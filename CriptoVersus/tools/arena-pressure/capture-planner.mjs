import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { parseMatchId } from './capture-browserless-options.mjs';

export const DEFAULT_TARGET_DURATION_SECONDS = 120;
export const DEFAULT_SEGMENT_DURATION_SECONDS = 10;
export const MIN_SEGMENT_DURATION_SECONDS = 5;
export const MAX_SEGMENT_DURATION_SECONDS = 15;
export const MIN_REPLAY_SPEED = 0.1;
export const MAX_REPLAY_SPEED = 10000;
export const DEFAULT_TAIL_PAD_SECONDS = 0.5;
export const DEFAULT_MAX_PAD_SECONDS = 1.0;
export const DEFAULT_WIDTH = 1280;
export const DEFAULT_HEIGHT = 720;
export const DEFAULT_FPS = 30;
export const DEFAULT_THREADS = 2;
export const DEFAULT_MAX_RETRIES = 2;
export const CAPTURE_ROUTE_CULTURES = new Set(['en', 'pt', 'zh', 'es', 'fr', 'de', 'it', 'ja', 'hi']);

const VALUE_OPTIONS = new Set([
    'match-id',
    'target-duration',
    'segment-duration',
    'max-segments',
    'width',
    'height',
    'fps',
    'threads',
    'max-retries',
    'tail-pad',
    'culture',
    'base-url',
    'output',
    'resume',
    'run-id',
    'keep-intermediates'
]);

function createPlannerError(message, code, retryable = false) {
    const error = new Error(message);
    error.code = code;
    error.retryable = retryable;
    return error;
}

function parseFiniteNumber(name, raw, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY, minInclusive = true } = {}) {
    if (raw === undefined || raw === null || typeof raw === 'boolean') {
        throw new Error(`--${name} must be a finite number.`);
    }
    const text = String(raw).trim();
    if (!text) throw new Error(`--${name} must be a finite number.`);
    const value = Number(text);
    const belowMin = minInclusive ? value < min : value <= min;
    if (!Number.isFinite(value) || belowMin || value > max) {
        const bound = minInclusive ? `[${min}..${max}]` : `(${min}..${max}]`;
        throw new Error(`--${name} must be a finite number in ${bound}.`);
    }
    return value;
}

function parsePositiveInt(name, raw, min = 1, max = 10000) {
    if (typeof raw !== 'string' || !/^[0-9]+$/.test(raw)) {
        throw new Error(`--${name} must be an integer between ${min} and ${max}.`);
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max) {
        throw new Error(`--${name} must be an integer between ${min} and ${max}.`);
    }
    return value;
}

function parseBooleanOption(name, raw) {
    const normalized = String(raw).trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
    throw new Error(`--${name} must be true or false.`);
}

export function fullMatchUsageText() {
    return [
        'Usage: node tools/arena-pressure/capture-full-match.mjs --match-id <positive-integer> [options]',
        '',
        'Options:',
        '  --match-id <id>             Finished match ID (required)',
        `  --target-duration <sec>     Target final video duration in seconds (default: ${DEFAULT_TARGET_DURATION_SECONDS})`,
        `  --segment-duration <sec>    Nominal segment duration in seconds (${MIN_SEGMENT_DURATION_SECONDS}..${MAX_SEGMENT_DURATION_SECONDS}, default: ${DEFAULT_SEGMENT_DURATION_SECONDS})`,
        '  --max-segments <count>      Optional cap on segments for partial continuity tests (1..N)',
        `  --width <px>                Output width (default: ${DEFAULT_WIDTH})`,
        `  --height <px>               Output height (default: ${DEFAULT_HEIGHT})`,
        `  --fps <rate>                Output constant frame rate (default: ${DEFAULT_FPS})`,
        `  --threads <count>           FFmpeg libx264 threads (default: ${DEFAULT_THREADS})`,
        `  --max-retries <count>       Transient retries per segment (default: ${DEFAULT_MAX_RETRIES})`,
        `  --tail-pad <sec>            Extra wall-clock pad per segment recording (default: ${DEFAULT_TAIL_PAD_SECONDS})`,
        '  --culture <code>            Route culture (default: en)',
        '  --base-url <https-origin>   Override origin (must match ARENA_PRESSURE_CAPTURE_BASE_URL)',
        '  --output <directory>        Output directory root',
        '  --run-id <id>               Explicit run identifier (A-Za-z0-9_-, 4..64 chars)',
        '  --resume <run-id-or-dir>    Resume an interrupted run from its manifest.json',
        '  --keep-intermediates <bool> Retain segment MP4s/WebMs after assembly (default: false)',
        '  -h, --help                  Show this usage message'
    ].join('\n');
}

export function parseFullMatchArgs(argv) {
    const raw = {};
    for (let index = 0; index < argv.length; index++) {
        const token = argv[index];
        if (token === '--help' || token === '-h') {
            return { help: true };
        }
        if (!token?.startsWith('--')) {
            throw new Error(`Unsupported positional or malformed argument: ${token ?? ''}`);
        }
        const name = token.slice(2);
        if (!VALUE_OPTIONS.has(name)) {
            throw new Error(`Unsupported option: ${token}`);
        }
        if (raw[name] !== undefined) {
            throw new Error(`Repeated option: ${token}`);
        }
        const nextToken = argv[index + 1];
        if (name === 'keep-intermediates' && (nextToken === undefined || nextToken.startsWith('--'))) {
            raw[name] = 'true';
            continue;
        }
        if (nextToken === undefined || nextToken === '' || nextToken.startsWith('--')) {
            throw new Error(`Missing value for option: ${token}`);
        }
        raw[name] = nextToken;
        index++;
    }

    const matchId = parseMatchId(raw['match-id']);
    const culture = raw.culture ?? 'en';
    if (!CAPTURE_ROUTE_CULTURES.has(culture)) {
        throw new Error('--culture must be a supported CriptoVersus route culture.');
    }

    if (raw.resume && raw['run-id']) {
        throw new Error('--resume and --run-id cannot be used together.');
    }
    if (raw['run-id'] !== undefined && !/^[A-Za-z0-9_-]{4,64}$/.test(raw['run-id'])) {
        throw new Error('--run-id must be 4..64 characters of [A-Za-z0-9_-].');
    }

    const width = raw.width !== undefined ? parsePositiveInt('width', raw.width, 320, 1920) : DEFAULT_WIDTH;
    const height = raw.height !== undefined ? parsePositiveInt('height', raw.height, 180, 1080) : DEFAULT_HEIGHT;
    if (width % 2 !== 0 || height % 2 !== 0) {
        throw new Error('--width and --height must be even integers for yuv420p encoding.');
    }

    return {
        help: false,
        matchId,
        targetDurationSeconds: raw['target-duration'] !== undefined
            ? parseFiniteNumber('target-duration', raw['target-duration'], { min: 5, max: 600 })
            : DEFAULT_TARGET_DURATION_SECONDS,
        segmentDurationSeconds: raw['segment-duration'] !== undefined
            ? parseFiniteNumber('segment-duration', raw['segment-duration'], {
                min: MIN_SEGMENT_DURATION_SECONDS,
                max: MAX_SEGMENT_DURATION_SECONDS
            })
            : DEFAULT_SEGMENT_DURATION_SECONDS,
        maxSegments: raw['max-segments'] !== undefined
            ? parsePositiveInt('max-segments', raw['max-segments'], 1, 1000)
            : null,
        width,
        height,
        fps: raw.fps !== undefined ? parsePositiveInt('fps', raw.fps, 15, 60) : DEFAULT_FPS,
        threads: raw.threads !== undefined ? parsePositiveInt('threads', raw.threads, 1, 4) : DEFAULT_THREADS,
        maxRetries: raw['max-retries'] !== undefined ? parsePositiveInt('max-retries', raw['max-retries'], 0, 5) : DEFAULT_MAX_RETRIES,
        tailPadSeconds: raw['tail-pad'] !== undefined
            ? parseFiniteNumber('tail-pad', raw['tail-pad'], { min: 0.1, max: 2.0 })
            : DEFAULT_TAIL_PAD_SECONDS,
        culture,
        baseUrl: raw['base-url'] ?? null,
        output: raw.output ? resolve(raw.output) : null,
        runId: raw['run-id'] ?? null,
        resume: raw.resume ?? null,
        keepIntermediates: raw['keep-intermediates'] !== undefined
            ? parseBooleanOption('keep-intermediates', raw['keep-intermediates'])
            : false
    };
}

export function validateMatchHistoryMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object' || metadata.found === false) {
        throw createPlannerError('Arena Pressure match was not found.', 'MATCH_NOT_FOUND', false);
    }
    if (metadata.pageError) {
        throw createPlannerError(
            `Arena Pressure page reported a load error (${metadata.pageState ?? 'error'}).`,
            'MATCH_LOAD_ERROR',
            true
        );
    }
    if (metadata.isFinished !== true) {
        throw createPlannerError('Arena Pressure match is not finished.', 'MATCH_NOT_FINISHED', false);
    }
    if (metadata.officialResult === 'cancelled') {
        throw createPlannerError('Arena Pressure match was cancelled and cannot produce a full-match replay.', 'MATCH_CANCELLED', false);
    }
    const historyPoints = Number(metadata.historyPoints);
    if (!Number.isSafeInteger(historyPoints) || historyPoints < 2) {
        throw createPlannerError('Arena Pressure match has insufficient history points (< 2).', 'INVALID_HISTORY', false);
    }
    const historicalDurationSeconds = Number(metadata.historySpanSeconds ?? metadata.durationSeconds);
    if (!Number.isFinite(historicalDurationSeconds) || historicalDurationSeconds < 1) {
        throw createPlannerError(
            `Arena Pressure match has invalid historical duration (${metadata.historySpanSeconds ?? metadata.durationSeconds}).`,
            'INVALID_HISTORY',
            false
        );
    }
    if (metadata.supportsSegmentedCapture === false) {
        throw createPlannerError(
            'Deployed Web capture page does not expose segmented seek/dynamicSpeed capabilities.',
            'CAPTURE_CONTRACT_OUTDATED',
            false
        );
    }

    return {
        historicalDurationSeconds,
        historyPoints,
        officialResult: metadata.officialResult ?? null,
        leftSymbol: typeof metadata.leftSymbol === 'string' ? metadata.leftSymbol : null,
        rightSymbol: typeof metadata.rightSymbol === 'string' ? metadata.rightSymbol : null
    };
}

export function calculateDynamicReplaySpeed(
    historicalDurationSeconds,
    targetVideoDurationSeconds,
    { minSpeed = MIN_REPLAY_SPEED, maxSpeed = MAX_REPLAY_SPEED } = {}
) {
    const historical = Number(historicalDurationSeconds);
    const target = Number(targetVideoDurationSeconds);
    if (!Number.isFinite(historical) || historical < 1) {
        throw createPlannerError('Historical duration must be at least 1 second.', 'INVALID_HISTORY', false);
    }
    if (!Number.isFinite(target) || target < 5) {
        throw createPlannerError('Target video duration must be at least 5 seconds.', 'INVALID_TARGET_DURATION', false);
    }

    const rawSpeed = historical / target;
    if (!Number.isFinite(rawSpeed) || rawSpeed > maxSpeed) {
        throw createPlannerError(
            `Calculated replay speed ${rawSpeed}x exceeds maximum supported speed (${maxSpeed}x).`,
            'SPEED_OUT_OF_RANGE',
            false
        );
    }

    if (rawSpeed < minSpeed) {
        return {
            replaySpeed: minSpeed,
            rawSpeed,
            effectiveTargetDurationSeconds: historical / minSpeed,
            shortMatchAdjusted: true
        };
    }

    return {
        replaySpeed: rawSpeed,
        rawSpeed,
        effectiveTargetDurationSeconds: target,
        shortMatchAdjusted: false
    };
}

function allocateSegmentFrameCounts(totalTargetFrames, segmentDurationSeconds, fps) {
    const nominalFrames = Math.max(fps, Math.round(segmentDurationSeconds * fps));
    if (totalTargetFrames <= nominalFrames) {
        return [totalTargetFrames];
    }

    const counts = [];
    let remaining = totalTargetFrames;
    while (remaining > 0) {
        const take = Math.min(nominalFrames, remaining);
        counts.push(take);
        remaining -= take;
    }

    const minTailFrames = Math.round(2 * fps);
    if (counts.length >= 2 && counts[counts.length - 1] < minTailFrames) {
        const combined = counts[counts.length - 2] + counts[counts.length - 1];
        const firstHalf = Math.floor(combined / 2);
        const secondHalf = combined - firstHalf;
        counts[counts.length - 2] = firstHalf;
        counts[counts.length - 1] = secondHalf;
    }
    return counts;
}

export function buildFullMatchPlan({
    matchId,
    historicalDurationSeconds,
    historyPoints,
    targetVideoDurationSeconds = DEFAULT_TARGET_DURATION_SECONDS,
    segmentDurationSeconds = DEFAULT_SEGMENT_DURATION_SECONDS,
    maxSegments = null,
    width = DEFAULT_WIDTH,
    height = DEFAULT_HEIGHT,
    fps = DEFAULT_FPS,
    culture = 'en',
    tailPadSeconds = DEFAULT_TAIL_PAD_SECONDS
}) {
    if (!Number.isSafeInteger(matchId) || matchId <= 0) {
        throw createPlannerError('matchId must be a positive safe integer.', 'INVALID_MATCH_ID', false);
    }
    if (!Number.isFinite(segmentDurationSeconds)
        || segmentDurationSeconds < MIN_SEGMENT_DURATION_SECONDS
        || segmentDurationSeconds > MAX_SEGMENT_DURATION_SECONDS) {
        throw createPlannerError(
            `segmentDurationSeconds must be between ${MIN_SEGMENT_DURATION_SECONDS} and ${MAX_SEGMENT_DURATION_SECONDS}.`,
            'INVALID_SEGMENT_DURATION',
            false
        );
    }

    const speedInfo = calculateDynamicReplaySpeed(historicalDurationSeconds, targetVideoDurationSeconds);
    const totalTargetFrames = Math.max(fps, Math.round(speedInfo.effectiveTargetDurationSeconds * fps));
    const exactTotalVideoDurationSeconds = totalTargetFrames / fps;
    const replaySpeed = historicalDurationSeconds / exactTotalVideoDurationSeconds;
    const frameCounts = allocateSegmentFrameCounts(totalTargetFrames, segmentDurationSeconds, fps);

    const segments = [];
    let cursorFrame = 0;
    for (let i = 0; i < frameCounts.length; i++) {
        const targetFrames = frameCounts[i];
        const startFrame = cursorFrame;
        const endFrame = cursorFrame + targetFrames;
        cursorFrame = endFrame;

        const videoStartSeconds = startFrame / fps;
        const videoEndSeconds = endFrame / fps;
        const videoDurationSeconds = targetFrames / fps;
        const historicalStartSeconds = i === 0
            ? 0
            : (startFrame / totalTargetFrames) * historicalDurationSeconds;
        const historicalEndSeconds = i === frameCounts.length - 1
            ? historicalDurationSeconds
            : (endFrame / totalTargetFrames) * historicalDurationSeconds;

        segments.push({
            index: i + 1,
            label: String(i + 1).padStart(2, '0'),
            totalSegments: frameCounts.length,
            startFrame,
            endFrame,
            targetFrames,
            videoStartSeconds,
            videoEndSeconds,
            videoDurationSeconds,
            recordingDurationSeconds: videoDurationSeconds + tailPadSeconds,
            historicalStartSeconds,
            historicalEndSeconds,
            historicalDurationSeconds: historicalEndSeconds - historicalStartSeconds,
            isFinalSegment: i === frameCounts.length - 1
        });
    }

    if (maxSegments !== null && (!Number.isSafeInteger(maxSegments) || maxSegments < 1)) {
        throw createPlannerError('maxSegments must be a positive integer.', 'INVALID_MAX_SEGMENTS', false);
    }
    const selectedSegments = maxSegments !== null
        ? segments.slice(0, Math.min(maxSegments, segments.length))
        : segments;
    const selectedTargetFrames = selectedSegments.reduce((sum, seg) => sum + seg.targetFrames, 0);
    const selectedVideoDurationSeconds = selectedTargetFrames / fps;
    const isPartialValidationRun = selectedSegments.length < segments.length;

    const fingerprintPayload = {
        matchId,
        historicalDurationSeconds: Number(historicalDurationSeconds.toFixed(6)),
        targetVideoDurationSeconds: Number(targetVideoDurationSeconds.toFixed(3)),
        effectiveVideoDurationSeconds: Number(exactTotalVideoDurationSeconds.toFixed(6)),
        segmentDurationSeconds: Number(segmentDurationSeconds.toFixed(3)),
        replaySpeed: Number(replaySpeed.toFixed(9)),
        width,
        height,
        fps,
        culture,
        totalSegments: segments.length,
        selectedSegments: selectedSegments.length,
        boundaries: selectedSegments.map(seg => [seg.index, seg.startFrame, seg.endFrame])
    };
    const planFingerprint = createHash('sha256')
        .update(JSON.stringify(fingerprintPayload))
        .digest('hex')
        .slice(0, 16);

    return {
        schemaVersion: 1,
        matchId,
        culture,
        width,
        height,
        fps,
        historyPoints,
        historicalDurationSeconds,
        requestedTargetDurationSeconds: targetVideoDurationSeconds,
        effectiveTargetDurationSeconds: exactTotalVideoDurationSeconds,
        shortMatchAdjusted: speedInfo.shortMatchAdjusted,
        segmentDurationSeconds,
        tailPadSeconds,
        replaySpeed,
        totalTargetFrames,
        totalSegments: segments.length,
        selectedSegmentCount: selectedSegments.length,
        selectedTargetFrames,
        selectedVideoDurationSeconds,
        isPartialValidationRun,
        segments,
        selectedSegments,
        planFingerprint
    };
}
