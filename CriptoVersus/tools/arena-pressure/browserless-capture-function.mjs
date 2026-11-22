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
        try {
            await withTimeout(
                Promise.race([
                    page.waitForFunction(
                        () => window.__arenaPressureCapture?.getState?.().status === 'ready',
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
        const ready = await page.evaluate(() => window.__arenaPressureCapture.getState());
        if (!ready.isFinished)
            throw fail('Arena Pressure match is not completed.', 'MATCH_NOT_FINISHED');
        if (!Number.isSafeInteger(ready.historyPoints) || ready.historyPoints < 2)
            throw fail('Arena Pressure match has no usable historical replay.', 'HISTORY_UNAVAILABLE');
        if (ready.speed !== 4)
            throw fail('Arena Pressure historical replay is not ready at 4x.', 'PHASER_INVALID_STATE');
        diagnostic('PHASER_READY', `historyPoints=${Number(ready.historyPoints)}`);

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
        const started = await page.evaluate(() => ({
            accepted: window.__arenaPressureCapture.start(),
            state: window.__arenaPressureCapture.getState(),
            monotonicMs: performance.now()
        }));
        if (!started.accepted || started.state.playheadSeconds > 0.25) {
            throw fail('Replay did not start at its historical origin.', 'REPLAY_START_FAILED');
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
            monotonicMs: performance.now()
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
        if (clockValues.some(value => !Number.isFinite(value))
            || ended.durationSeconds !== started.state.durationSeconds
            || ended.speed !== started.state.speed
            || ended.speed !== 4
            || actualAdvance < 0
            || Math.abs(deviationSeconds) > 4.5) {
            throw fail('Replay logical clock did not advance at 4x.', 'REPLAY_CLOCK');
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

export const browserlessFunction = `module.exports = ${browserlessFunctionHandler.toString()};`;
