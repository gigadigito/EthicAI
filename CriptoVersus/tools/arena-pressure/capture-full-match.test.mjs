import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runCommand } from './capture-media.mjs';
import { runFullMatchCapture } from './capture-full-match.mjs';

const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe';

async function hasFfmpegToolchain() {
    try {
        await runCommand(FFMPEG, ['-version']);
        await runCommand(FFPROBE, ['-version']);
        return true;
    } catch {
        return false;
    }
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

function generateStreamingWebm(outputPath, durationSeconds, width = 320, height = 180) {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(FFMPEG, [
            '-hide_banner', '-loglevel', 'error',
            '-f', 'lavfi', '-i', `testsrc2=size=${width}x${height}:rate=24:duration=${durationSeconds.toFixed(3)}`,
            '-c:v', 'libvpx', '-b:v', '300k', '-deadline', 'realtime', '-cpu-used', '8',
            '-f', 'webm', '-live', '1', 'pipe:1'
        ], { windowsHide: true, shell: false });
        const stderrChunks = [];
        const writer = createWriteStream(outputPath, { flags: 'wx' });
        let settled = false;
        const fail = err => {
            if (settled) return;
            settled = true;
            writer.destroy();
            rejectPromise(err);
        };
        child.stderr.on('data', chunk => stderrChunks.push(chunk));
        child.on('error', fail);
        writer.on('error', fail);
        child.stdout.pipe(writer);
        const exitPromise = new Promise((res, rej) => {
            child.on('close', code => {
                if (code === 0) res();
                else rej(new Error(`ffmpeg generator exited ${code}: ${Buffer.concat(stderrChunks).toString('utf8')}`));
            });
        });
        const writePromise = new Promise(res => writer.on('close', res));
        Promise.all([exitPromise, writePromise]).then(() => {
            if (!settled) {
                settled = true;
                resolvePromise();
            }
        }, fail);
    });
}

const FFMPEG_AVAILABLE = await hasFfmpegToolchain();

test('real FFmpeg/FFprobe: orchestrates 3 sequential segments into 15.000s MP4, emits all telemetry markers, and redacts secrets', { skip: !FFMPEG_AVAILABLE }, async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'arena-pressure-full-ok-'));
    const secret = 'super-secret-capture-key-999';
    const logs = [];
    const observedOrder = [];

    try {
        const report = await runFullMatchCapture({
            matchId: 46156,
            targetDurationSeconds: 15,
            segmentDurationSeconds: 5,
            width: 320,
            height: 180,
            fps: 30,
            tailPadSeconds: 0.3,
            outputRoot: outDir,
            runId: 'testrun01',
            secrets: [secret],
            ffmpeg: FFMPEG,
            ffprobe: FFPROBE,
            sleep: async () => {},
            onLog: line => logs.push(line),
            fetchMetadata: async () => ({
                found: true,
                pageError: false,
                isFinished: true,
                officialResult: 'left',
                historyPoints: 240,
                historySpanSeconds: 5412.612,
                leftSymbol: 'BTC',
                rightSymbol: 'ETH',
                supportsSegmentedCapture: true
            }),
            captureSegmentWebm: async ({ segment, outputWebmPartialPath }) => {
                observedOrder.push(segment.index);
                // Alternate slightly shorter and slightly longer WebMs to exercise padding & trimming
                const dur = segment.videoDurationSeconds + (segment.index === 1 ? -0.2 : 0.25);
                await generateStreamingWebm(outputWebmPartialPath, dur, 320, 180);
            }
        });

        assert.deepEqual(observedOrder, [1, 2, 3]);
        assert.equal(report.status, 'validated');
        assert.equal(report.matchId, 46156);
        assert.equal(report.plannedSegments, 3);
        assert.equal(report.completedSegments, 3);
        assert.equal(report.outputCodec, 'h264');
        assert.equal(report.width, 320);
        assert.equal(report.height, 180);
        assert.equal(report.outputFps, '30/1');
        assert.equal(report.outputPixelFormat, 'yuv420p');
        assert.equal(report.faststart, true);
        assert.equal(report.finalFrames, 450);
        assert.ok(Math.abs(report.finalDurationSeconds - 15.0) < 0.04);
        assert.equal(await fileExists(report.outputPath), true);
        assert.equal(await fileExists(report.reportPath), true);

        // Intermediates removed by default
        assert.equal(await fileExists(join(outDir, 'runs', 'match-46156-testrun01', 'segments')), false);

        const requiredMarkers = [
            '[FULL_MATCH:START]',
            '[FULL_MATCH:HISTORY_LOADED]',
            '[FULL_MATCH:PLAN_READY]',
            '[FULL_MATCH:SEGMENT_START]',
            '[FULL_MATCH:SEGMENT_COMPLETE]',
            '[FULL_MATCH:ASSEMBLY_START]',
            '[FULL_MATCH:ASSEMBLY_COMPLETE]',
            '[FULL_MATCH:MP4_VALIDATED]',
            '[FULL_MATCH:COMPLETE]'
        ];
        for (const marker of requiredMarkers) {
            assert.ok(logs.some(line => line.includes(marker)), `missing marker ${marker}`);
        }
        assert.equal(logs.some(line => line.includes(secret)), false, 'secret must never appear in logs');

        const savedReport = JSON.parse(await readFile(report.reportPath, 'utf8'));
        assert.equal(savedReport.finalFrames, 450);
        assert.equal(savedReport.segments.length, 3);
    } finally {
        await rm(outDir, { recursive: true, force: true });
    }
});

test('real FFmpeg/FFprobe: retries transient segment failure, preserves partial progress, and resumes cleanly without re-capturing valid segments', { skip: !FFMPEG_AVAILABLE }, async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'arena-pressure-full-resume-'));
    const secret = 'resume-secret-token-777';
    const captureAttempts = [];

    const metadataStub = async () => ({
        found: true,
        pageError: false,
        isFinished: true,
        officialResult: 'right',
        historyPoints: 180,
        historySpanSeconds: 4000,
        leftSymbol: 'SOL',
        rightSymbol: 'DOGE',
        supportsSegmentedCapture: true
    });

    try {
        // Run 1: segment 2 recovers on attempt 2, segment 3 fails permanently -> aborts keeping segments 1 & 2 intact
        await assert.rejects(
            runFullMatchCapture({
                matchId: 46324,
                targetDurationSeconds: 15,
                segmentDurationSeconds: 5,
                width: 320,
                height: 180,
                fps: 30,
                tailPadSeconds: 0.25,
                maxRetries: 1,
                outputRoot: outDir,
                runId: 'resumable01',
                secrets: [secret],
                ffmpeg: FFMPEG,
                ffprobe: FFPROBE,
                sleep: async () => {},
                fetchMetadata: metadataStub,
                captureSegmentWebm: async ({ segment, attempt, outputWebmPartialPath }) => {
                    captureAttempts.push({ seg: segment.index, attempt });
                    if (segment.index === 2 && attempt === 1) {
                        throw new Error(`Transient Browserless glitch containing ${secret}`);
                    }
                    if (segment.index === 3) {
                        throw new Error('Transient screencast drop');
                    }
                    await generateStreamingWebm(outputWebmPartialPath, segment.videoDurationSeconds + 0.15, 320, 180);
                }
            }),
            /Transient screencast drop/
        );

        assert.deepEqual(captureAttempts, [
            { seg: 1, attempt: 1 },
            { seg: 2, attempt: 1 },
            { seg: 2, attempt: 2 },
            { seg: 3, attempt: 1 },
            { seg: 3, attempt: 2 }
        ]);

        const logAfterFailure = await readFile(
            join(outDir, 'arena-pressure-match-46324-full-resumable01.log'),
            'utf8'
        );
        assert.equal(logAfterFailure.includes(secret), false);
        assert.match(logAfterFailure, /\[FULL_MATCH:SEGMENT_FAILED\]/);

        // Resume with mismatched targetDuration must be rejected by planFingerprint check
        await assert.rejects(
            runFullMatchCapture({
                matchId: 46324,
                targetDurationSeconds: 20,
                segmentDurationSeconds: 5,
                width: 320,
                height: 180,
                fps: 30,
                outputRoot: outDir,
                resume: 'resumable01',
                ffmpeg: FFMPEG,
                ffprobe: FFPROBE,
                fetchMetadata: metadataStub,
                captureSegmentWebm: async () => {}
            }),
            error => error.code === 'RESUME_PLAN_MISMATCH'
        );

        // Corrupt segment 2 on disk to prove resume verifies integrity before reusing!
        const seg2Mp4 = join(outDir, 'runs', 'match-46324-resumable01', 'segments', 'segment-02.mp4');
        await writeFile(seg2Mp4, Buffer.from('corrupt-bytes'));

        const resumedAttempts = [];
        const resumedReport = await runFullMatchCapture({
            matchId: 46324,
            targetDurationSeconds: 15,
            segmentDurationSeconds: 5,
            width: 320,
            height: 180,
            fps: 30,
            tailPadSeconds: 0.25,
            maxRetries: 1,
            outputRoot: outDir,
            resume: 'resumable01',
            ffmpeg: FFMPEG,
            ffprobe: FFPROBE,
            sleep: async () => {},
            fetchMetadata: metadataStub,
            captureSegmentWebm: async ({ segment, attempt, outputWebmPartialPath }) => {
                resumedAttempts.push({ seg: segment.index, attempt });
                await generateStreamingWebm(outputWebmPartialPath, segment.videoDurationSeconds + 0.15, 320, 180);
            }
        });

        // Segment 1 reused, segment 2 detected corrupt & re-captured, segment 3 captured!
        assert.equal(resumedReport.segmentsReused, 1);
        assert.equal(resumedReport.segmentsCaptured, 2);
        assert.deepEqual(resumedAttempts, [
            { seg: 2, attempt: 1 },
            { seg: 3, attempt: 1 }
        ]);
        assert.equal(resumedReport.finalFrames, 450);
        assert.ok(Math.abs(resumedReport.finalDurationSeconds - 15.0) < 0.04);
    } finally {
        await rm(outDir, { recursive: true, force: true });
    }
});

test('real FFmpeg/FFprobe: --max-segments partial validation preserves full-match speed and produces labeled partial MP4', { skip: !FFMPEG_AVAILABLE }, async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'arena-pressure-partial-'));
    try {
        const report = await runFullMatchCapture({
            matchId: 46156,
            targetDurationSeconds: 10,
            segmentDurationSeconds: 5,
            maxSegments: 1,
            width: 320,
            height: 180,
            fps: 30,
            tailPadSeconds: 0.2,
            outputRoot: outDir,
            runId: 'partialtest',
            ffmpeg: FFMPEG,
            ffprobe: FFPROBE,
            fetchMetadata: async () => ({
                found: true,
                pageError: false,
                isFinished: true,
                officialResult: 'draw',
                historyPoints: 100,
                historySpanSeconds: 451.051,
                supportsSegmentedCapture: true
            }),
            captureSegmentWebm: async ({ segment, replaySpeed, outputWebmPartialPath }) => {
                assert.equal(segment.index, 1);
                assert.ok(Math.abs(replaySpeed - 45.1051) < 1e-6);
                await generateStreamingWebm(outputWebmPartialPath, 5.2, 320, 180);
            }
        });

        assert.equal(report.isPartialValidationRun, true);
        assert.equal(report.plannedSegments, 2);
        assert.equal(report.selectedSegments, 1);
        assert.match(report.outputPath, /partial-1of2-partialtest\.mp4$/);
        assert.equal(report.finalFrames, 150);
    } finally {
        await rm(outDir, { recursive: true, force: true });
    }
});
