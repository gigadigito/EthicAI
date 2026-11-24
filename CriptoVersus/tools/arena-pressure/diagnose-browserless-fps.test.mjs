import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {
    buildSyntheticContext,
    buildSyntheticPageHtml,
    syntheticBrowserlessFunction,
    syntheticBrowserlessHandler
} from './diagnose-browserless-fps.mjs';

class FakeRequest {
    constructor(url) {
        this.requestUrl = url;
        this.abortedReason = null;
    }
    url() { return this.requestUrl; }
    async abort(reason) { this.abortedReason = reason; }
}

class FakePage {
    constructor({
        rafMode = 'never',
        interceptionNever = false,
        viewportNever = false,
        viewportDelayMs = 0,
        setContentNever = false,
        setContentError = null,
        omitCanvas = false,
        omitBench = false,
        readyOnAttempt = 1,
        readinessEvaluateNever = false,
        metricsEvaluateNever = false,
        metricsError = null,
        emitRequestsOnSetContent = []
    } = {}) {
        this.rafMode = rafMode;
        this.interceptionNever = interceptionNever;
        this.viewportNever = viewportNever;
        this.viewportDelayMs = viewportDelayMs;
        this.setContentNever = setContentNever;
        this.setContentError = setContentError;
        this.omitCanvas = omitCanvas;
        this.omitBench = omitBench;
        this.readyOnAttempt = readyOnAttempt;
        this.readinessEvaluateNever = readinessEvaluateNever;
        this.metricsEvaluateNever = metricsEvaluateNever;
        this.metricsError = metricsError;
        this.emitRequestsOnSetContent = emitRequestsOnSetContent;

        this.interceptionEnabled = false;
        this.viewport = null;
        this.requestHandler = null;
        this.cleanedUp = false;
        this.requests = [];
        this.rafQueue = [];
        this.rafRequests = 0;
        this.fakeNowMs = 1_000;
        this.readinessPolls = 0;
        this.vmContext = null;
    }

    async setRequestInterception(value) {
        if (this.interceptionNever) return new Promise(() => {});
        this.interceptionEnabled = value;
    }

    on(event, handler) {
        assert.equal(event, 'request');
        this.requestHandler = handler;
    }

    off(event, handler) {
        assert.equal(event, 'request');
        if (this.requestHandler === handler) {
            this.requestHandler = null;
            this.cleanedUp = true;
        }
    }

    async setViewport(viewport) {
        if (this.viewportNever) return new Promise(() => {});
        if (this.viewportDelayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, this.viewportDelayMs));
        }
        this.viewport = viewport;
    }

    emitRequest(url) {
        const request = new FakeRequest(url);
        this.requests.push(request);
        if (this.requestHandler) this.requestHandler(request);
        return request;
    }

    async setContent(html) {
        for (const url of this.emitRequestsOnSetContent) {
            this.emitRequest(url);
        }
        if (this.setContentNever) return new Promise(() => {});
        if (this.setContentError) throw this.setContentError;

        const canvasMatch = html.match(/<canvas\b[^>]*id="bench"[^>]*width="(\d+)"[^>]*height="(\d+)"/);
        const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
        const canvasWidth = canvasMatch ? Number(canvasMatch[1]) : 0;
        const canvasHeight = canvasMatch ? Number(canvasMatch[2]) : 0;

        const fakeCtx = {
            fillStyle: '',
            font: '',
            fillRect() {},
            beginPath() {},
            arc() {},
            fill() {},
            fillText() {}
        };
        const fakeCanvas = {
            width: canvasWidth,
            height: canvasHeight,
            getContext: kind => (kind === '2d' ? fakeCtx : null)
        };

        const self = this;
        const sandbox = {
            Math,
            Number,
            String,
            Boolean,
            Array,
            Object,
            performance: {
                now: () => self.fakeNowMs
            },
            document: {
                readyState: 'complete',
                getElementById: id => (id === 'bench' ? fakeCanvas : null)
            },
            requestAnimationFrame: callback => {
                self.rafRequests += 1;
                if (self.rafMode === 'manual') {
                    self.rafQueue.push(callback);
                }
                return self.rafRequests;
            }
        };
        sandbox.window = sandbox;
        this.vmContext = vm.createContext(sandbox);

        if (scriptMatch) {
            vm.runInContext(scriptMatch[1], this.vmContext);
        }
        if (this.omitCanvas) {
            this.vmContext.document.getElementById = () => null;
        }
        if (this.omitBench) {
            vm.runInContext('delete window.__syntheticBench;', this.vmContext);
        }
    }

    flushRafFrame(stepMs = 16.67) {
        if (!this.vmContext || this.rafQueue.length === 0) return 0;
        const callbacks = this.rafQueue.splice(0, this.rafQueue.length);
        this.fakeNowMs += stepMs;
        for (const callback of callbacks) {
            callback(this.fakeNowMs);
        }
        return callbacks.length;
    }

    async evaluate(fn, ...args) {
        const source = fn.toString();
        const isReadinessProbe = source.includes('getElementById') && source.includes('__syntheticBench');
        if (isReadinessProbe) {
            this.readinessPolls += 1;
            if (this.readinessEvaluateNever) return new Promise(() => {});
            if (this.readinessPolls < this.readyOnAttempt) {
                return {
                    ready: false,
                    hasCanvas: false,
                    canvasWidth: 0,
                    canvasHeight: 0,
                    hasBench: false,
                    readyState: 'loading'
                };
            }
        } else {
            if (this.metricsEvaluateNever) return new Promise(() => {});
            if (this.metricsError) throw this.metricsError;
        }

        const serializedArgs = JSON.stringify(args);
        return vm.runInContext(`(${source})(...${serializedArgs})`, this.vmContext);
    }
}

function syntheticContext(overrides = {}) {
    return {
        ...buildSyntheticContext({ width: 1280, height: 720, durationSeconds: 1 }),
        durationMs: 25,
        executionBudgetMs: 1_000,
        initBudgetMs: 500,
        requestInterceptionTimeoutMs: 100,
        viewportTimeoutMs: 100,
        setContentTimeoutMs: 100,
        readinessTimeoutMs: 100,
        readinessPollIntervalMs: 5,
        metricsTimeoutMs: 100,
        screencastControlTimeoutMs: 100,
        ...overrides
    };
}

async function captureLogs(action) {
    const logs = [];
    const errors = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...values) => { logs.push(values.join(' ')); };
    console.error = (...values) => { errors.push(values.join(' ')); };
    try {
        await action();
    } finally {
        console.log = originalLog;
        console.error = originalError;
    }
    return { logs, errors };
}

test('completes synthetic benchmark without waiting for requestAnimationFrame callbacks', async () => {
    assert.doesNotMatch(syntheticBrowserlessFunction, /requestAnimationFrame/);

    const page = new FakePage({ rafMode: 'never' });
    let starts = 0;
    let stops = 0;

    const { logs, errors } = await captureLogs(async () => {
        await syntheticBrowserlessHandler({
            page,
            context: syntheticContext(),
            startScreencast: () => { starts += 1; },
            stopScreencast: () => { stops += 1; }
        });
    });

    assert.equal(errors.length, 0);
    assert.equal(page.rafRequests, 1);
    assert.equal(starts, 1);
    assert.equal(stops, 1);
    assert.equal(page.cleanedUp, true);
    assert.ok(logs.some(line => line.includes('[SYNTHETIC:CANVAS_READY]') && line.includes('hasBench=true')));
    assert.ok(logs.some(line => line.includes('[PERF:SYNTHETIC] width=1280 height=720 frames=0 rafFps=0.00')));
    assert.ok(logs.some(line => line.includes('[SYNTHETIC:COMPLETE]')));
});

test('passes readiness before rAF starts and reports frames when rAF ticks during recording', async () => {
    const page = new FakePage({ rafMode: 'manual' });
    let starts = 0;
    let stops = 0;
    let rafQueueAtStart = -1;

    const { logs } = await captureLogs(async () => {
        await syntheticBrowserlessHandler({
            page,
            context: syntheticContext({ durationMs: 40 }),
            startScreencast: () => {
                starts += 1;
                rafQueueAtStart = page.rafQueue.length;
                setTimeout(() => {
                    for (let i = 0; i < 5; i++) {
                        page.flushRafFrame(16.67);
                    }
                }, 5);
            },
            stopScreencast: () => { stops += 1; }
        });
    });

    assert.equal(starts, 1);
    assert.equal(stops, 1);
    assert.equal(rafQueueAtStart, 1);
    const perfLine = logs.find(line => line.includes('[PERF:SYNTHETIC]'));
    assert.ok(perfLine, 'expected [PERF:SYNTHETIC] log line');
    assert.match(perfLine, /frames=5\b/);
    assert.match(perfLine, /rafFps=[1-9]\d*\.\d{2}/);
});

test('emits full stage instrumentation in chronological order and cleans up request handler', async () => {
    const page = new FakePage({
        rafMode: 'never',
        emitRequestsOnSetContent: [
            'https://example.test/favicon.ico',
            'https://example.test/analytics.js'
        ]
    });
    let starts = 0;
    let stops = 0;

    const { logs } = await captureLogs(async () => {
        await syntheticBrowserlessHandler({
            page,
            context: syntheticContext(),
            startScreencast: () => { starts += 1; },
            stopScreencast: () => { stops += 1; }
        });
    });
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(starts, 1);
    assert.equal(stops, 1);
    assert.equal(page.interceptionEnabled, true);
    assert.equal(page.cleanedUp, true);
    assert.equal(page.requests.length, 2);
    for (const req of page.requests) {
        assert.equal(req.abortedReason, 'blockedbyclient');
    }

    const expectedMarkers = [
        '[SYNTHETIC:REQUEST_INTERCEPTION_START]',
        '[SYNTHETIC:REQUEST_INTERCEPTION_OK]',
        '[SYNTHETIC:VIEWPORT_START]',
        '[SYNTHETIC:VIEWPORT_OK]',
        '[SYNTHETIC:SET_CONTENT_START]',
        '[SYNTHETIC:SET_CONTENT_OK]',
        '[SYNTHETIC:CANVAS_CHECK_START]',
        '[SYNTHETIC:CANVAS_READY]',
        '[SYNTHETIC:SCREENCAST_START]',
        '[SYNTHETIC:SCREENCAST_STARTED]',
        '[SYNTHETIC:RECORDING_START]',
        '[SYNTHETIC:RECORDING_END]',
        '[SYNTHETIC:METRICS_START]',
        '[PERF:SYNTHETIC]',
        '[SYNTHETIC:METRICS_OK]',
        '[SYNTHETIC:SCREENCAST_STOP_START]',
        '[SYNTHETIC:SCREENCAST_STOP_OK]',
        '[SYNTHETIC:COMPLETE]'
    ];

    let cursor = -1;
    for (const marker of expectedMarkers) {
        const index = logs.findIndex((line, i) => i > cursor && line.includes(marker));
        assert.ok(index > cursor, `missing or out-of-order marker ${marker}`);
        cursor = index;
    }
    assert.ok(logs.some(line => line.includes('[SYNTHETIC:COMPLETE]') && line.includes('abortedRequests=2')));
});

test('buildSyntheticContext preserves 10s recording duration and bounded budgets below global timeout', () => {
    const ctx = buildSyntheticContext({ width: 1280, height: 720, durationSeconds: 10 });
    assert.equal(ctx.width, 1280);
    assert.equal(ctx.height, 720);
    assert.equal(ctx.durationMs, 10_000);
    assert.equal(ctx.executionBudgetMs, 30_000);
    assert.ok(ctx.executionBudgetMs < 45_000);
    assert.equal(ctx.initBudgetMs, 15_000);
    assert.ok(ctx.requestInterceptionTimeoutMs > 0 && ctx.requestInterceptionTimeoutMs <= 10_000);
    assert.ok(ctx.viewportTimeoutMs > 0 && ctx.viewportTimeoutMs <= 10_000);
    assert.ok(ctx.setContentTimeoutMs > 0 && ctx.setContentTimeoutMs <= 10_000);
    assert.ok(ctx.readinessTimeoutMs > 0 && ctx.readinessTimeoutMs <= 10_000);
    assert.ok(ctx.metricsTimeoutMs > 0 && ctx.metricsTimeoutMs <= 10_000);
    assert.ok(ctx.screencastControlTimeoutMs > 0 && ctx.screencastControlTimeoutMs <= 10_000);
    assert.equal(ctx.html, buildSyntheticPageHtml(1280, 720));
});

test('preserves the full requested recording duration between startScreencast and stopScreencast', async () => {
    const page = new FakePage({ rafMode: 'never' });
    let startAt = 0;
    let stopAt = 0;

    const { logs } = await captureLogs(async () => {
        await syntheticBrowserlessHandler({
            page,
            context: syntheticContext({ durationMs: 60 }),
            startScreencast: () => { startAt = Date.now(); },
            stopScreencast: () => { stopAt = Date.now(); }
        });
    });

    assert.ok(stopAt - startAt >= 50, `expected >= 50ms recording interval, got ${stopAt - startAt}ms`);
    const endLine = logs.find(line => line.includes('[SYNTHETIC:RECORDING_END]'));
    assert.ok(endLine, 'expected [SYNTHETIC:RECORDING_END]');
    assert.match(endLine, /requestedMs=60\b/);
    const match = endLine.match(/wallElapsedMs=(\d+)/);
    assert.ok(match && Number(match[1]) >= 50);
});

test('fails fast on bounded initialization timeouts without starting screencast', async () => {
    const timeoutCases = [
        {
            name: 'setRequestInterception hang',
            pageOptions: { interceptionNever: true },
            ctxOverrides: { requestInterceptionTimeoutMs: 10 },
            expectedCode: 'REQUEST_INTERCEPTION_TIMEOUT',
            expectedStage: 'REQUEST_INTERCEPTION',
            expectCleanedUp: false
        },
        {
            name: 'setViewport hang',
            pageOptions: { viewportNever: true },
            ctxOverrides: { viewportTimeoutMs: 10 },
            expectedCode: 'VIEWPORT_TIMEOUT',
            expectedStage: 'VIEWPORT',
            expectCleanedUp: true
        },
        {
            name: 'setContent hang',
            pageOptions: { setContentNever: true },
            ctxOverrides: { setContentTimeoutMs: 10 },
            expectedCode: 'SET_CONTENT_TIMEOUT',
            expectedStage: 'SET_CONTENT',
            expectCleanedUp: true
        },
        {
            name: 'setContent Puppeteer TimeoutError',
            pageOptions: { setContentError: Object.assign(new Error('Navigation timeout'), { name: 'TimeoutError' }) },
            ctxOverrides: {},
            expectedCode: 'SET_CONTENT_TIMEOUT',
            expectedStage: 'SET_CONTENT',
            expectCleanedUp: true
        },
        {
            name: 'missing canvas readiness timeout',
            pageOptions: { omitCanvas: true },
            ctxOverrides: { readinessTimeoutMs: 20, readinessPollIntervalMs: 5 },
            expectedCode: 'CANVAS_READY_TIMEOUT',
            expectedStage: 'CANVAS_READY',
            expectCleanedUp: true
        },
        {
            name: 'missing __syntheticBench readiness timeout',
            pageOptions: { omitBench: true },
            ctxOverrides: { readinessTimeoutMs: 20, readinessPollIntervalMs: 5 },
            expectedCode: 'CANVAS_READY_TIMEOUT',
            expectedStage: 'CANVAS_READY',
            expectCleanedUp: true
        },
        {
            name: 'readiness evaluate hang',
            pageOptions: { readinessEvaluateNever: true },
            ctxOverrides: { readinessTimeoutMs: 15 },
            expectedCode: 'CANVAS_READY_TIMEOUT',
            expectedStage: 'CANVAS_READY',
            expectCleanedUp: true
        }
    ];

    for (const tc of timeoutCases) {
        const page = new FakePage(tc.pageOptions);
        let starts = 0;
        let stops = 0;
        const { errors } = await captureLogs(async () => {
            await assert.rejects(
                syntheticBrowserlessHandler({
                    page,
                    context: syntheticContext(tc.ctxOverrides),
                    startScreencast: () => { starts += 1; },
                    stopScreencast: () => { stops += 1; }
                }),
                error => error.captureCode === tc.expectedCode,
                `${tc.name}: expected rejection with ${tc.expectedCode}`
            );
        });

        assert.equal(starts, 0, `${tc.name}: should not start screencast`);
        assert.equal(stops, 0, `${tc.name}: should not stop screencast`);
        assert.equal(page.cleanedUp, tc.expectCleanedUp, `${tc.name}: cleanedUp mismatch`);
        assert.ok(
            errors.some(line => line.includes(`[SYNTHETIC:FAILED] stage=${tc.expectedStage}`) && line.includes(`reason=${tc.expectedCode}`)),
            `${tc.name}: missing failure diagnostic`
        );
    }
});

test('CANVAS_READY succeeds after polling retry without rAF', async () => {
    const page = new FakePage({ rafMode: 'never', readyOnAttempt: 2 });
    let starts = 0;
    let stops = 0;

    const { logs } = await captureLogs(async () => {
        await syntheticBrowserlessHandler({
            page,
            context: syntheticContext(),
            startScreencast: () => { starts += 1; },
            stopScreencast: () => { stops += 1; }
        });
    });

    assert.equal(starts, 1);
    assert.equal(stops, 1);
    assert.ok(logs.some(line => line.includes('[SYNTHETIC:CANVAS_READY]') && line.includes('attempts=2')));
});

test('enforces combined initBudgetMs cap across initialization stages', async () => {
    const page = new FakePage({ viewportDelayMs: 25 });
    let starts = 0;
    let stops = 0;

    const { errors } = await captureLogs(async () => {
        await assert.rejects(
            syntheticBrowserlessHandler({
                page,
                context: syntheticContext({ initBudgetMs: 15, viewportTimeoutMs: 100 }),
                startScreencast: () => { starts += 1; },
                stopScreencast: () => { stops += 1; }
            }),
            error => error.captureCode === 'INIT_BUDGET_EXHAUSTED' || error.captureCode === 'VIEWPORT_TIMEOUT'
        );
    });

    assert.equal(starts, 0);
    assert.equal(stops, 0);
    assert.equal(page.cleanedUp, true);
    assert.ok(errors.some(line => line.includes('[SYNTHETIC:FAILED]')));
});

test('runs stopScreencast safely on post-start failures without masking original error or double-stopping', async () => {
    // 1. Metrics throws -> cleanup stops once
    {
        const page = new FakePage();
        page.metricsError = new Error('metrics boom');
        let starts = 0;
        let stops = 0;
        const { logs, errors } = await captureLogs(async () => {
            await assert.rejects(
                syntheticBrowserlessHandler({
                    page,
                    context: syntheticContext(),
                    startScreencast: () => { starts += 1; },
                    stopScreencast: () => { stops += 1; }
                }),
                /metrics boom/
            );
        });
        assert.equal(starts, 1);
        assert.equal(stops, 1);
        assert.equal(page.cleanedUp, true);
        assert.ok(logs.some(line => line.includes('[SYNTHETIC:SCREENCAST_STOP_START]') && line.includes('cleanup=true')));
        assert.ok(logs.some(line => line.includes('[SYNTHETIC:SCREENCAST_STOP_OK]') && line.includes('cleanup=true')));
        assert.ok(errors.some(line => line.includes('[SYNTHETIC:FAILED] stage=METRICS')));
    }

    // 2. Metrics hangs -> METRICS_TIMEOUT, cleanup stops once
    {
        const page = new FakePage({ metricsEvaluateNever: true });
        let starts = 0;
        let stops = 0;
        const { logs, errors } = await captureLogs(async () => {
            await assert.rejects(
                syntheticBrowserlessHandler({
                    page,
                    context: syntheticContext({ metricsTimeoutMs: 15 }),
                    startScreencast: () => { starts += 1; },
                    stopScreencast: () => { stops += 1; }
                }),
                error => error.captureCode === 'METRICS_TIMEOUT'
            );
        });
        assert.equal(starts, 1);
        assert.equal(stops, 1);
        assert.equal(page.cleanedUp, true);
        assert.ok(logs.some(line => line.includes('[SYNTHETIC:SCREENCAST_STOP_OK]') && line.includes('cleanup=true')));
        assert.ok(errors.some(line => line.includes('[SYNTHETIC:FAILED] stage=METRICS') && line.includes('reason=METRICS_TIMEOUT')));
    }

    // 3. Metrics throws AND cleanup stopScreencast throws -> original error propagates, stop failed logged
    {
        const page = new FakePage({ metricsError: new Error('original metrics failure') });
        let stops = 0;
        const { errors } = await captureLogs(async () => {
            await assert.rejects(
                syntheticBrowserlessHandler({
                    page,
                    context: syntheticContext(),
                    startScreencast: () => {},
                    stopScreencast: () => {
                        stops += 1;
                        throw new Error('cleanup stop failed');
                    }
                }),
                /original metrics failure/
            );
        });
        assert.equal(stops, 1);
        assert.equal(page.cleanedUp, true);
        assert.ok(errors.some(line => line.includes('[SYNTHETIC:SCREENCAST_STOP_FAILED]') && line.includes('cleanup=true')));
    }

    // 4. Normal stopScreencast throws -> propagates, never double-called in finally
    {
        const page = new FakePage();
        let stops = 0;
        const { errors } = await captureLogs(async () => {
            await assert.rejects(
                syntheticBrowserlessHandler({
                    page,
                    context: syntheticContext(),
                    startScreencast: () => {},
                    stopScreencast: () => {
                        stops += 1;
                        throw new Error('stop exploded');
                    }
                }),
                /stop exploded/
            );
        });
        assert.equal(stops, 1);
        assert.equal(page.cleanedUp, true);
        assert.ok(errors.some(line => line.includes('[SYNTHETIC:SCREENCAST_STOP_FAILED]') && line.includes('cleanup=false')));
    }
});

test('serialized Browserless v1 function compiles and runs in isolated VM without URL or rAF', async () => {
    assert.match(syntheticBrowserlessFunction, /^module\.exports = async function syntheticBrowserlessHandler/);
    assert.doesNotMatch(syntheticBrowserlessFunction, /new URL\s*\(/);
    assert.doesNotThrow(() => new Function(syntheticBrowserlessFunction));

    const sandbox = { module: { exports: null }, setTimeout, clearTimeout, console };
    vm.runInNewContext(syntheticBrowserlessFunction, sandbox);
    assert.equal(vm.runInNewContext('typeof URL', sandbox), 'undefined');

    const page = new FakePage({ rafMode: 'never' });
    let starts = 0;
    let stops = 0;

    const { logs } = await captureLogs(async () => {
        await sandbox.module.exports({
            page,
            context: syntheticContext(),
            startScreencast: () => { starts += 1; },
            stopScreencast: () => { stops += 1; }
        });
    });

    assert.equal(starts, 1);
    assert.equal(stops, 1);
    assert.equal(page.cleanedUp, true);
    assert.ok(logs.some(line => line.includes('[SYNTHETIC:COMPLETE]')));
});
