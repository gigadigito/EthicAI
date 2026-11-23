import { createWriteStream } from 'node:fs';
import { access, mkdir, open, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import {
    finiteNumber,
    formatPerfWebmLine,
    frameTimes,
    mediaDuration,
    preserveFailedWebm,
    probeMedia,
    redactSecret,
    runCommand,
    timingMetrics
} from './capture-media.mjs';

const MAX_WEBM_BYTES = 100 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 45_000;
const toolRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(toolRoot, '..', '..', '..');
const defaultOutput = resolve(repositoryRoot, '.codex-artifacts-local', 'arena-pressure');

const VALUE_OPTIONS = new Set(['analyze-webm', 'width', 'height', 'duration', 'output']);

function usageText() {
    return [
        'Usage:',
        '  Offline WebM cadence analysis:',
        '    node tools/arena-pressure/diagnose-browserless-fps.mjs --analyze-webm <webm-path>',
        '  Controlled Browserless v1 synthetic Canvas2D benchmark (Experiment B / D):',
        '    node tools/arena-pressure/diagnose-browserless-fps.mjs --synthetic [--width 1280] [--height 720] [--duration 10] [--output <dir>]',
        '',
        'Options:',
        '  --analyze-webm <path>  Probe an existing .webm / .failed.webm file without opening a browser',
        '  --synthetic            Stream a self-contained Canvas2D 60 FPS scene to Browserless /screencast',
        '  --width <px>           Synthetic viewport width (default: 1280)',
        '  --height <px>          Synthetic viewport height (default: 720)',
        '  --duration <seconds>   Synthetic capture duration in seconds (default: 10, range: 1..30)',
        '  --output <directory>   Output directory for synthetic capture artifacts',
        '  -h, --help             Show this help message'
    ].join('\n');
}

function parsePositiveInt(name, raw, min = 1, max = 3840) {
    if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) {
        throw new Error(`--${name} must be a positive integer.`);
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max) {
        throw new Error(`--${name} must be an integer between ${min} and ${max}.`);
    }
    return value;
}

export function parseDiagnoseArgs(argv) {
    let synthetic = false;
    const raw = {};
    for (let index = 0; index < argv.length; index++) {
        const token = argv[index];
        if (token === '--help' || token === '-h') {
            return { help: true };
        }
        if (token === '--synthetic') {
            if (synthetic) throw new Error('Repeated flag: --synthetic');
            synthetic = true;
            continue;
        }
        if (token.startsWith('--')) {
            const name = token.slice(2);
            if (!VALUE_OPTIONS.has(name)) {
                throw new Error(`Unsupported option: ${token}`);
            }
            if (raw[name] !== undefined) {
                throw new Error(`Repeated option: ${token}`);
            }
            const value = argv[index + 1];
            if (value === undefined || value === '' || value.startsWith('--')) {
                throw new Error(`Missing value for option: ${token}`);
            }
            raw[name] = value;
            index++;
            continue;
        }
        throw new Error(`Unexpected argument: ${token}`);
    }

    const hasAnalyze = Boolean(raw['analyze-webm']);
    if (hasAnalyze === synthetic) {
        throw new Error('Specify exactly one mode: --analyze-webm <path> OR --synthetic.');
    }

    if (hasAnalyze) {
        return {
            help: false,
            mode: 'analyze',
            inputPath: resolve(raw['analyze-webm'])
        };
    }

    return {
        help: false,
        mode: 'synthetic',
        width: raw.width !== undefined ? parsePositiveInt('width', raw.width, 64, 3840) : 1280,
        height: raw.height !== undefined ? parsePositiveInt('height', raw.height, 64, 2160) : 720,
        durationSeconds: raw.duration !== undefined ? parsePositiveInt('duration', raw.duration, 1, 30) : 10,
        outputRoot: resolve(raw.output ?? defaultOutput)
    };
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

function collectSecrets(browserlessEndpoint, rawBrowserlessUrl) {
    const items = [];
    const add = value => {
        if (typeof value === 'string' && value.length >= 4 && !items.includes(value)) {
            items.push(value);
        }
    };
    if (browserlessEndpoint?.search) items.push(browserlessEndpoint.search);
    if (browserlessEndpoint?.searchParams) {
        for (const value of browserlessEndpoint.searchParams.values()) add(value);
    }
    if (rawBrowserlessUrl) {
        try {
            const raw = new URL(rawBrowserlessUrl);
            add(raw.username);
            add(raw.password);
        } catch {
            // Raw URL already validated by safeUrl.
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

export function buildSyntheticPageHtml(width, height) {
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  html, body { margin: 0; padding: 0; width: ${width}px; height: ${height}px; overflow: hidden; background: #09111f; }
  canvas { display: block; width: ${width}px; height: ${height}px; }
</style>
</head>
<body>
<canvas id="bench" width="${width}" height="${height}"></canvas>
<script>
(() => {
  const canvas = document.getElementById('bench');
  const ctx = canvas.getContext('2d');
  const start = performance.now();
  let last = 0;
  let frames = 0;
  const gaps = [];
  const work = [];
  window.__syntheticBench = {
    startedAt: start,
    getMetrics: () => {
      const elapsedSec = Math.max(0.001, (performance.now() - start) / 1000);
      const sortedGaps = gaps.slice().sort((a, b) => a - b);
      const sortedWork = work.slice().sort((a, b) => a - b);
      const pick = (arr, q) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(q * (arr.length - 1)))] : 0;
      return {
        frames,
        rafFps: (frames > 1 && last > start) ? (frames - 1) / ((last - start) / 1000) : frames / elapsedSec,
        avgGapMs: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0,
        p95GapMs: pick(sortedGaps, 0.95),
        maxGapMs: sortedGaps.length ? sortedGaps[sortedGaps.length - 1] : 0,
        avgWorkMs: work.length ? work.reduce((a, b) => a + b, 0) / work.length : 0,
        p95WorkMs: pick(sortedWork, 0.95)
      };
    }
  };
  function draw(now) {
    const t0 = performance.now();
    if (last > 0) gaps.push(now - last);
    last = now;
    frames += 1;
    const elapsed = (now - start) / 1000;
    ctx.fillStyle = '#09111f';
    ctx.fillRect(0, 0, ${width}, ${height});
    const x = ${Math.round(width / 2)} + Math.sin(elapsed * 2.5) * ${Math.round(width * 0.32)};
    const y = ${Math.round(height * 0.45)};
    ctx.fillStyle = '#ff9100';
    ctx.beginPath();
    ctx.arc(x, y, ${Math.max(24, Math.round(height * 0.11))}, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#18d8d2';
    const barW = Math.max(8, Math.round(((elapsed % 2) / 2) * ${Math.round(width * 0.8)}));
    ctx.fillRect(${Math.round(width * 0.1)}, ${Math.round(height * 0.78)}, barW, ${Math.max(12, Math.round(height * 0.04))});
    ctx.fillStyle = '#e6edf7';
    ctx.font = 'bold ${Math.max(18, Math.round(height * 0.045))}px monospace';
    ctx.fillText('SYNTHETIC F=' + frames + ' T=' + elapsed.toFixed(2) + 's', ${Math.round(width * 0.1)}, ${Math.round(height * 0.15)});
    work.push(performance.now() - t0);
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
})();
</script>
</body>
</html>`;
}

export async function syntheticBrowserlessHandler({ page, context, startScreencast, stopScreencast }) {
    let screencastStarted = false;
    try {
        await page.setRequestInterception(true);
        page.on('request', request => request.abort('blockedbyclient'));
        await page.setViewport({ width: context.width, height: context.height, deviceScaleFactor: 1 });
        await page.setContent(context.html, { waitUntil: 'domcontentloaded' });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

        startScreencast();
        screencastStarted = true;
        await new Promise(resolve => setTimeout(resolve, context.durationMs));
        const metrics = await page.evaluate(() => window.__syntheticBench?.getMetrics?.() ?? null);
        if (metrics) {
            console.log(
                `[PERF:SYNTHETIC] width=${Number(context.width)} height=${Number(context.height)}`
                + ` frames=${Number(metrics.frames)} rafFps=${Number(metrics.rafFps).toFixed(2)}`
                + ` avgGapMs=${Number(metrics.avgGapMs).toFixed(1)} p95GapMs=${Number(metrics.p95GapMs).toFixed(1)}`
                + ` maxGapMs=${Number(metrics.maxGapMs).toFixed(1)} avgWorkMs=${Number(metrics.avgWorkMs).toFixed(2)}`
            );
        }
        stopScreencast();
        screencastStarted = false;
    } finally {
        if (screencastStarted) {
            stopScreencast();
        }
    }
}

export const syntheticBrowserlessFunction = `module.exports = ${syntheticBrowserlessHandler.toString()};`;

async function analyzeWebmFile(ffprobe, inputPath) {
    const fileStat = await stat(inputPath);
    if (!fileStat.isFile() || fileStat.size <= 0) {
        throw new Error(`WebM file is missing or empty: ${inputPath}`);
    }
    const probe = await probeMedia(runCommand, ffprobe, inputPath, true);
    const stream = probe?.streams?.[0] ?? {};
    const duration = mediaDuration(probe);
    const times = frameTimes(probe);
    const timing = timingMetrics(times, duration.seconds);

    console.log(`[VIDEO:RECEIVED] bytes=${fileStat.size}`);
    console.log(`[VIDEO:PROBE] codec=${stream.codec_name ?? 'missing'} width=${stream.width ?? 'missing'} height=${stream.height ?? 'missing'}`);
    console.log(`[VIDEO:FRAMES] count=${Math.max(times.length, finiteNumber(stream.nb_read_frames) ?? 0)}`);
    console.log(`[VIDEO:DURATION] method=${duration.source} seconds=${duration.seconds !== null ? duration.seconds.toFixed(3) : 'unavailable'}`);
    console.log(formatPerfWebmLine(timing, duration.seconds));
    console.log(`[PERF:WEBM_WINDOWS] ${timing.windowFps.map(bucket => `${bucket.second}s:${bucket.frames}`).join(' ')}`);

    return {
        mode: 'analyze',
        inputPath,
        bytes: fileStat.size,
        codec: stream.codec_name ?? null,
        width: stream.width ?? null,
        height: stream.height ?? null,
        durationSeconds: duration.seconds,
        durationSource: duration.source,
        timing
    };
}

async function runSyntheticBenchmark(ffprobe, options) {
    const rawBrowserlessUrl = process.env.ARENA_PRESSURE_BROWSERLESS_URL;
    const browserlessEndpoint = safeUrl(rawBrowserlessUrl, 'ARENA_PRESSURE_BROWSERLESS_URL');
    browserlessEndpoint.pathname = '/screencast';
    const secrets = collectSecrets(browserlessEndpoint, rawBrowserlessUrl);

    const runId = new Date().toISOString().replace(/[-:.]/g, '');
    const prefix = `arena-pressure-synthetic-${options.width}x${options.height}-${runId}`;
    const webmPartial = resolve(options.outputRoot, `${prefix}.webm.partial`);
    const webmFailed = resolve(options.outputRoot, `${prefix}.failed.webm`);
    const webmPath = resolve(options.outputRoot, `${prefix}.webm`);
    const reportPath = resolve(options.outputRoot, `${prefix}.json`);
    const lockPath = resolve(options.outputRoot, 'browserless-preview.lock');

    let lockHandle;
    let timeoutHandle;
    let receivedWebm = false;
    let publishedWebm = false;
    try {
        await mkdir(options.outputRoot, { recursive: true });
        if (await pathExists(webmPath) || await pathExists(reportPath)) {
            throw new Error(`Refusing to overwrite existing output artifacts for ${prefix}.`);
        }
        lockHandle = await open(lockPath, 'wx')
            .catch(() => { throw new Error(`Another Browserless capture is active (${lockPath}).`); });
        await lockHandle.writeFile(JSON.stringify({ pid: process.pid, mode: 'synthetic', startedAt: new Date().toISOString() }));
        await runCommand(ffprobe, ['-version']);

        const controller = new AbortController();
        timeoutHandle = setTimeout(
            () => controller.abort(new Error(`Browserless synthetic request exceeded ${REQUEST_TIMEOUT_MS / 1000}s.`)),
            REQUEST_TIMEOUT_MS
        );
        console.log(
            `Requesting ${options.durationSeconds}s synthetic Canvas2D Browserless screencast at ${options.width}x${options.height}.`
        );
        const response = await fetch(browserlessEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code: syntheticBrowserlessFunction,
                context: {
                    width: options.width,
                    height: options.height,
                    durationMs: options.durationSeconds * 1000,
                    html: buildSyntheticPageHtml(options.width, options.height)
                }
            }),
            signal: controller.signal
        });
        if (!response.ok || !response.body) {
            throw new Error(`Browserless synthetic screencast failed with HTTP ${response.status}.`);
        }
        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.toLowerCase().includes('video/webm')) {
            throw new Error(`Browserless returned unexpected content type ${contentType || '(missing)'}.`);
        }

        let received = 0;
        const limiter = new Transform({
            transform(chunk, _encoding, callback) {
                received += chunk.length;
                callback(
                    received <= MAX_WEBM_BYTES ? null : new Error('Synthetic WebM exceeded 100 MiB safety limit.'),
                    chunk
                );
            }
        });
        await pipeline(Readable.fromWeb(response.body), limiter, createWriteStream(webmPartial, { flags: 'wx' }));
        receivedWebm = true;
        clearTimeout(timeoutHandle);
        timeoutHandle = undefined;

        const analysis = await analyzeWebmFile(ffprobe, webmPartial);
        await rename(webmPartial, webmPath);
        publishedWebm = true;

        const report = {
            schemaVersion: 1,
            mode: 'synthetic',
            width: options.width,
            height: options.height,
            requestedDurationSeconds: options.durationSeconds,
            webmBytes: analysis.bytes,
            codec: analysis.codec,
            probedWidth: analysis.width,
            probedHeight: analysis.height,
            durationSeconds: analysis.durationSeconds,
            durationSource: analysis.durationSource,
            timing: analysis.timing,
            generatedAtUtc: new Date().toISOString()
        };
        await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
        console.log(`Outputs: ${webmPath}; ${reportPath}`);
    } catch (error) {
        if (receivedWebm && !publishedWebm) {
            await preserveFailedWebm(webmPartial, webmFailed).catch(() => {});
        }
        const message = redactSecret(error?.message ?? error, secrets);
        throw new Error(message);
    } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (!receivedWebm) await rm(webmPartial, { force: true }).catch(() => {});
        if (lockHandle) await lockHandle.close().catch(() => {});
        if (lockHandle) await rm(lockPath, { force: true }).catch(() => {});
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
        options = parseDiagnoseArgs(process.argv.slice(2));
    } catch (error) {
        console.error(error.message);
        console.error(usageText());
        process.exit(2);
    }

    if (options.help) {
        console.log(usageText());
        process.exit(0);
    }

    const ffprobe = process.env.FFPROBE_PATH ?? 'ffprobe';
    try {
        await runCommand(ffprobe, ['-version']);
        if (options.mode === 'analyze') {
            await analyzeWebmFile(ffprobe, options.inputPath);
        } else {
            await runSyntheticBenchmark(ffprobe, options);
        }
    } catch (error) {
        console.error(error?.message ?? String(error));
        process.exit(1);
    }
}

if (isDirectExecution()) {
    await main();
}
