import { createWriteStream } from 'node:fs';
import { access, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { browserlessFunction, browserlessMetadataFunction } from './browserless-capture-function.mjs';
import {
    DEFAULT_MAX_PAD_SECONDS,
    buildFullMatchPlan,
    fullMatchUsageText,
    parseFullMatchArgs,
    validateMatchHistoryMetadata
} from './capture-planner.mjs';
import {
    concatenateMp4Segments,
    preserveFailedWebm,
    processWebmToMp4,
    redactSecret,
    runCommand,
    validateExistingSegmentMp4
} from './capture-media.mjs';

const SPEED_URL_PARAM = 4;
const MAX_WEBM_BYTES = 100 * 1024 * 1024;
const METADATA_HTTP_TIMEOUT_MS = 40_000;
const METADATA_EXECUTION_BUDGET_MS = 30_000;
const SEGMENT_HTTP_TIMEOUT_MS = 55_000;
const MAX_REMOTE_SEGMENT_BUDGET_MS = 48_000;
const DEFAULT_VIDEO_TRACK_TIMESCALE = 30000;
const DEFAULT_PRESET = 'veryfast';
const DEFAULT_CRF = 23;

const NON_RETRYABLE_CODES = new Set([
    'TARGET_CONTRACT',
    'SEGMENT_CONTRACT',
    'UNAUTHORIZED_NAVIGATION',
    'MATCH_UNAVAILABLE',
    'MATCH_NOT_FOUND',
    'MATCH_NOT_FINISHED',
    'MATCH_CANCELLED',
    'INVALID_HISTORY',
    'HISTORY_UNAVAILABLE',
    'HISTORY_DURATION_MISMATCH',
    'CAPTURE_CONTRACT_OUTDATED',
    'INVALID_TARGET_DURATION',
    'SPEED_OUT_OF_RANGE',
    'RESUME_PLAN_MISMATCH',
    'RESUME_NOT_FOUND',
    'OUTPUT_EXISTS'
]);

const toolRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(toolRoot, '..', '..', '..');
const defaultOutputRoot = resolve(repositoryRoot, '.codex-artifacts-local', 'arena-pressure');

function createOrchestratorError(message, code, retryable = false) {
    const error = new Error(message);
    error.code = code;
    error.retryable = retryable;
    return error;
}

function safeUrl(value, variableName) {
    if (!value) throw new Error(`${variableName} is required.`);
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error(`${variableName} must use HTTP or HTTPS.`);
    }
    url.username = '';
    url.password = '';
    return url;
}

function collectSecrets(captureKey, browserlessEndpoint, rawBrowserlessUrl) {
    const items = [];
    const add = value => {
        if (typeof value === 'string' && value.length >= 4 && !items.includes(value)) {
            items.push(value);
        }
    };
    if (typeof captureKey === 'string' && captureKey.length > 0) {
        items.push(captureKey);
    }
    if (browserlessEndpoint?.search) {
        items.push(browserlessEndpoint.search);
    }
    if (browserlessEndpoint?.searchParams) {
        for (const value of browserlessEndpoint.searchParams.values()) {
            add(value);
        }
    }
    if (rawBrowserlessUrl) {
        try {
            const raw = new URL(rawBrowserlessUrl);
            add(raw.username);
            add(raw.password);
        } catch {
            // Raw URL was validated by safeUrl before reaching here.
        }
    }
    return items;
}

async function pathExists(filePath) {
    try {
        await access(filePath);
        return true;
    } catch (error) {
        if (error?.code === 'ENOENT') return false;
        throw error;
    }
}

async function writeJsonAtomic(filePath, value) {
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(tmpPath, filePath);
}

function extractCaptureCodeFromText(text) {
    const match = String(text ?? '').match(/\b(TARGET_CONTRACT|SEGMENT_CONTRACT|UNAUTHORIZED_NAVIGATION|MATCH_UNAVAILABLE|MATCH_NOT_FOUND|MATCH_LOAD_ERROR|MATCH_NOT_FINISHED|MATCH_CANCELLED|HISTORY_UNAVAILABLE|HISTORY_DURATION_MISMATCH|CAPTURE_CONTRACT_OUTDATED|SEGMENT_SEEK_TIMEOUT|SEGMENT_SEEK_FAILED|REPLAY_START_FAILED|REPLAY_CLOCK|REPLAY_END_NOT_REACHED|NAV_TIMEOUT|PHASER_TIMEOUT|SCREENCAST_TIMEOUT|BUDGET_EXHAUSTED)\b/);
    return match ? match[1] : null;
}

function buildTargetNavigation(allowedOriginUrl, culture, matchId) {
    const targetUrl = new URL(`/${culture}/tv/pressure/${matchId}/match`, allowedOriginUrl.origin);
    targetUrl.searchParams.set('mode', 'videoCapture');
    targetUrl.searchParams.set('speed', String(SPEED_URL_PARAM));
    if (targetUrl.protocol !== 'https:') {
        throw new Error('ARENA_PRESSURE_CAPTURE_BASE_URL must use HTTPS.');
    }
    return {
        targetUrl: targetUrl.toString(),
        authorizedNavigation: {
            href: targetUrl.href,
            protocol: targetUrl.protocol,
            hostname: targetUrl.hostname,
            port: targetUrl.port,
            pathname: targetUrl.pathname,
            search: targetUrl.search
        }
    };
}

async function defaultFetchMetadata({
    browserlessBaseUrl,
    targetUrl,
    authorizedNavigation,
    captureKey,
    width,
    height,
    secrets
}) {
    const endpoint = new URL(browserlessBaseUrl.href);
    endpoint.pathname = '/function';

    const controller = new AbortController();
    const timeoutHandle = setTimeout(
        () => controller.abort(createOrchestratorError('Browserless metadata request exceeded 40s.', 'METADATA_TIMEOUT', true)),
        METADATA_HTTP_TIMEOUT_MS
    );

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code: browserlessMetadataFunction,
                context: {
                    targetUrl,
                    authorizedNavigation,
                    captureKey,
                    width,
                    height,
                    executionBudgetMs: METADATA_EXECUTION_BUDGET_MS,
                    navigationTimeoutMs: 15_000,
                    phaserTimeoutMs: 15_000
                }
            }),
            signal: controller.signal
        });

        const rawText = await response.text();
        const safeBody = redactSecret(rawText, secrets);
        if (!response.ok) {
            const extractedCode = extractCaptureCodeFromText(safeBody) ?? 'METADATA_HTTP_ERROR';
            const retryable = !NON_RETRYABLE_CODES.has(extractedCode) && (response.status >= 500 || response.status === 429 || response.status === 408);
            throw createOrchestratorError(
                `Browserless metadata probe failed with HTTP ${response.status}: ${safeBody.slice(0, 300)}`,
                extractedCode,
                retryable
            );
        }

        let parsed;
        try {
            parsed = JSON.parse(rawText);
        } catch (error) {
            throw createOrchestratorError(`Browserless metadata returned invalid JSON: ${error.message}`, 'METADATA_INVALID_JSON', true);
        }
        return parsed && typeof parsed === 'object' && 'data' in parsed && !('found' in parsed)
            ? parsed.data
            : parsed;
    } finally {
        clearTimeout(timeoutHandle);
    }
}

async function defaultCaptureSegmentWebm({
    browserlessBaseUrl,
    targetUrl,
    authorizedNavigation,
    captureKey,
    width,
    height,
    segment,
    totalSegments,
    historicalDurationSeconds,
    replaySpeed,
    recordingDurationSeconds,
    outputWebmPartialPath,
    secrets
}) {
    const endpoint = new URL(browserlessBaseUrl.href);
    endpoint.pathname = '/screencast';
    const durationMs = Math.round(recordingDurationSeconds * 1000);
    const executionBudgetMs = Math.min(MAX_REMOTE_SEGMENT_BUDGET_MS, Math.max(44_000, durationMs + 33_000));

    const controller = new AbortController();
    const timeoutHandle = setTimeout(
        () => controller.abort(createOrchestratorError(
            `Browserless segment ${segment.label} screencast exceeded ${SEGMENT_HTTP_TIMEOUT_MS / 1000}s.`,
            'SEGMENT_HTTP_TIMEOUT',
            true
        )),
        SEGMENT_HTTP_TIMEOUT_MS
    );

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code: browserlessFunction,
                context: {
                    targetUrl,
                    authorizedNavigation,
                    captureKey,
                    width,
                    height,
                    durationMs,
                    executionBudgetMs,
                    navigationTimeoutMs: 15_000,
                    phaserTimeoutMs: 15_000,
                    visualPreparationTimeoutMs: 4_000,
                    segment: {
                        index: segment.index,
                        totalSegments,
                        historicalStartSeconds: segment.historicalStartSeconds,
                        historicalEndSeconds: segment.historicalEndSeconds,
                        speed: replaySpeed,
                        videoStartSeconds: segment.videoStartSeconds,
                        expectedHistoricalDurationSeconds: historicalDurationSeconds,
                        isFinalSegment: segment.isFinalSegment,
                        maxWallDeviationSeconds: 0.75
                    }
                }
            }),
            signal: controller.signal
        });

        if (!response.ok || !response.body) {
            const errText = redactSecret(await response.text().catch(() => ''), secrets);
            const extractedCode = extractCaptureCodeFromText(errText) ?? 'SCREENCAST_HTTP_ERROR';
            const retryable = !NON_RETRYABLE_CODES.has(extractedCode);
            throw createOrchestratorError(
                `Browserless screencast failed for segment ${segment.label} with HTTP ${response.status}${errText ? `: ${errText.slice(0, 300)}` : ''}.`,
                extractedCode,
                retryable
            );
        }

        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.toLowerCase().includes('video/webm')) {
            const bodySnippet = redactSecret(await response.text().catch(() => ''), secrets);
            throw createOrchestratorError(
                `Browserless returned unexpected content type ${contentType || '(missing)'}${bodySnippet ? `: ${bodySnippet.slice(0, 200)}` : ''}.`,
                'UNEXPECTED_CONTENT_TYPE',
                true
            );
        }

        let received = 0;
        const limiter = new Transform({
            transform(chunk, _encoding, callback) {
                received += chunk.length;
                callback(
                    received <= MAX_WEBM_BYTES
                        ? null
                        : createOrchestratorError('WebM exceeded the 100 MiB safety limit.', 'WEBM_SIZE_LIMIT', false),
                    chunk
                );
            }
        });
        await pipeline(Readable.fromWeb(response.body), limiter, createWriteStream(outputWebmPartialPath, { flags: 'wx' }));
        return { bytesReceived: received };
    } finally {
        clearTimeout(timeoutHandle);
    }
}

async function resolveWorkDirectory({ matchId, outputRoot, resumeTarget, explicitRunId }) {
    const runsRoot = resolve(outputRoot, 'runs');
    if (resumeTarget) {
        const candidates = isAbsolute(resumeTarget)
            ? [resumeTarget]
            : [
                resolve(resumeTarget),
                resolve(runsRoot, resumeTarget),
                resolve(runsRoot, `match-${matchId}-${resumeTarget}`)
            ];
        for (const candidate of candidates) {
            const manifestCandidate = resolve(candidate, 'manifest.json');
            if (await pathExists(manifestCandidate)) {
                const raw = await readFile(manifestCandidate, 'utf8');
                const manifest = JSON.parse(raw);
                if (manifest.matchId !== matchId) {
                    throw createOrchestratorError(
                        `Resume manifest matchId (${manifest.matchId}) does not match --match-id ${matchId}.`,
                        'RESUME_PLAN_MISMATCH',
                        false
                    );
                }
                return {
                    isResume: true,
                    runId: String(manifest.runId),
                    workDir: candidate,
                    existingManifest: manifest
                };
            }
        }
        throw createOrchestratorError(`Could not find resumable manifest.json for "${resumeTarget}".`, 'RESUME_NOT_FOUND', false);
    }

    const runId = explicitRunId ?? new Date().toISOString().replace(/[-:.]/g, '');
    const workDir = resolve(runsRoot, `match-${matchId}-${runId}`);
    if (await pathExists(workDir)) {
        throw createOrchestratorError(
            `Run directory already exists (${workDir}). Pass --resume ${runId} to resume.`,
            'RUN_DIR_EXISTS',
            false
        );
    }
    return {
        isResume: false,
        runId,
        workDir,
        existingManifest: null
    };
}

function isRetryableError(error) {
    if (!error) return false;
    const code = error.code ?? error.captureCode;
    if (code && NON_RETRYABLE_CODES.has(code)) return false;
    if (error.retryable === false) return false;
    return true;
}

export async function runFullMatchCapture({
    matchId,
    targetDurationSeconds = 120,
    segmentDurationSeconds = 10,
    maxSegments = null,
    width = 1280,
    height = 720,
    fps = 30,
    threads = 2,
    maxRetries = 2,
    tailPadSeconds = 0.5,
    culture = 'en',
    baseUrl = null,
    outputRoot = defaultOutputRoot,
    runId: explicitRunId = null,
    resume = null,
    keepIntermediates = false,
    browserlessBaseUrl = null,
    allowedCaptureOrigin = null,
    captureKey = null,
    secrets = [],
    ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg',
    ffprobe = process.env.FFPROBE_PATH ?? 'ffprobe',
    run = runCommand,
    fetchMetadata = defaultFetchMetadata,
    captureSegmentWebm = defaultCaptureSegmentWebm,
    sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms)),
    now = () => new Date(),
    onLog = null
}) {
    const resolvedOutputRoot = resolve(outputRoot);
    const notes = [];
    let lockHandle = null;
    const lockPath = resolve(resolvedOutputRoot, 'browserless-preview.lock');
    let logPath = resolve(resolvedOutputRoot, `arena-pressure-match-${matchId}-full-error-${Date.now()}.log`);
    let manifestPath = null;
    let manifest = null;

    const log = message => {
        const safe = redactSecret(message, secrets);
        const line = `${now().toISOString()} ${safe}`;
        notes.push(line);
        if (typeof onLog === 'function') {
            onLog(line, safe);
        } else {
            console.log(line);
        }
    };

    try {
        await mkdir(resolvedOutputRoot, { recursive: true });
        lockHandle = await open(lockPath, 'wx')
            .catch(() => {
                throw createOrchestratorError(
                    `Another Browserless capture is active (${lockPath}).`,
                    'CAPTURE_LOCKED',
                    false
                );
            });
        await lockHandle.writeFile(JSON.stringify({
            pid: process.pid,
            mode: 'full-match',
            matchId,
            startedAt: now().toISOString()
        }));

        await run(ffmpeg, ['-version']);
        await run(ffprobe, ['-version']);

        const workInfo = await resolveWorkDirectory({
            matchId,
            outputRoot: resolvedOutputRoot,
            resumeTarget: resume,
            explicitRunId
        });
        const runId = workInfo.runId;
        const workDir = workInfo.workDir;
        const segmentsDir = resolve(workDir, 'segments');
        const concatManifestPath = resolve(workDir, 'concat-list.txt');
        manifestPath = resolve(workDir, 'manifest.json');

        log(`[FULL_MATCH:START] matchId=${matchId} runId=${runId} resume=${workInfo.isResume}`);

        let targetNav = { targetUrl: null, authorizedNavigation: null };
        if (allowedCaptureOrigin) {
            const requestedBase = safeUrl(baseUrl ?? allowedCaptureOrigin.origin, '--base-url');
            if (requestedBase.origin !== allowedCaptureOrigin.origin) {
                throw createOrchestratorError(
                    '--base-url must exactly match the configured ARENA_PRESSURE_CAPTURE_BASE_URL origin.',
                    'TARGET_CONTRACT',
                    false
                );
            }
            targetNav = buildTargetNavigation(allowedCaptureOrigin, culture, matchId);
        }

        const rawMetadata = await fetchMetadata({
            matchId,
            culture,
            browserlessBaseUrl,
            targetUrl: targetNav.targetUrl,
            authorizedNavigation: targetNav.authorizedNavigation,
            captureKey,
            width,
            height,
            secrets
        });
        const metadata = validateMatchHistoryMetadata(rawMetadata);

        log(
            `[FULL_MATCH:HISTORY_LOADED] matchId=${matchId}`
            + ` historicalDuration=${metadata.historicalDurationSeconds.toFixed(3)}`
            + ` historyPoints=${metadata.historyPoints}`
            + ` officialResult=${String(metadata.officialResult ?? 'unknown')}`
            + ` pair=${String(metadata.leftSymbol ?? '?')}v${String(metadata.rightSymbol ?? '?')}`
        );

        const plan = buildFullMatchPlan({
            matchId,
            historicalDurationSeconds: metadata.historicalDurationSeconds,
            historyPoints: metadata.historyPoints,
            targetVideoDurationSeconds: targetDurationSeconds,
            segmentDurationSeconds,
            maxSegments,
            width,
            height,
            fps,
            culture,
            tailPadSeconds
        });

        const suffix = plan.isPartialValidationRun
            ? `partial-${plan.selectedSegmentCount}of${plan.totalSegments}`
            : 'full';
        const prefix = `arena-pressure-match-${matchId}-${suffix}-${runId}`;
        const finalMp4Path = resolve(resolvedOutputRoot, `${prefix}.mp4`);
        const finalMp4PartialPath = resolve(workDir, `${prefix}.mp4.partial`);
        const finalReportPath = resolve(resolvedOutputRoot, `${prefix}.json`);
        logPath = resolve(resolvedOutputRoot, `${prefix}.log`);

        if (await pathExists(finalMp4Path) || await pathExists(finalReportPath)) {
            throw createOrchestratorError(
                `Refusing to overwrite existing final output artifacts for ${prefix}.`,
                'OUTPUT_EXISTS',
                false
            );
        }

        if (workInfo.isResume) {
            if (workInfo.existingManifest.planFingerprint !== plan.planFingerprint) {
                throw createOrchestratorError(
                    `Resume plan mismatch: stored fingerprint ${workInfo.existingManifest.planFingerprint} differs from current ${plan.planFingerprint}.`,
                    'RESUME_PLAN_MISMATCH',
                    false
                );
            }
            manifest = {
                ...workInfo.existingManifest,
                status: 'in_progress',
                updatedAtUtc: now().toISOString()
            };
        } else {
            await mkdir(segmentsDir, { recursive: true });
            manifest = {
                schemaVersion: 1,
                runId,
                matchId,
                status: 'in_progress',
                planFingerprint: plan.planFingerprint,
                createdAtUtc: now().toISOString(),
                updatedAtUtc: now().toISOString(),
                metadata,
                plan: {
                    culture: plan.culture,
                    width: plan.width,
                    height: plan.height,
                    fps: plan.fps,
                    historicalDurationSeconds: plan.historicalDurationSeconds,
                    requestedTargetDurationSeconds: plan.requestedTargetDurationSeconds,
                    effectiveTargetDurationSeconds: plan.effectiveTargetDurationSeconds,
                    shortMatchAdjusted: plan.shortMatchAdjusted,
                    segmentDurationSeconds: plan.segmentDurationSeconds,
                    tailPadSeconds: plan.tailPadSeconds,
                    replaySpeed: plan.replaySpeed,
                    totalTargetFrames: plan.totalTargetFrames,
                    totalSegments: plan.totalSegments,
                    selectedSegmentCount: plan.selectedSegmentCount,
                    selectedTargetFrames: plan.selectedTargetFrames,
                    selectedVideoDurationSeconds: plan.selectedVideoDurationSeconds,
                    isPartialValidationRun: plan.isPartialValidationRun
                },
                segments: plan.selectedSegments.map(seg => ({
                    index: seg.index,
                    label: seg.label,
                    status: 'pending',
                    attempts: 0,
                    startFrame: seg.startFrame,
                    endFrame: seg.endFrame,
                    targetFrames: seg.targetFrames,
                    videoStartSeconds: seg.videoStartSeconds,
                    videoEndSeconds: seg.videoEndSeconds,
                    videoDurationSeconds: seg.videoDurationSeconds,
                    recordingDurationSeconds: seg.recordingDurationSeconds,
                    historicalStartSeconds: seg.historicalStartSeconds,
                    historicalEndSeconds: seg.historicalEndSeconds,
                    isFinalSegment: seg.isFinalSegment,
                    mp4FileName: `segment-${seg.label}.mp4`,
                    webmDurationSeconds: null,
                    mp4DurationSeconds: null,
                    mp4Frames: null,
                    mp4Bytes: null,
                    effectiveCaptureFps: null,
                    averageFps: null,
                    trimmedSeconds: null,
                    paddedSeconds: null,
                    lastError: null
                })),
                output: null
            };
        }
        await writeJsonAtomic(manifestPath, manifest);

        log(
            `[FULL_MATCH:PLAN_READY] matchId=${matchId}`
            + ` historicalDuration=${plan.historicalDurationSeconds.toFixed(3)}`
            + ` targetVideoDuration=${plan.effectiveTargetDurationSeconds.toFixed(3)}`
            + ` replaySpeed=${plan.replaySpeed.toFixed(4)}`
            + ` segments=${plan.selectedSegmentCount}`
            + (plan.isPartialValidationRun ? ` totalPlanSegments=${plan.totalSegments}` : '')
        );
        for (const seg of plan.selectedSegments) {
            log(
                `[FULL_MATCH:PLAN_SEGMENT] segment=${seg.label}/${String(plan.totalSegments).padStart(2, '0')}`
                + ` video=${seg.videoStartSeconds.toFixed(3)}..${seg.videoEndSeconds.toFixed(3)}s`
                + ` history=${seg.historicalStartSeconds.toFixed(3)}..${seg.historicalEndSeconds.toFixed(3)}s`
                + ` frames=${seg.targetFrames}`
            );
        }

        let segmentsReused = 0;
        let segmentsCaptured = 0;
        const segmentMp4Paths = [];

        for (let idx = 0; idx < plan.selectedSegments.length; idx++) {
            const seg = plan.selectedSegments[idx];
            const entry = manifest.segments[idx];
            const segMp4Path = resolve(segmentsDir, entry.mp4FileName);
            const segMp4PartialPath = resolve(segmentsDir, `${entry.mp4FileName}.partial`);
            const segWebmPartialPath = resolve(segmentsDir, `segment-${seg.label}.webm.partial`);
            const segWebmPath = resolve(segmentsDir, `segment-${seg.label}.webm`);

            if (workInfo.isResume && entry.status === 'completed') {
                const check = await validateExistingSegmentMp4({
                    filePath: segMp4Path,
                    width: plan.width,
                    height: plan.height,
                    fps: plan.fps,
                    expectedFrames: seg.targetFrames,
                    expectedDuration: seg.videoDurationSeconds,
                    toleranceSeconds: (1 / plan.fps) + 0.02,
                    ffmpeg,
                    ffprobe,
                    run
                });
                if (check.valid) {
                    segmentsReused += 1;
                    segmentMp4Paths.push(segMp4Path);
                    log(
                        `[FULL_MATCH:SEGMENT_REUSED] matchId=${matchId} segment=${seg.label}/${String(plan.totalSegments).padStart(2, '0')}`
                        + ` frames=${check.validation.frames} duration=${check.validation.duration.seconds.toFixed(3)} bytes=${check.bytes}`
                    );
                    continue;
                }
                log(
                    `Segment ${seg.label} marked completed in manifest failed integrity check (${check.reason}); re-capturing.`
                );
                entry.status = 'pending';
                await rm(segMp4Path, { force: true }).catch(() => {});
            }

            const totalAttempts = 1 + maxRetries;
            let completedSegment = false;
            let lastSegmentError = null;

            for (let attempt = 1; attempt <= totalAttempts; attempt++) {
                entry.status = 'running';
                entry.attempts += 1;
                manifest.updatedAtUtc = now().toISOString();
                await writeJsonAtomic(manifestPath, manifest);

                await rm(segWebmPartialPath, { force: true }).catch(() => {});
                await rm(segWebmPath, { force: true }).catch(() => {});
                await rm(segMp4PartialPath, { force: true }).catch(() => {});
                await rm(segMp4Path, { force: true }).catch(() => {});

                let receivedWebm = false;
                try {
                    log(
                        `[FULL_MATCH:SEGMENT_START] matchId=${matchId}`
                        + ` segment=${seg.label}/${String(plan.totalSegments).padStart(2, '0')}`
                        + ` attempt=${attempt}/${totalAttempts}`
                        + ` videoStart=${seg.videoStartSeconds.toFixed(3)}`
                        + ` videoEnd=${seg.videoEndSeconds.toFixed(3)}`
                        + ` historicalStart=${seg.historicalStartSeconds.toFixed(3)}`
                        + ` historicalEnd=${seg.historicalEndSeconds.toFixed(3)}`
                        + ` speed=${plan.replaySpeed.toFixed(4)}`
                    );

                    await captureSegmentWebm({
                        matchId,
                        culture,
                        browserlessBaseUrl,
                        targetUrl: targetNav.targetUrl,
                        authorizedNavigation: targetNav.authorizedNavigation,
                        captureKey,
                        width: plan.width,
                        height: plan.height,
                        segment: seg,
                        totalSegments: plan.totalSegments,
                        historicalDurationSeconds: plan.historicalDurationSeconds,
                        replaySpeed: plan.replaySpeed,
                        recordingDurationSeconds: seg.recordingDurationSeconds,
                        outputWebmPartialPath: segWebmPartialPath,
                        attempt,
                        secrets
                    });
                    receivedWebm = await pathExists(segWebmPartialPath);

                    const maxPadFrames = Math.ceil(DEFAULT_MAX_PAD_SECONDS * plan.fps);
                    const minWebmDurationSeconds = Math.max(1.0, seg.videoDurationSeconds - DEFAULT_MAX_PAD_SECONDS);
                    const processed = await processWebmToMp4({
                        inputPath: segWebmPartialPath,
                        outputPath: segMp4Path,
                        mp4PartialPath: segMp4PartialPath,
                        width: plan.width,
                        height: plan.height,
                        fps: plan.fps,
                        expectedDuration: seg.recordingDurationSeconds,
                        toleranceSeconds: Math.max(2.0, DEFAULT_MAX_PAD_SECONDS + plan.tailPadSeconds + 0.5),
                        threads,
                        preset: DEFAULT_PRESET,
                        crf: DEFAULT_CRF,
                        exactFrames: seg.targetFrames,
                        maxPadFrames,
                        normalizeTimestamps: true,
                        videoTrackTimescale: DEFAULT_VIDEO_TRACK_TIMESCALE,
                        keyint: plan.fps,
                        h264Profile: 'high',
                        mp4ExpectedDuration: seg.videoDurationSeconds,
                        mp4ToleranceSeconds: (1 / plan.fps) + 0.02,
                        minWebmDurationSeconds,
                        ffmpeg,
                        ffprobe,
                        run,
                        log,
                        secrets,
                        onWebmValidated: async () => {
                            if (keepIntermediates) {
                                await rename(segWebmPartialPath, segWebmPath);
                                return segWebmPath;
                            }
                            return segWebmPartialPath;
                        }
                    });

                    if (!keepIntermediates) {
                        await rm(segWebmPartialPath, { force: true }).catch(() => {});
                    }

                    const webmDuration = processed.webmValidation.duration.seconds ?? seg.videoDurationSeconds;
                    const mp4Duration = processed.mp4Validation.duration.seconds ?? seg.videoDurationSeconds;
                    const trimmedSeconds = Math.max(0, webmDuration - mp4Duration);
                    const paddedSeconds = Math.max(0, mp4Duration - webmDuration);

                    entry.status = 'completed';
                    entry.webmDurationSeconds = webmDuration;
                    entry.mp4DurationSeconds = mp4Duration;
                    entry.mp4Frames = processed.mp4Validation.frames;
                    entry.mp4Bytes = processed.mp4Bytes;
                    entry.effectiveCaptureFps = processed.timing.effectiveCaptureFps;
                    entry.averageFps = processed.timing.averageFps;
                    entry.trimmedSeconds = trimmedSeconds;
                    entry.paddedSeconds = paddedSeconds;
                    entry.lastError = null;
                    manifest.updatedAtUtc = now().toISOString();
                    await writeJsonAtomic(manifestPath, manifest);

                    log(
                        `[FULL_MATCH:SEGMENT_COMPLETE] matchId=${matchId}`
                        + ` segment=${seg.label}/${String(plan.totalSegments).padStart(2, '0')}`
                        + ` attempt=${attempt}`
                        + ` effectiveFps=${processed.timing.effectiveCaptureFps.toFixed(2)}`
                        + ` averageFps=${processed.timing.averageFps.toFixed(2)}`
                        + ` webmDuration=${webmDuration.toFixed(3)}`
                        + ` mp4Duration=${mp4Duration.toFixed(3)}`
                        + ` frames=${processed.mp4Validation.frames}`
                        + ` trimmedSeconds=${trimmedSeconds.toFixed(3)}`
                        + ` paddedSeconds=${paddedSeconds.toFixed(3)}`
                    );

                    segmentsCaptured += 1;
                    segmentMp4Paths.push(segMp4Path);
                    completedSegment = true;
                    break;
                } catch (error) {
                    lastSegmentError = error;
                    if (receivedWebm && await pathExists(segWebmPartialPath)) {
                        const failedPath = resolve(segmentsDir, `segment-${seg.label}.failed-attempt-${entry.attempts}.webm`);
                        await preserveFailedWebm(segWebmPartialPath, failedPath).catch(() => {});
                        if (entry.attempts > 1) {
                            const prevFailed = resolve(segmentsDir, `segment-${seg.label}.failed-attempt-${entry.attempts - 1}.webm`);
                            await rm(prevFailed, { force: true }).catch(() => {});
                        }
                    } else {
                        await rm(segWebmPartialPath, { force: true }).catch(() => {});
                    }
                    await rm(segMp4PartialPath, { force: true }).catch(() => {});

                    const retryable = isRetryableError(error);
                    const safeReason = redactSecret(
                        String(error?.message ?? error).replace(/\s+/g, ' ').trim(),
                        secrets
                    );
                    entry.status = 'failed';
                    entry.lastError = safeReason;
                    manifest.updatedAtUtc = now().toISOString();
                    await writeJsonAtomic(manifestPath, manifest);

                    log(
                        `[FULL_MATCH:SEGMENT_FAILED] matchId=${matchId}`
                        + ` segment=${seg.label}/${String(plan.totalSegments).padStart(2, '0')}`
                        + ` attempt=${attempt}/${totalAttempts}`
                        + ` retryable=${retryable}`
                        + ` reason=${safeReason}`
                    );

                    if (!retryable || attempt >= totalAttempts) {
                        throw error;
                    }
                    await sleep(attempt * 2000);
                }
            }

            if (!completedSegment && lastSegmentError) {
                throw lastSegmentError;
            }
        }

        log(
            `[FULL_MATCH:ASSEMBLY_START] matchId=${matchId}`
            + ` segments=${segmentMp4Paths.length}`
            + ` expectedFrames=${plan.selectedTargetFrames}`
            + ` expectedDuration=${plan.selectedVideoDurationSeconds.toFixed(3)}`
        );

        const maxDurationDeviationSeconds = Math.max(0.1, (2 / plan.fps));
        const assembly = await concatenateMp4Segments({
            segmentPaths: segmentMp4Paths,
            manifestPath: concatManifestPath,
            outputPath: finalMp4Path,
            partialOutputPath: finalMp4PartialPath,
            width: plan.width,
            height: plan.height,
            fps: plan.fps,
            expectedFrames: plan.selectedTargetFrames,
            expectedDuration: plan.selectedVideoDurationSeconds,
            maxDurationDeviationSeconds,
            threads,
            preset: DEFAULT_PRESET,
            crf: DEFAULT_CRF,
            videoTrackTimescale: DEFAULT_VIDEO_TRACK_TIMESCALE,
            ffmpeg,
            ffprobe,
            run,
            log,
            secrets
        });

        const v = assembly.validation;
        log(
            `[FULL_MATCH:ASSEMBLY_COMPLETE] matchId=${matchId}`
            + ` strategy=${assembly.strategy}`
            + ` duration=${v.duration.seconds.toFixed(3)}`
            + ` frames=${v.frames}`
            + ` bytes=${assembly.mp4Bytes}`
        );
        log(
            `[FULL_MATCH:MP4_VALIDATED] matchId=${matchId}`
            + ` codec=${v.stream.codec_name}`
            + ` resolution=${v.stream.width}x${v.stream.height}`
            + ` avgFrameRate=${v.stream.avg_frame_rate}`
            + ` pixFmt=${v.stream.pix_fmt}`
            + ` faststart=${v.faststart}`
            + ` duration=${v.duration.seconds.toFixed(3)}`
            + ` frames=${v.frames}`
            + ` maxGapMs=${v.maxGapMs.toFixed(1)}`
        );

        const report = {
            schemaVersion: 1,
            status: 'validated',
            runId,
            matchId,
            culture: plan.culture,
            leftSymbol: metadata.leftSymbol,
            rightSymbol: metadata.rightSymbol,
            officialResult: metadata.officialResult,
            historicalDurationSeconds: plan.historicalDurationSeconds,
            historyPoints: plan.historyPoints,
            requestedTargetDurationSeconds: plan.requestedTargetDurationSeconds,
            effectiveTargetDurationSeconds: plan.effectiveTargetDurationSeconds,
            shortMatchAdjusted: plan.shortMatchAdjusted,
            replaySpeed: plan.replaySpeed,
            isPartialValidationRun: plan.isPartialValidationRun,
            plannedSegments: plan.totalSegments,
            selectedSegments: plan.selectedSegmentCount,
            completedSegments: manifest.segments.filter(item => item.status === 'completed').length,
            segmentsReused,
            segmentsCaptured,
            assemblyStrategy: assembly.strategy,
            outputPath: finalMp4Path,
            reportPath: finalReportPath,
            logPath,
            manifestPath,
            validationStatus: 'validated',
            outputCodec: v.stream.codec_name,
            width: v.stream.width,
            height: v.stream.height,
            outputFps: v.stream.avg_frame_rate,
            outputPixelFormat: v.stream.pix_fmt,
            faststart: v.faststart,
            finalDurationSeconds: v.duration.seconds,
            expectedDurationSeconds: plan.selectedVideoDurationSeconds,
            finalFrames: v.frames,
            expectedFrames: plan.selectedTargetFrames,
            maxFrameGapMs: v.maxGapMs,
            firstLuma: v.firstLuma,
            midLuma: v.midLuma,
            lastLuma: v.lastLuma,
            mp4Bytes: assembly.mp4Bytes,
            assemblyDurationSeconds: assembly.assemblyDurationSeconds,
            segments: manifest.segments.map(item => ({
                index: item.index,
                label: item.label,
                status: item.status,
                attempts: item.attempts,
                videoStartSeconds: item.videoStartSeconds,
                videoEndSeconds: item.videoEndSeconds,
                historicalStartSeconds: item.historicalStartSeconds,
                historicalEndSeconds: item.historicalEndSeconds,
                targetFrames: item.targetFrames,
                mp4Frames: item.mp4Frames,
                webmDurationSeconds: item.webmDurationSeconds,
                mp4DurationSeconds: item.mp4DurationSeconds,
                effectiveCaptureFps: item.effectiveCaptureFps,
                averageFps: item.averageFps,
                trimmedSeconds: item.trimmedSeconds,
                paddedSeconds: item.paddedSeconds
            })),
            generatedAtUtc: now().toISOString()
        };

        await writeFile(finalReportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });

        manifest.status = 'completed';
        manifest.updatedAtUtc = now().toISOString();
        manifest.output = {
            mp4Path: finalMp4Path,
            reportPath: finalReportPath,
            logPath
        };
        await writeJsonAtomic(manifestPath, manifest);

        if (!keepIntermediates) {
            await rm(segmentsDir, { recursive: true, force: true }).catch(() => {});
            await rm(concatManifestPath, { force: true }).catch(() => {});
        }

        log(
            `[FULL_MATCH:COMPLETE] matchId=${matchId} runId=${runId}`
            + ` output=${finalMp4Path} report=${finalReportPath}`
        );

        return report;
    } catch (error) {
        if (manifest && manifestPath) {
            manifest.status = 'failed';
            manifest.updatedAtUtc = now().toISOString();
            await writeJsonAtomic(manifestPath, manifest).catch(() => {});
        }
        const diagnostic = redactSecret(error?.stack ?? error?.message ?? error, secrets);
        notes.push(`${now().toISOString()} FATAL ${diagnostic}`);
        throw error;
    } finally {
        if (lockHandle) await lockHandle.close().catch(() => {});
        if (lockHandle) await rm(lockPath, { force: true }).catch(() => {});
        await mkdir(dirname(logPath), { recursive: true }).catch(() => {});
        await writeFile(logPath, `${notes.join('\n')}\n`, 'utf8').catch(() => {});
    }
}

function isDirectExecution() {
    if (!process.argv[1]) return false;
    const entry = resolve(process.argv[1]);
    const self = fileURLToPath(import.meta.url);
    return process.platform === 'win32'
        ? entry.toLowerCase() === self.toLowerCase()
        : entry === self;
}

async function main() {
    let options;
    try {
        options = parseFullMatchArgs(process.argv.slice(2));
    } catch (error) {
        console.error(error.message);
        console.error(fullMatchUsageText());
        process.exit(2);
    }

    if (options.help) {
        console.log(fullMatchUsageText());
        process.exit(0);
    }

    let secrets = [];
    try {
        const rawBrowserlessUrl = process.env.ARENA_PRESSURE_BROWSERLESS_URL;
        const browserlessBaseUrl = safeUrl(rawBrowserlessUrl, 'ARENA_PRESSURE_BROWSERLESS_URL');
        const allowedCaptureOrigin = safeUrl(process.env.ARENA_PRESSURE_CAPTURE_BASE_URL, 'ARENA_PRESSURE_CAPTURE_BASE_URL');
        const captureKey = process.env.ARENA_PRESSURE_CAPTURE_KEY;
        if (!captureKey?.trim()) {
            throw new Error('ARENA_PRESSURE_CAPTURE_KEY is required.');
        }
        secrets = collectSecrets(captureKey, browserlessBaseUrl, rawBrowserlessUrl);

        await runFullMatchCapture({
            matchId: options.matchId,
            targetDurationSeconds: options.targetDurationSeconds,
            segmentDurationSeconds: options.segmentDurationSeconds,
            maxSegments: options.maxSegments,
            width: options.width,
            height: options.height,
            fps: options.fps,
            threads: options.threads,
            maxRetries: options.maxRetries,
            tailPadSeconds: options.tailPadSeconds,
            culture: options.culture,
            baseUrl: options.baseUrl,
            outputRoot: options.output ?? defaultOutputRoot,
            runId: options.runId,
            resume: options.resume,
            keepIntermediates: options.keepIntermediates,
            browserlessBaseUrl,
            allowedCaptureOrigin,
            captureKey,
            secrets
        });
    } catch (error) {
        console.error(redactSecret(error?.message ?? String(error), secrets));
        process.exit(1);
    }
}

if (isDirectExecution()) {
    await main();
}
