export function createTelemetryCubeController(deps) {
    let state = null;

    function resolveVirtualFaceKey(faceIndex) {
        switch (faceIndex) {
            case 4:
                return "split";
            case 5:
                return "goals";
            case 6:
                return "sentiment";
            case 2:
                return "compare";
            default:
                return "none";
        }
    }

    function clearSettledTimer() {
        if (!state?.settledTimerId) {
            return;
        }

        try {
            window.clearTimeout(state.settledTimerId);
        } catch {
        }

        state.settledTimerId = null;
    }

    function pause(reason) {
        if (!state) {
            return;
        }

        if (state.timerId) {
            window.clearInterval(state.timerId);
            state.timerId = null;
        }

        state.shell?.classList.toggle("is-paused", state.paused);

        if (deps.throttleKey("TV_CUBE", `paused:${reason ?? "unknown"}`, 2000)) {
            deps.logCube("paused", reason);
        }
    }

    function resizeCharts() {
        deps.onResizeCharts?.();
    }

    function refreshChartsFromSettledFace(reason, faceIndex) {
        const lastPayload = deps.getLastPayload?.();
        if (!lastPayload) {
            return;
        }

        try {
            deps.onRefreshCharts?.(lastPayload);

            if (deps.throttleKey("TV_CHART", `refresh:${reason}:face-${faceIndex}`, 2000)) {
                deps.logChart("refresh from settled face", { reason, faceIndex });
            }
        } catch (error) {
            deps.logCube("chart refresh failed", error?.message || String(error));
        }
    }

    function settleFaceRotation(token, reason) {
        if (!state || state.pendingSettledToken !== token || state.lastSettledToken === token) {
            return;
        }

        state.lastSettledToken = token;
        clearSettledTimer();
        resizeCharts();
        refreshChartsFromSettledFace(reason ?? "settled", state.faceIndex);
    }

    function scheduleFaceSettled(reason) {
        if (!state) {
            return;
        }

        clearSettledTimer();
        state.pendingSettledToken = (state.pendingSettledToken || 0) + 1;
        state.lastFaceChangeReason = reason ?? "face";
        state.lastFaceChangeIndex = state.faceIndex;
        const token = state.pendingSettledToken;

        state.settledTimerId = window.setTimeout(() => {
            settleFaceRotation(token, `${state.lastFaceChangeReason ?? "face"}-timeout`);
        }, 1100);
    }

    function setFace(faceIndex, reason) {
        try {
            if (!state?.cube) {
                return;
            }

            const faceCount = state.faceCount || 7;
            const normalized = ((faceIndex % faceCount) + faceCount) % faceCount;
            state.faceIndex = normalized;
            const virtualFace = resolveVirtualFaceKey(normalized);
            state.virtualFace = virtualFace;
            state.cube.classList.remove("is-face-0", "is-face-1", "is-face-2", "is-face-3", "is-face-4", "is-face-5", "is-face-6");
            state.cube.classList.add(`is-face-${normalized}`);
            state.cube.dataset.virtualFace = virtualFace;

            deps.logCube(`face changed ${normalized}`, reason ? { reason, virtualFace } : { virtualFace });

            window.setTimeout(() => resizeCharts(), 0);
            window.setTimeout(() => resizeCharts(), 80);
            window.setTimeout(() => resizeCharts(), 350);
            window.setTimeout(() => resizeCharts(), 1100);

            const lastPayload = deps.getLastPayload?.();
            if (lastPayload) {
                window.setTimeout(() => {
                    try {
                        deps.onRefreshCharts?.(lastPayload);

                        if (deps.throttleKey("TV_CHART", `refresh:face-${normalized}`, 2000)) {
                            deps.logChart("refresh from state", { reason: `face-${normalized}` });
                        }
                    } catch (error) {
                        deps.logCube("chart refresh failed", error?.message || String(error));
                    }
                }, 120);
            }

            scheduleFaceSettled(reason ?? `face-${normalized}`);
        } catch (error) {
            deps.logCube("setCubeFace failed", error?.message || String(error));
        }
    }

    function resume() {
        if (!state || state.disabled || state.paused || state.timerId) {
            return;
        }

        state.timerId = window.setInterval(() => {
            try {
                setFace(state.faceIndex + 1, "interval");
            } catch (error) {
                deps.logCube("interval failed", error?.message || String(error));
            }
        }, state.intervalMs);
    }

    function init(shellId, intervalMs) {
        const tryInit = (attempt) => {
            const shell = document.getElementById(shellId);
            const cube = shell?.querySelector?.(".tv-telemetry-cube");

            if (!shell || !cube) {
                if (attempt < 10) {
                    window.setTimeout(() => tryInit(attempt + 1), 300);
                }

                return;
            }

            const resolvedIntervalMs = typeof intervalMs === "number" && intervalMs >= 3000
                ? intervalMs
                : Math.max(3000, (Number(shell.dataset.intervalSeconds) || 12) * 1000);

            if (state?.shell === shell && state?.cube === cube) {
                state.intervalMs = resolvedIntervalMs;
                state.disabled = deps.isReducedMotion()
                    || (typeof window !== "undefined" && window.innerWidth <= 720);
                return;
            }

            pause("reinit");

            state = {
                shell,
                cube,
                intervalMs: resolvedIntervalMs,
                timerId: null,
                faceIndex: 0,
                faceCount: 7,
                virtualFace: "none",
                paused: false,
                disabled: false,
                holdUntil: 0,
                settledTimerId: null,
                pendingSettledToken: 0,
                lastSettledToken: 0,
                lastFaceChangeReason: "init",
                lastFaceChangeIndex: 0
            };

            const disabled = deps.isReducedMotion()
                || (typeof window !== "undefined" && window.innerWidth <= 720);

            state.disabled = disabled;

            if (disabled) {
                setFace(0, "disabled");
                deps.logCube("initialized (disabled)");
                return;
            }

            if (!shell.dataset.tvCubeBound) {
                shell.dataset.tvCubeBound = "1";

                shell.addEventListener("click", () => {
                    if (!state || state.disabled) {
                        return;
                    }

                    setFace(state.faceIndex + 1, "click");
                });

                cube.addEventListener("transitionend", (event) => {
                    if (!state || state.disabled) {
                        return;
                    }

                    if (event?.target !== cube) {
                        return;
                    }

                    if (typeof event?.propertyName === "string" && event.propertyName !== "transform") {
                        return;
                    }

                    settleFaceRotation(state.pendingSettledToken, `${state.lastFaceChangeReason ?? "face"}-transitionend`);
                });
            }

            if (!window.__tvTelemetryCubeVisibilityBound) {
                window.__tvTelemetryCubeVisibilityBound = true;

                window.addEventListener("visibilitychange", () => {
                    if (document.hidden) {
                        pause("hidden");
                        return;
                    }

                    if (state) {
                        state.paused = false;
                    }

                    resume();
                });
            }

            setFace(0, "init");
            deps.logCube("initialized", { intervalMs: resolvedIntervalMs });
            resume();

            if (deps.hasChartContainers()) {
                deps.logChart("containers ready");
            } else {
                deps.scheduleContainerRetry("initTelemetryCube");
            }
        };

        tryInit(0);
    }

    function notify(eventKey) {
        if (!state || state.disabled) {
            return;
        }

        const key = String(eventKey || "").toLowerCase();
        if (!key) {
            return;
        }

        if (key.includes("goal")) {
            setFace(5, "goal");
            state.holdUntil = Date.now() + 7000;
            pause("goal-hold");

            window.setTimeout(() => {
                if (!state || Date.now() < state.holdUntil) {
                    return;
                }

                state.paused = false;
                resume();
            }, 7200);

            return;
        }

        if (key.includes("fear")) {
            setFace(6, "fear");
            state.holdUntil = Date.now() + 7000;
            pause("fear-hold");

            window.setTimeout(() => {
                if (!state || Date.now() < state.holdUntil) {
                    return;
                }

                state.paused = false;
                resume();
            }, 7200);

            return;
        }

        if (key.includes("momentum") || key.includes("reversal") || key.includes("fear")) {
            setFace(2, "momentum-shift");
        }
    }

    return {
        init,
        notify,
        pause,
        resume,
        setFace,
        getState() {
            return state;
        }
    };
}
