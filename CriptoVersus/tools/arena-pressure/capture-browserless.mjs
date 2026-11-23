import { createWriteStream } from 'node:fs';
import { mkdir, open, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { browserlessFunction } from './browserless-capture-function.mjs';
import { parseBrowserlessArgs, parseMatchId } from './capture-browserless-options.mjs';
import {
    preserveFailedWebm,
    processWebmToMp4,
    publishWithoutOverwrite,
    redactSecret,
    runCommand
} from './capture-media.mjs';

const DURATION_SECONDS = 10;
const SPEED = 4;
const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 30;
const MAX_WEBM_BYTES = 100 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 55_000;
const REMOTE_EXECUTION_BUDGET_MS = 44_000;
const CAPTURE_ROUTE_CULTURES = new Set(['en', 'pt', 'zh', 'es', 'fr', 'de', 'it', 'ja', 'hi']);
const toolRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(toolRoot, '..', '..', '..');
const defaultOutput = resolve(repositoryRoot, '.codex-artifacts-local', 'arena-pressure');

function usage(message) {
    if (message) console.error(message);
    console.error('Usage: node tools/arena-pressure/capture-browserless.mjs ' +
        '--match-id <positive-integer> [--base-url <allowed-origin>] [--culture en] ' +
        '[--duration 10] [--speed 4] [--width 1280] [--height 720] [--output <directory>]');
    process.exit(2);
}

function requireFixedValue(name, actual, expected) {
    if (String(actual ?? expected) !== String(expected)) {
        usage(`--${name} must be ${expected} for this capture profile.`);
    }
}

function safeUrl(value, variableName) {
    if (!value) throw new Error(`${variableName} is required.`);
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${variableName} must use HTTP or HTTPS.`);
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
            // Raw URL was already validated by safeUrl before reaching here.
        }
    }
    return items;
}

let args;
let matchId;
try {
    args = parseBrowserlessArgs(process.argv.slice(2));
    matchId = parseMatchId(args['match-id']);
} catch (error) {
    usage(error.message);
}
requireFixedValue('duration', args.duration, DURATION_SECONDS);
requireFixedValue('speed', args.speed, SPEED);
requireFixedValue('width', args.width, WIDTH);
requireFixedValue('height', args.height, HEIGHT);

const rawBrowserlessUrl = process.env.ARENA_PRESSURE_BROWSERLESS_URL;
const browserlessEndpoint = safeUrl(rawBrowserlessUrl, 'ARENA_PRESSURE_BROWSERLESS_URL');
browserlessEndpoint.pathname = '/screencast';
const allowedOrigin = safeUrl(process.env.ARENA_PRESSURE_CAPTURE_BASE_URL, 'ARENA_PRESSURE_CAPTURE_BASE_URL');
const requestedBase = safeUrl(args['base-url'] ?? allowedOrigin.origin, '--base-url');
if (requestedBase.origin !== allowedOrigin.origin) {
    throw new Error('--base-url must exactly match the configured ARENA_PRESSURE_CAPTURE_BASE_URL origin.');
}
const captureKey = process.env.ARENA_PRESSURE_CAPTURE_KEY;
if (!captureKey?.trim()) throw new Error('ARENA_PRESSURE_CAPTURE_KEY is required.');
const secrets = collectSecrets(captureKey, browserlessEndpoint, rawBrowserlessUrl);

const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg';
const ffprobe = process.env.FFPROBE_PATH ?? 'ffprobe';
const outputRoot = resolve(args.output ?? defaultOutput);
const runId = new Date().toISOString().replace(/[-:.]/g, '');
const prefix = `arena-pressure-match-${matchId}-preview-${runId}`;
const webmPartial = resolve(outputRoot, `${prefix}.webm.partial`);
const webmFailed = resolve(outputRoot, `${prefix}.failed.webm`);
const webmPath = resolve(outputRoot, `${prefix}.webm`);
const mp4Partial = resolve(outputRoot, `${prefix}.mp4.partial`);
const mp4Path = resolve(outputRoot, `${prefix}.mp4`);
const reportPath = resolve(outputRoot, `${prefix}.json`);
const logPath = resolve(outputRoot, `${prefix}.log`);
const lockPath = resolve(outputRoot, 'browserless-preview.lock');
const routeCulture = args.culture ?? 'en';
if (!CAPTURE_ROUTE_CULTURES.has(routeCulture)) {
    throw new Error('--culture must be a supported CriptoVersus route culture.');
}
const targetUrl = new URL(`/${routeCulture}/tv/pressure/${matchId}/match`, allowedOrigin.origin);
targetUrl.searchParams.set('mode', 'videoCapture');
targetUrl.searchParams.set('speed', String(SPEED));
if (targetUrl.protocol !== 'https:') {
    throw new Error('ARENA_PRESSURE_CAPTURE_BASE_URL must use HTTPS.');
}
const authorizedNavigation = {
    href: targetUrl.href,
    protocol: targetUrl.protocol,
    hostname: targetUrl.hostname,
    port: targetUrl.port,
    pathname: targetUrl.pathname,
    search: targetUrl.search
};

let lockHandle;
let browserlessTimeout;
let receivedWebm = false;
let publishedWebm = false;
const notes = [];
const startedAt = new Date();
const initialRss = process.memoryUsage().rss;
const log = message => {
    const line = `${new Date().toISOString()} ${redactSecret(message, secrets)}`;
    notes.push(line);
    console.log(line);
};

try {
    await mkdir(outputRoot, { recursive: true });
    lockHandle = await open(lockPath, 'wx')
        .catch(() => { throw new Error(`Another Browserless preview capture is active (${lockPath}).`); });
    await lockHandle.writeFile(JSON.stringify({ pid: process.pid, startedAt: startedAt.toISOString() }));
    await runCommand(ffmpeg, ['-version']);
    await runCommand(ffprobe, ['-version']);

    const controller = new AbortController();
    browserlessTimeout = setTimeout(
        () => controller.abort(new Error('Browserless request exceeded 55 seconds.')),
        REQUEST_TIMEOUT_MS
    );
    log(`Requesting ${DURATION_SECONDS}s Browserless screencast for match ${matchId} at ${WIDTH}x${HEIGHT}.`);
    const response = await fetch(browserlessEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            code: browserlessFunction,
            context: {
                targetUrl: targetUrl.toString(),
                authorizedNavigation,
                captureKey,
                width: WIDTH,
                height: HEIGHT,
                durationMs: DURATION_SECONDS * 1000,
                executionBudgetMs: REMOTE_EXECUTION_BUDGET_MS,
                navigationTimeoutMs: 15_000,
                phaserTimeoutMs: 15_000,
                visualPreparationTimeoutMs: 4_000
            }
        }),
        signal: controller.signal
    });
    if (!response.ok || !response.body) {
        throw new Error(`Browserless screencast failed with HTTP ${response.status}.`);
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('video/webm')) {
        throw new Error(`Browserless returned unexpected content type ${contentType || '(missing)'}.`);
    }

    let received = 0;
    const limiter = new Transform({
        transform(chunk, encoding, callback) {
            received += chunk.length;
            callback(
                received <= MAX_WEBM_BYTES ? null : new Error('WebM exceeded the 100 MiB safety limit.'),
                chunk
            );
        }
    });
    await pipeline(Readable.fromWeb(response.body), limiter, createWriteStream(webmPartial, { flags: 'wx' }));
    receivedWebm = true;
    clearTimeout(browserlessTimeout);
    browserlessTimeout = undefined;
    log(`WebM received by streaming (${received} bytes).`);

    const processed = await processWebmToMp4({
        inputPath: webmPartial,
        outputPath: mp4Path,
        mp4PartialPath: mp4Partial,
        width: WIDTH,
        height: HEIGHT,
        fps: FPS,
        expectedDuration: DURATION_SECONDS,
        ffmpeg,
        ffprobe,
        run: runCommand,
        log,
        secrets,
        onWebmValidated: async () => {
            await publishWithoutOverwrite(webmPartial, webmPath);
            publishedWebm = true;
            return webmPath;
        }
    });

    const webmStream = processed.webmValidation.stream;
    const mp4Stream = processed.mp4Validation.stream;
    const timing = processed.timing;
    const report = {
        schemaVersion: 1,
        status: 'validated',
        matchId,
        captureDurationSeconds: processed.webmValidation.duration.seconds,
        captureDurationSource: processed.webmValidation.duration.source,
        replaySpeed: SPEED,
        playheadStart: 0,
        playheadEnd: null,
        logicalTimeAdvanced: null,
        logicalClockValidation: 'Browserless function required advancement within 4.5s of min(historyDuration, 40s); exact state is not returned by the v1 /screencast response.',
        replayEndedBeforeCapture: null,
        width: WIDTH,
        height: HEIGHT,
        intermediateCodec: webmStream.codec_name,
        outputCodec: mp4Stream.codec_name,
        outputFps: mp4Stream.avg_frame_rate,
        outputPixelFormat: mp4Stream.pix_fmt,
        firstTimestampSeconds: timing.firstTimestampSeconds,
        lastTimestampSeconds: timing.lastTimestampSeconds,
        effectiveCaptureFps: timing.effectiveCaptureFps,
        averageFps: timing.averageFps,
        maximumFrameGap: timing.maximumFrameGap,
        averageFrameGapMs: timing.averageFrameGapMs,
        p50FrameGapMs: timing.p50FrameGapMs,
        p95FrameGapMs: timing.p95FrameGapMs,
        maxFrameGapMs: timing.maxFrameGapMs,
        intervalsOver50Ms: timing.intervalsOver50Ms,
        intervalsOver100Ms: timing.intervalsOver100Ms,
        intervalsOver200Ms: timing.intervalsOver200Ms,
        windowFpsMin: timing.windowFpsMin,
        windowFpsMax: timing.windowFpsMax,
        windowFps: timing.windowFps,
        capturedFrameCount: processed.webmValidation.frameCount,
        webmBytes: processed.webmBytes,
        mp4Bytes: processed.mp4Bytes,
        conversionDurationSeconds: processed.conversionDurationSeconds,
        totalDurationSeconds: (Date.now() - startedAt.getTime()) / 1000,
        clientRssBeforeBytes: initialRss,
        clientRssAfterBytes: process.memoryUsage().rss,
        browserlessResourceUsage: 'not exposed by the v1 screencast response',
        generatedAtUtc: new Date().toISOString()
    };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    log(
        `Validated ${processed.webmValidation.frameCount} ${String(webmStream.codec_name).toUpperCase()} frames ` +
        `at ${timing.effectiveCaptureFps.toFixed(2)} effective FPS; maximum gap ${timing.maximumFrameGap.toFixed(3)}s.`
    );
    log(`Outputs: ${webmPath}; ${mp4Path}; ${reportPath}`);
} catch (error) {
    process.exitCode = 1;
    if (receivedWebm && !publishedWebm) {
        await preserveFailedWebm(webmPartial, webmFailed)
            .then(() => notes.push(`${new Date().toISOString()} Preserved failed WebM: ${webmFailed}`))
            .catch(preserveError => notes.push(
                `${new Date().toISOString()} Could not preserve failed WebM: ${redactSecret(preserveError.message, secrets)}`
            ));
    }
    const diagnostic = redactSecret(error?.stack ?? error?.message ?? error, secrets);
    const publicMessage = redactSecret(error?.message ?? error, secrets);
    notes.push(`${new Date().toISOString()} FATAL ${diagnostic}`);
    console.error(publicMessage);
    console.error(`Diagnostic log: ${logPath}`);
} finally {
    if (browserlessTimeout) clearTimeout(browserlessTimeout);
    if (!receivedWebm) await rm(webmPartial, { force: true }).catch(() => {});
    await rm(mp4Partial, { force: true }).catch(() => {});
    if (lockHandle) await lockHandle.close().catch(() => {});
    if (lockHandle) await rm(lockPath, { force: true }).catch(() => {});
    await mkdir(dirname(logPath), { recursive: true });
    await writeFile(logPath, `${notes.join('\n')}\n`, 'utf8').catch(() => {});
}
