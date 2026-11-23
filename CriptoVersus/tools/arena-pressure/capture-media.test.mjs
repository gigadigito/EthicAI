import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
    buildProbeArgs,
    convertWebmToMp4,
    extractProbeEntries,
    finiteNumber,
    frameLuma,
    frameTimes,
    mediaDuration,
    preserveFailedWebm,
    probeMedia,
    processWebmToMp4,
    publishWithoutOverwrite,
    redactSecret,
    runCommand,
    timingMetrics,
    validateMp4,
    validateWebm,
    verifyVideoDecode
} from './capture-media.mjs';
import { defaultOutputPath, parseReprocessArgs } from './reprocess-webm.mjs';
import {
    buildSyntheticPageHtml,
    parseDiagnoseArgs,
    syntheticBrowserlessFunction
} from './diagnose-browserless-fps.mjs';

const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe';
const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
const REPROCESS_SCRIPT = join(TOOL_DIR, 'reprocess-webm.mjs');
const DIAGNOSE_SCRIPT = join(TOOL_DIR, 'diagnose-browserless-fps.mjs');

const frame = (time, duration = '0.033333') => ({
    best_effort_timestamp_time: String(time),
    pkt_duration_time: duration
});

function webm(frames, packets = []) {
    return {
        format: { format_name: 'matroska,webm', duration: 'N/A' },
        streams: [{ codec_name: 'vp8', width: 1280, height: 720 }],
        frames,
        packets
    };
}

async function fileExists(filePath) {
    try {
        await access(filePath);
        return true;
    } catch (error) {
        if (error?.code === 'ENOENT') return false;
        throw error;
    }
}

async function hasFfmpegToolchain() {
    try {
        await runCommand(FFMPEG, ['-version']);
        await runCommand(FFPROBE, ['-version']);
        return true;
    } catch {
        return false;
    }
}

function generateStreamingWebm(outputPath, args) {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(FFMPEG, args, { windowsHide: true, shell: false });
        const stderrChunks = [];
        const writer = createWriteStream(outputPath, { flags: 'wx' });
        let settled = false;
        const fail = error => {
            if (settled) return;
            settled = true;
            writer.destroy();
            rejectPromise(error);
        };
        child.stderr.on('data', chunk => {
            stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        child.on('error', fail);
        writer.on('error', fail);
        child.stdout.pipe(writer);
        const exitPromise = new Promise((resolveExit, rejectExit) => {
            child.on('close', code => {
                if (code === 0) {
                    resolveExit();
                } else {
                    const stderr = Buffer.concat(stderrChunks).toString('utf8').slice(-2000);
                    rejectExit(new Error(`ffmpeg generator exited with code ${code}: ${stderr}`));
                }
            });
        });
        const writePromise = new Promise(resolveWrite => {
            writer.on('close', resolveWrite);
        });
        Promise.all([exitPromise, writePromise]).then(() => {
            if (!settled) {
                settled = true;
                resolvePromise();
            }
        }, fail);
    });
}

function runNodeCli(scriptPath, cliArgs) {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(process.execPath, [scriptPath, ...cliArgs], {
            windowsHide: true,
            shell: false,
            env: { ...process.env, FFMPEG_PATH: FFMPEG, FFPROBE_PATH: FFPROBE }
        });
        const stdoutChunks = [];
        const stderrChunks = [];
        child.stdout.on('data', chunk => stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        child.stderr.on('data', chunk => stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        child.on('error', rejectPromise);
        child.on('close', code => {
            resolvePromise({
                exitCode: code,
                stdout: Buffer.concat(stdoutChunks).toString('utf8'),
                stderr: Buffer.concat(stderrChunks).toString('utf8')
            });
        });
    });
}

const FFMPEG_AVAILABLE = await hasFfmpegToolchain();

// --- Unit tests (Node.js 18.19.0 compatible, zero external binaries required) ---

test('finiteNumber rejects null, undefined, booleans, blanks, and non-numeric strings', () => {
    assert.equal(finiteNumber(null), null);
    assert.equal(finiteNumber(undefined), null);
    assert.equal(finiteNumber(''), null);
    assert.equal(finiteNumber('   '), null);
    assert.equal(finiteNumber('N/A'), null);
    assert.equal(finiteNumber(true), null);
    assert.equal(finiteNumber(false), null);
    assert.equal(finiteNumber(Number.NaN), null);
    assert.equal(finiteNumber(Number.POSITIVE_INFINITY), null);
    assert.equal(finiteNumber({}), null);
    assert.equal(finiteNumber([]), null);
    assert.equal(finiteNumber(0), 0);
    assert.equal(finiteNumber('0'), 0);
    assert.equal(finiteNumber('9.564'), 9.564);
    assert.equal(finiteNumber(72), 72);
});

test('buildProbeArgs requests FFmpeg 4.x and 7/8+ fields with -count_frames', () => {
    const withFrames = buildProbeArgs('sample.webm', true);
    assert.ok(withFrames.includes('-count_frames'));
    assert.ok(withFrames.includes('-select_streams'));
    assert.equal(withFrames[withFrames.indexOf('-select_streams') + 1], 'v:0');
    const entries = withFrames[withFrames.indexOf('-show_entries') + 1];
    assert.match(entries, /frame=.*best_effort_timestamp_time/);
    assert.match(entries, /frame=.*pts_time/);
    assert.match(entries, /frame=.*pkt_pts_time/);
    assert.match(entries, /frame=.*duration_time/);
    assert.match(entries, /frame=.*pkt_duration_time/);
    assert.match(entries, /packet=pts_time,dts_time,duration_time/);

    const mp4Args = buildProbeArgs('sample.mp4', false);
    assert.ok(mp4Args.includes('-count_frames'));
    assert.doesNotMatch(mp4Args[mp4Args.indexOf('-show_entries') + 1], /frame=|packet=/);
});

test('parses FFprobe 4.4.2 packets_and_frames with N/A duration and sparse 72-frame cadence', () => {
    const packetsAndFrames = [];
    const totalFrames = 72;
    for (let index = 0; index < totalFrames; index++) {
        const ts = ((index / (totalFrames - 1)) * 9.564).toFixed(6);
        packetsAndFrames.push({
            type: 'packet',
            pts_time: ts,
            dts_time: ts,
            duration_time: '0.133000'
        });
        packetsAndFrames.push({
            type: 'frame',
            best_effort_timestamp_time: ts,
            pkt_pts_time: ts,
            pkt_dts_time: ts,
            pkt_duration_time: '0.133000'
        });
    }
    const probe = {
        format: { format_name: 'matroska,webm', duration: 'N/A', size: '1310146' },
        streams: [{ codec_name: 'vp8', width: 1280, height: 720, nb_read_frames: '72' }],
        packets_and_frames: packetsAndFrames
    };

    const extracted = extractProbeEntries(probe);
    assert.equal(extracted.frames.length, 72);
    assert.equal(extracted.packets.length, 72);
    assert.equal(frameTimes(probe).length, 72);

    const result = validateWebm(probe, { width: 1280, height: 720, expectedDuration: 10 });
    assert.deepEqual(result.failures, []);
    assert.equal(result.frameCount, 72);
    assert.equal(result.duration.source, 'frame_timestamps');
    assert.ok(Math.abs(result.duration.seconds - 9.697) < 0.002);

    const metrics = timingMetrics(result.times);
    assert.equal(metrics.frameCount, 72);
    assert.ok(metrics.effectiveCaptureFps > 7 && metrics.effectiveCaptureFps < 8);
});

test('parses FFprobe 8.1.1 packets_and_frames with pts_time, duration_time, and omitted format.duration', () => {
    const probe = {
        format: { format_name: 'matroska,webm', size: '1203171' },
        streams: [{ codec_name: 'vp8', width: 1280, height: 720, nb_read_frames: '72' }],
        packets_and_frames: [
            { type: 'packet', pts_time: '0.000000', dts_time: '0.000000', duration_time: '0.133000' },
            { type: 'frame', best_effort_timestamp_time: null, pts_time: '0.000000', duration_time: '0.133000' },
            { type: 'packet', pts_time: '9.467000', dts_time: '9.467000', duration_time: '0.133000' },
            { type: 'frame', best_effort_timestamp_time: '', pts_time: '9.467000', duration_time: '0.133000' }
        ]
    };

    const result = validateWebm(probe, { width: 1280, height: 720, expectedDuration: 10 });
    assert.deepEqual(result.failures, []);
    assert.equal(result.duration.source, 'frame_timestamps');
    assert.ok(Math.abs(result.duration.seconds - 9.6) < 0.001);
    assert.deepEqual(result.times, [0, 9.467]);
});

test('uses frame timestamps when streaming WebM format duration is N/A', () => {
    const probe = webm([frame(0), frame(5), frame(9.966667)]);
    const result = validateWebm(probe, { width: 1280, height: 720, expectedDuration: 10 });
    assert.deepEqual(result.failures, []);
    assert.equal(result.duration.source, 'frame_timestamps');
    assert.ok(Math.abs(result.duration.seconds - 10) < 0.001);
});

test('uses packet timestamps if frame timestamps cannot establish duration', () => {
    const probe = webm([frame(0, 'N/A')], [
        { pts_time: '0', duration_time: '0.033333' },
        { pts_time: '9.966667', duration_time: '0.033333' }
    ]);
    assert.equal(mediaDuration(probe).source, 'packet_timestamps');
    assert.deepEqual(validateWebm(probe, { width: 1280, height: 720, expectedDuration: 10 }).failures, []);
});

test('accepts vp9 codec in WebM and rejects unsupported codecs', () => {
    const vp9Probe = {
        format: { format_name: 'matroska,webm', duration: 'N/A' },
        streams: [{ codec_name: 'vp9', width: 1280, height: 720, nb_read_frames: '2' }],
        packets_and_frames: [
            { type: 'frame', pts_time: '0', duration_time: '0.1' },
            { type: 'frame', pts_time: '9.9', duration_time: '0.1' }
        ]
    };
    assert.deepEqual(validateWebm(vp9Probe, { width: 1280, height: 720, expectedDuration: 10 }).failures, []);

    const h264InWebm = {
        ...vp9Probe,
        streams: [{ codec_name: 'h264', width: 1280, height: 720, nb_read_frames: '2' }]
    };
    assert.match(
        validateWebm(h264InWebm, { width: 1280, height: 720, expectedDuration: 10 }).failures.join('; '),
        /codec is h264/
    );
});

test('rejects a truncated WebM by effective timestamp duration', () => {
    const result = validateWebm(webm([frame(0), frame(1)]), {
        width: 1280, height: 720, expectedDuration: 10
    });
    assert.match(result.failures.join('; '), /differs from expected/);
});

test('rejects a WebM with packets spanning 10s but zero decodable frames', () => {
    const separateResult = validateWebm(webm([], [{ pts_time: '0' }, { pts_time: '10' }]), {
        width: 1280, height: 720, expectedDuration: 10
    });
    assert.equal(separateResult.frameCount, 0);
    assert.match(separateResult.failures.join('; '), /no decodable video frames/);

    const combinedResult = validateWebm({
        format: { format_name: 'matroska,webm', duration: 'N/A' },
        streams: [{ codec_name: 'vp8', width: 1280, height: 720, nb_read_frames: '0' }],
        packets_and_frames: [
            { type: 'packet', pts_time: '0', duration_time: '0.1' },
            { type: 'packet', pts_time: '9.9', duration_time: '0.1' }
        ]
    }, { width: 1280, height: 720, expectedDuration: 10 });
    assert.equal(combinedResult.frameCount, 0);
    assert.match(combinedResult.failures.join('; '), /no decodable video frames/);
});

test('MP4 validation handles nb_read_frames N/A fallback and rejects invalid properties', () => {
    const validWithFallback = validateMp4({
        format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '10.0' },
        streams: [{
            codec_name: 'h264',
            width: 1280,
            height: 720,
            avg_frame_rate: '30/1',
            pix_fmt: 'yuv420p',
            nb_read_frames: 'N/A',
            nb_frames: '300'
        }]
    }, { width: 1280, height: 720, expectedDuration: 10 });
    assert.deepEqual(validWithFallback.failures, []);
    assert.equal(validWithFallback.frames, 300);

    const zeroFrames = validateMp4({
        format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '10' },
        streams: [{ codec_name: 'h264', width: 1280, height: 720, avg_frame_rate: '30/1', pix_fmt: 'yuv420p', nb_read_frames: '0' }]
    }, { width: 1280, height: 720, expectedDuration: 10 });
    assert.match(zeroFrames.failures.join('; '), /no decodable video frames/);

    const invalidAll = validateMp4({
        format: { format_name: 'matroska,webm', duration: 'N/A' },
        streams: [{
            codec_name: 'vp8',
            width: 640,
            height: 360,
            avg_frame_rate: '24/1',
            pix_fmt: 'yuv444p',
            nb_read_frames: 'N/A',
            nb_frames: ''
        }]
    }, { width: 1280, height: 720, expectedDuration: 10, fps: 30 });
    const joined = invalidAll.failures.join('; ');
    assert.match(joined, /container is not MP4/);
    assert.match(joined, /codec is not H\.264/);
    assert.match(joined, /resolution is not 1280x720/);
    assert.match(joined, /frame rate is 24\/1/);
    assert.match(joined, /pixel format is yuv444p/);
    assert.match(joined, /no decodable video frames/);
    assert.match(joined, /duration is unavailable/);
});

test('convertWebmToMp4 emits exact FFmpeg 4.4.2-safe flags and propagates conversion failures', async () => {
    let capturedArgs = null;
    await convertWebmToMp4(
        async (_bin, args) => {
            capturedArgs = args;
            return { stdout: '', stderr: '', exitCode: 0 };
        },
        'ffmpeg',
        'input.webm',
        'output.mp4.partial',
        { width: 1280, height: 720 }
    );
    assert.ok(capturedArgs.includes('-n'));
    const genptsIdx = capturedArgs.indexOf('-fflags');
    const inputIdx = capturedArgs.indexOf('-i');
    assert.ok(genptsIdx >= 0 && capturedArgs[genptsIdx + 1] === '+genpts');
    assert.ok(genptsIdx < inputIdx, '-fflags +genpts must precede -i');
    assert.equal(capturedArgs[capturedArgs.indexOf('-map') + 1], '0:v:0');
    assert.equal(capturedArgs[capturedArgs.indexOf('-vf') + 1], 'scale=1280:720:flags=lanczos,setsar=1,fps=30');
    assert.equal(capturedArgs[capturedArgs.indexOf('-c:v') + 1], 'libx264');
    assert.equal(capturedArgs[capturedArgs.indexOf('-preset') + 1], 'veryfast');
    assert.equal(capturedArgs[capturedArgs.indexOf('-threads') + 1], '2');
    assert.equal(capturedArgs[capturedArgs.indexOf('-crf') + 1], '23');
    assert.equal(capturedArgs[capturedArgs.indexOf('-pix_fmt') + 1], 'yuv420p');
    assert.ok(capturedArgs.includes('-an'));
    assert.equal(capturedArgs[capturedArgs.indexOf('-movflags') + 1], '+faststart');
    assert.equal(capturedArgs[capturedArgs.indexOf('-f') + 1], 'mp4');
    assert.equal(capturedArgs[capturedArgs.length - 1], 'output.mp4.partial');

    const failure = new Error('ffmpeg conversion failed');
    failure.exitCode = 1;
    await assert.rejects(
        convertWebmToMp4(async () => { throw failure; }, 'ffmpeg', 'input.webm', 'output.partial.mp4', { width: 1280, height: 720 }),
        failure
    );
});

test('processWebmToMp4 cleans up partial MP4 and preserves input on simulated transcode failure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arena-pressure-transcode-fail-'));
    const inputPath = join(directory, 'input.failed.webm');
    const outputPath = join(directory, 'input.mp4');
    const partialPath = `${outputPath}.partial`;
    const inputBytes = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0xde, 0xad, 0xbe, 0xef]);
    const logs = [];
    const fakeProbeJson = JSON.stringify({
        format: { format_name: 'matroska,webm', duration: 'N/A', size: String(inputBytes.length) },
        streams: [{ codec_name: 'vp8', width: 1280, height: 720, nb_read_frames: '2' }],
        packets_and_frames: [
            { type: 'frame', best_effort_timestamp_time: '0.000', pkt_duration_time: '0.133' },
            { type: 'frame', best_effort_timestamp_time: '9.867', pkt_duration_time: '0.133' }
        ]
    });
    const fakeRun = async (command, args) => {
        if (command === 'ffprobe') {
            return { stdout: fakeProbeJson, stderr: '', exitCode: 0 };
        }
        if (args.includes('-f') && args[args.indexOf('-f') + 1] === 'null') {
            return { stdout: '', stderr: '', exitCode: 0 };
        }
        await writeFile(partialPath, Buffer.from('partial-mp4-bytes'));
        const err = new Error('simulated libx264 failure with super-secret-token');
        err.exitCode = 137;
        throw err;
    };

    try {
        await writeFile(inputPath, inputBytes);
        await assert.rejects(
            processWebmToMp4({
                inputPath,
                outputPath,
                mp4PartialPath: partialPath,
                ffmpeg: 'ffmpeg',
                ffprobe: 'ffprobe',
                run: fakeRun,
                log: msg => logs.push(msg),
                secrets: ['super-secret-token']
            }),
            error => error.stage === 'transcode' && error.exitCode === 137
        );
        assert.equal(await fileExists(outputPath), false);
        assert.equal(await fileExists(partialPath), false);
        assert.deepEqual(await readFile(inputPath), inputBytes);
        const failedLine = logs.find(line => line.startsWith('[VIDEO:FAILED]'));
        assert.ok(failedLine, 'expected [VIDEO:FAILED] log marker');
        assert.match(failedLine, /stage=transcode/);
        assert.match(failedLine, /exitCode=137/);
        assert.ok(!failedLine.includes('super-secret-token'), 'secret must be redacted from logs');
        assert.match(failedLine, /\[REDACTED\]/);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('preserves exact received bytes as .failed.webm and never overwrites existing files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arena-pressure-media-'));
    const partial = join(directory, 'capture.webm.partial');
    const failed = join(directory, 'capture.failed.webm');
    const secondPartial = join(directory, 'capture2.webm.partial');
    const bytes = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0xff]);
    const otherBytes = Buffer.from([0x01, 0x02, 0x03]);
    try {
        await writeFile(partial, bytes);
        await preserveFailedWebm(partial, failed);
        assert.deepEqual(await readFile(failed), bytes);
        await assert.rejects(readFile(partial), error => error.code === 'ENOENT');

        await writeFile(secondPartial, otherBytes);
        await assert.rejects(
            preserveFailedWebm(secondPartial, failed),
            /Refusing to overwrite existing file/
        );
        assert.deepEqual(await readFile(failed), bytes);

        const mp4Source = join(directory, 'video.mp4.partial');
        const mp4Dest = join(directory, 'video.mp4');
        const mp4Second = join(directory, 'video2.mp4.partial');
        await writeFile(mp4Source, bytes);
        await publishWithoutOverwrite(mp4Source, mp4Dest);
        assert.deepEqual(await readFile(mp4Dest), bytes);
        assert.equal(await fileExists(mp4Source), false);

        await writeFile(mp4Second, otherBytes);
        await assert.rejects(
            publishWithoutOverwrite(mp4Second, mp4Dest),
            /Refusing to overwrite existing output file/
        );
        assert.deepEqual(await readFile(mp4Dest), bytes);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('redactSecret strips strings and arrays without altering unrelated content', () => {
    assert.equal(redactSecret('token=abc123&k=xyz', ['abc123', 'xyz']), 'token=[REDACTED]&k=[REDACTED]');
    assert.equal(redactSecret('clean message', ''), 'clean message');
});

test('reprocess-webm CLI argument parsing and defaultOutputPath work cleanly', () => {
    assert.ok(defaultOutputPath('/tmp/match-46156.failed.webm').endsWith('match-46156.mp4'));
    assert.ok(defaultOutputPath('/tmp/match-46156.webm').endsWith('match-46156.mp4'));
    assert.ok(defaultOutputPath('/tmp/match-46156.FAILED.WEBM').endsWith('match-46156.mp4'));

    const parsed = parseReprocessArgs(['--input', 'clip.failed.webm', '--duration', 'auto', '--threads', '2']);
    assert.equal(parsed.help, false);
    assert.equal(parsed.expectedDuration, null);
    assert.equal(parsed.width, 1280);
    assert.equal(parsed.height, 720);
    assert.equal(parsed.fps, 30);
    assert.equal(parsed.threads, 2);

    assert.equal(parseReprocessArgs(['--help']).help, true);
    assert.throws(() => parseReprocessArgs([]), /input WebM file path is required/);
    assert.throws(() => parseReprocessArgs(['--input', 'a.webm', 'b.webm']), /not both/);
    assert.throws(() => parseReprocessArgs(['--unknown', '1', 'a.webm']), /Unsupported option/);
    assert.throws(() => parseReprocessArgs(['--input', 'a.webm', '--duration', '0']), /positive number or "auto"/);
});

// --- Real FFprobe / FFmpeg integration tests (isolated temp dir, cleaned up in finally) ---

test('real FFmpeg/FFprobe: streaming VP8 WebM with N/A duration (~7.5fps, ~9.6s) converts cleanly to H.264 MP4', { skip: !FFMPEG_AVAILABLE }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arena-pressure-real-vp8-'));
    const webmPath = join(directory, 'arena-pressure-match-46156-preview-test.failed.webm');
    const mp4Path = join(directory, 'arena-pressure-match-46156-preview-test.mp4');
    const logs = [];
    try {
        await generateStreamingWebm(webmPath, [
            '-hide_banner', '-loglevel', 'error',
            '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=7.5:duration=9.6',
            '-vf', 'setpts=PTS+0.08/TB',
            '-c:v', 'libvpx', '-b:v', '1M', '-deadline', 'realtime', '-cpu-used', '8',
            '-f', 'webm', '-live', '1', 'pipe:1'
        ]);
        const originalBytes = await readFile(webmPath);
        assert.ok(originalBytes.length > 10_000, 'generated streaming WebM should be non-trivial');

        const rawProbe = await probeMedia(runCommand, FFPROBE, webmPath, true);
        assert.ok(Array.isArray(rawProbe.packets_and_frames), 'real ffprobe with frame+packet emits packets_and_frames');
        assert.equal(finiteNumber(rawProbe?.format?.duration), null, 'streaming WebM should have missing/N/A format.duration');

        const decodeResult = await verifyVideoDecode(runCommand, FFMPEG, webmPath);
        assert.equal(decodeResult.exitCode, 0);
        assert.equal(decodeResult.stderr.trim(), '');

        const result = await processWebmToMp4({
            inputPath: webmPath,
            outputPath: mp4Path,
            width: 1280,
            height: 720,
            fps: 30,
            expectedDuration: 10,
            toleranceSeconds: 2,
            ffmpeg: FFMPEG,
            ffprobe: FFPROBE,
            log: line => logs.push(line)
        });

        assert.equal(result.webmValidation.duration.source, 'frame_timestamps');
        assert.ok(result.webmValidation.frameCount >= 70);
        assert.equal(result.mp4Validation.stream.codec_name, 'h264');
        assert.equal(result.mp4Validation.stream.width, 1280);
        assert.equal(result.mp4Validation.stream.height, 720);
        assert.equal(result.mp4Validation.stream.avg_frame_rate, '30/1');
        assert.equal(result.mp4Validation.stream.pix_fmt, 'yuv420p');
        assert.ok(result.mp4Validation.frames >= 240);
        assert.ok(result.mp4Validation.firstLuma >= 2);
        assert.ok(result.mp4Validation.lastLuma >= 2);
        assert.deepEqual(await readFile(webmPath), originalBytes, 'input WebM must remain untouched');

        const mp4Bytes = await readFile(mp4Path);
        const moovIndex = mp4Bytes.indexOf(Buffer.from('moov'));
        const mdatIndex = mp4Bytes.indexOf(Buffer.from('mdat'));
        assert.ok(moovIndex > 0 && mdatIndex > 0 && moovIndex < mdatIndex, 'MP4 must have faststart (moov before mdat)');

        const expectedMarkers = [
            '[VIDEO:RECEIVED]',
            '[VIDEO:PROBE]',
            '[VIDEO:FRAMES]',
            '[VIDEO:DURATION]',
            '[VIDEO:VALIDATED]',
            '[PERF:WEBM]',
            '[VIDEO:TRANSCODE_START]',
            '[VIDEO:TRANSCODE_COMPLETE]',
            '[VIDEO:MP4_VALIDATED]'
        ];
        let cursor = -1;
        for (const marker of expectedMarkers) {
            const foundIndex = logs.findIndex(line => line.startsWith(marker));
            assert.ok(foundIndex > cursor, `expected marker ${marker} in order; logs=${logs.join(' | ')}`);
            cursor = foundIndex;
        }
        assert.equal(logs.some(line => line.startsWith('[VIDEO:FAILED]')), false);

        // Non-overwrite refusal when target MP4 already exists
        await assert.rejects(
            processWebmToMp4({
                inputPath: webmPath,
                outputPath: mp4Path,
                ffmpeg: FFMPEG,
                ffprobe: FFPROBE
            }),
            /Refusing to overwrite existing output file/
        );
        assert.deepEqual(await readFile(mp4Path), mp4Bytes);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('real FFmpeg/FFprobe: streaming VP9 WebM with N/A duration validates and converts cleanly', { skip: !FFMPEG_AVAILABLE }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arena-pressure-real-vp9-'));
    const webmPath = join(directory, 'sample-vp9.webm');
    const mp4Path = join(directory, 'sample-vp9.mp4');
    try {
        await generateStreamingWebm(webmPath, [
            '-hide_banner', '-loglevel', 'error',
            '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=10:duration=2',
            '-c:v', 'libvpx-vp9', '-b:v', '400k', '-deadline', 'realtime', '-cpu-used', '8',
            '-f', 'webm', '-live', '1', 'pipe:1'
        ]);
        const decodeResult = await verifyVideoDecode(runCommand, FFMPEG, webmPath);
        assert.equal(decodeResult.exitCode, 0);
        assert.equal(decodeResult.stderr.trim(), '');

        const result = await processWebmToMp4({
            inputPath: webmPath,
            outputPath: mp4Path,
            width: 320,
            height: 180,
            fps: 30,
            expectedDuration: 2,
            toleranceSeconds: 1,
            ffmpeg: FFMPEG,
            ffprobe: FFPROBE
        });
        assert.equal(result.webmValidation.stream.codec_name, 'vp9');
        assert.equal(result.mp4Validation.stream.codec_name, 'h264');
        assert.equal(result.mp4Validation.stream.avg_frame_rate, '30/1');
        assert.equal(result.mp4Validation.stream.pix_fmt, 'yuv420p');
        assert.ok(result.mp4Validation.firstLuma >= 2);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('real FFmpeg/FFprobe: reprocess-webm.mjs CLI reprocesses .failed.webm, preserves input, refuses overwrite, and returns exit 2 on bad args', { skip: !FFMPEG_AVAILABLE }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arena-pressure-real-cli-'));
    const failedWebm = join(directory, 'arena-pressure-match-46156-preview-20261122T163726880Z.failed.webm');
    const expectedMp4 = join(directory, 'arena-pressure-match-46156-preview-20261122T163726880Z.mp4');
    try {
        await generateStreamingWebm(failedWebm, [
            '-hide_banner', '-loglevel', 'error',
            '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=10:duration=2',
            '-c:v', 'libvpx', '-b:v', '400k', '-deadline', 'realtime', '-cpu-used', '8',
            '-f', 'webm', '-live', '1', 'pipe:1'
        ]);
        const originalBytes = await readFile(failedWebm);

        const okRun = await runNodeCli(REPROCESS_SCRIPT, [
            '--input', failedWebm,
            '--width', '320',
            '--height', '180',
            '--duration', '2',
            '--tolerance', '1'
        ]);
        assert.equal(okRun.exitCode, 0, `expected exit 0, stderr=${okRun.stderr}`);
        assert.match(okRun.stdout, /\[VIDEO:RECEIVED\]/);
        assert.match(okRun.stdout, /\[VIDEO:PROBE\] codec=vp8 width=320 height=180/);
        assert.match(okRun.stdout, /\[VIDEO:FRAMES\]/);
        assert.match(okRun.stdout, /\[VIDEO:DURATION\] method=frame_timestamps/);
        assert.match(okRun.stdout, /\[VIDEO:VALIDATED\]/);
        assert.match(okRun.stdout, /\[PERF:WEBM\]/);
        assert.match(okRun.stdout, /\[VIDEO:TRANSCODE_START\]/);
        assert.match(okRun.stdout, /\[VIDEO:TRANSCODE_COMPLETE\]/);
        assert.match(okRun.stdout, /\[VIDEO:MP4_VALIDATED\]/);
        assert.equal(await fileExists(expectedMp4), true);
        assert.deepEqual(await readFile(failedWebm), originalBytes);
        const generatedMp4Bytes = await readFile(expectedMp4);

        const overwriteRun = await runNodeCli(REPROCESS_SCRIPT, [
            '--input', failedWebm,
            '--width', '320',
            '--height', '180',
            '--duration', '2'
        ]);
        assert.equal(overwriteRun.exitCode, 1);
        assert.match(overwriteRun.stdout, /\[VIDEO:FAILED\] stage=input_check/);
        assert.match(overwriteRun.stderr, /Refusing to overwrite existing output file/);
        assert.deepEqual(await readFile(expectedMp4), generatedMp4Bytes);
        assert.deepEqual(await readFile(failedWebm), originalBytes);

        const usageRun = await runNodeCli(REPROCESS_SCRIPT, []);
        assert.equal(usageRun.exitCode, 2);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('real FFmpeg/FFprobe: rejects corrupted, empty, truncated, audio-only, and blank-black WebMs without publishing MP4', { skip: !FFMPEG_AVAILABLE }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arena-pressure-real-neg-'));
    try {
        // 1. Empty 0-byte WebM
        const emptyWebm = join(directory, 'empty.webm');
        const emptyMp4 = join(directory, 'empty.mp4');
        await writeFile(emptyWebm, Buffer.alloc(0));
        const emptyLogs = [];
        await assert.rejects(
            processWebmToMp4({
                inputPath: emptyWebm,
                outputPath: emptyMp4,
                ffmpeg: FFMPEG,
                ffprobe: FFPROBE,
                log: line => emptyLogs.push(line)
            }),
            error => error.stage === 'input_check' && /empty \(0 bytes\)/.test(error.message)
        );
        assert.equal(await fileExists(emptyMp4), false);
        assert.ok(emptyLogs.some(line => line.includes('[VIDEO:FAILED] stage=input_check')));

        // 2. Corrupted garbage WebM
        const corruptWebm = join(directory, 'corrupt.webm');
        const corruptMp4 = join(directory, 'corrupt.mp4');
        const corruptBytes = Buffer.from('NOT-A-VALID-WEBM-HEADER-0123456789abcdef'.repeat(20));
        await writeFile(corruptWebm, corruptBytes);
        const corruptLogs = [];
        await assert.rejects(
            processWebmToMp4({
                inputPath: corruptWebm,
                outputPath: corruptMp4,
                ffmpeg: FFMPEG,
                ffprobe: FFPROBE,
                log: line => corruptLogs.push(line)
            }),
            error => error.stage === 'webm_probe'
        );
        assert.equal(await fileExists(corruptMp4), false);
        assert.deepEqual(await readFile(corruptWebm), corruptBytes);
        assert.ok(corruptLogs.some(line => line.includes('[VIDEO:FAILED] stage=webm_probe')));

        // 3. Truncated streaming VP8 WebM (mid-file cut; duration still close enough to hit webm_decode)
        const fullWebm = join(directory, 'full.webm');
        const truncatedWebm = join(directory, 'truncated.webm');
        const truncatedMp4 = join(directory, 'truncated.mp4');
        await generateStreamingWebm(fullWebm, [
            '-hide_banner', '-loglevel', 'error',
            '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=10:duration=2.5',
            '-c:v', 'libvpx', '-b:v', '400k', '-deadline', 'realtime', '-cpu-used', '8',
            '-f', 'webm', '-live', '1', 'pipe:1'
        ]);
        const fullBytes = await readFile(fullWebm);
        const truncatedBytes = fullBytes.subarray(0, Math.floor(fullBytes.length * 0.85));
        await writeFile(truncatedWebm, truncatedBytes);
        const truncatedLogs = [];
        await assert.rejects(
            processWebmToMp4({
                inputPath: truncatedWebm,
                outputPath: truncatedMp4,
                width: 320,
                height: 180,
                expectedDuration: 2.5,
                toleranceSeconds: 1.5,
                ffmpeg: FFMPEG,
                ffprobe: FFPROBE,
                log: line => truncatedLogs.push(line)
            }),
            error => ['webm_probe', 'webm_validate', 'webm_decode'].includes(error.stage)
        );
        assert.equal(await fileExists(truncatedMp4), false);
        assert.equal(await fileExists(`${truncatedMp4}.partial`), false);
        assert.deepEqual(await readFile(truncatedWebm), truncatedBytes);
        assert.ok(truncatedLogs.some(line => line.startsWith('[VIDEO:FAILED]')));

        // 4. Audio-only WebM (zero decodable video frames)
        const audioOnlyWebm = join(directory, 'audio-only.webm');
        const audioOnlyMp4 = join(directory, 'audio-only.mp4');
        await runCommand(FFMPEG, [
            '-hide_banner', '-loglevel', 'error',
            '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
            '-c:a', 'libopus', '-f', 'webm', audioOnlyWebm
        ]);
        await assert.rejects(
            processWebmToMp4({
                inputPath: audioOnlyWebm,
                outputPath: audioOnlyMp4,
                width: 320,
                height: 180,
                expectedDuration: 2,
                ffmpeg: FFMPEG,
                ffprobe: FFPROBE
            }),
            error => error.stage === 'webm_validate' && /no decodable video frames/.test(error.message)
        );
        assert.equal(await fileExists(audioOnlyMp4), false);

        // 5. Blank all-black (Y=0) WebM rejected by MP4 frameLuma check
        const blankWebm = join(directory, 'blank.webm');
        const blankMp4 = join(directory, 'blank.mp4');
        await generateStreamingWebm(blankWebm, [
            '-hide_banner', '-loglevel', 'error',
            '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=10:d=2',
            '-vf', 'format=yuv420p,lutyuv=y=0:u=128:v=128',
            '-c:v', 'libvpx', '-b:v', '200k', '-deadline', 'realtime', '-cpu-used', '8',
            '-f', 'webm', '-live', '1', 'pipe:1'
        ]);
        const blankLuma = await frameLuma(runCommand, FFMPEG, blankWebm, 0.1);
        assert.ok(blankLuma !== null && blankLuma < 2, `expected Y=0 blank WebM luma < 2, got ${blankLuma}`);
        await assert.rejects(
            processWebmToMp4({
                inputPath: blankWebm,
                outputPath: blankMp4,
                width: 320,
                height: 180,
                expectedDuration: 2,
                toleranceSeconds: 1,
                ffmpeg: FFMPEG,
                ffprobe: FFPROBE
            }),
            error => error.stage === 'mp4_validate' && /blank\/unreadable/.test(error.message)
        );
        assert.equal(await fileExists(blankMp4), false);
        assert.equal(await fileExists(`${blankMp4}.partial`), false);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('timingMetrics computes percentiles, gap thresholds, average FPS, and 1s window FPS buckets', () => {
    // 3 full seconds (0..1, 1..2, 2..3) with a 1-second freeze (second 1 has 0 frames)
    const times = [
        0.00, 0.18, 0.36, 0.54, 0.72,
        2.02, 2.20, 2.38, 2.56, 2.74
    ];
    const metrics = timingMetrics(times, 3.0);
    assert.equal(metrics.frameCount, 10);
    assert.equal(metrics.firstTimestampSeconds, 0);
    assert.equal(metrics.lastTimestampSeconds, 2.74);
    assert.ok(Math.abs(metrics.spanSeconds - 2.74) < 1e-6);
    assert.ok(Math.abs(metrics.averageFps - 10 / 3) < 1e-6);
    assert.ok(Math.abs(metrics.effectiveCaptureFps - 9 / 2.74) < 1e-6);
    assert.equal(metrics.intervalsOver50Ms, 9);
    assert.equal(metrics.intervalsOver100Ms, 9);
    assert.equal(metrics.intervalsOver200Ms, 1); // 2.02 - 0.72 = 1.30s
    assert.ok(Math.abs(metrics.p50FrameGapMs - 180) < 1e-6);
    assert.ok(Math.abs(metrics.maxFrameGapMs - 1300) < 1e-6);
    assert.ok(metrics.p95FrameGapMs >= 180);
    assert.deepEqual(metrics.windowFps, [
        { second: 0, frames: 5 },
        { second: 1, frames: 0 },
        { second: 2, frames: 5 }
    ]);
    assert.equal(metrics.windowFpsMin, 0);
    assert.equal(metrics.windowFpsMax, 5);
});

test('diagnose-browserless-fps parses modes safely and builds self-contained synthetic benchmark', () => {
    assert.equal(parseDiagnoseArgs(['--help']).help, true);
    const analyze = parseDiagnoseArgs(['--analyze-webm', 'clip.webm']);
    assert.equal(analyze.mode, 'analyze');
    assert.ok(analyze.inputPath.endsWith('clip.webm'));

    const synthetic = parseDiagnoseArgs(['--synthetic', '--width', '640', '--height', '360', '--duration', '5']);
    assert.equal(synthetic.mode, 'synthetic');
    assert.equal(synthetic.width, 640);
    assert.equal(synthetic.height, 360);
    assert.equal(synthetic.durationSeconds, 5);

    assert.throws(() => parseDiagnoseArgs([]), /Specify exactly one mode/);
    assert.throws(() => parseDiagnoseArgs(['--synthetic', '--analyze-webm', 'a.webm']), /Specify exactly one mode/);
    assert.throws(() => parseDiagnoseArgs(['--synthetic', '--width', '0']), /positive integer/);
    assert.throws(() => parseDiagnoseArgs(['--synthetic', '--width', '10']), /integer between/);

    const html = buildSyntheticPageHtml(1280, 720);
    assert.match(html, /width="1280" height="720"/);
    assert.match(html, /requestAnimationFrame/);
    assert.match(syntheticBrowserlessFunction, /startScreencast/);
    assert.match(syntheticBrowserlessFunction, /\[PERF:SYNTHETIC\]/);
});

test('real FFprobe: diagnose-browserless-fps --analyze-webm prints full [PERF:WEBM] and 1s window buckets', { skip: !FFMPEG_AVAILABLE }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arena-pressure-diag-'));
    const webmPath = join(directory, 'sample.failed.webm');
    try {
        await generateStreamingWebm(webmPath, [
            '-hide_banner', '-loglevel', 'error',
            '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=15:duration=2.2',
            '-c:v', 'libvpx', '-b:v', '400k', '-deadline', 'realtime', '-cpu-used', '8',
            '-f', 'webm', '-live', '1', 'pipe:1'
        ]);
        const runResult = await runNodeCli(DIAGNOSE_SCRIPT, ['--analyze-webm', webmPath]);
        assert.equal(runResult.exitCode, 0, `expected exit 0, stderr=${runResult.stderr}`);
        assert.match(runResult.stdout, /\[VIDEO:PROBE\] codec=vp8 width=320 height=180/);
        assert.match(runResult.stdout, /\[PERF:WEBM\] frames=\d+ durationSeconds=[\d.]+ effectiveFps=[\d.]+ averageFps=[\d.]+/);
        assert.match(runResult.stdout, /\[PERF:WEBM_WINDOWS\] 0s:\d+ 1s:\d+/);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
