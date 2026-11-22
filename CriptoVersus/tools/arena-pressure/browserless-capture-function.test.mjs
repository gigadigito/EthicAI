import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { browserlessFunction, browserlessFunctionHandler } from './browserless-capture-function.mjs';

const secret = 'test-secret-never-log';
function navigationFor(matchId = 46156) {
    const pathname = `/en/tv/pressure/${matchId}/match`;
    const search = '?mode=videoCapture&speed=4';
    return {
        href: `https://capture.example:8443${pathname}${search}`,
        protocol: 'https:',
        hostname: 'capture.example',
        port: '8443',
        pathname,
        search
    };
}
const authorizedNavigation = navigationFor();
const targetUrl = authorizedNavigation.href;

class FakeRequest {
    constructor(page, { url, method = 'GET', navigation = false, headers = {} }) {
        this.page = page;
        this.options = { url, method, navigation, headers };
        this.continued = null;
        this.aborted = null;
    }
    url() { return this.options.url; }
    method() { return this.options.method; }
    headers() { return this.options.headers; }
    isNavigationRequest() { return this.options.navigation; }
    frame() { return this.page.mainFrame(); }
    async continue(overrides) { this.continued = overrides; }
    async abort(reason) { this.aborted = reason; }
}

class FakePage {
    constructor({
        resources = [],
        redirect = null,
        navigationMethod = 'GET',
        navigationNever = false,
        phaserNever = false,
        fontsNever = false,
        responseOk = true,
        readyState = null,
        replayAccepted = true,
        clockStartMs = 1_000,
        clockEndMs = 1_001,
        startState = null,
        endState = null
    } = {}) {
        this.resources = resources;
        this.redirect = redirect;
        this.navigationMethod = navigationMethod;
        this.navigationNever = navigationNever;
        this.phaserNever = phaserNever;
        this.fontsNever = fontsNever;
        this.responseOk = responseOk;
        this.readyState = readyState ?? { isFinished: true, historyPoints: 10, speed: 4 };
        this.replayAccepted = replayAccepted;
        this.clockStartMs = clockStartMs;
        this.clockEndMs = clockEndMs;
        this.startState = startState ?? {
            status: 'recording',
            playheadSeconds: 0,
            durationSeconds: 100,
            speed: 4
        };
        this.endState = endState ?? {
            status: 'recording',
            playheadSeconds: 0.004,
            durationSeconds: 100,
            speed: 4
        };
        this.requests = [];
        this.requestHandler = null;
        this.main = {};
        this.evaluateCall = 0;
    }
    mainFrame() { return this.main; }
    async setRequestInterception(value) { this.interceptionEnabled = value; }
    on(event, handler) {
        assert.equal(event, 'request');
        this.requestHandler = handler;
    }
    off(event, handler) {
        assert.equal(event, 'request');
        if (this.requestHandler === handler) this.requestHandler = null;
        this.cleanedUp = true;
    }
    async setViewport() {}
    emit(options) {
        const request = new FakeRequest(this, options);
        this.requests.push(request);
        this.requestHandler(request);
        return request;
    }
    async goto(url) {
        this.emit({ url, method: this.navigationMethod, navigation: true });
        if (this.redirect) {
            this.emit({
                url: this.redirect,
                navigation: true,
                headers: { 'X-Arena-Capture-Key': secret }
            });
        }
        if (this.navigationNever) return new Promise(() => {});
        return { ok: () => this.responseOk };
    }
    async waitForFunction() {
        if (this.phaserNever) return new Promise(() => {});
        for (const resource of this.resources) this.emit(resource);
    }
    async evaluate() {
        this.evaluateCall += 1;
        if (this.evaluateCall === 1) return this.readyState;
        if (this.evaluateCall === 2) {
            if (this.fontsNever) return new Promise(() => {});
            return undefined;
        }
        if (this.evaluateCall === 3) {
            return { accepted: this.replayAccepted, state: this.startState, monotonicMs: this.clockStartMs };
        }
        return { state: this.endState, monotonicMs: this.clockEndMs };
    }
}

function context(overrides = {}) {
    return {
        targetUrl,
        authorizedNavigation,
        captureKey: secret,
        width: 1280,
        height: 720,
        durationMs: 1,
        executionBudgetMs: 100,
        navigationTimeoutMs: 25,
        phaserTimeoutMs: 25,
        visualPreparationTimeoutMs: 10,
        ...overrides
    };
}

function header(request, name) {
    const entry = Object.entries(request.continued?.headers ?? {})
        .find(([key]) => key.toLowerCase() === name.toLowerCase());
    return entry?.[1];
}

async function captureDiagnostics(action) {
    const entries = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...values) => { entries.push(values.join(' ')); };
    console.error = (...values) => { entries.push(values.join(' ')); };
    try {
        await action();
    } finally {
        console.log = originalLog;
        console.error = originalError;
    }
    return entries;
}

test('sends the key only on the exact initial navigation and strips it from all resources', async () => {
    const resources = [
        { url: 'https://capture.example:8443/_framework/blazor.server.js', headers: { 'x-arena-capture-key': secret } },
        { url: 'https://capture.example:8443/games/arena-pressure/phaser.js' },
        { url: 'https://capture.example:8443/api/matches/46156' },
        { url: 'wss://capture.example:8443/hubs/dashboard?id=1' },
        { url: 'https://fonts.example/font.woff2' },
        { url: 'https://analytics.example/collect' },
        { url: 'https://images.example/arena.png' }
    ];
    const page = new FakePage({ resources });
    let starts = 0;
    let stops = 0;

    await browserlessFunctionHandler({
        page,
        context: context(),
        startScreencast: () => { starts += 1; },
        stopScreencast: () => { stops += 1; }
    });

    assert.equal(page.interceptionEnabled, true);
    assert.equal(starts, 1);
    assert.equal(stops, 1);
    assert.equal(header(page.requests[0], 'X-Arena-Capture-Key'), secret);
    for (const request of page.requests.slice(1)) {
        assert.equal(request.aborted, null);
        assert.equal(header(request, 'X-Arena-Capture-Key'), undefined, request.url());
    }
    assert.equal(page.requests.filter(request => header(request, 'X-Arena-Capture-Key') === secret).length, 1);
});

test('captures match 46324 with the same exact-navigation authorization contract', async () => {
    const navigation = navigationFor(46324);
    const page = new FakePage();
    await browserlessFunctionHandler({
        page,
        context: context({ targetUrl: navigation.href, authorizedNavigation: navigation }),
        startScreencast() {},
        stopScreencast() {}
    });

    assert.equal(page.requests[0].url(), navigation.href);
    assert.equal(header(page.requests[0], 'X-Arena-Capture-Key'), secret);
});

test('blocks and sanitizes a cross-origin redirect', async () => {
    const page = new FakePage({ redirect: 'https://attacker.example/steal' });

    await assert.rejects(
        browserlessFunctionHandler({
            page,
            context: context(),
            startScreencast() {},
            stopScreencast() {}
        }),
        /unauthorized navigation/
    );

    assert.equal(header(page.requests[0], 'X-Arena-Capture-Key'), secret);
    assert.equal(page.requests[1].aborted, 'blockedbyclient');
    assert.equal(header(page.requests[1], 'X-Arena-Capture-Key'), undefined);
});

test('blocks a non-GET initial navigation without emitting the key', async () => {
    const page = new FakePage({ navigationMethod: 'POST' });

    await assert.rejects(
        browserlessFunctionHandler({
            page,
            context: context(),
            startScreencast() {},
            stopScreencast() {}
        }),
        /unauthorized navigation/
    );

    assert.equal(page.requests[0].aborted, 'blockedbyclient');
    assert.equal(header(page.requests[0], 'X-Arena-Capture-Key'), undefined);
});

test('rejects URL contract changes before any request is emitted', async () => {
    for (const changedUrl of [
        'http://capture.example:8443/en/tv/pressure/46156/match?mode=videoCapture&speed=4',
        'https://other.example:8443/en/tv/pressure/46156/match?mode=videoCapture&speed=4',
        'https://capture.example/en/tv/pressure/46156/match?mode=videoCapture&speed=4',
        'https://capture.example:8443/en/tv/pressure/999/match?mode=videoCapture&speed=4',
        'https://capture.example:8443/en/tv/pressure/46156/match?speed=4&mode=videoCapture',
        'https://capture.example:8443/en/tv/pressure/46156/match?mode=videoCapture&speed=4#fragment'
    ]) {
        const page = new FakePage();
        await assert.rejects(
            browserlessFunctionHandler({
                page,
                context: context({ targetUrl: changedUrl }),
                startScreencast() {},
                stopScreencast() {}
            }),
            /authorized HTTPS navigation contract/
        );
        assert.equal(page.requests.length, 0);
    }
});

test('rejects arbitrary paths even when target and authorization fields agree', async () => {
    for (const pathname of ['/en/tv/pressure/46324/../../faq', '/en/tv/match/46324/match', '/en/tv/pressure/0/match']) {
        const navigation = {
            ...navigationFor(46324),
            pathname,
            href: `https://capture.example:8443${pathname}?mode=videoCapture&speed=4`
        };
        const page = new FakePage();
        await assert.rejects(
            browserlessFunctionHandler({
                page,
                context: context({ targetUrl: navigation.href, authorizedNavigation: navigation }),
                startScreencast() {},
                stopScreencast() {}
            }),
            error => error.captureCode === 'TARGET_CONTRACT'
        );
        assert.equal(page.requests.length, 0);
    }
});

test('reports unavailable matches and unusable history explicitly', async () => {
    await assert.rejects(
        browserlessFunctionHandler({
            page: new FakePage({ responseOk: false }),
            context: context(),
            startScreencast() {},
            stopScreencast() {}
        }),
        error => error.captureCode === 'MATCH_UNAVAILABLE'
    );

    await assert.rejects(
        browserlessFunctionHandler({
            page: new FakePage({ readyState: { isFinished: true, historyPoints: 0, speed: 4 } }),
            context: context(),
            startScreencast() {},
            stopScreencast() {}
        }),
        error => error.captureCode === 'HISTORY_UNAVAILABLE'
    );
});

test('serialized Browserless v1 function is self-contained and does not set global headers', () => {
    assert.match(browserlessFunction, /^module\.exports = async function browserlessFunctionHandler/);
    assert.doesNotMatch(browserlessFunction, /setExtraHTTPHeaders/);
    assert.match(browserlessFunction, /setRequestInterception\(true\)/);
    assert.match(browserlessFunction, /const captureHeader = 'x-arena-capture-key'/);
    assert.doesNotMatch(browserlessFunction, /new URL\s*\(/);
    assert.doesNotThrow(() => new Function(browserlessFunction));
});

test('serialized function runs when the Browserless context has no global URL', async () => {
    const sandbox = { module: { exports: null }, setTimeout, clearTimeout, console };
    vm.runInNewContext(browserlessFunction, sandbox);
    assert.equal(vm.runInNewContext('typeof URL', sandbox), 'undefined');

    const page = new FakePage();
    await sandbox.module.exports({
        page,
        context: context(),
        startScreencast() {},
        stopScreencast() {}
    });

    assert.equal(header(page.requests[0], 'X-Arena-Capture-Key'), secret);
});

test('fails fast on navigation timeout and cleans up without starting the screencast', async () => {
    const page = new FakePage({ navigationNever: true });
    let starts = 0;
    let stops = 0;
    const diagnostics = await captureDiagnostics(async () => {
        await assert.rejects(
            browserlessFunctionHandler({
                page,
                context: context({ navigationTimeoutMs: 5 }),
                startScreencast: () => { starts += 1; },
                stopScreencast: () => { stops += 1; }
            }),
            error => error.captureCode === 'NAV_TIMEOUT'
        );
    });

    assert.equal(starts, 0);
    assert.equal(stops, 0);
    assert.equal(page.cleanedUp, true);
    assert(diagnostics.some(entry => entry.includes('[CAPTURE:NAV_START]')));
    assert(diagnostics.some(entry => entry.includes('[CAPTURE:FAILED] stage=NAVIGATION') && entry.includes('reason=NAV_TIMEOUT')));
});

test('fails fast while waiting for Phaser ready and never starts recording', async () => {
    const page = new FakePage({ phaserNever: true });
    let starts = 0;
    const diagnostics = await captureDiagnostics(async () => {
        await assert.rejects(
            browserlessFunctionHandler({
                page,
                context: context({ phaserTimeoutMs: 5 }),
                startScreencast: () => { starts += 1; },
                stopScreencast() {}
            }),
            error => error.captureCode === 'PHASER_TIMEOUT'
        );
    });

    assert.equal(starts, 0);
    assert.equal(page.cleanedUp, true);
    assert(diagnostics.some(entry => entry.includes('[CAPTURE:PHASER_WAIT]')));
    assert(diagnostics.some(entry => entry.includes('[CAPTURE:FAILED] stage=PHASER_READY') && entry.includes('reason=PHASER_TIMEOUT')));
});

test('reports font timeout, continues safely, and completes cleanup', async () => {
    const page = new FakePage({ fontsNever: true });
    let starts = 0;
    let stops = 0;
    const diagnostics = await captureDiagnostics(async () => {
        await browserlessFunctionHandler({
            page,
            context: context({ visualPreparationTimeoutMs: 5 }),
            startScreencast: () => { starts += 1; },
            stopScreencast: () => { stops += 1; }
        });
    });

    assert.equal(starts, 1);
    assert.equal(stops, 1);
    assert.equal(page.cleanedUp, true);
    assert(diagnostics.some(entry => entry.includes('[CAPTURE:FONTS_TIMEOUT]') && entry.includes('continuing=true')));
    assert(diagnostics.some(entry => entry.includes('[CAPTURE:COMPLETE]')));
});

test('stops an active screencast when replay startup fails', async () => {
    const page = new FakePage({ replayAccepted: false });
    let starts = 0;
    let stops = 0;
    const diagnostics = await captureDiagnostics(async () => {
        await assert.rejects(
            browserlessFunctionHandler({
                page,
                context: context(),
                startScreencast: () => { starts += 1; },
                stopScreencast: () => { stops += 1; }
            }),
            error => error.captureCode === 'REPLAY_START_FAILED'
        );
    });

    assert.equal(starts, 1);
    assert.equal(stops, 1);
    assert.equal(page.cleanedUp, true);
    assert(diagnostics.some(entry => entry.includes('[CAPTURE:SCREENCAST_STOP]') && entry.includes('cleanup=true')));
});

test('caps stage timeouts by the remaining execution budget', async () => {
    const page = new FakePage({ phaserNever: true });
    const began = Date.now();
    await captureDiagnostics(async () => {
        await assert.rejects(
            browserlessFunctionHandler({
                page,
                context: context({ executionBudgetMs: 12, phaserTimeoutMs: 1000 }),
                startScreencast() {},
                stopScreencast() {}
            }),
            error => error.captureCode === 'PHASER_TIMEOUT'
        );
    });

    assert(Date.now() - began < 100, 'execution exceeded the bounded test budget');
});

test('validates normal 4x advancement and emits numeric clock diagnostics', async () => {
    const page = new FakePage({
        clockStartMs: 2_000,
        clockEndMs: 12_000,
        endState: {
            status: 'recording', playheadSeconds: 40, durationSeconds: 100, speed: 4
        }
    });
    const diagnostics = await captureDiagnostics(async () => {
        await browserlessFunctionHandler({
            page,
            context: context(),
            startScreencast() {},
            stopScreencast() {}
        });
    });

    assert(diagnostics.some(entry => entry.includes('[CAPTURE:CLOCK_START]')
        && entry.includes('speed=4') && entry.includes('playheadSeconds=0.000')));
    assert(diagnostics.some(entry => entry.includes('[CAPTURE:CLOCK_END]')
        && entry.includes('wallElapsedMs=10000')
        && entry.includes('actualAdvance=40.000')
        && entry.includes('expectedAdvance=40.000')
        && entry.includes('deviationSeconds=0.000')));
});

test('uses actual monotonic recording time instead of the configured sleep value', async () => {
    const page = new FakePage({
        clockStartMs: 5_000,
        clockEndMs: 7_500,
        endState: {
            status: 'recording', playheadSeconds: 10, durationSeconds: 100, speed: 4
        }
    });
    const diagnostics = await captureDiagnostics(async () => {
        await browserlessFunctionHandler({
            page,
            context: context({ durationMs: 1 }),
            startScreencast() {},
            stopScreencast() {}
        });
    });

    assert(diagnostics.some(entry => entry.includes('wallElapsedMs=2500')
        && entry.includes('expectedAdvance=10.000')));
});

test('accepts the historical ending reached before recording finishes', async () => {
    const ending = {
        status: 'completed', playheadSeconds: 27.5, durationSeconds: 27.5, speed: 4
    };
    const page = new FakePage({
        clockStartMs: 1_000,
        clockEndMs: 11_000,
        startState: {
            status: 'recording', playheadSeconds: 0, durationSeconds: 27.5, speed: 4
        },
        endState: ending
    });

    await browserlessFunctionHandler({
        page,
        context: context(),
        startScreencast() {},
        stopScreencast() {}
    });
});

test('rejects divergence between configured and effective replay speed', async () => {
    const page = new FakePage({
        clockStartMs: 1_000,
        clockEndMs: 11_000,
        endState: {
            status: 'recording', playheadSeconds: 20, durationSeconds: 100, speed: 4
        }
    });
    const diagnostics = await captureDiagnostics(async () => {
        await assert.rejects(
            browserlessFunctionHandler({
                page,
                context: context(),
                startScreencast() {},
                stopScreencast() {}
            }),
            error => error.captureCode === 'REPLAY_CLOCK'
        );
    });

    assert(diagnostics.some(entry => entry.includes('[CAPTURE:CLOCK_END]')
        && entry.includes('actualAdvance=20.000')
        && entry.includes('expectedAdvance=40.000')
        && entry.includes('deviationSeconds=-20.000')));
    assert(diagnostics.some(entry => entry.includes('[CAPTURE:FAILED] stage=SCREENCAST')
        && entry.includes('reason=REPLAY_CLOCK')));
});
