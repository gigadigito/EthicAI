import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { browserlessFunction } from './browserless-capture-function.mjs';

const MATCH_ID = 46156;
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
        '--match-id 46156 [--base-url <allowed-origin>] [--duration 10] [--speed 4] ' +
        '[--width 1280] [--height 720] [--output <directory>]');
    process.exit(2);
}

function parseArgs(values) {
    const parsed = {};
    for (let index = 0; index < values.length; index += 2) {
        const name = values[index];
        const value = values[index + 1];
        if (!name?.startsWith('--') || value === undefined) usage(`Invalid argument: ${name ?? ''}`);
        parsed[name.slice(2)] = value;
    }
    return parsed;
}

function requirePrototypeValue(name, actual, expected) {
    if (String(actual ?? expected) !== String(expected)) {
        usage(`Phase 2 prototype requires --${name} ${expected}.`);
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

function run(command, args) {
    return new Promise((resolvePromise, reject) => {
        const child = spawn(command, args, { windowsHide: true, shell: false });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', chunk => { stdout += chunk; });
        child.stderr.on('data', chunk => { stderr += chunk; });
        child.on('error', reject);
        child.on('close', code => code === 0
            ? resolvePromise({ stdout, stderr })
            : reject(new Error(`${command} exited with ${code}: ${stderr.slice(-2000)}`)));
    });
}

function parseFrameTimes(text) {
    return text.split(/\r?\n/)
        .map(line => Number(line.trim().replace(/,$/, '')))
        .filter(Number.isFinite)
        .sort((left, right) => left - right);
}

function timingMetrics(times) {
    const gaps = times.slice(1).map((time, index) => time - times[index]).filter(gap => gap >= 0);
    const span = times.length > 1 ? times.at(-1) - times[0] : 0;
    return {
        frameCount: times.length,
        effectiveCaptureFps: span > 0 ? (times.length - 1) / span : 0,
        maximumFrameGap: gaps.length ? Math.max(...gaps) : 0,
        intervalsOver100Ms: gaps.filter(gap => gap > 0.1).length,
        intervalsOver200Ms: gaps.filter(gap => gap > 0.2).length
    };
}

async function probe(ffprobe, path, includeFrames = false) {
    const entries = includeFrames
        ? 'format=format_name,duration,size:stream=codec_name,width,height,avg_frame_rate,pix_fmt,nb_frames:frame=best_effort_timestamp_time'
        : 'format=format_name,duration,size:stream=codec_name,width,height,avg_frame_rate,pix_fmt,nb_frames';
    const result = await run(ffprobe, [
        '-v', 'error', '-select_streams', 'v:0', '-show_entries', entries,
        '-of', includeFrames ? 'json' : 'json', path
    ]);
    return JSON.parse(result.stdout);
}

async function frameLuma(ffmpeg, input, atSeconds) {
    const result = await run(ffmpeg, [
        '-hide_banner', '-ss', String(Math.max(0, atSeconds)), '-i', input,
        '-frames:v', '1', '-vf', 'signalstats,metadata=print', '-f', 'null', '-'
    ]);
    const match = result.stderr.match(/lavfi\.signalstats\.YAVG=([\d.]+)/);
    return match ? Number(match[1]) : null;
}

const args = parseArgs(process.argv.slice(2));
requirePrototypeValue('match-id', args['match-id'], MATCH_ID);
requirePrototypeValue('duration', args.duration, DURATION_SECONDS);
requirePrototypeValue('speed', args.speed, SPEED);
requirePrototypeValue('width', args.width, WIDTH);
requirePrototypeValue('height', args.height, HEIGHT);

const browserlessEndpoint = safeUrl(process.env.ARENA_PRESSURE_BROWSERLESS_URL, 'ARENA_PRESSURE_BROWSERLESS_URL');
browserlessEndpoint.pathname = '/screencast';
const allowedOrigin = safeUrl(process.env.ARENA_PRESSURE_CAPTURE_BASE_URL, 'ARENA_PRESSURE_CAPTURE_BASE_URL');
const requestedBase = safeUrl(args['base-url'] ?? allowedOrigin.origin, '--base-url');
if (requestedBase.origin !== allowedOrigin.origin) {
    throw new Error('--base-url must exactly match the configured ARENA_PRESSURE_CAPTURE_BASE_URL origin.');
}
const captureKey = process.env.ARENA_PRESSURE_CAPTURE_KEY;
if (!captureKey?.trim()) throw new Error('ARENA_PRESSURE_CAPTURE_KEY is required.');

const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg';
const ffprobe = process.env.FFPROBE_PATH ?? 'ffprobe';
const outputRoot = resolve(args.output ?? defaultOutput);
const prefix = `arena-pressure-match-${MATCH_ID}-preview`;
const webmPartial = resolve(outputRoot, `${prefix}.webm.partial`);
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
const targetUrl = new URL(`/${routeCulture}/tv/pressure/${MATCH_ID}/match`, allowedOrigin.origin);
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
const notes = [];
const startedAt = new Date();
const initialRss = process.memoryUsage().rss;
const log = message => {
    const line = `${new Date().toISOString()} ${message}`;
    notes.push(line);
    console.log(line);
};

try {
    await mkdir(outputRoot, { recursive: true });
    lockHandle = await import('node:fs/promises').then(fs => fs.open(lockPath, 'wx'))
        .catch(() => { throw new Error(`Another Browserless preview capture is active (${lockPath}).`); });
    await lockHandle.writeFile(JSON.stringify({ pid: process.pid, startedAt: startedAt.toISOString() }));
    await run(ffmpeg, ['-version']);
    await run(ffprobe, ['-version']);

    const controller = new AbortController();
    browserlessTimeout = setTimeout(() => controller.abort(new Error('Browserless request exceeded 55 seconds.')), REQUEST_TIMEOUT_MS);
    log(`Requesting ${DURATION_SECONDS}s Browserless screencast for match ${MATCH_ID} at ${WIDTH}x${HEIGHT}.`);
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
    if (!response.ok || !response.body) throw new Error(`Browserless screencast failed with HTTP ${response.status}.`);
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('video/webm')) {
        throw new Error(`Browserless returned unexpected content type ${contentType || '(missing)'}.`);
    }

    let received = 0;
    const limiter = new Transform({
        transform(chunk, encoding, callback) {
            received += chunk.length;
            callback(received <= MAX_WEBM_BYTES ? null : new Error('WebM exceeded the 100 MiB safety limit.'), chunk);
        }
    });
    await pipeline(Readable.fromWeb(response.body), limiter, createWriteStream(webmPartial, { flags: 'wx' }));
    clearTimeout(browserlessTimeout);
    browserlessTimeout = undefined;
    log(`WebM received by streaming (${received} bytes).`);

    const webmProbe = await probe(ffprobe, webmPartial, true);
    const webmStream = webmProbe.streams?.[0];
    const webmDuration = Number(webmProbe.format?.duration);
    const frameTimes = (webmProbe.frames ?? [])
        .map(frame => Number(frame.best_effort_timestamp_time))
        .filter(Number.isFinite);
    const timing = timingMetrics(frameTimes);
    const webmFailures = [];
    if (!String(webmProbe.format?.format_name).includes('webm')) webmFailures.push('container is not WebM');
    if (webmStream?.codec_name !== 'vp8') webmFailures.push(`codec is ${webmStream?.codec_name}`);
    if (webmStream?.width !== WIDTH || webmStream?.height !== HEIGHT) webmFailures.push('resolution is not 1280x720');
    if (!Number.isFinite(webmDuration) || Math.abs(webmDuration - DURATION_SECONDS) > 2) webmFailures.push(`duration is ${webmDuration}s`);
    if (timing.frameCount < 2) webmFailures.push('fewer than two timestamped frames');
    if (webmFailures.length) throw new Error(`WebM validation failed: ${webmFailures.join('; ')}.`);
    await rm(webmPath, { force: true });
    await rename(webmPartial, webmPath);

    const conversionStarted = Date.now();
    await run(ffmpeg, [
        '-y', '-hide_banner', '-loglevel', 'warning', '-i', webmPath, '-an',
        '-vf', `scale=${WIDTH}:${HEIGHT}:flags=lanczos,setsar=1,fps=${FPS}`,
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart', '-f', 'mp4', mp4Partial
    ]);
    await run(ffmpeg, ['-v', 'error', '-i', mp4Partial, '-f', 'null', '-']);
    const mp4Probe = await probe(ffprobe, mp4Partial);
    const mp4Stream = mp4Probe.streams?.[0];
    const mp4Duration = Number(mp4Probe.format?.duration);
    const mp4Failures = [];
    if (!String(mp4Probe.format?.format_name).includes('mp4')) mp4Failures.push('container is not MP4');
    if (mp4Stream?.codec_name !== 'h264') mp4Failures.push('codec is not H.264');
    if (mp4Stream?.width !== WIDTH || mp4Stream?.height !== HEIGHT) mp4Failures.push('resolution is not 1280x720');
    if (mp4Stream?.avg_frame_rate !== '30/1') mp4Failures.push(`frame rate is ${mp4Stream?.avg_frame_rate}`);
    if (mp4Stream?.pix_fmt !== 'yuv420p') mp4Failures.push(`pixel format is ${mp4Stream?.pix_fmt}`);
    if (!Number.isFinite(mp4Duration) || Math.abs(mp4Duration - DURATION_SECONDS) > 2) mp4Failures.push(`duration is ${mp4Duration}s`);
    const firstLuma = await frameLuma(ffmpeg, mp4Partial, 0.1);
    const lastLuma = await frameLuma(ffmpeg, mp4Partial, Math.max(0, mp4Duration - 0.2));
    if (firstLuma === null || firstLuma < 2) mp4Failures.push(`first frame is blank/unreadable (YAVG=${firstLuma})`);
    if (lastLuma === null || lastLuma < 2) mp4Failures.push(`last frame is blank/unreadable (YAVG=${lastLuma})`);
    if (mp4Failures.length) throw new Error(`MP4 validation failed: ${mp4Failures.join('; ')}.`);
    await rm(mp4Path, { force: true });
    await rename(mp4Partial, mp4Path);

    const webmSize = (await stat(webmPath)).size;
    const mp4Size = (await stat(mp4Path)).size;
    const report = {
        schemaVersion: 1,
        status: 'validated',
        matchId: MATCH_ID,
        captureDurationSeconds: webmDuration,
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
        effectiveCaptureFps: timing.effectiveCaptureFps,
        maximumFrameGap: timing.maximumFrameGap,
        intervalsOver100Ms: timing.intervalsOver100Ms,
        intervalsOver200Ms: timing.intervalsOver200Ms,
        capturedFrameCount: timing.frameCount,
        webmBytes: webmSize,
        mp4Bytes: mp4Size,
        conversionDurationSeconds: (Date.now() - conversionStarted) / 1000,
        totalDurationSeconds: (Date.now() - startedAt.getTime()) / 1000,
        clientRssBeforeBytes: initialRss,
        clientRssAfterBytes: process.memoryUsage().rss,
        browserlessResourceUsage: 'not exposed by the v1 screencast response',
        generatedAtUtc: new Date().toISOString()
    };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    log(`Validated ${timing.frameCount} VP8 frames at ${timing.effectiveCaptureFps.toFixed(2)} effective FPS; maximum gap ${timing.maximumFrameGap.toFixed(3)}s.`);
    log(`Outputs: ${webmPath}; ${mp4Path}; ${reportPath}`);
} catch (error) {
    process.exitCode = 1;
    const diagnostic = String(error.stack ?? error.message ?? error).split(captureKey).join('[REDACTED]');
    const publicMessage = String(error.message ?? error).split(captureKey).join('[REDACTED]');
    notes.push(`${new Date().toISOString()} FATAL ${diagnostic}`);
    console.error(publicMessage);
    console.error(`Diagnostic log: ${logPath}`);
} finally {
    if (browserlessTimeout) clearTimeout(browserlessTimeout);
    await rm(webmPartial, { force: true }).catch(() => {});
    await rm(mp4Partial, { force: true }).catch(() => {});
    if (lockHandle) await lockHandle.close().catch(() => {});
    if (lockHandle) await rm(lockPath, { force: true }).catch(() => {});
    await mkdir(dirname(logPath), { recursive: true });
    await writeFile(logPath, `${notes.join('\n')}\n`, 'utf8').catch(() => {});
}
