import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { convertWebmToMp4, mediaDuration, preserveFailedWebm, validateMp4, validateWebm } from './capture-media.mjs';

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

test('uses frame timestamps when streaming WebM format duration is N/A', () => {
    const probe = webm([frame(0), frame(5), frame(9.966667)]);
    const result = validateWebm(probe, { width: 1280, height: 720, expectedDuration: 10 });
    assert.deepEqual(result.failures, []);
    assert.equal(result.duration.source, 'frame-timestamps');
    assert.ok(Math.abs(result.duration.seconds - 10) < 0.001);
});

test('uses packet timestamps if frame timestamps cannot establish duration', () => {
    const probe = webm([frame(0, 'N/A')], [
        { pts_time: '0', duration_time: '0.033333' },
        { pts_time: '9.966667', duration_time: '0.033333' }
    ]);
    assert.equal(mediaDuration(probe).source, 'packet-timestamps');
    assert.deepEqual(validateWebm(probe, { width: 1280, height: 720, expectedDuration: 10 }).failures, []);
});

test('rejects a truncated WebM by effective timestamp duration', () => {
    const result = validateWebm(webm([frame(0), frame(1)]), {
        width: 1280, height: 720, expectedDuration: 10
    });
    assert.match(result.failures.join('; '), /differs from expected/);
});

test('rejects a WebM without decodable frames', () => {
    const result = validateWebm(webm([], [{ pts_time: '0' }, { pts_time: '10' }]), {
        width: 1280, height: 720, expectedDuration: 10
    });
    assert.match(result.failures.join('; '), /no decodable video frames/);
});

test('MP4 validation requires decoded frames and the requested output properties', () => {
    const result = validateMp4({
        format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '10' },
        streams: [{ codec_name: 'h264', width: 1280, height: 720, avg_frame_rate: '30/1', pix_fmt: 'yuv420p', nb_read_frames: '0' }]
    }, { width: 1280, height: 720, expectedDuration: 10 });
    assert.match(result.failures.join('; '), /no decodable video frames/);
});

test('conversion failures are propagated without publishing an MP4', async () => {
    const failure = new Error('ffmpeg conversion failed');
    const run = async () => { throw failure; };
    await assert.rejects(
        convertWebmToMp4(run, 'ffmpeg', 'input.webm', 'output.partial.mp4', { width: 1280, height: 720 }),
        failure);
});

test('preserves the exact received bytes with a .failed.webm name after validation failure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arena-pressure-media-'));
    const partial = join(directory, 'capture.webm.partial');
    const failed = join(directory, 'capture.failed.webm');
    const bytes = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0xff]);
    try {
        await writeFile(partial, bytes);
        await preserveFailedWebm(partial, failed);
        assert.deepEqual(await readFile(failed), bytes);
        await assert.rejects(readFile(partial), error => error.code === 'ENOENT');
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
