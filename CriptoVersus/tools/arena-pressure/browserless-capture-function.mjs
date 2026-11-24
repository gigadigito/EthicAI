export async function browserlessFunctionHandler({ page, context, startScreencast, stopScreencast }) {
    const captureHeader = 'x-arena-capture-key';
    const startedAt = Date.now();
    const executionBudgetMs = context.executionBudgetMs ?? 44000;
    const deadline = startedAt + executionBudgetMs;
    const timeouts = {
        navigation: context.navigationTimeoutMs ?? 15000,
        phaser: context.phaserTimeoutMs ?? 15000,
        fonts: context.visualPreparationTimeoutMs ?? 4000
    };
    const elapsed = () => Date.now() - startedAt;
    const remaining = () => Math.max(0, deadline - Date.now());
    const diagnostic = (marker, details = '') => {
        console.log(`[CAPTURE:${marker}] elapsedMs=${elapsed()}${details ? ` ${details}` : ''}`);
    };
    const fail = (message, captureCode) => {
        const error = new Error(message);
        error.captureCode = captureCode;
        return error;
    };
    const stageLimit = (requestedMs, stage) => {
        const allowed = Math.min(requestedMs, remaining());
        if (allowed <= 0) throw fail(`Capture budget exhausted before ${stage}.`, 'BUDGET_EXHAUSTED');
        return allowed;
    };
    const withTimeout = async (operation, timeoutMs, stage, timeoutCode) => {
        let timer;
        const timeoutPromise = new Promise((_, reject) => {
            timer = setTimeout(
                () => reject(fail(`Capture timed out during ${stage}.`, timeoutCode)),
                timeoutMs
            );
        });
        try {
            return await Promise.race([operation, timeoutPromise]);
        } finally {
            clearTimeout(timer);
        }
    };
    const expected = context.authorizedNavigation;
    const allowedPath = /^\/(?:en|pt|zh|es|fr|de|it|ja|hi)\/tv\/pressure\/[1-9]\d*\/match$/;
    const expectedOrigin = expected
        ? `${expected.protocol}//${expected.hostname}${expected.port ? `:${expected.port}` : ''}`
        : '';
    const reconstructedHref = expected
        ? `${expectedOrigin}${expected.pathname}${expected.search}`
        : '';

    if (!expected
        || expected.protocol !== 'https:'
        || typeof expected.hostname !== 'string'
        || !expected.hostname
        || typeof expected.port !== 'string'
        || typeof expected.pathname !== 'string'
        || !allowedPath.test(expected.pathname)
        || expected.search !== '?mode=videoCapture&speed=4'
        || typeof expected.href !== 'string'
        || expected.href !== reconstructedHref
        || typeof context.captureKey !== 'string'
        || !context.captureKey.trim()
        || context.targetUrl !== expected.href) {
        throw fail('Capture target does not match the authorized HTTPS navigation contract.', 'TARGET_CONTRACT');
    }

    const segment = context.segment && typeof context.segment === 'object' ? context.segment : null;
    let segIndex = 1;
    let segTotal = 1;
    let segStart = 0;
    let segEnd = 0;
    let segSpeed = 4;
    let segVideoStart = 0;
    let expectedHistDuration = 0;
    let isFinalSegment = false;
    let maxWallDeviationSeconds = 0.75;
    if (segment) {
        segIndex = Number(segment.index);
        segTotal = Number(segment.totalSegments);
        segStart = Number(segment.historicalStartSeconds);
        segEnd = Number(segment.historicalEndSeconds);
        segSpeed = Number(segment.speed);
        segVideoStart = Number(segment.videoStartSeconds);
        expectedHistDuration = Number(segment.expectedHistoricalDurationSeconds);
        isFinalSegment = Boolean(segment.isFinalSegment);
        if (Number.isFinite(Number(segment.maxWallDeviationSeconds)) && Number(segment.maxWallDeviationSeconds) > 0) {
            maxWallDeviationSeconds = Number(segment.maxWallDeviationSeconds);
        }
        if (!Number.isSafeInteger(segIndex) || segIndex < 1
            || !Number.isSafeInteger(segTotal) || segTotal < segIndex
            || !Number.isFinite(segStart) || segStart < 0
            || !Number.isFinite(segEnd) || segEnd < segStart
            || !Number.isFinite(segSpeed) || segSpeed < 0.1 || segSpeed > 10000
            || !Number.isFinite(segVideoStart) || segVideoStart < 0
            || !Number.isFinite(expectedHistDuration) || expectedHistDuration <= 0) {
            throw fail('Invalid segment capture contract.', 'SEGMENT_CONTRACT');
        }
    }

    let stage = 'SETUP';
    let initialNavigationHandled = false;
    let securityViolation = null;
    let rejectSecurityViolation;
    let screencastStarted = false;
    const securityViolationPromise = new Promise((_, reject) => { rejectSecurityViolation = reject; });
    securityViolationPromise.catch(() => {});

    const rejectNavigation = (request, message) => {
        securityViolation ??= fail(message, 'UNAUTHORIZED_NAVIGATION');
        rejectSecurityViolation(securityViolation);
        return request.abort('blockedbyclient');
    };

    const requestHandler = request => {
        const headers = { ...request.headers() };
        for (const name of Object.keys(headers)) {
            if (name.toLowerCase() === captureHeader) delete headers[name];
        }

        const isMainFrameNavigation = request.isNavigationRequest() && request.frame() === page.mainFrame();
        if (!isMainFrameNavigation) {
            request.continue({ headers }).catch(() => {
                securityViolation ??= fail('Unable to sanitize a capture subresource request.', 'REQUEST_SANITIZE');
                rejectSecurityViolation(securityViolation);
            });
            return;
        }

        const isAuthorizedInitialRequest = !initialNavigationHandled
            && request.method() === 'GET'
            && request.url() === expected.href;

        if (!isAuthorizedInitialRequest) {
            rejectNavigation(request, 'Capture blocked an unauthorized navigation.');
            return;
        }

        initialNavigationHandled = true;
        headers['X-Arena-Capture-Key'] = context.captureKey;
        request.continue({ headers }).catch(() => {
            securityViolation ??= fail('Unable to authorize the initial capture navigation.', 'INITIAL_NAVIGATION');
            rejectSecurityViolation(securityViolation);
        });
    };

    try {
        await page.setRequestInterception(true);
        page.on('request', requestHandler);
        await page.setViewport({ width: context.width, height: context.height, deviceScaleFactor: 1 });

        stage = 'NAVIGATION';
        diagnostic('NAV_START');
        const navigationLimit = stageLimit(timeouts.navigation, stage);
        let response;
        try {
            response = await withTimeout(
                Promise.race([
                    page.goto(expected.href, { waitUntil: 'domcontentloaded', timeout: navigationLimit }),
                    securityViolationPromise
                ]),
                navigationLimit,
                stage,
                'NAV_TIMEOUT'
            );
        } catch (error) {
            if (securityViolation || error.captureCode) throw securityViolation ?? error;
            if (error.name === 'TimeoutError') {
                throw fail('Capture timed out during navigation.', 'NAV_TIMEOUT');
            }
            throw error;
        }
        if (securityViolation) throw securityViolation;
        if (!initialNavigationHandled || !response || !response.ok()) {
            throw fail('Historical Arena Pressure match was not found or could not be loaded.', 'MATCH_UNAVAILABLE');
        }
        diagnostic('NAV_OK');

        stage = 'PHASER_READY';
        diagnostic('PHASER_WAIT');
        const phaserLimit = stageLimit(timeouts.phaser, stage);
        let waitResult;
        try {
            waitResult = await withTimeout(
                Promise.race([
                    page.waitForFunction(
                        () => {
                            const captureState = window.__arenaPressureCapture?.getState?.();
                            if (captureState?.status === 'ready') return 'ready';
                            const pageState = typeof document !== 'undefined'
                                ? document.querySelector('[data-arena-pressure-page-state]')?.getAttribute('data-arena-pressure-page-state')
                                : null;
                            if (pageState === 'notfound' || pageState === 'error') return pageState;
                            const hostState = typeof document !== 'undefined'
                                ? document.querySelector('[data-capture-state]')?.getAttribute('data-capture-state')
                                : null;
                            if (hostState === 'error') return 'capture_error';
                            return false;
                        },
                        { timeout: phaserLimit, polling: 100 }
                    ),
                    securityViolationPromise
                ]),
                phaserLimit,
                stage,
                'PHASER_TIMEOUT'
            );
        } catch (error) {
            if (securityViolation || error.captureCode) throw securityViolation ?? error;
            if (error.name === 'TimeoutError') {
                throw fail('Capture timed out waiting for Phaser ready.', 'PHASER_TIMEOUT');
            }
            throw error;
        }
        if (securityViolation) throw securityViolation;
        const waitOutcome = waitResult && typeof waitResult.jsonValue === 'function'
            ? await waitResult.jsonValue().catch(() => null)
            : waitResult;
        if (waitOutcome === 'notfound') {
            throw fail('Historical Arena Pressure match was not found.', 'MATCH_NOT_FOUND');
        }
        if (waitOutcome === 'error' || waitOutcome === 'capture_error') {
            throw fail('Arena Pressure capture page failed to load.', 'MATCH_LOAD_ERROR');
        }

        const ready = await page.evaluate(() => window.__arenaPressureCapture.getState());
        if (!ready.isFinished)
            throw fail('Arena Pressure match is not completed.', 'MATCH_NOT_FINISHED');
        if (segment && ready.officialResult === 'cancelled')
            throw fail('Arena Pressure match was cancelled.', 'MATCH_CANCELLED');
        if (!Number.isSafeInteger(ready.historyPoints) || ready.historyPoints < 2)
            throw fail('Arena Pressure match has no usable historical replay.', 'HISTORY_UNAVAILABLE');

        if (!segment) {
            if (ready.speed !== 4)
                throw fail('Arena Pressure historical replay is not ready at 4x.', 'PHASER_INVALID_STATE');
        } else {
            const histSpan = Number(ready.historySpanSeconds ?? ready.durationSeconds);
            if (!Number.isFinite(histSpan) || histSpan < 1) {
                throw fail('Arena Pressure match has invalid historical duration.', 'HISTORY_UNAVAILABLE');
            }
            if (Math.abs(Number(ready.durationSeconds) - expectedHistDuration) > 0.5) {
                throw fail('Historical duration differs from the planned match duration.', 'HISTORY_DURATION_MISMATCH');
            }
        }
        diagnostic('PHASER_READY', `historyPoints=${Number(ready.historyPoints)}`);

        if (segment) {
            stage = 'SEGMENT_SEEK';
            const seekLimit = stageLimit(timeouts.phaser, stage);
            const prepared = await withTimeout(
                Promise.race([
                    page.evaluate(async cfg => {
                        const ctrl = window.__arenaPressureCapture;
                        if (!ctrl || typeof ctrl.prepareSegment !== 'function') {
                            return { unsupported: true };
                        }
                        return await ctrl.prepareSegment(cfg);
                    }, {
                        startSeconds: segStart,
                        speed: segSpeed,
                        videoStartSeconds: segVideoStart
                    }),
                    securityViolationPromise
                ]),
                seekLimit,
                stage,
                'SEGMENT_SEEK_TIMEOUT'
            );
            if (securityViolation) throw securityViolation;
            if (prepared?.unsupported) {
                throw fail('Arena Pressure capture contract does not support segmented seek.', 'CAPTURE_CONTRACT_OUTDATED');
            }
            if (!prepared?.ok
                || !Number.isFinite(Number(prepared.playheadSeconds))
                || Math.abs(Number(prepared.playheadSeconds) - segStart) > 0.25) {
                throw fail('Failed to seek replay to the planned segment start.', 'SEGMENT_SEEK_FAILED');
            }
            diagnostic(
                'SEGMENT_SEEK',
                `segment=${segIndex}/${segTotal} startSeconds=${Number(prepared.playheadSeconds).toFixed(3)}`
                + ` speed=${Number(prepared.speed).toFixed(6)} leftPercent=${Number(prepared.leftPercent ?? 50)}`
            );
        }

        stage = 'VISUAL_PREPARATION';
        const fontsLimit = stageLimit(timeouts.fonts, stage);
        let fontsTimedOut = false;
        try {
            await withTimeout(
                page.evaluate(async () => {
                    if (document.fonts?.ready) await document.fonts.ready;
                    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                }),
                fontsLimit,
                stage,
                'FONTS_TIMEOUT'
            );
        } catch (error) {
            if (error.captureCode !== 'FONTS_TIMEOUT') throw error;
            fontsTimedOut = true;
            diagnostic('FONTS_TIMEOUT', 'continuing=true');
        }
        if (!fontsTimedOut) diagnostic('FONTS_READY');
        if (securityViolation) throw securityViolation;

        stage = 'SCREENCAST';
        const captureLimit = stageLimit(context.durationMs, stage);
        if (captureLimit < context.durationMs) {
            throw fail('Insufficient capture budget for the requested screencast.', 'BUDGET_EXHAUSTED');
        }
        startScreencast();
        screencastStarted = true;
        diagnostic('SCREENCAST_START');
        const started = segment
            ? await page.evaluate(cfg => ({
                accepted: window.__arenaPressureCapture.start(cfg),
                state: window.__arenaPressureCapture.getState(),
                monotonicMs: performance.now()
            }), {
                startSeconds: segStart,
                speed: segSpeed,
                videoStartSeconds: segVideoStart
            })
            : await page.evaluate(() => ({
                accepted: window.__arenaPressureCapture.start(),
                state: window.__arenaPressureCapture.getState(),
                monotonicMs: performance.now()
            }));

        if (!segment) {
            if (!started.accepted || started.state.playheadSeconds > 0.25) {
                throw fail('Replay did not start at its historical origin.', 'REPLAY_START_FAILED');
            }
        } else {
            const speedTolerance = Math.max(1e-4, segSpeed * 1e-4);
            if (!started.accepted
                || !Number.isFinite(Number(started.state?.playheadSeconds))
                || Math.abs(started.state.playheadSeconds - segStart) > 0.25
                || Math.abs(started.state.speed - segSpeed) > speedTolerance) {
                throw fail('Segment replay did not start at the planned offset and speed.', 'REPLAY_START_FAILED');
            }
        }
        diagnostic('REPLAY_START');
        diagnostic(
            'CLOCK_START',
            `speed=${Number(started.state.speed)} playheadSeconds=${Number(started.state.playheadSeconds).toFixed(3)}`
            + ` durationSeconds=${Number(started.state.durationSeconds).toFixed(3)} status=${String(started.state.status)}`
        );

        await withTimeout(
            Promise.race([
                new Promise(resolve => setTimeout(resolve, context.durationMs)),
                securityViolationPromise
            ]),
            captureLimit,
            stage,
            'SCREENCAST_TIMEOUT'
        );
        if (securityViolation) throw securityViolation;
        const endedSnapshot = await page.evaluate(() => ({
            state: window.__arenaPressureCapture.getState(),
            monotonicMs: performance.now(),
            perf: typeof window.__arenaPressureCapture.getPerfMetrics === 'function'
                ? window.__arenaPressureCapture.getPerfMetrics()
                : null
        }));
        const ended = endedSnapshot.state;
        const wallElapsedMs = Math.max(0, endedSnapshot.monotonicMs - started.monotonicMs);
        const actualAdvance = ended.playheadSeconds - started.state.playheadSeconds;
        const expectedPosition = Math.min(
            ended.durationSeconds,
            started.state.playheadSeconds + wallElapsedMs / 1000 * started.state.speed
        );
        const expectedAdvance = expectedPosition - started.state.playheadSeconds;
        const deviationSeconds = ended.playheadSeconds - expectedPosition;
        diagnostic(
            'CLOCK_END',
            `speed=${Number(ended.speed)} playheadSeconds=${Number(ended.playheadSeconds).toFixed(3)}`
            + ` durationSeconds=${Number(ended.durationSeconds).toFixed(3)} status=${String(ended.status)}`
            + ` wallElapsedMs=${wallElapsedMs.toFixed(0)} actualAdvance=${actualAdvance.toFixed(3)}`
            + ` expectedAdvance=${expectedAdvance.toFixed(3)} deviationSeconds=${deviationSeconds.toFixed(3)}`
        );
        if (endedSnapshot.perf) {
            const p = endedSnapshot.perf;
            const num = (value, digits = 2) => (Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : 'na');
            const intOrNa = value => (Number.isFinite(Number(value)) ? Number(value) : 'na');
            console.log(
                `[PERF:PHASER] renderer=${String(p.renderer ?? 'UNKNOWN')}`
                + ` updateFps=${num(p.updateFps)}`
                + ` renderFps=${num(p.renderFps)}`
                + ` updateFrames=${intOrNa(p.updateFrames)}`
                + ` renderFrames=${intOrNa(p.renderFrames)}`
                + ` avgFrameMs=${num(p.avgFrameMs)}`
                + ` p95FrameMs=${num(p.p95FrameMs)}`
                + ` avgRenderMs=${num(p.avgRenderMs)}`
                + ` avgWheelMs=${num(p.avgWheelMs)}`
                + ` avgGapMs=${num(p.avgGapMs, 1)}`
                + ` p95GapMs=${num(p.p95GapMs, 1)}`
                + ` maxGapMs=${num(p.maxGapMs, 1)}`
                + ` overBudgetFrames=${intOrNa(p.overBudgetFrames)}`
                + ` longTasks=${intOrNa(p.longTasks)}`
                + ` webglContextLost=${intOrNa(p.webglContextLost)}`
            );
        }
        console.log(
            `[PERF:BROWSERLESS] wallElapsedMs=${wallElapsedMs.toFixed(0)} screencastMode=browserless_v1_rest frameEvents=unavailable_in_v1_response`
        );
        const clockValues = [
            started.state.playheadSeconds,
            started.state.durationSeconds,
            started.state.speed,
            ended.playheadSeconds,
            ended.durationSeconds,
            ended.speed,
            wallElapsedMs,
            actualAdvance,
            expectedAdvance,
            deviationSeconds
        ];
        if (!segment) {
            if (clockValues.some(value => !Number.isFinite(value))
                || ended.durationSeconds !== started.state.durationSeconds
                || ended.speed !== started.state.speed
                || ended.speed !== 4
                || actualAdvance < 0
                || Math.abs(deviationSeconds) > 4.5) {
                throw fail('Replay logical clock did not advance at 4x.', 'REPLAY_CLOCK');
            }
        } else {
            const speedTolerance = Math.max(1e-4, segSpeed * 1e-4);
            const maxLogicalDeviation = Math.max(0.25, segSpeed * maxWallDeviationSeconds);
            if (clockValues.some(value => !Number.isFinite(value))
                || ended.durationSeconds !== started.state.durationSeconds
                || Math.abs(ended.speed - started.state.speed) > speedTolerance
                || Math.abs(ended.speed - segSpeed) > speedTolerance
                || actualAdvance < 0
                || Math.abs(deviationSeconds) > maxLogicalDeviation) {
                throw fail(`Replay logical clock did not advance at ${segSpeed}x.`, 'REPLAY_CLOCK');
            }
            if (isFinalSegment) {
                const endTolerance = Math.max(0.1, segSpeed * 0.15);
                if (Math.abs(ended.playheadSeconds - ended.durationSeconds) > endTolerance) {
                    throw fail('Final segment did not reach the official match end.', 'REPLAY_END_NOT_REACHED');
                }
            }
        }

        stopScreencast();
        screencastStarted = false;
        diagnostic('SCREENCAST_STOP');
        diagnostic('COMPLETE');
    } catch (error) {
        const reason = error?.captureCode ?? error?.name ?? 'ERROR';
        console.error(`[CAPTURE:FAILED] stage=${stage} elapsedMs=${elapsed()} reason=${reason}`);
        throw error;
    } finally {
        if (screencastStarted) {
            stopScreencast();
            screencastStarted = false;
            diagnostic('SCREENCAST_STOP', 'cleanup=true');
        }
        if (typeof page.off === 'function') page.off('request', requestHandler);
    }
}

export async function browserlessMetadataHandler({ page, context }) {
    const captureHeader = 'x-arena-capture-key';
    const startedAt = Date.now();
    const executionBudgetMs = context.executionBudgetMs ?? 30000;
    const deadline = startedAt + executionBudgetMs;
    const timeouts = {
        navigation: context.navigationTimeoutMs ?? 15000,
        phaser: context.phaserTimeoutMs ?? 15000
    };
    const elapsed = () => Date.now() - startedAt;
    const remaining = () => Math.max(0, deadline - Date.now());
    const fail = (message, captureCode) => {
        const error = new Error(message);
        error.captureCode = captureCode;
        return error;
    };
    const stageLimit = (requestedMs, stage) => {
        const allowed = Math.min(requestedMs, remaining());
        if (allowed <= 0) throw fail(`Metadata budget exhausted before ${stage}.`, 'BUDGET_EXHAUSTED');
        return allowed;
    };
    const withTimeout = async (operation, timeoutMs, stage, timeoutCode) => {
        let timer;
        const timeoutPromise = new Promise((_, reject) => {
            timer = setTimeout(
                () => reject(fail(`Metadata probe timed out during ${stage}.`, timeoutCode)),
                timeoutMs
            );
        });
        try {
            return await Promise.race([operation, timeoutPromise]);
        } finally {
            clearTimeout(timer);
        }
    };

    const expected = context.authorizedNavigation;
    const allowedPath = /^\/(?:en|pt|zh|es|fr|de|it|ja|hi)\/tv\/pressure\/[1-9]\d*\/match$/;
    const expectedOrigin = expected
        ? `${expected.protocol}//${expected.hostname}${expected.port ? `:${expected.port}` : ''}`
        : '';
    const reconstructedHref = expected
        ? `${expectedOrigin}${expected.pathname}${expected.search}`
        : '';

    if (!expected
        || expected.protocol !== 'https:'
        || typeof expected.hostname !== 'string'
        || !expected.hostname
        || typeof expected.port !== 'string'
        || typeof expected.pathname !== 'string'
        || !allowedPath.test(expected.pathname)
        || expected.search !== '?mode=videoCapture&speed=4'
        || typeof expected.href !== 'string'
        || expected.href !== reconstructedHref
        || typeof context.captureKey !== 'string'
        || !context.captureKey.trim()
        || context.targetUrl !== expected.href) {
        throw fail('Metadata target does not match the authorized HTTPS navigation contract.', 'TARGET_CONTRACT');
    }

    let stage = 'SETUP';
    let initialNavigationHandled = false;
    let securityViolation = null;
    let rejectSecurityViolation;
    const securityViolationPromise = new Promise((_, reject) => { rejectSecurityViolation = reject; });
    securityViolationPromise.catch(() => {});

    const rejectNavigation = (request, message) => {
        securityViolation ??= fail(message, 'UNAUTHORIZED_NAVIGATION');
        rejectSecurityViolation(securityViolation);
        return request.abort('blockedbyclient');
    };

    const requestHandler = request => {
        const headers = { ...request.headers() };
        for (const name of Object.keys(headers)) {
            if (name.toLowerCase() === captureHeader) delete headers[name];
        }

        const isMainFrameNavigation = request.isNavigationRequest() && request.frame() === page.mainFrame();
        if (!isMainFrameNavigation) {
            request.continue({ headers }).catch(() => {
                securityViolation ??= fail('Unable to sanitize a metadata subresource request.', 'REQUEST_SANITIZE');
                rejectSecurityViolation(securityViolation);
            });
            return;
        }

        const isAuthorizedInitialRequest = !initialNavigationHandled
            && request.method() === 'GET'
            && request.url() === expected.href;

        if (!isAuthorizedInitialRequest) {
            rejectNavigation(request, 'Metadata probe blocked an unauthorized navigation.');
            return;
        }

        initialNavigationHandled = true;
        headers['X-Arena-Capture-Key'] = context.captureKey;
        request.continue({ headers }).catch(() => {
            securityViolation ??= fail('Unable to authorize the initial metadata navigation.', 'INITIAL_NAVIGATION');
            rejectSecurityViolation(securityViolation);
        });
    };

    try {
        await page.setRequestInterception(true);
        page.on('request', requestHandler);
        await page.setViewport({ width: context.width ?? 1280, height: context.height ?? 720, deviceScaleFactor: 1 });

        stage = 'NAVIGATION';
        const navigationLimit = stageLimit(timeouts.navigation, stage);
        let response;
        try {
            response = await withTimeout(
                Promise.race([
                    page.goto(expected.href, { waitUntil: 'domcontentloaded', timeout: navigationLimit }),
                    securityViolationPromise
                ]),
                navigationLimit,
                stage,
                'NAV_TIMEOUT'
            );
        } catch (error) {
            if (securityViolation || error.captureCode) throw securityViolation ?? error;
            if (error.name === 'TimeoutError') {
                throw fail('Metadata probe timed out during navigation.', 'NAV_TIMEOUT');
            }
            throw error;
        }
        if (securityViolation) throw securityViolation;
        if (!initialNavigationHandled || !response || !response.ok()) {
            throw fail('Historical Arena Pressure match was not found or could not be loaded.', 'MATCH_UNAVAILABLE');
        }

        stage = 'PHASER_READY';
        const phaserLimit = stageLimit(timeouts.phaser, stage);
        let waitResult;
        try {
            waitResult = await withTimeout(
                Promise.race([
                    page.waitForFunction(
                        () => {
                            const captureState = window.__arenaPressureCapture?.getState?.();
                            if (captureState?.status === 'ready') return 'ready';
                            const pageState = typeof document !== 'undefined'
                                ? document.querySelector('[data-arena-pressure-page-state]')?.getAttribute('data-arena-pressure-page-state')
                                : null;
                            if (pageState === 'notfound' || pageState === 'error') return pageState;
                            const hostState = typeof document !== 'undefined'
                                ? document.querySelector('[data-capture-state]')?.getAttribute('data-capture-state')
                                : null;
                            if (hostState === 'error') return 'capture_error';
                            return false;
                        },
                        { timeout: phaserLimit, polling: 100 }
                    ),
                    securityViolationPromise
                ]),
                phaserLimit,
                stage,
                'PHASER_TIMEOUT'
            );
        } catch (error) {
            if (securityViolation || error.captureCode) throw securityViolation ?? error;
            if (error.name === 'TimeoutError') {
                throw fail('Metadata probe timed out waiting for Phaser ready.', 'PHASER_TIMEOUT');
            }
            throw error;
        }
        if (securityViolation) throw securityViolation;
        const waitOutcome = waitResult && typeof waitResult.jsonValue === 'function'
            ? await waitResult.jsonValue().catch(() => null)
            : waitResult;

        if (waitOutcome === 'notfound') {
            return {
                type: 'application/json',
                data: { found: false, pageError: false, pageState: 'notfound' }
            };
        }
        if (waitOutcome === 'error' || waitOutcome === 'capture_error') {
            return {
                type: 'application/json',
                data: { found: true, pageError: true, pageState: waitOutcome }
            };
        }

        const metadata = await page.evaluate(() => {
            const ctrl = window.__arenaPressureCapture;
            const state = ctrl?.getState?.();
            return {
                found: true,
                pageError: false,
                status: state?.status ?? null,
                isFinished: Boolean(state?.isFinished),
                officialResult: state?.officialResult ?? null,
                durationSeconds: Number(state?.durationSeconds ?? 0),
                historySpanSeconds: Number(state?.historySpanSeconds ?? state?.durationSeconds ?? 0),
                historyPoints: Number(state?.historyPoints ?? 0),
                leftSymbol: state?.leftSymbol ?? null,
                rightSymbol: state?.rightSymbol ?? null,
                supportsSegmentedCapture: typeof ctrl?.prepareSegment === 'function'
                    && Array.isArray(ctrl?.capabilities)
                    && ctrl.capabilities.includes('seek')
            };
        });

        console.log(
            `[CAPTURE:METADATA_OK] elapsedMs=${elapsed()} isFinished=${Boolean(metadata?.isFinished)}`
            + ` historyPoints=${Number(metadata?.historyPoints ?? 0)}`
            + ` historySpanSeconds=${Number(metadata?.historySpanSeconds ?? 0).toFixed(3)}`
        );
        return { type: 'application/json', data: metadata };
    } catch (error) {
        const reason = error?.captureCode ?? error?.name ?? 'ERROR';
        console.error(`[CAPTURE:METADATA_FAILED] stage=${stage} elapsedMs=${elapsed()} reason=${reason}`);
        throw error;
    } finally {
        if (typeof page.off === 'function') page.off('request', requestHandler);
    }
}

export const browserlessFunction = `module.exports = ${browserlessFunctionHandler.toString()};`;
export const browserlessMetadataFunction = `module.exports = ${browserlessMetadataHandler.toString()};`;
