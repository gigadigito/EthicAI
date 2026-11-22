import { rename } from 'node:fs/promises';

function finiteNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function timestampRange(items, timestampNames, durationName) {
    let first = Number.POSITIVE_INFINITY;
    let last = Number.NEGATIVE_INFINITY;
    for (const item of items ?? []) {
        const timestamp = timestampNames.map(name => finiteNumber(item?.[name])).find(value => value !== null);
        if (timestamp === undefined) continue;
        const itemDuration = Math.max(0, finiteNumber(item?.[durationName]) ?? 0);
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

    const frameRange = timestampRange(
        probe?.frames,
        ['best_effort_timestamp_time', 'pkt_pts_time', 'pkt_dts_time'],
        'pkt_duration_time');
    const packetRange = timestampRange(probe?.packets, ['pts_time', 'dts_time'], 'duration_time');
    const range = [frameRange, packetRange]
        .filter(Boolean)
        .sort((left, right) => right.duration - left.duration)[0];
    if (!range || range.duration <= 0) return { seconds: null, source: 'unavailable' };
    return { seconds: range.duration, source: frameRange === range ? 'frame-timestamps' : 'packet-timestamps' };
}

export function frameTimes(probe) {
    return (probe?.frames ?? [])
        .map(frame => ['best_effort_timestamp_time', 'pkt_pts_time', 'pkt_dts_time']
            .map(name => finiteNumber(frame?.[name]))
            .find(value => value !== null))
        .filter(value => value !== undefined)
        .sort((left, right) => left - right);
}

export function validateWebm(probe, { width, height, expectedDuration, toleranceSeconds = 2 }) {
    const stream = probe?.streams?.[0];
    const duration = mediaDuration(probe);
    const times = frameTimes(probe);
    const failures = [];
    if (!String(probe?.format?.format_name).includes('webm')) failures.push('container is not WebM');
    if (stream?.codec_name !== 'vp8') failures.push(`codec is ${stream?.codec_name ?? 'missing'}`);
    if (stream?.width !== width || stream?.height !== height) failures.push(`resolution is not ${width}x${height}`);
    if (times.length === 0) failures.push('no decodable video frames');
    if (duration.seconds === null) failures.push('duration is unavailable from format, frames, and packets');
    else if (Math.abs(duration.seconds - expectedDuration) > toleranceSeconds) {
        failures.push(`duration ${duration.seconds.toFixed(3)}s from ${duration.source} differs from expected ${expectedDuration.toFixed(3)}s`);
    }
    return { failures, duration, times, stream };
}

export function validateMp4(probe, { width, height, expectedDuration, toleranceSeconds = 2, fps = 30 }) {
    const stream = probe?.streams?.[0];
    const duration = mediaDuration(probe);
    const frames = Number(stream?.nb_read_frames ?? stream?.nb_frames);
    const failures = [];
    if (!String(probe?.format?.format_name).includes('mp4')) failures.push('container is not MP4');
    if (stream?.codec_name !== 'h264') failures.push('codec is not H.264');
    if (stream?.width !== width || stream?.height !== height) failures.push(`resolution is not ${width}x${height}`);
    if (stream?.avg_frame_rate !== `${fps}/1`) failures.push(`frame rate is ${stream?.avg_frame_rate ?? 'missing'}`);
    if (stream?.pix_fmt !== 'yuv420p') failures.push(`pixel format is ${stream?.pix_fmt ?? 'missing'}`);
    if (!Number.isFinite(frames) || frames < 1) failures.push('no decodable video frames');
    if (duration.seconds === null || Math.abs(duration.seconds - expectedDuration) > toleranceSeconds) {
        failures.push(`duration is ${duration.seconds ?? 'unavailable'}s`);
    }
    return { failures, duration, stream, frames };
}

export async function preserveFailedWebm(partialPath, failedPath) {
    await rename(partialPath, failedPath);
    return failedPath;
}

export async function convertWebmToMp4(run, ffmpeg, input, output, { width, height, fps = 30 }) {
    await run(ffmpeg, [
        '-n', '-hide_banner', '-loglevel', 'warning', '-i', input, '-an',
        '-vf', `scale=${width}:${height}:flags=lanczos,setsar=1,fps=${fps}`,
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart', '-f', 'mp4', output
    ]);
}
