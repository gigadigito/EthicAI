export function createBroadcastPanelCarouselController(deps) {
    let state = null;

    function resolvePanelKey(panelIndex) {
        switch (panelIndex) {
            case 1:
                return "split";
            case 2:
                return "goals";
            case 3:
                return "sentiment";
            case 0:
            default:
                return "compare";
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

    function resizeCharts() {
        deps.onResizeCharts?.();
    }

    function refreshChartsFromSettledPanel(reason, panelIndex) {
        const lastPayload = deps.getLastPayload?.();
        if (!lastPayload) {
            return;
        }

        try {
            deps.onRefreshCharts?.(lastPayload);

            if (deps.throttleKey("TV_PANEL", `refresh:${reason}:panel-${panelIndex}`, 2000)) {
                deps.logPanel("refresh from settled panel", { reason, panelIndex });
            }
        } catch (error) {
            deps.logPanel("chart refresh failed", error?.message || String(error));
        }
    }

    function settlePanel(token, reason) {
        if (!state || state.pendingSettledToken !== token || state.lastSettledToken === token) {
            return;
        }

        state.lastSettledToken = token;
        clearSettledTimer();
        resizeCharts();
        refreshChartsFromSettledPanel(reason ?? "settled", state.activePanelIndex);
    }

    function schedulePanelSettled(reason) {
        if (!state) {
            return;
        }

        clearSettledTimer();
        state.pendingSettledToken = (state.pendingSettledToken || 0) + 1;
        state.lastPanelChangeReason = reason ?? "panel";
        const token = state.pendingSettledToken;

        state.settledTimerId = window.setTimeout(() => {
            settlePanel(token, `${state.lastPanelChangeReason ?? "panel"}-timeout`);
        }, 560);
    }

    function applyPanelState(panelIndex, reason) {
        if (!state?.carousel) {
            return;
        }

        state.activePanelIndex = panelIndex;
        state.activePanelKey = resolvePanelKey(panelIndex);

        state.carousel.classList.remove("is-panel-0", "is-panel-1", "is-panel-2", "is-panel-3");
        state.carousel.classList.add(`is-panel-${panelIndex}`);
        state.carousel.dataset.activePanel = state.activePanelKey;
        state.carousel.dataset.activePanelIndex = String(panelIndex);

        deps.logPanel(`panel changed ${panelIndex}`, reason ? { reason, panelKey: state.activePanelKey } : { panelKey: state.activePanelKey });

        window.setTimeout(() => resizeCharts(), 0);
        window.setTimeout(() => resizeCharts(), 80);
        window.setTimeout(() => resizeCharts(), 280);
        window.setTimeout(() => resizeCharts(), 560);

        const lastPayload = deps.getLastPayload?.();
        if (lastPayload) {
            window.setTimeout(() => {
                try {
                    deps.onRefreshCharts?.(lastPayload);

                    if (deps.throttleKey("TV_PANEL", `refresh:panel-${panelIndex}`, 2000)) {
                        deps.logPanel("refresh from state", { reason: `panel-${panelIndex}` });
                    }
                } catch (error) {
                    deps.logPanel("chart refresh failed", error?.message || String(error));
                }
            }, 120);
        }

        schedulePanelSettled(reason ?? `panel-${panelIndex}`);
    }

    function normalizePanelIndex(requestedIndex) {
        const panelCount = state?.panelCount || 4;
        return ((requestedIndex % panelCount) + panelCount) % panelCount;
    }

    function setFace(faceIndex, reason) {
        if (!state?.carousel) {
            return;
        }

        const normalized = normalizePanelIndex(faceIndex);
        applyPanelState(normalized, reason);
    }

    function goToNextPanel(reason) {
        if (!state) {
            return;
        }

        setFace(state.activePanelIndex + 1, reason);
    }

    function pause(reason) {
        if (!state) {
            return;
        }

        state.paused = true;

        if (state.timerId) {
            window.clearInterval(state.timerId);
            state.timerId = null;
        }

        state.shell?.classList.add("is-paused");

        if (deps.throttleKey("TV_PANEL", `paused:${reason ?? "unknown"}`, 2000)) {
            deps.logPanel("paused", reason);
        }
    }

    function resume() {
        if (!state || state.disabled || state.timerId || state.paused) {
            return;
        }

        state.shell?.classList.remove("is-paused");
        state.timerId = window.setInterval(() => {
            try {
                goToNextPanel("interval");
            } catch (error) {
                deps.logPanel("interval failed", error?.message || String(error));
            }
        }, state.intervalMs);
    }

    function bindUi(shell, carousel) {
        if (shell.dataset.tvPanelCarouselBound) {
            return;
        }

        shell.dataset.tvPanelCarouselBound = "1";

        shell.addEventListener("click", (event) => {
            if (!state || state.disabled) {
                return;
            }

            const target = event?.target;
            const dotButton = target?.closest?.("[data-broadcast-panel-target]");
            if (dotButton) {
                const requested = Number(dotButton.getAttribute("data-broadcast-panel-target"));
                if (Number.isFinite(requested)) {
                    setFace(requested, "dot-click");
                }
                return;
            }

            goToNextPanel("click");
        });

        if (!window.__tvPanelCarouselVisibilityBound) {
            window.__tvPanelCarouselVisibilityBound = true;

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
    }

    function init(shellId, intervalMs) {
        const tryInit = (attempt) => {
            const shell = document.getElementById(shellId);
            const carousel = shell?.querySelector?.(".tv-broadcast-panel-carousel");

            if (!shell || !carousel) {
                if (attempt < 10) {
                    window.setTimeout(() => tryInit(attempt + 1), 300);
                }

                return;
            }

            const resolvedIntervalMs = typeof intervalMs === "number" && intervalMs >= 3000
                ? intervalMs
                : Math.max(3000, (Number(shell.dataset.intervalSeconds) || 12) * 1000);

            if (state?.shell === shell && state?.carousel === carousel) {
                state.intervalMs = resolvedIntervalMs;
                state.disabled = deps.isReducedMotion();
                return;
            }

            pause("reinit");

            state = {
                shell,
                carousel,
                intervalMs: resolvedIntervalMs,
                timerId: null,
                activePanelIndex: 0,
                activePanelKey: "compare",
                panelCount: 4,
                paused: false,
                disabled: deps.isReducedMotion(),
                holdUntil: 0,
                settledTimerId: null,
                pendingSettledToken: 0,
                lastSettledToken: 0,
                lastPanelChangeReason: "init"
            };

            bindUi(shell, carousel);
            applyPanelState(0, state.disabled ? "disabled" : "init");

            if (state.disabled) {
                deps.logPanel("initialized (reduced motion)");
                return;
            }

            deps.logPanel("initialized", { intervalMs: resolvedIntervalMs });
            state.paused = false;
            resume();

            if (deps.hasChartContainers()) {
                deps.logChart?.("containers ready");
            } else {
                deps.scheduleContainerRetry?.("initBroadcastPanelCarousel");
            }
        };

        tryInit(0);
    }

    function holdOnPanel(panelIndex, reason, durationMs) {
        if (!state) {
            return;
        }

        state.holdUntil = Date.now() + durationMs;
        state.paused = true;
        setFace(panelIndex, reason);
        pause(`${reason}-hold`);

        window.setTimeout(() => {
            if (!state || Date.now() < state.holdUntil) {
                return;
            }

            state.paused = false;
            state.shell?.classList.remove("is-paused");
            resume();
        }, durationMs + 200);
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
            holdOnPanel(2, "goal", 7000);
            return;
        }

        if (key.includes("fear") || key.includes("pressure")) {
            holdOnPanel(3, "pressure", 7000);
            return;
        }

        if (key.includes("candle") || key.includes("split")) {
            holdOnPanel(1, "candle-battle", 5000);
            return;
        }

        if (key.includes("momentum") || key.includes("reversal")) {
            setFace(0, "momentum-shift");
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
