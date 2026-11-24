import { spawn } from 'node:child_process';
import { access, link, mkdir, open, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const FRAME_TIMESTAMP_FIELDS = ['best_effort_timestamp_time', 'pts_time', 'pkt_pts_time', 'pkt_dts_time'];
const FRAME_DURATION_FIELDS = ['duration_time', 'pkt_duration_time'];
const PACKET_TIMESTAMP_FIELDS = ['pts_time', 'dts_time'];
const PACKET_DURATION_FIELDS = ['duration_time'];
const ALLOWED_WEBM_CODECS = new Set(['vp8', 'vp9']);

export function finiteNumber(value) {
    if (value === null || value === undefined || typeof value === 'boolean') return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

export function redactSecret(text, secret) {
    let value = String(text ?? '');
    const secrets = Array.isArray(secret) ? secret : [secret];
    for (const entry of secrets) {
        if (typeof entry === 'string' && entry.length > 0) {
            value = value.split(entry).join('[REDACTED]');
        }
    }
    return value;
}

export function runCommand(command, args) {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(command, args, { windowsHide: true, shell: false });
        const stdoutChunks = [];
        const stderrChunks = [];
        child.stdout?.on('data', chunk => {
            stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        child.stderr?.on('data', chunk => {
            stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        child.on('error', error => {
            const stderr = Buffer.concat(stderrChunks).toString('utf8').slice(-2000);
            error.exitCode = error.exitCode ?? null;
            error.stderr = stderr;
            rejectPromise(error);
        });
        child.on('close', (code, signal) => {
            const stdout = Buffer.concat(stdoutChunks).toString('utf8');
            const stderr = Buffer.concat(stderrChunks).toString('utf8');
            if (code === 0) {
                resolvePromise({ stdout, stderr, exitCode: 0 });
                return;
            }
            const truncatedStderr = stderr.slice(-2000);
            const reason = code !== null ? `code ${code}` : `signal ${signal ?? 'unknown'}`;
            const error = new Error(
                `${command} exited with ${reason}${truncatedStderr ? `: ${truncatedStderr}` : ''}`
            );
            error.exitCode = code ?? 1;
            error.stderr = truncatedStderr;
            rejectPromise(error);
        });
    });
}

export function buildProbeArgs(filePath, includeFrames = false) {
    const entries = includeFrames
        ? 'format=format_name,duration,size:stream=codec_name,codec_type,width,height,avg_frame_rate,pix_fmt,time_base,nb_frames,nb_read_frames:frame=best_effort_timestamp_time,pts_time,pkt_pts_time,pkt_dts_time,duration_time,pkt_duration_time:packet=pts_time,dts_time,duration_time'
        : 'format=format_name,duration,size:stream=codec_name,codec_type,width,height,avg_frame_rate,pix_fmt,time_base,nb_frames,nb_read_frames';
    return [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-count_frames',
        '-show_entries', entries,
        '-of', 'json',
        filePath
    ];
}

export async function probeMedia(run, ffprobe, filePath, includeFrames = false) {
    const result = await run(ffprobe, buildProbeArgs(filePath, includeFrames));
    const stdout = String(result?.stdout ?? '').trim();
    if (!stdout) {
        throw new Error(`ffprobe returned empty output for ${filePath}.`);
    }
    try {
        return JSON.parse(stdout);
    } catch (error) {
        throw new Error(`ffprobe returned invalid JSON for ${filePath}: ${error.message}`);
    }
}

export function extractProbeEntries(probe) {
    const combined = Array.isArray(probe?.packets_and_frames) ? probe.packets_and_frames : [];
    const frames = Array.isArray(probe?.frames) && probe.frames.length > 0
        ? probe.frames
        : combined.filter(entry => entry?.type === 'frame');
    const packets = Array.isArray(probe?.packets) && probe.packets.length > 0
        ? probe.packets
        : combined.filter(entry => entry?.type === 'packet');
    return { frames, packets };
}

function firstFiniteField(item, fieldNames) {
    for (const name of fieldNames) {
        const value = finiteNumber(item?.[name]);
        if (value !== null) return value;
    }
    return null;
}

function timestampRange(items, timestampNames, durationNames) {
    const durations = Array.isArray(durationNames) ? durationNames : [durationNames];
    let first = Number.POSITIVE_INFINITY;
    let last = Number.NEGATIVE_INFINITY;
    for (const item of items ?? []) {
        const timestamp = firstFiniteField(item, timestampNames);
        if (timestamp === null) continue;
        const itemDuration = Math.max(0, firstFiniteField(item, durations) ?? 0);
        first = Math.min(first, timestamp);
        last = Math.max(last, timestamp + itemDuration);
    }
    return Number.isFinite(first) && Number.isFinite(last) && last >= first
        ? { first, last, duration: last - first }
        : null;
}

export function mediaDuration(probe) {
    const containerDuration = finiteNumber(probe?.format?.duration);
    if (containerDuration !== null && containerDuration > 0) {
        return { seconds: containerDuration, source: 'format' };
    }

    const { frames, packets } = extractProbeEntries(probe);
    const frameRange = timestampRange(frames, FRAME_TIMESTAMP_FIELDS, FRAME_DURATION_FIELDS);
    const packetRange = timestampRange(packets, PACKET_TIMESTAMP_FIELDS, PACKET_DURATION_FIELDS);
    const validFrame = frameRange && frameRange.duration > 0 ? frameRange : null;
    const validPacket = packetRange && packetRange.duration > 0 ? packetRange : null;

    if (!validFrame && !validPacket) {
        return { seconds: null, source: 'unavailable' };
    }
    if (validFrame && (!validPacket || validFrame.duration >= validPacket.duration)) {
        return { seconds: validFrame.duration, source: 'frame_timestamps' };
    }
    return { seconds: validPacket.duration, source: 'packet_timestamps' };
}

export function frameTimes(probe) {
    const { frames } = extractProbeEntries(probe);
    return frames
        .map(frame => firstFiniteField(frame, FRAME_TIMESTAMP_FIELDS))
        .filter(value => value !== null)
        .sort((left, right) => left - right);
}

export function percentile(sorted, ratio) {
    if (!Array.isArray(sorted) || sorted.length === 0) return 0;
    const clamped = Math.max(0, Math.min(1, ratio));
    const index = Math.min(sorted.length - 1, Math.floor(clamped * (sorted.length - 1)));
    return sorted[index];
}

export function timingMetrics(times, durationSeconds = null) {
    const sortedTimes = (Array.isArray(times) ? times : [])
        .map(finiteNumber)
        .filter(value => value !== null)
        .sort((left, right) => left - right);
    const firstTimestampSeconds = sortedTimes.length > 0 ? sortedTimes[0] : null;
    const lastTimestampSeconds = sortedTimes.length > 0 ? sortedTimes[sortedTimes.length - 1] : null;
    const spanSeconds = sortedTimes.length > 1
        ? Math.max(0, lastTimestampSeconds - firstTimestampSeconds)
        : 0;

    const gaps = [];
    for (let index = 1; index < sortedTimes.length; index++) {
        const gap = sortedTimes[index] - sortedTimes[index - 1];
        if (gap >= 0) gaps.push(gap);
    }
    const sortedGapsMs = gaps.map(gap => gap * 1000).sort((left, right) => left - right);
    const maximumFrameGap = gaps.reduce((max, gap) => (gap > max ? gap : max), 0);
    const maxFrameGapMs = sortedGapsMs.length > 0 ? sortedGapsMs[sortedGapsMs.length - 1] : 0;
    const averageFrameGapMs = sortedGapsMs.length > 0
        ? sortedGapsMs.reduce((sum, gap) => sum + gap, 0) / sortedGapsMs.length
        : 0;
    const p50FrameGapMs = percentile(sortedGapsMs, 0.5);
    const p95FrameGapMs = percentile(sortedGapsMs, 0.95);

    const parsedDuration = finiteNumber(durationSeconds);
    const durationBasis = parsedDuration !== null && parsedDuration > 0 ? parsedDuration : spanSeconds;
    const averageFps = durationBasis > 0 ? sortedTimes.length / durationBasis : 0;

    const bucketMap = new Map();
    for (const time of sortedTimes) {
        const second = Math.floor(Math.max(0, time - firstTimestampSeconds));
        bucketMap.set(second, (bucketMap.get(second) ?? 0) + 1);
    }
    const maxBucket = sortedTimes.length > 0
        ? Math.max(0, Math.floor(Math.max(0, lastTimestampSeconds - firstTimestampSeconds)))
        : -1;
    const windowFps = [];
    for (let second = 0; second <= maxBucket; second++) {
        windowFps.push({ second, frames: bucketMap.get(second) ?? 0 });
    }
    const fullBuckets = windowFps.filter(bucket => bucket.second + 1 <= durationBasis + 1e-6);
    const summaryBuckets = windowFps.length < 2
        ? windowFps
        : (fullBuckets.length >= 2 ? fullBuckets : (fullBuckets.length > 0 ? fullBuckets : windowFps));
    const windowFpsMin = summaryBuckets.length > 0
        ? summaryBuckets.reduce((min, bucket) => (bucket.frames < min ? bucket.frames : min), summaryBuckets[0].frames)
        : 0;
    const windowFpsMax = summaryBuckets.length > 0
        ? summaryBuckets.reduce((max, bucket) => (bucket.frames > max ? bucket.frames : max), summaryBuckets[0].frames)
        : 0;

    return {
        frameCount: sortedTimes.length,
        firstTimestampSeconds,
        lastTimestampSeconds,
        spanSeconds,
        effectiveCaptureFps: spanSeconds > 0 ? (sortedTimes.length - 1) / spanSeconds : 0,
        averageFps,
        maximumFrameGap,
        averageFrameGapMs,
        p50FrameGapMs,
        p95FrameGapMs,
        maxFrameGapMs,
        intervalsOver50Ms: gaps.filter(gap => gap > 0.05).length,
        intervalsOver100Ms: gaps.filter(gap => gap > 0.1).length,
        intervalsOver200Ms: gaps.filter(gap => gap > 0.2).length,
        windowFps,
        windowFpsMin,
        windowFpsMax
    };
}

export function formatPerfWebmLine(timing, durationSeconds = null) {
    const parsedDuration = finiteNumber(durationSeconds);
    const resolvedDuration = parsedDuration !== null && parsedDuration > 0
        ? parsedDuration
        : timing.spanSeconds;
    return `[PERF:WEBM] frames=${timing.frameCount}` +
        ` durationSeconds=${resolvedDuration.toFixed(3)}` +
        ` effectiveFps=${timing.effectiveCaptureFps.toFixed(2)}` +
        ` averageFps=${timing.averageFps.toFixed(2)}` +
        ` avgGapMs=${timing.averageFrameGapMs.toFixed(1)}` +
        ` p50GapMs=${timing.p50FrameGapMs.toFixed(1)}` +
        ` p95GapMs=${timing.p95FrameGapMs.toFixed(1)}` +
        ` maxGapMs=${timing.maxFrameGapMs.toFixed(1)}` +
        ` over50ms=${timing.intervalsOver50Ms}` +
        ` over100ms=${timing.intervalsOver100Ms}` +
        ` over200ms=${timing.intervalsOver200Ms}` +
        ` windowFpsMin=${timing.windowFpsMin}` +
        ` windowFpsMax=${timing.windowFpsMax}`;
}

export function validateWebm(probe, { width, height, expectedDuration, toleranceSeconds = 2 }) {
    const stream = probe?.streams?.[0];
    const duration = mediaDuration(probe);
    const { frames } = extractProbeEntries(probe);
    const times = frameTimes(probe);
    const decodedFromEntries = times.length > 0 ? times.length : frames.length;
    const readFrames = finiteNumber(stream?.nb_read_frames);
    const frameCount = Math.max(
        decodedFromEntries,
        readFrames !== null && readFrames > 0 ? readFrames : 0
    );
    const failures = [];
    if (!String(probe?.format?.format_name ?? '').toLowerCase().includes('webm')) {
        failures.push('container is not WebM');
    }
    if (!ALLOWED_WEBM_CODECS.has(stream?.codec_name)) {
        failures.push(`codec is ${stream?.codec_name ?? 'missing'}`);
    }
    if (stream?.width !== width || stream?.height !== height) {
        failures.push(`resolution is not ${width}x${height}`);
    }
    if (frameCount < 1) {
        failures.push('no decodable video frames');
    }
    if (duration.seconds === null || duration.seconds <= 0) {
        failures.push('duration is unavailable from format, frames, and packets');
    } else if (
        expectedDuration !== undefined &&
        expectedDuration !== null &&
        Number.isFinite(expectedDuration) &&
        Math.abs(duration.seconds - expectedDuration) > toleranceSeconds
    ) {
        failures.push(
            `duration ${duration.seconds.toFixed(3)}s from ${duration.source} differs from expected ${expectedDuration.toFixed(3)}s`
        );
    }
    return { failures, duration, times, frameCount, stream };
}

export function validateMp4(probe, { width, height, expectedDuration, toleranceSeconds = 2, fps = 30 }) {
    const stream = probe?.streams?.[0];
    const duration = mediaDuration(probe);
    const frames = finiteNumber(stream?.nb_read_frames) ?? finiteNumber(stream?.nb_frames);
    const failures = [];
    if (!String(probe?.format?.format_name ?? '').toLowerCase().includes('mp4')) {
        failures.push('container is not MP4');
    }
    if (stream?.codec_name !== 'h264') {
        failures.push('codec is not H.264');
    }
    if (stream?.width !== width || stream?.height !== height) {
        failures.push(`resolution is not ${width}x${height}`);
    }
    if (stream?.avg_frame_rate !== `${fps}/1`) {
        failures.push(`frame rate is ${stream?.avg_frame_rate ?? 'missing'}`);
    }
    if (stream?.pix_fmt !== 'yuv420p') {
        failures.push(`pixel format is ${stream?.pix_fmt ?? 'missing'}`);
    }
    if (frames === null || frames < 1) {
        failures.push('no decodable video frames');
    }
    if (duration.seconds === null || duration.seconds <= 0) {
        failures.push('duration is unavailable');
    } else if (
        expectedDuration !== undefined &&
        expectedDuration !== null &&
        Number.isFinite(expectedDuration) &&
        Math.abs(duration.seconds - expectedDuration) > toleranceSeconds
    ) {
        failures.push(`duration is ${duration.seconds}s`);
    }
    return { failures, duration, stream, frames };
}

export async function verifyVideoDecode(run, ffmpeg, inputPath) {
    const result = await run(ffmpeg, [
        '-v', 'error', '-xerror', '-i', inputPath, '-map', '0:v:0', '-f', 'null', '-'
    ]);
    const exitCode = result?.exitCode ?? 0;
    const stderr = String(result?.stderr ?? '').trim();
    if (exitCode !== 0 || stderr.length > 0) {
        const detail = stderr.slice(-2000) || `exit code ${exitCode}`;
        const error = new Error(`Video decode verification failed for ${inputPath}: ${detail}`);
        error.exitCode = exitCode;
        error.stderr = stderr.slice(-2000);
        throw error;
    }
    return result;
}

export async function convertWebmToMp4(
    run,
    ffmpeg,
    input,
    output,
    {
        width,
        height,
        fps = 30,
        threads = 2,
        preset = 'veryfast',
        crf = 23,
        exactFrames = null,
        maxPadFrames = 0,
        normalizeTimestamps = false,
        videoTrackTimescale = null,
        keyint = null,
        h264Profile = null
    }
) {
    const filters = [`scale=${width}:${height}:flags=lanczos`, 'setsar=1'];
    if (normalizeTimestamps) {
        filters.push('setpts=PTS-STARTPTS');
    }
    filters.push(`fps=${fps}`);
    if (exactFrames !== null && Number.isSafeInteger(exactFrames) && exactFrames > 0 && maxPadFrames > 0) {
        filters.push(`tpad=stop_mode=clone:stop=${maxPadFrames}`);
    }

    const args = [
        '-n', '-hide_banner', '-loglevel', 'warning',
        '-fflags', '+genpts',
        '-i', input,
        '-map', '0:v:0',
        '-vf', filters.join(','),
        '-c:v', 'libx264',
        '-preset', String(preset),
        '-threads', String(threads),
        '-crf', String(crf)
    ];
    if (h264Profile) {
        args.push('-profile:v', String(h264Profile));
    }
    if (keyint !== null && Number.isSafeInteger(keyint) && keyint > 0) {
        args.push('-g', String(keyint), '-keyint_min', String(keyint), '-sc_threshold', '0');
    }
    args.push('-pix_fmt', 'yuv420p');
    if (exactFrames !== null && Number.isSafeInteger(exactFrames) && exactFrames > 0) {
        args.push('-frames:v', String(exactFrames));
    }
    if (videoTrackTimescale !== null && Number.isSafeInteger(videoTrackTimescale) && videoTrackTimescale > 0) {
        args.push('-video_track_timescale', String(videoTrackTimescale));
    }
    args.push('-an', '-movflags', '+faststart', '-f', 'mp4', output);
    return await run(ffmpeg, args);
}

export async function frameLuma(run, ffmpeg, input, atSeconds) {
    const result = await run(ffmpeg, [
        '-hide_banner', '-ss', String(Math.max(0, atSeconds)), '-i', input,
        '-frames:v', '1', '-vf', 'signalstats,metadata=print', '-f', 'null', '-'
    ]);
    const match = String(result?.stderr ?? '').match(/lavfi\.signalstats\.YAVG=([\d.]+)/);
    return match ? finiteNumber(match[1]) : null;
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

export async function publishWithoutOverwrite(sourcePath, destinationPath) {
    if (await pathExists(destinationPath)) {
        throw new Error(`Refusing to overwrite existing output file: ${destinationPath}`);
    }
    try {
        await link(sourcePath, destinationPath);
        await rm(sourcePath, { force: true });
    } catch (error) {
        if (error?.code === 'EEXIST') {
            throw new Error(`Refusing to overwrite existing output file: ${destinationPath}`);
        }
        if (error?.code === 'EXDEV' || error?.code === 'EPERM' || error?.code === 'ENOTSUP') {
            if (await pathExists(destinationPath)) {
                throw new Error(`Refusing to overwrite existing output file: ${destinationPath}`);
            }
            await rename(sourcePath, destinationPath);
            return;
        }
        throw error;
    }
}

export async function preserveFailedWebm(partialPath, failedPath) {
    if (await pathExists(failedPath)) {
        throw new Error(`Refusing to overwrite existing file: ${failedPath}`);
    }
    await rename(partialPath, failedPath);
    return failedPath;
}

export async function processWebmToMp4({
    inputPath,
    outputPath,
    mp4PartialPath = `${outputPath}.partial`,
    width = 1280,
    height = 720,
    fps = 30,
    expectedDuration = 10,
    toleranceSeconds = 2,
    threads = 2,
    preset = 'veryfast',
    crf = 23,
    exactFrames = null,
    maxPadFrames = 0,
    normalizeTimestamps = false,
    videoTrackTimescale = null,
    keyint = null,
    h264Profile = null,
    mp4ExpectedDuration = null,
    mp4ToleranceSeconds = null,
    minWebmDurationSeconds = null,
    ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg',
    ffprobe = process.env.FFPROBE_PATH ?? 'ffprobe',
    run = runCommand,
    log = () => {},
    secrets = [],
    onWebmValidated = null
}) {
    const emit = message => {
        log(redactSecret(message, secrets));
    };

    let stage = 'input_check';
    let createdMp4Partial = false;
    try {
        if (!inputPath) throw new Error('Input WebM path is required.');
        if (!outputPath) throw new Error('Output MP4 path is required.');
        if (mp4PartialPath === outputPath || mp4PartialPath === inputPath) {
            throw new Error('Temporary MP4 partial path must differ from input and output paths.');
        }

        let inputStat;
        try {
            inputStat = await stat(inputPath);
        } catch (error) {
            throw new Error(`Input WebM file is not accessible (${inputPath}): ${error.message}`);
        }
        if (!inputStat.isFile()) {
            throw new Error(`Input path is not a regular file: ${inputPath}`);
        }
        if (inputStat.size <= 0) {
            throw new Error(`Input WebM file is empty (0 bytes): ${inputPath}`);
        }
        if (await pathExists(outputPath)) {
            throw new Error(`Refusing to overwrite existing output file: ${outputPath}`);
        }
        if (await pathExists(mp4PartialPath)) {
            throw new Error(`Temporary MP4 partial file already exists: ${mp4PartialPath}`);
        }
        emit(`[VIDEO:RECEIVED] bytes=${inputStat.size}`);

        stage = 'webm_probe';
        const webmProbe = await probeMedia(run, ffprobe, inputPath, true);
        const webmValidation = validateWebm(webmProbe, {
            width,
            height,
            expectedDuration,
            toleranceSeconds
        });
        const codec = webmValidation.stream?.codec_name ?? 'missing';
        const probedWidth = webmValidation.stream?.width ?? 'missing';
        const probedHeight = webmValidation.stream?.height ?? 'missing';
        const durationText = webmValidation.duration.seconds !== null
            ? webmValidation.duration.seconds.toFixed(3)
            : 'unavailable';
        emit(`[VIDEO:PROBE] codec=${codec} width=${probedWidth} height=${probedHeight}`);
        emit(`[VIDEO:FRAMES] count=${webmValidation.frameCount}`);
        emit(`[VIDEO:DURATION] method=${webmValidation.duration.source} seconds=${durationText}`);

        stage = 'webm_validate';
        if (webmValidation.failures.length > 0) {
            throw new Error(`WebM validation failed: ${webmValidation.failures.join('; ')}.`);
        }
        if (minWebmDurationSeconds !== null
            && Number.isFinite(minWebmDurationSeconds)
            && webmValidation.duration.seconds !== null
            && webmValidation.duration.seconds < minWebmDurationSeconds) {
            throw new Error(
                `WebM validation failed: duration ${webmValidation.duration.seconds.toFixed(3)}s ` +
                `is shorter than minimum ${minWebmDurationSeconds.toFixed(3)}s.`
            );
        }

        stage = 'webm_decode';
        await verifyVideoDecode(run, ffmpeg, inputPath);
        emit('[VIDEO:VALIDATED]');
        const timing = timingMetrics(webmValidation.times, webmValidation.duration.seconds);
        emit(formatPerfWebmLine(timing, webmValidation.duration.seconds));

        stage = 'webm_publish';
        let transcodeInputPath = inputPath;
        if (typeof onWebmValidated === 'function') {
            const updatedPath = await onWebmValidated({
                inputPath,
                webmBytes: inputStat.size,
                webmValidation
            });
            if (typeof updatedPath === 'string' && updatedPath.length > 0) {
                transcodeInputPath = updatedPath;
            }
        }

        stage = 'transcode';
        await mkdir(dirname(mp4PartialPath), { recursive: true });
        await mkdir(dirname(outputPath), { recursive: true });
        const conversionStarted = Date.now();
        emit('[VIDEO:TRANSCODE_START]');
        createdMp4Partial = true;
        await convertWebmToMp4(run, ffmpeg, transcodeInputPath, mp4PartialPath, {
            width,
            height,
            fps,
            threads,
            preset,
            crf,
            exactFrames,
            maxPadFrames,
            normalizeTimestamps,
            videoTrackTimescale,
            keyint,
            h264Profile
        });
        const conversionDurationSeconds = (Date.now() - conversionStarted) / 1000;
        emit('[VIDEO:TRANSCODE_COMPLETE]');

        stage = 'mp4_decode';
        await verifyVideoDecode(run, ffmpeg, mp4PartialPath);

        stage = 'mp4_validate';
        const mp4Probe = await probeMedia(run, ffprobe, mp4PartialPath, false);
        const mp4Validation = validateMp4(mp4Probe, {
            width,
            height,
            expectedDuration: mp4ExpectedDuration !== null ? mp4ExpectedDuration : expectedDuration,
            toleranceSeconds: mp4ToleranceSeconds !== null ? mp4ToleranceSeconds : toleranceSeconds,
            fps
        });
        const mp4Failures = [...mp4Validation.failures];
        if (exactFrames !== null && Number.isSafeInteger(exactFrames) && mp4Validation.frames !== exactFrames) {
            mp4Failures.push(`frame count is ${mp4Validation.frames ?? 'missing'}, expected ${exactFrames}`);
        }
        let firstLuma = null;
        let lastLuma = null;
        if (mp4Validation.duration.seconds !== null) {
            firstLuma = await frameLuma(run, ffmpeg, mp4PartialPath, 0.1);
            lastLuma = await frameLuma(
                run,
                ffmpeg,
                mp4PartialPath,
                Math.max(0, mp4Validation.duration.seconds - 0.2)
            );
            if (firstLuma === null || firstLuma < 2) {
                mp4Failures.push(`first frame is blank/unreadable (YAVG=${firstLuma})`);
            }
            if (lastLuma === null || lastLuma < 2) {
                mp4Failures.push(`last frame is blank/unreadable (YAVG=${lastLuma})`);
            }
        }
        if (mp4Failures.length > 0) {
            throw new Error(`MP4 validation failed: ${mp4Failures.join('; ')}.`);
        }

        stage = 'mp4_publish';
        await publishWithoutOverwrite(mp4PartialPath, outputPath);
        const mp4Stat = await stat(outputPath);
        emit('[VIDEO:MP4_VALIDATED]');

        return {
            webmBytes: inputStat.size,
            mp4Bytes: mp4Stat.size,
            webmValidation,
            mp4Validation: { ...mp4Validation, firstLuma, lastLuma },
            timing,
            conversionDurationSeconds,
            outputPath,
            inputPath: transcodeInputPath
        };
    } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        const exitCode = failure.exitCode !== undefined && failure.exitCode !== null
            ? failure.exitCode
            : 'na';
        const reason = redactSecret(
            String(failure.message ?? failure).replace(/\s+/g, ' ').trim(),
            secrets
        );
        emit(`[VIDEO:FAILED] stage=${stage} reason=${reason} exitCode=${exitCode}`);
        if (createdMp4Partial && mp4PartialPath && mp4PartialPath !== outputPath && mp4PartialPath !== inputPath) {
            await rm(mp4PartialPath, { force: true }).catch(() => {});
        }
        failure.stage = stage;
        if (failure.exitCode === undefined) {
            failure.exitCode = null;
        }
        throw failure;
    }
}

export async function checkMp4Faststart(filePath) {
    const fileStat = await stat(filePath);
    const fileSize = fileStat.size;
    const handle = await open(filePath, 'r');
    const header = Buffer.alloc(16);
    let offset = 0;
    let moovOffset = null;
    let mdatOffset = null;
    try {
        while (offset + 8 <= fileSize) {
            const bytesToRead = Math.min(16, fileSize - offset);
            const { bytesRead } = await handle.read(header, 0, bytesToRead, offset);
            if (bytesRead < 8) break;
            const size32 = header.readUInt32BE(0);
            const boxType = header.toString('ascii', 4, 8);
            let boxSize = size32;
            if (size32 === 1) {
                if (bytesRead < 16) break;
                const extended = header.readBigUInt64BE(8);
                if (extended < 16n) break;
                boxSize = Number(extended);
            } else if (size32 === 0) {
                boxSize = fileSize - offset;
            } else if (size32 < 8) {
                break;
            }

            if (boxType === 'moov' && moovOffset === null) {
                moovOffset = offset;
            } else if (boxType === 'mdat' && mdatOffset === null) {
                mdatOffset = offset;
            }
            if (moovOffset !== null && mdatOffset !== null) {
                break;
            }
            if (!Number.isFinite(boxSize) || boxSize <= 0) {
                break;
            }
            offset += boxSize;
        }
    } finally {
        await handle.close();
    }

    return {
        faststart: moovOffset !== null && mdatOffset !== null && moovOffset < mdatOffset,
        moovOffset,
        mdatOffset
    };
}

export function validateTimestampContinuity(times, fps = 30) {
    const sorted = (Array.isArray(times) ? times : [])
        .map(finiteNumber)
        .filter(value => value !== null);
    if (sorted.length < 2) {
        return { valid: false, reason: 'insufficient frame timestamps', maxGapMs: 0 };
    }
    const maxAllowedGapSeconds = (2 / fps) + 0.015;
    let maxGap = 0;
    for (let index = 1; index < sorted.length; index++) {
        const diff = sorted[index] - sorted[index - 1];
        if (diff < -1e-6) {
            return {
                valid: false,
                reason: `non-monotonic timestamp regression at frame ${index} (${sorted[index - 1]} -> ${sorted[index]})`,
                maxGapMs: maxGap * 1000
            };
        }
        if (diff > maxGap) maxGap = diff;
        if (diff > maxAllowedGapSeconds) {
            return {
                valid: false,
                reason: `timestamp gap ${(diff * 1000).toFixed(1)}ms at frame ${index} exceeds ${(maxAllowedGapSeconds * 1000).toFixed(1)}ms`,
                maxGapMs: maxGap * 1000
            };
        }
    }
    return { valid: true, reason: null, maxGapMs: maxGap * 1000 };
}

export async function validateExistingSegmentMp4({
    filePath,
    width,
    height,
    fps = 30,
    expectedFrames,
    expectedDuration,
    toleranceSeconds = 0.08,
    ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg',
    ffprobe = process.env.FFPROBE_PATH ?? 'ffprobe',
    run = runCommand
}) {
    try {
        const fileStat = await stat(filePath);
        if (!fileStat.isFile() || fileStat.size <= 0) {
            return { valid: false, reason: 'segment file missing or empty', bytes: 0 };
        }
        const probe = await probeMedia(run, ffprobe, filePath, false);
        const validation = validateMp4(probe, {
            width,
            height,
            expectedDuration,
            toleranceSeconds,
            fps
        });
        const failures = [...validation.failures];
        if (expectedFrames !== undefined && expectedFrames !== null && validation.frames !== expectedFrames) {
            failures.push(`frame count is ${validation.frames ?? 'missing'}, expected ${expectedFrames}`);
        }
        if (failures.length > 0) {
            return { valid: false, reason: failures.join('; '), bytes: fileStat.size, probe, validation };
        }
        await verifyVideoDecode(run, ffmpeg, filePath);
        return { valid: true, reason: null, bytes: fileStat.size, probe, validation };
    } catch (error) {
        return { valid: false, reason: error?.message ?? String(error), bytes: 0 };
    }
}

export function buildConcatManifest(segmentPaths) {
    if (!Array.isArray(segmentPaths) || segmentPaths.length === 0) {
        throw new Error('At least one segment path is required for concatenation.');
    }
    const lines = ['ffconcat version 1.0'];
    for (const rawPath of segmentPaths) {
        const normalized = String(rawPath).replace(/\\/g, '/').replace(/'/g, "'\\''");
        lines.push(`file '${normalized}'`);
    }
    return `${lines.join('\n')}\n`;
}

export function checkSegmentsConcatCompatible(probes, { width, height, fps = 30 }) {
    if (!Array.isArray(probes) || probes.length === 0) {
        return { compatible: false, reasons: ['no segment probes available'] };
    }
    const reasons = [];
    let expectedTimeBase = null;
    for (let index = 0; index < probes.length; index++) {
        const stream = probes[index]?.streams?.[0];
        const tag = `segment ${index + 1}`;
        if (!stream) {
            reasons.push(`${tag}: missing video stream`);
            continue;
        }
        if (stream.codec_name !== 'h264') {
            reasons.push(`${tag}: codec is ${stream.codec_name ?? 'missing'}`);
        }
        if (stream.width !== width || stream.height !== height) {
            reasons.push(`${tag}: resolution is ${stream.width ?? '?'}x${stream.height ?? '?'}`);
        }
        if (stream.pix_fmt !== 'yuv420p') {
            reasons.push(`${tag}: pixel format is ${stream.pix_fmt ?? 'missing'}`);
        }
        if (stream.avg_frame_rate !== `${fps}/1`) {
            reasons.push(`${tag}: avg_frame_rate is ${stream.avg_frame_rate ?? 'missing'}`);
        }
        if (stream.time_base) {
            if (expectedTimeBase === null) {
                expectedTimeBase = stream.time_base;
            } else if (stream.time_base !== expectedTimeBase) {
                reasons.push(`${tag}: time_base ${stream.time_base} differs from ${expectedTimeBase}`);
            }
        }
    }
    return { compatible: reasons.length === 0, reasons };
}

export async function validateConsolidatedMp4({
    filePath,
    width = 1280,
    height = 720,
    fps = 30,
    expectedFrames,
    expectedDuration,
    maxDurationDeviationSeconds = 0.1,
    ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg',
    ffprobe = process.env.FFPROBE_PATH ?? 'ffprobe',
    run = runCommand
}) {
    await verifyVideoDecode(run, ffmpeg, filePath);
    const probe = await probeMedia(run, ffprobe, filePath, true);
    const validation = validateMp4(probe, {
        width,
        height,
        expectedDuration,
        toleranceSeconds: maxDurationDeviationSeconds,
        fps
    });
    const failures = [...validation.failures];
    if (expectedFrames !== undefined && expectedFrames !== null) {
        if (validation.frames === null || Math.abs(validation.frames - expectedFrames) > 1) {
            failures.push(`frame count is ${validation.frames ?? 'missing'}, expected ${expectedFrames}`);
        }
    }

    const times = frameTimes(probe);
    const continuity = validateTimestampContinuity(times, fps);
    if (!continuity.valid) {
        failures.push(`timestamp continuity check failed: ${continuity.reason}`);
    }

    let firstLuma = null;
    let midLuma = null;
    let lastLuma = null;
    if (validation.duration.seconds !== null) {
        firstLuma = await frameLuma(run, ffmpeg, filePath, 0.1);
        if (validation.duration.seconds >= 2) {
            midLuma = await frameLuma(run, ffmpeg, filePath, validation.duration.seconds / 2);
        } else {
            midLuma = firstLuma;
        }
        lastLuma = await frameLuma(run, ffmpeg, filePath, Math.max(0, validation.duration.seconds - 0.2));
        if (firstLuma === null || firstLuma < 2) {
            failures.push(`first frame is blank/unreadable (YAVG=${firstLuma})`);
        }
        if (midLuma === null || midLuma < 2) {
            failures.push(`midpoint frame is blank/unreadable (YAVG=${midLuma})`);
        }
        if (lastLuma === null || lastLuma < 2) {
            failures.push(`last frame is blank/unreadable (YAVG=${lastLuma})`);
        }
    }

    const faststartInfo = await checkMp4Faststart(filePath);
    if (!faststartInfo.faststart) {
        failures.push('MP4 faststart atom ordering invalid (moov must precede mdat)');
    }

    return {
        failures,
        duration: validation.duration,
        frames: validation.frames,
        stream: validation.stream,
        maxGapMs: continuity.maxGapMs,
        firstLuma,
        midLuma,
        lastLuma,
        faststart: faststartInfo.faststart
    };
}

export async function concatenateMp4Segments({
    segmentPaths,
    manifestPath,
    outputPath,
    partialOutputPath = `${outputPath}.partial`,
    width = 1280,
    height = 720,
    fps = 30,
    expectedFrames,
    expectedDuration,
    maxDurationDeviationSeconds = 0.1,
    threads = 2,
    preset = 'veryfast',
    crf = 23,
    videoTrackTimescale = 30000,
    ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg',
    ffprobe = process.env.FFPROBE_PATH ?? 'ffprobe',
    run = runCommand,
    log = () => {},
    secrets = []
}) {
    const emit = message => log(redactSecret(message, secrets));
    if (await pathExists(outputPath)) {
        throw new Error(`Refusing to overwrite existing output file: ${outputPath}`);
    }
    if (await pathExists(partialOutputPath)) {
        await rm(partialOutputPath, { force: true });
    }
    await mkdir(dirname(outputPath), { recursive: true });
    await mkdir(dirname(manifestPath), { recursive: true });

    const probes = [];
    for (const segPath of segmentPaths) {
        probes.push(await probeMedia(run, ffprobe, segPath, false));
    }
    const compat = checkSegmentsConcatCompatible(probes, { width, height, fps });
    await writeFile(manifestPath, buildConcatManifest(segmentPaths), 'utf8');

    const startedAt = Date.now();
    let strategy = null;
    let validation = null;

    if (compat.compatible) {
        try {
            emit(`Concatenating ${segmentPaths.length} segments via FFmpeg concat demuxer (-c copy).`);
            await run(ffmpeg, [
                '-n', '-hide_banner', '-loglevel', 'warning',
                '-f', 'concat', '-safe', '0',
                '-i', manifestPath,
                '-map', '0:v:0',
                '-c', 'copy',
                '-an',
                '-movflags', '+faststart',
                '-f', 'mp4',
                partialOutputPath
            ]);
            validation = await validateConsolidatedMp4({
                filePath: partialOutputPath,
                width,
                height,
                fps,
                expectedFrames,
                expectedDuration,
                maxDurationDeviationSeconds,
                ffmpeg,
                ffprobe,
                run
            });
            if (validation.failures.length === 0) {
                strategy = 'concat_copy';
            } else {
                emit(`Concat -c copy validation failed (${validation.failures.join('; ')}); falling back to bounded re-encode.`);
                await rm(partialOutputPath, { force: true }).catch(() => {});
            }
        } catch (error) {
            emit(`Concat -c copy failed (${error.message}); falling back to bounded re-encode.`);
            await rm(partialOutputPath, { force: true }).catch(() => {});
        }
    } else {
        emit(`Segments incompatible for stream copy (${compat.reasons.join('; ')}); using bounded concat re-encode.`);
    }

    if (strategy === null) {
        const reencodeArgs = ['-n', '-hide_banner', '-loglevel', 'warning'];
        for (const segPath of segmentPaths) {
            reencodeArgs.push('-i', segPath);
        }
        const filterParts = segmentPaths.map((_, index) =>
            `[${index}:v:0]scale=${width}:${height}:flags=lanczos,setsar=1,fps=${fps},setpts=PTS-STARTPTS[v${index}]`
        );
        const concatInputs = segmentPaths.map((_, index) => `[v${index}]`).join('');
        filterParts.push(`${concatInputs}concat=n=${segmentPaths.length}:v=1:a=0[vout]`);
        reencodeArgs.push(
            '-filter_complex', filterParts.join(';'),
            '-map', '[vout]',
            '-frames:v', String(expectedFrames),
            '-c:v', 'libx264',
            '-preset', String(preset),
            '-threads', String(threads),
            '-crf', String(crf),
            '-pix_fmt', 'yuv420p',
            '-video_track_timescale', String(videoTrackTimescale),
            '-an',
            '-movflags', '+faststart',
            '-f', 'mp4',
            partialOutputPath
        );
        await run(ffmpeg, reencodeArgs);
        validation = await validateConsolidatedMp4({
            filePath: partialOutputPath,
            width,
            height,
            fps,
            expectedFrames,
            expectedDuration,
            maxDurationDeviationSeconds,
            ffmpeg,
            ffprobe,
            run
        });
        if (validation.failures.length > 0) {
            await rm(partialOutputPath, { force: true }).catch(() => {});
            throw new Error(`Consolidated MP4 validation failed: ${validation.failures.join('; ')}.`);
        }
        strategy = 'reencode_fallback';
    }

    await publishWithoutOverwrite(partialOutputPath, outputPath);
    const outStat = await stat(outputPath);
    return {
        strategy,
        mp4Bytes: outStat.size,
        validation,
        assemblyDurationSeconds: (Date.now() - startedAt) / 1000,
        outputPath
    };
}
