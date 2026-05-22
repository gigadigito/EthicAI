const CAMERA_DEFAULTS = {
    minZoom: 1,
    maxZoom: 1.72,
    autoResetDelayMs: 0,
    directorIntervalMs: 5600,
    overviewZoom: 1.04,
    ballZoom: 1.22,
    attackZoom: 1.34,
    goalZoom: 1.48,
    stepXEase: 0.035,
    stepYEase: 0.035,
    stepZoomEase: 0.028
};

let tvCameraState = null;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function isReducedMotion() {
    return typeof window !== "undefined"
        && typeof window.matchMedia === "function"
        && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function clearTimers(state) {
    if (!state) {
        return;
    }

    if (state.resetTimerId) {
        window.clearTimeout(state.resetTimerId);
        state.resetTimerId = 0;
    }

    if (state.directorTimerId) {
        window.clearTimeout(state.directorTimerId);
        state.directorTimerId = 0;
    }

    if (state.cycleTimerIds.length > 0) {
        for (const timerId of state.cycleTimerIds) {
            window.clearTimeout(timerId);
        }

        state.cycleTimerIds = [];
    }
}

function applyTransform(state) {
    if (!state?.layer?.isConnected) {
        return;
    }

    state.layer.style.transform = `translate3d(${state.currentX}px, ${state.currentY}px, 0) scale(${state.currentZoom})`;
}

function clampTranslation(state, value, axis) {
    const zoom = state.targetZoom;
    const viewportSize = axis === "x" ? state.viewport.clientWidth : state.viewport.clientHeight;
    const overflow = Math.max(0, ((viewportSize * zoom) - viewportSize) / 2);
    return clamp(value, -overflow, overflow);
}

function ensureAnimationLoop(state) {
    if (!state || state.rafId) {
        return;
    }

    const tick = () => {
        if (!tvCameraState || tvCameraState !== state || !state.root?.isConnected) {
            if (state.rafId) {
                cancelAnimationFrame(state.rafId);
                state.rafId = 0;
            }

            return;
        }

        state.currentX += (state.targetX - state.currentX) * CAMERA_DEFAULTS.stepXEase;
        state.currentY += (state.targetY - state.currentY) * CAMERA_DEFAULTS.stepYEase;
        state.currentZoom += (state.targetZoom - state.currentZoom) * CAMERA_DEFAULTS.stepZoomEase;

        if (Math.abs(state.targetX - state.currentX) < 0.1) {
            state.currentX = state.targetX;
        }

        if (Math.abs(state.targetY - state.currentY) < 0.1) {
            state.currentY = state.targetY;
        }

        if (Math.abs(state.targetZoom - state.currentZoom) < 0.001) {
            state.currentZoom = state.targetZoom;
        }

        applyTransform(state);
        state.rafId = requestAnimationFrame(tick);
    };

    state.rafId = requestAnimationFrame(tick);
}

function buildOptions(options = {}) {
    return {
        ...CAMERA_DEFAULTS,
        ...options,
        minZoom: Math.max(1, Number(options.minZoom) || CAMERA_DEFAULTS.minZoom),
        maxZoom: Math.max(1, Number(options.maxZoom) || CAMERA_DEFAULTS.maxZoom),
        autoResetDelayMs: Math.max(1200, Number(options.autoResetDelayMs) || CAMERA_DEFAULTS.autoResetDelayMs),
        directorIntervalMs: Math.max(2600, Number(options.directorIntervalMs) || CAMERA_DEFAULTS.directorIntervalMs),
        autoDirectorEnabled: options.autoDirectorEnabled !== false
    };
}

function getState(rootId = "tv-crypto-field", options) {
    const root = document.getElementById(rootId);
    if (!root) {
        destroyTvCamera(rootId);
        return null;
    }

    const viewport = root.querySelector(".tv-camera-viewport");
    const layer = root.querySelector(".tv-camera-layer");
    const scene = root.querySelector(".tv-field-scene");
    if (!viewport || !layer || !scene) {
        destroyTvCamera(rootId);
        return null;
    }

    if (!tvCameraState || tvCameraState.root !== root) {
        clearTimers(tvCameraState);
        if (tvCameraState?.rafId) {
            cancelAnimationFrame(tvCameraState.rafId);
        }

        tvCameraState = {
            rootId,
            root,
            viewport,
            layer,
            scene,
            options: buildOptions(options),
            rafId: 0,
            currentX: 0,
            currentY: 0,
            currentZoom: 1,
            targetX: 0,
            targetY: 0,
            targetZoom: 1,
            resetTimerId: 0,
            directorTimerId: 0,
            cycleTimerIds: [],
            autoShotIndex: 0,
            currentShotKey: "overview",
            lastBallXPercent: 50,
            initialized: false
        };
    } else {
        tvCameraState.rootId = rootId;
        tvCameraState.root = root;
        tvCameraState.viewport = viewport;
        tvCameraState.layer = layer;
        tvCameraState.scene = scene;
        tvCameraState.options = buildOptions({ ...tvCameraState.options, ...options });
    }

    ensureAnimationLoop(tvCameraState);
    return tvCameraState;
}

function scheduleAutoReset(state, autoReset) {
    if (!state) {
        return;
    }

    if (state.resetTimerId) {
        window.clearTimeout(state.resetTimerId);
        state.resetTimerId = 0;
    }

    if (!autoReset || state.options.autoResetDelayMs <= 0) {
        return;
    }

    state.resetTimerId = window.setTimeout(() => {
        resetCamera(state.rootId);
    }, state.options.autoResetDelayMs);
}

function focusUsingLocalPoint(state, localX, localY, zoom, autoReset) {
    if (!state) {
        return;
    }

    const viewportWidth = state.viewport.clientWidth;
    const viewportHeight = state.viewport.clientHeight;
    if (!viewportWidth || !viewportHeight) {
        return;
    }

    const normalizedZoom = clamp(Number(zoom) || 1, state.options.minZoom, state.options.maxZoom);
    const centerX = viewportWidth / 2;
    const centerY = viewportHeight / 2;

    const translatedX = centerX - (centerX + ((localX - centerX) * normalizedZoom));
    const translatedY = centerY - (centerY + ((localY - centerY) * normalizedZoom));

    state.targetZoom = normalizedZoom;
    state.targetX = clampTranslation(state, translatedX, "x");
    state.targetY = clampTranslation(state, translatedY, "y");
    scheduleAutoReset(state, autoReset);
}

function readScenePercentages(state) {
    const sceneRect = state.scene.getBoundingClientRect();
    const ball = state.root.querySelector(".tv-field__ball");
    const ballCarrier = state.root.querySelector(".tv-field__player.has-ball");
    const attackingLeft = state.root.querySelectorAll(".tv-field__player.is-left.is-attacking").length;
    const attackingRight = state.root.querySelectorAll(".tv-field__player.is-right.is-attacking").length;
    const possessionLeft = Number(state.root.dataset.possessionA) || 50;
    const possessionRight = Number(state.root.dataset.possessionB) || 50;
    const pressureLeft = Number(state.root.dataset.pressureA) || 0;
    const pressureRight = Number(state.root.dataset.pressureB) || 0;

    let ballXPercent = 50;
    let ballYPercent = 50;

    if (ball && sceneRect.width && sceneRect.height) {
        const ballRect = ball.getBoundingClientRect();
        ballXPercent = clamp((((ballRect.left + (ballRect.width / 2)) - sceneRect.left) / sceneRect.width) * 100, 0, 100);
        ballYPercent = clamp((((ballRect.top + (ballRect.height / 2)) - sceneRect.top) / sceneRect.height) * 100, 0, 100);
    } else if (ballCarrier && sceneRect.width && sceneRect.height) {
        const carrierRect = ballCarrier.getBoundingClientRect();
        ballXPercent = clamp((((carrierRect.left + (carrierRect.width / 2)) - sceneRect.left) / sceneRect.width) * 100, 0, 100);
        ballYPercent = clamp((((carrierRect.top + (carrierRect.height / 2)) - sceneRect.top) / sceneRect.height) * 100, 0, 100);
    }

    return {
        ball,
        ballCarrier,
        ballXPercent,
        ballYPercent,
        attackingLeft,
        attackingRight,
        possessionLeft,
        possessionRight,
        pressureLeft,
        pressureRight
    };
}

function scheduleDirector(state) {
    if (!state || !state.options.autoDirectorEnabled) {
        return;
    }

    if (state.directorTimerId) {
        window.clearTimeout(state.directorTimerId);
        state.directorTimerId = 0;
    }

    state.directorTimerId = window.setTimeout(() => {
        if (!tvCameraState || tvCameraState !== state || !state.root?.isConnected) {
            return;
        }

        runAutoDirector(state);
        scheduleDirector(state);
    }, state.options.directorIntervalMs);
}

function runAutoDirector(state) {
    const scene = readScenePercentages(state);
    state.autoShotIndex += 1;
    state.lastBallXPercent = scene.ballXPercent;

    let nextShotKey = "overview";
    let nextAction = () => focusCameraOnPoint(50, 50, state.options.overviewZoom, { autoReset: false });

    if (scene.ballCarrier && (scene.ballXPercent <= 18 || scene.ballXPercent >= 82)) {
        nextShotKey = scene.ballXPercent < 50 ? "goal-left" : "goal-right";
        nextAction = () => focusGoalArea(state.options.goalZoom);
    } else if (scene.ballCarrier && scene.ballXPercent <= 32) {
        nextShotKey = "attack-left";
        nextAction = () => focusLeftAttack(state.options.attackZoom);
    } else if (scene.ballCarrier && scene.ballXPercent >= 68) {
        nextShotKey = "attack-right";
        nextAction = () => focusRightAttack(state.options.attackZoom);
    } else if (scene.ballCarrier && scene.ballXPercent < 46) {
        nextShotKey = "mid-left";
        nextAction = () => focusCameraOnPoint(42, 50, state.options.ballZoom, { autoReset: false });
    } else if (scene.ballCarrier && scene.ballXPercent > 54) {
        nextShotKey = "mid-right";
        nextAction = () => focusCameraOnPoint(58, 50, state.options.ballZoom, { autoReset: false });
    } else {
        const leftBias = (scene.attackingLeft * 0.8) + (scene.possessionLeft * 0.02) + (scene.pressureLeft * 1.2);
        const rightBias = (scene.attackingRight * 0.8) + (scene.possessionRight * 0.02) + (scene.pressureRight * 1.2);

        if (Math.abs(leftBias - rightBias) >= 0.7) {
            if (leftBias > rightBias) {
                nextShotKey = "lean-left";
                nextAction = () => focusLeftAttack(state.options.attackZoom - 0.1);
            } else {
                nextShotKey = "lean-right";
                nextAction = () => focusRightAttack(state.options.attackZoom - 0.1);
            }
        }
    }

    const shouldRotateToOverview = state.autoShotIndex % 6 === 0 && nextShotKey !== "goal-left" && nextShotKey !== "goal-right";

    if (shouldRotateToOverview) {
        state.currentShotKey = "overview";
        focusCameraOnPoint(50, 50, state.options.overviewZoom, { autoReset: false });
        return;
    }

    if (nextShotKey !== state.currentShotKey) {
        state.currentShotKey = nextShotKey;
        nextAction();
    }
}

export function initTvCamera(rootId = "tv-crypto-field", options = {}) {
    const state = getState(rootId, options);
    if (!state) {
        return false;
    }

    if (isReducedMotion()) {
        clearTimers(state);
        resetCamera(rootId);
        return true;
    }

    applyTransform(state);

    if (!state.initialized) {
        state.initialized = true;
        runAutoDirector(state);
        scheduleDirector(state);
        return true;
    }

    if (!state.directorTimerId) {
        scheduleDirector(state);
    }

    return true;
}

export function focusCameraOnElement(selector, zoom = 1.22, options = {}) {
    const state = getState();
    if (!state) {
        return false;
    }

    const target = state.root.querySelector(selector);
    if (!target) {
        return false;
    }

    const targetRect = target.getBoundingClientRect();
    const sceneRect = state.scene.getBoundingClientRect();
    if ((!targetRect.width && !targetRect.height) || !sceneRect.width || !sceneRect.height) {
        return false;
    }

    const localX = ((targetRect.left + (targetRect.width / 2)) - sceneRect.left) / sceneRect.width * state.viewport.clientWidth;
    const localY = ((targetRect.top + (targetRect.height / 2)) - sceneRect.top) / sceneRect.height * state.viewport.clientHeight;

    focusUsingLocalPoint(state, localX, localY, zoom, options.autoReset !== false);
    return true;
}

export function focusCameraOnPoint(x, y, zoom = 1.18, options = {}) {
    const state = getState();
    if (!state) {
        return false;
    }

    const localX = clamp(Number(x) || 50, 0, 100) / 100 * state.viewport.clientWidth;
    const localY = clamp(Number(y) || 50, 0, 100) / 100 * state.viewport.clientHeight;

    focusUsingLocalPoint(state, localX, localY, zoom, options.autoReset !== false);
    return true;
}

export function resetCamera(rootId = "tv-crypto-field") {
    const state = getState(rootId);
    if (!state) {
        return false;
    }

    if (state.resetTimerId) {
        window.clearTimeout(state.resetTimerId);
        state.resetTimerId = 0;
    }

    state.targetX = 0;
    state.targetY = 0;
    state.targetZoom = 1;
    return true;
}

export function cinematicFocusCycle() {
    const state = getState();
    if (!state) {
        return false;
    }

    clearTimers(state);

    const actions = [
        () => focusBall(state.options.ballZoom),
        () => focusLeftAttack(state.options.attackZoom),
        () => focusRightAttack(state.options.attackZoom),
        () => focusGoalArea(state.options.goalZoom),
        () => resetCamera()
    ];

    actions.forEach((action, index) => {
        state.cycleTimerIds.push(window.setTimeout(action, index * state.options.directorIntervalMs));
    });

    return true;
}

export function focusBall(zoom = CAMERA_DEFAULTS.ballZoom) {
    return focusCameraOnElement(".tv-field__player.has-ball", zoom, { autoReset: false })
        || focusCameraOnElement(".tv-field__ball", zoom, { autoReset: false })
        || focusCameraOnPoint(50, 50, CAMERA_DEFAULTS.overviewZoom, { autoReset: false });
}

export function focusLeftAttack(zoom = CAMERA_DEFAULTS.attackZoom) {
    return focusCameraOnElement(".tv-field__camera-target--left-attack", zoom, { autoReset: false });
}

export function focusRightAttack(zoom = CAMERA_DEFAULTS.attackZoom) {
    return focusCameraOnElement(".tv-field__camera-target--right-attack", zoom, { autoReset: false });
}

export function focusGoalArea(zoom = CAMERA_DEFAULTS.goalZoom) {
    const state = getState();
    if (!state) {
        return false;
    }

    const scene = readScenePercentages(state);
    const selector = scene.ballXPercent < 50
        ? ".tv-field__camera-target--left-goal-area"
        : ".tv-field__camera-target--right-goal-area";

    return focusCameraOnElement(selector, zoom, { autoReset: false });
}

export function destroyTvCamera(rootId = "tv-crypto-field") {
    if (!tvCameraState) {
        return;
    }

    if (rootId && tvCameraState.rootId && tvCameraState.rootId !== rootId) {
        return;
    }

    clearTimers(tvCameraState);

    if (tvCameraState.rafId) {
        cancelAnimationFrame(tvCameraState.rafId);
    }

    if (tvCameraState.layer?.isConnected) {
        tvCameraState.layer.style.transform = "translate3d(0px, 0px, 0) scale(1)";
    }

    tvCameraState = null;
}

if (typeof globalThis !== "undefined") {
    globalThis.criptoVersusTvCamera = {
        initTvCamera,
        focusCameraOnElement,
        focusCameraOnPoint,
        resetCamera,
        cinematicFocusCycle,
        focusBall,
        focusLeftAttack,
        focusRightAttack,
        focusGoalArea,
        destroyTvCamera
    };
}
