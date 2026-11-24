import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
    buildFullMatchPlan,
    calculateDynamicReplaySpeed,
    parseFullMatchArgs,
    validateMatchHistoryMetadata
} from './capture-planner.mjs';

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));

test('calculateDynamicReplaySpeed computes dynamic speeds for arbitrary match durations and handles short matches', () => {
    const match46156 = calculateDynamicReplaySpeed(5412.612, 120);
    assert.ok(Math.abs(match46156.replaySpeed - 45.1051) < 1e-9);
    assert.equal(match46156.shortMatchAdjusted, false);
    assert.equal(match46156.effectiveTargetDurationSeconds, 120);

    const match15m = calculateDynamicReplaySpeed(900, 120);
    assert.equal(match15m.replaySpeed, 7.5);

    const match3h = calculateDynamicReplaySpeed(10800, 120);
    assert.equal(match3h.replaySpeed, 90);

    const match24h = calculateDynamicReplaySpeed(86400, 120);
    assert.equal(match24h.replaySpeed, 720);

    // 60s match compressed into 120s -> 0.5x (valid without clamping)
    const shortValid = calculateDynamicReplaySpeed(60, 120);
    assert.equal(shortValid.replaySpeed, 0.5);
    assert.equal(shortValid.shortMatchAdjusted, false);

    // 5s match cannot stretch below MIN_REPLAY_SPEED=0.1x -> capped to 50s at 0.1x
    const veryShort = calculateDynamicReplaySpeed(5, 120);
    assert.equal(veryShort.replaySpeed, 0.1);
    assert.equal(veryShort.effectiveTargetDurationSeconds, 50);
    assert.equal(veryShort.shortMatchAdjusted, true);

    assert.throws(() => calculateDynamicReplaySpeed(0.5, 120), /at least 1 second/);
    assert.throws(() => calculateDynamicReplaySpeed(2_000_000, 120), /exceeds maximum supported speed/);
});

test('buildFullMatchPlan plans match 46156 cleanly with contiguous zero-drift boundaries', () => {
    const plan = buildFullMatchPlan({
        matchId: 46156,
        historicalDurationSeconds: 5412.612,
        historyPoints: 240,
        targetVideoDurationSeconds: 120,
        segmentDurationSeconds: 10,
        width: 1280,
        height: 720,
        fps: 30
    });

    assert.equal(plan.totalSegments, 12);
    assert.equal(plan.selectedSegmentCount, 12);
    assert.equal(plan.totalTargetFrames, 3600);
    assert.ok(Math.abs(plan.replaySpeed - 45.1051) < 1e-9);
    assert.equal(plan.isPartialValidationRun, false);

    assert.equal(plan.segments[0].videoStartSeconds, 0);
    assert.equal(plan.segments[0].historicalStartSeconds, 0);
    assert.equal(plan.segments[0].isFinalSegment, false);

    for (let i = 0; i < plan.segments.length - 1; i++) {
        const current = plan.segments[i];
        const next = plan.segments[i + 1];
        assert.equal(current.endFrame, next.startFrame);
        assert.equal(current.videoEndSeconds, next.videoStartSeconds);
        assert.equal(current.historicalEndSeconds, next.historicalStartSeconds);
    }

    const last = plan.segments.at(-1);
    assert.equal(last.videoEndSeconds, 120);
    assert.equal(last.historicalEndSeconds, 5412.612);
    assert.equal(last.isFinalSegment, true);
});

test('buildFullMatchPlan rebalances tiny remainder tails and supports --max-segments partial continuity mode', () => {
    // 21s at 10s segments -> [10, 10, 1] rebalanced to [10, 5.5, 5.5] (300, 165, 165 frames)
    const rebalanced = buildFullMatchPlan({
        matchId: 100,
        historicalDurationSeconds: 210,
        historyPoints: 50,
        targetVideoDurationSeconds: 21,
        segmentDurationSeconds: 10,
        fps: 30
    });
    assert.deepEqual(rebalanced.segments.map(s => s.targetFrames), [300, 165, 165]);
    assert.equal(rebalanced.segments.reduce((s, x) => s + x.targetFrames, 0), 630);

    const partial = buildFullMatchPlan({
        matchId: 46156,
        historicalDurationSeconds: 5412.612,
        historyPoints: 240,
        targetVideoDurationSeconds: 120,
        segmentDurationSeconds: 10,
        maxSegments: 3
    });
    assert.equal(partial.totalSegments, 12);
    assert.equal(partial.selectedSegmentCount, 3);
    assert.equal(partial.selectedTargetFrames, 900);
    assert.equal(partial.selectedVideoDurationSeconds, 30);
    assert.ok(Math.abs(partial.replaySpeed - 45.1051) < 1e-9);
    assert.equal(partial.isPartialValidationRun, true);
    assert.notEqual(partial.planFingerprint, buildFullMatchPlan({
        matchId: 46156,
        historicalDurationSeconds: 5412.612,
        historyPoints: 240,
        targetVideoDurationSeconds: 120,
        segmentDurationSeconds: 10
    }).planFingerprint);
});

test('validateMatchHistoryMetadata enforces finished status, valid history, and capture contract', () => {
    const valid = validateMatchHistoryMetadata({
        found: true,
        pageError: false,
        isFinished: true,
        officialResult: 'left',
        historyPoints: 240,
        historySpanSeconds: 5412.612,
        leftSymbol: 'BTC',
        rightSymbol: 'ETH',
        supportsSegmentedCapture: true
    });
    assert.equal(valid.historicalDurationSeconds, 5412.612);
    assert.equal(valid.historyPoints, 240);

    assert.throws(() => validateMatchHistoryMetadata({ found: false }), error => error.code === 'MATCH_NOT_FOUND');
    assert.throws(() => validateMatchHistoryMetadata({ found: true, pageError: true }), error => error.code === 'MATCH_LOAD_ERROR');
    assert.throws(() => validateMatchHistoryMetadata({ found: true, isFinished: false }), error => error.code === 'MATCH_NOT_FINISHED');
    assert.throws(() => validateMatchHistoryMetadata({ found: true, isFinished: true, officialResult: 'cancelled' }), error => error.code === 'MATCH_CANCELLED');
    assert.throws(() => validateMatchHistoryMetadata({ found: true, isFinished: true, historyPoints: 1, historySpanSeconds: 100 }), error => error.code === 'INVALID_HISTORY');
    assert.throws(() => validateMatchHistoryMetadata({ found: true, isFinished: true, historyPoints: 10, historySpanSeconds: 0.4 }), error => error.code === 'INVALID_HISTORY');
    assert.throws(() => validateMatchHistoryMetadata({ found: true, isFinished: true, historyPoints: 10, historySpanSeconds: 100, supportsSegmentedCapture: false }), error => error.code === 'CAPTURE_CONTRACT_OUTDATED');
});

test('parseFullMatchArgs validates required parameters, bounds, and mutual exclusions', () => {
    assert.equal(parseFullMatchArgs(['--help']).help, true);
    const parsed = parseFullMatchArgs([
        '--match-id', '46156',
        '--target-duration', '120',
        '--segment-duration', '10',
        '--width', '1280',
        '--height', '720',
        '--output', '/tmp/arena-pressure-phase2/out'
    ]);
    assert.equal(parsed.matchId, 46156);
    assert.equal(parsed.targetDurationSeconds, 120);
    assert.equal(parsed.segmentDurationSeconds, 10);
    assert.equal(parsed.keepIntermediates, false);

    assert.throws(() => parseFullMatchArgs(['--match-id', '46156', '--segment-duration', '30']), /\[5\.\.15\]/);
    assert.throws(() => parseFullMatchArgs(['--match-id', '46156', '--width', '1281']), /even integers/);
    assert.throws(() => parseFullMatchArgs(['--match-id', '46156', '--resume', 'r1', '--run-id', 'r2']), /cannot be used together/);
    assert.throws(() => parseFullMatchArgs(['--match-id', '46156', '--culture', 'xx']), /route culture/);
});

test('VPS standalone runtime .mjs files have zero third-party node_modules imports and avoid Node >18 APIs', async () => {
    const runtimeFiles = [
        'capture-media.mjs',
        'capture-browserless-options.mjs',
        'capture-browserless.mjs',
        'browserless-capture-function.mjs',
        'reprocess-webm.mjs',
        'diagnose-browserless-fps.mjs',
        'capture-planner.mjs',
        'capture-full-match.mjs'
    ];
    for (const file of runtimeFiles) {
        const source = await readFile(join(TOOL_DIR, file), 'utf8');
        const imports = [...source.matchAll(/^\s*import\s+[^'"]*['"]([^'"]+)['"]/gm)].map(m => m[1]);
        for (const specifier of imports) {
            assert.ok(
                specifier.startsWith('node:') || specifier.startsWith('./'),
                `${file} imports non-builtin/non-local specifier "${specifier}"`
            );
        }
        assert.doesNotMatch(source, /\bimport\.meta\.dirname\b/, `${file} uses Node 20+ import.meta.dirname`);
        assert.doesNotMatch(source, /\bArray\.fromAsync\b/, `${file} uses Node 22+ Array.fromAsync`);
        assert.doesNotMatch(source, /\bObject\.groupBy\b/, `${file} uses Node 21+ Object.groupBy`);
    }
});
