/**
 * Arena Pressure — captura local de replay histórico em 4× (Fase 1).
 *
 * Requisitos: @playwright/test, Google Chrome ou Edge instalado, ffmpeg/ffprobe.
 * Não usa recordVideo: o Chrome envia quadros pelo CDP, e o FFmpeg local gera MP4.
 * Não publica conteúdo, não altera dados da partida e não usa o n8n.
 */
import { chromium } from '@playwright/test';
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const toolRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(toolRoot, '..', '..', '..');
const outputRoot = resolve(repoRoot, '.codex-artifacts-local', 'arena-pressure');
const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;
const SPEED = 4;

function usage(message) {
    if (message) console.error(`Error: ${message}`);
    console.error([
        'Usage: node tools/arena-pressure/capture-video.mjs --match-id <id>',
        '  [--base-url https://localhost:7297] [--culture en]',
        '  [--browser-channel chrome|msedge|chromium] [--browser-path <exe>]',
        '  [--ffmpeg <path>] [--ffprobe <path>]'
    ].join('\n'));
    process.exit(2);
}

function argsOf(values) {
    if (values.length % 2) usage('Arguments must be --name value pairs.');
    const allowed = new Set([
        'match-id', 'base-url', 'culture', 'browser-channel', 'browser-path',
        'ffmpeg', 'ffprobe'
    ]);
    const result = {};
    for (let i = 0; i < values.length; i += 2) {
        const name = values[i]?.replace(/^--/, '');
        if (!values[i]?.startsWith('--') || !allowed.has(name) ||
            !values[i + 1] || result[name] !== undefined) {
            usage(`Invalid, repeated or unsupported argument: ${values[i] ?? ''}`);
        }
        result[name] = values[i + 1];
    }
    return result;
}

function run(command, parameters, options = {}) {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(command, parameters, {
            windowsHide: true, shell: false, ...options
        });
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', chunk => { stdout += chunk.toString(); });
        child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
        child.once('error', rejectPromise);
        child.once('close', code => {
            if (code === 0) resolvePromise({ stdout, stderr });
            else rejectPromise(new Error(
                `${command} exited with ${code}\n${stderr.slice(-12000)}`
            ));
        });
    });
}

async function frameLuma(ffmpeg, input, atSeconds) {
    const { stderr } = await run(ffmpeg, [
        '-hide_banner', '-ss', String(Math.max(0, atSeconds)), '-i', input,
        '-frames:v', '1', '-vf', 'signalstats,metadata=print', '-f', 'null', '-'
    ]);
    const match = stderr.match(/lavfi\.signalstats\.YAVG=([\d.]+)/);
    return match ? Number(match[1]) : null;
}

function secondsSince(start) {
    return Number(process.hrtime.bigint() - start) / 1e9;
}

// FFmpeg concat demuxer: cada JPEG tem sua duração real, sem pressupor
// que o CDP tenha entregado 30 quadros por segundo. O filtro fps=30
// duplica/descarta quadros quando necessário, preservando o tempo real.
function createConcatFile(frames) {
    if (frames.length < 2) throw new Error('Not enough screencast frames.');
    const lines = ['ffconcat version 1.0'];
    for (let i = 0; i < frames.length - 1; i++) {
        const duration = frames[i + 1].time - frames[i].time;
        if (!Number.isFinite(duration) || duration <= 0) {
            throw new Error(`Non-monotonic capture frame at index ${i}.`);
        }
        lines.push(`file '${frames[i].file}'`);
        lines.push(`duration ${duration.toFixed(6)}`);
    }
    // O concat exige repetir o último arquivo para aplicar a última duração.
    lines.push(`file '${frames.at(-1).file}'`);
    return `${lines.join('\n')}\n`;
}

const args = argsOf(process.argv.slice(2));
const matchId = Number(args['match-id']);
if (!Number.isSafeInteger(matchId) || matchId <= 0) {
    usage('--match-id must be a positive safe integer.');
}

const baseUrl = (args['base-url'] ?? process.env.ARENA_PRESSURE_BASE_URL ??
    'http://localhost:5287').replace(/\/+$/, '');
let base;
try { base = new URL(baseUrl); } catch { usage('Invalid --base-url.'); }
if (!['http:', 'https:'].includes(base.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) ||
    (base.pathname !== '/' && base.pathname !== '') ||
    base.search || base.hash || base.username || base.password) {
    usage('Phase 1 accepts only local Development URLs, e.g. https://localhost:7297.');
}

const culture = args.culture ?? 'en';
if (!/^[a-z]{2}(?:-[a-z]{2})?$/i.test(culture)) {
    usage('Invalid --culture (example: en or pt-BR).');
}
const ffmpeg = args.ffmpeg ?? process.env.FFMPEG_PATH ?? 'ffmpeg';
const ffprobe = args.ffprobe ?? process.env.FFPROBE_PATH ?? 'ffprobe';
const browserChannel = args['browser-channel'] ??
    process.env.ARENA_PRESSURE_BROWSER_CHANNEL ?? 'chrome';
const browserPath = args['browser-path'] ?? process.env.ARENA_PRESSURE_BROWSER_PATH;
if (!['chrome', 'msedge', 'chromium'].includes(browserChannel)) {
    usage(`Unsupported --browser-channel: ${browserChannel}`);
}

const runId = `${Date.now()}-${process.pid}`;
const tempRoot = resolve(outputRoot, 'tmp', `match-${matchId}-${runId}`);
const frameDir = resolve(tempRoot, 'frames');
const lockPath = resolve(outputRoot, `match-${matchId}.lock`);
const outputPath = resolve(outputRoot, `arena-pressure-match-${matchId}-${runId}.mp4`);
const partialPath = resolve(tempRoot, 'video.partial.mp4');
const logPath = resolve(outputRoot, `arena-pressure-match-${matchId}-${runId}.log`);
const notes = [];
let lock;
let browser;
let context;
let cdp;
let probe;
const log = message => {
    const line = `${new Date().toISOString()} ${message}`;
    notes.push(line);
    console.log(line);
};

try {
    await mkdir(frameDir, { recursive: true });
    try {
        lock = await open(lockPath, 'wx');
        await lock.writeFile(JSON.stringify({
            pid: process.pid, matchId, startedAt: new Date().toISOString()
        }));
    } catch {
        throw new Error(
            `Capture lock exists (${lockPath}). Check that another capture is not running ` +
            'before manually removing a stale lock.'
        );
    }

    await run(ffmpeg, ['-version']);
    await run(ffprobe, ['-version']);

    log(`Opening real replay for match ${matchId}.`);
    try {
        browser = await chromium.launch({
            headless: true,
            ...(browserPath ? { executablePath: browserPath } :
                browserChannel === 'chromium' ? {} : { channel: browserChannel })
        });
    } catch (error) {
        throw new Error(
            `Unable to start ${browserPath ?? browserChannel}. ` +
            'Use --browser-channel chrome (or msedge), or --browser-path to an installed browser. ' +
            `Details: ${error.message}`
        );
    }
    log(`Browser: ${browser.version()} (${browserPath ?? browserChannel}).`);
    context = await browser.newContext({
        viewport: { width: WIDTH, height: HEIGHT },
        deviceScaleFactor: 1,
        // Permit only the local ASP.NET Development HTTPS certificate.
        ignoreHTTPSErrors: base.protocol === 'https:'
    });
    const page = await context.newPage();
    page.on('pageerror', error => {
        notes.push(`${new Date().toISOString()} browser:pageerror ${String(error.message).slice(0, 500)}`);
    });
    page.on('console', message => {
        if (message.type() === 'error') {
            notes.push(`${new Date().toISOString()} browser:console-error ${message.text().slice(0, 500)}`);
        }
    });

    const url = `${baseUrl}/${culture}/tv/pressure/${matchId}/match?mode=videoCapture&speed=${SPEED}`;
    const response = await page.goto(url, {
        waitUntil: 'domcontentloaded', timeout: 60_000
    });
    if (!response?.ok()) {
        throw new Error(`Replay returned HTTP ${response?.status() ?? 'unknown'}.`);
    }
    await page.waitForFunction(() => {
        const state = window.__arenaPressureCapture?.getState?.();
        return state?.status === 'ready' || state?.status === 'error';
    }, null, { timeout: 120_000 });
    const ready = await page.evaluate(() => window.__arenaPressureCapture.getState());
    if (ready.status !== 'ready') throw new Error(`Replay not ready: ${JSON.stringify(ready)}`);
    if (!Number.isFinite(ready.durationSeconds) || ready.durationSeconds <= 0 ||
        ready.historyPoints < 2) {
        throw new Error(`No usable real history (points=${ready.historyPoints}, duration=${ready.durationSeconds}).`);
    }
    if (!ready.isFinished) throw new Error(`Match ${matchId} is not completed.`);
    if (ready.speed !== SPEED) throw new Error(`Unexpected replay speed: ${ready.speed}.`);

    await page.evaluate(async () => {
        if (document.fonts?.ready) await document.fonts.ready;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });

    // Primeira imagem do estado pronto: sempre representa t=0 do vídeo.
    const frames = [];
    const firstFile = 'frame-000000.jpg';
    await writeFile(resolve(frameDir, firstFile),
        await page.screenshot({ type: 'jpeg', quality: 90 }));
    frames.push({ file: firstFile, time: 0 });

    // ScreenCast do protocolo Chrome DevTools. Diferentemente de recordVideo,
    // NÃO depende do FFmpeg instalado pelo próprio Playwright.
    cdp = await context.newCDPSession(page);
    await cdp.send('Page.enable');
    let recording = false;
    let captureStart;
    let frameWritesError;
    const pending = new Set();
    let firstScreencastFrame;
    const firstScreencastFramePromise = new Promise(resolvePromise => {
        firstScreencastFrame = resolvePromise;
    });

    cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
        // Liberar rapidamente o frame no Chrome, mesmo quando não estamos gravando.
        void cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => { });
        if (!recording || frameWritesError) return;
        firstScreencastFrame?.();
        firstScreencastFrame = undefined;
        if (pending.size > 120) {
            frameWritesError = new Error('Frame writer backlog exceeded 120 pending images.');
            return;
        }
        const time = secondsSince(captureStart);
        if (time <= frames.at(-1).time) return;
        const file = `frame-${String(frames.length).padStart(6, '0')}.jpg`;
        frames.push({ file, time });
        const writing = writeFile(resolve(frameDir, file), Buffer.from(data, 'base64'))
            .catch(error => { frameWritesError ??= error; });
        pending.add(writing);
        void writing.finally(() => pending.delete(writing));
    });

    await cdp.send('Page.startScreencast', {
        format: 'jpeg', quality: 90,
        maxWidth: WIDTH, maxHeight: HEIGHT, everyNthFrame: 1
    });
    // Não esperar um frame antes do Play: páginas pausadas podem não gerar
    // novos quadros CDP. Verificaremos a chegada depois de iniciar a arena.
    const expectedPlayback = ready.durationSeconds / SPEED;
    const targetDuration = expectedPlayback + 2;
    log(`Ready: ${ready.historyPoints} points; ${ready.durationSeconds.toFixed(3)}s logical; ` +
        `4× playback ≈ ${expectedPlayback.toFixed(3)}s + 2s final hold.`);

    captureStart = process.hrtime.bigint();
    recording = true;
    const accepted = await page.evaluate(() => window.__arenaPressureCapture.start());
    if (!accepted) throw new Error('Capture control rejected replay start.');
    log('Replay started; Chrome CDP screencast is recording.');

    // Detectar rapidamente bloqueio de captura sem depender da taxa de FPS.
    let firstFrameTimeout;
    try {
        await Promise.race([
            firstScreencastFramePromise,
            new Promise((_, reject) => {
                firstFrameTimeout = setTimeout(() => reject(new Error(
                    'Chrome CDP did not deliver a frame after replay started.'
                )), 10000);
            })
        ]);
    } finally {
        clearTimeout(firstFrameTimeout);
    }

    const timeoutMs = Math.ceil((expectedPlayback + 30) * 1000);
    await page.waitForFunction(() => {
        const state = window.__arenaPressureCapture?.getState?.();
        if (state?.status === 'error') throw new Error('Replay entered error state.');
        return state?.status === 'completed' && state.finalFrameStable;
    }, null, { timeout: timeoutMs, polling: 100 });

    const completed = await page.evaluate(() => window.__arenaPressureCapture.getState());
    if (completed.speed !== SPEED ||
        Math.abs(completed.playheadSeconds - completed.durationSeconds) > 0.05) {
        throw new Error(`Unexpected final state: ${JSON.stringify(completed)}`);
    }
    // Quadro final explícito: evita depender da chegada do último evento CDP.
    const lastTime = secondsSince(captureStart);
    recording = false;
    const lastFile = `frame-${String(frames.length).padStart(6, '0')}.jpg`;
    await writeFile(resolve(frameDir, lastFile),
        await page.screenshot({ type: 'jpeg', quality: 90 }));
    frames.push({ file: lastFile, time: Math.max(lastTime, frames.at(-1).time + 0.001) });
    await cdp.send('Page.stopScreencast');
    await Promise.all([...pending]);
    if (frameWritesError) throw frameWritesError;

    const observedDuration = frames.at(-1).time;
    const captureFps = (frames.length - 2) / Math.max(observedDuration, 0.001);
    log(`CDP frames: ${frames.length}; capture average: ${captureFps.toFixed(2)} FPS; ` +
        `observed duration: ${observedDuration.toFixed(3)}s.`);
    if (Math.abs(observedDuration - targetDuration) > 3) {
        throw new Error(`Replay timing mismatch: observed ${observedDuration.toFixed(3)}s ` +
            `but expected ≈${targetDuration.toFixed(3)}s.`);
    }
    if (captureFps < 8) {
        throw new Error(`CDP delivered only ${captureFps.toFixed(2)} FPS on average. ` +
            'Capture is too sparse for a smooth video.');
    }
    if (captureFps < 24) log('WARNING: input capture is below 24 FPS; output will duplicate frames to reach 30 FPS.');

    await context.close();
    context = undefined;
    await browser.close();
    browser = undefined;
    cdp = undefined;

    const manifest = resolve(frameDir, 'frames.ffconcat');
    await writeFile(manifest, createConcatFile(frames), 'utf8');
    log('Encoding MP4 with the locally installed FFmpeg (no Playwright video dependency).');
    await run(ffmpeg, [
        '-y', '-hide_banner', '-loglevel', 'warning',
        '-f', 'concat', '-safe', '0', '-i', manifest,
        '-an', '-vf', `scale=${WIDTH}:${HEIGHT}:flags=lanczos,setsar=1,fps=${FPS}`,
        '-frames:v', String(Math.round(observedDuration * FPS)),
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart', partialPath
    ]);

    const probeResult = await run(ffprobe, [
        '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'format=format_name,duration:stream=codec_name,width,height,avg_frame_rate,pix_fmt,nb_frames',
        '-of', 'json', partialPath
    ]);
    probe = JSON.parse(probeResult.stdout);
    const stream = probe.streams?.[0];
    const duration = Number(probe.format?.duration);
    const failures = [];
    if (!String(probe.format?.format_name).includes('mp4')) failures.push('Container is not MP4');
    if (stream?.codec_name !== 'h264') failures.push('Codec is not H.264');
    if (stream?.width !== WIDTH || stream?.height !== HEIGHT) failures.push('Resolution is not 1920×1080');
    if (stream?.avg_frame_rate !== `${FPS}/1`) failures.push(`Frame rate: ${stream?.avg_frame_rate}`);
    if (stream?.pix_fmt !== 'yuv420p') failures.push(`Pixel format: ${stream?.pix_fmt}`);
    if (!Number.isFinite(duration) || Math.abs(duration - targetDuration) > 3) {
        failures.push(`Duration ${duration}s differs from expected ${targetDuration.toFixed(3)}s`);
    }
    await run(ffmpeg, ['-v', 'error', '-i', partialPath, '-f', 'null', '-']);
    const firstLuma = await frameLuma(ffmpeg, partialPath, 0.1);
    const lastLuma = await frameLuma(ffmpeg, partialPath, Math.max(0, duration - 0.2));
    if (firstLuma === null || firstLuma < 2) failures.push(`Initial frame blank/unreadable (YAVG=${firstLuma})`);
    if (lastLuma === null || lastLuma < 2) failures.push(`Final frame blank/unreadable (YAVG=${lastLuma})`);
    if (failures.length) throw new Error(`MP4 validation failed: ${failures.join('; ')}.`);

    await rename(partialPath, outputPath);
    log(`Validated MP4: ${duration.toFixed(3)}s, ${stream.codec_name}, ` +
        `${stream.width}×${stream.height}, ${stream.avg_frame_rate}, ${stream.pix_fmt}.`);
    log(`Output: ${outputPath}`);
} catch (error) {
    process.exitCode = 1;
    notes.push(`${new Date().toISOString()} FATAL ${error.stack ?? error.message}`);
    console.error(error.message);
    console.error(`Diagnostic log: ${logPath}`);
} finally {
    if (cdp) await cdp.send('Page.stopScreencast').catch(() => { });
    if (context) await context.close().catch(() => { });
    if (browser) await browser.close().catch(() => { });
    if (lock) await lock.close().catch(() => { });
    if (lock) await rm(lockPath, { force: true }).catch(() => { });
    await mkdir(dirname(logPath), { recursive: true });
    await writeFile(logPath,
        `${notes.join('\n')}\n${probe ? JSON.stringify(probe, null, 2) + '\n' : ''}`,
        'utf8').catch(error => console.error(`Unable to write log: ${error.message}`));
    await rm(tempRoot, { recursive: true, force: true }).catch(() => { });
}
