function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function fallbackLabel(symbol) {
    if (typeof symbol !== "string" || symbol.trim().length === 0) {
        return "?";
    }

    const compact = symbol.trim().replace(/[^a-z0-9]/gi, "").toUpperCase();
    return compact.slice(0, compact.length >= 4 ? 3 : 2) || "?";
}

function formatBattleTime(time) {
    if (!Number.isFinite(time)) {
        return "CANDLE";
    }

    const date = new Date(time * 1000);
    return date.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit"
    });
}

function ensureBattleMarkerStyles() {
    if (typeof document === "undefined" || document.getElementById("tv-candle-battle-marker-styles")) {
        return;
    }

    const style = document.createElement("style");
    style.id = "tv-candle-battle-marker-styles";
    style.textContent = `
.tv-candle-battle-marker-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 4;
    overflow: hidden;
}

.tv-candle-battle-chart-marker {
    position: absolute;
    width: 0;
    top: 0;
    bottom: 0;
    opacity: 0;
    transition: opacity 180ms ease;
    pointer-events: none;
}

.tv-candle-battle-chart-marker.is-visible {
    opacity: 1;
}

.tv-candle-battle-chart-marker__badge {
    position: absolute;
    left: 0;
    top: var(--battle-marker-y, 50%);
    width: 22px;
    height: 22px;
    transform: translate(-50%, -50%);
    border-radius: 999px;
    display: grid;
    place-items: center;
    border: 1px solid rgba(255,255,255,0.2);
    box-shadow: 0 0 14px rgba(0,0,0,0.26);
    animation: tvBattleMarkerEnter 260ms ease-out;
    overflow: hidden;
}

.tv-candle-battle-chart-marker__badge.is-left {
    background: radial-gradient(circle at 30% 28%, rgba(255,255,255,0.28), transparent 34%), linear-gradient(135deg, rgba(34, 240, 162, 0.98), rgba(8, 52, 39, 0.96));
    box-shadow: 0 0 16px rgba(34, 240, 162, 0.42);
}

.tv-candle-battle-chart-marker__badge.is-right {
    background: radial-gradient(circle at 30% 28%, rgba(255,255,255,0.28), transparent 34%), linear-gradient(135deg, rgba(255, 91, 143, 0.98), rgba(68, 12, 32, 0.96));
    box-shadow: 0 0 16px rgba(255, 91, 143, 0.38);
}

.tv-candle-battle-chart-marker__badge.is-tie {
    background: radial-gradient(circle at 30% 28%, rgba(255,255,255,0.24), transparent 34%), linear-gradient(135deg, rgba(160, 172, 189, 0.98), rgba(52, 60, 77, 0.96));
    box-shadow: 0 0 14px rgba(154, 167, 184, 0.32);
}

.tv-candle-battle-chart-marker__badge img {
    width: 72%;
    height: 72%;
    object-fit: contain;
    filter: drop-shadow(0 0 8px rgba(255,255,255,0.2));
}

.tv-candle-battle-chart-marker__fallback {
    font-size: 0.6rem;
    font-weight: 900;
    letter-spacing: 0.08em;
    color: #f8fbff;
}

@keyframes tvBattleMarkerEnter {
    from { opacity: 0; transform: translate(-50%, calc(-50% + 4px)) scale(0.82); }
    to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}
`;
    document.head.appendChild(style);
}

function ensureMarkerRoot(state) {
    ensureBattleMarkerStyles();

    if (state.battleMarkerRoot?.isConnected) {
        return state.battleMarkerRoot;
    }

    if (typeof window !== "undefined") {
        const computed = window.getComputedStyle(state.container);
        if (computed.position === "static") {
            state.container.style.position = "relative";
        }
    }

    const root = document.createElement("div");
    root.className = "tv-candle-battle-marker-layer";
    state.container.appendChild(root);
    state.battleMarkerRoot = root;
    return root;
}

function buildMarkerModel(sample, chartSide, battleState) {
    const winnerMeta = sample.winner === "right" ? battleState.rightMeta : battleState.leftMeta;
    const chartCandle = chartSide === "right" ? sample.rightCandle : sample.leftCandle;

    let value = chartCandle?.close;
    let yOffset = 0;
    if (sample.winner === "left") {
        value = chartCandle?.low;
        yOffset = 14;
    } else if (sample.winner === "right") {
        value = chartCandle?.high;
        yOffset = -14;
    }

    return {
        key: `${chartSide}:${sample.time}:${sample.winner}`,
        time: sample.time,
        value: Number(value),
        yOffset,
        winner: sample.winner,
        accentClass: sample.winner === "left" ? "is-left" : sample.winner === "right" ? "is-right" : "is-tie",
        logoUrl: sample.winner === "tie" ? "" : winnerMeta.logoUrl,
        fallback: sample.winner === "tie" ? "=" : fallbackLabel(winnerMeta.displayBase),
        title: sample.winner === "tie"
            ? `${formatBattleTime(sample.time)} - Empate`
            : `${formatBattleTime(sample.time)} - ${winnerMeta.displayBase} venceu`
    };
}

function buildMarkerNode(model) {
    const node = document.createElement("div");
    node.className = "tv-candle-battle-chart-marker";

    const badge = document.createElement("div");
    badge.className = `tv-candle-battle-chart-marker__badge ${model.accentClass}`;
    badge.title = model.title;

    const fallback = document.createElement("span");
    fallback.className = "tv-candle-battle-chart-marker__fallback";
    fallback.textContent = model.fallback;
    badge.appendChild(fallback);

    if (model.logoUrl) {
        const image = document.createElement("img");
        image.alt = "";
        image.src = model.logoUrl;
        image.addEventListener("load", () => {
            fallback.style.display = "none";
        }, { once: true });
        image.addEventListener("error", () => {
            image.remove();
            fallback.style.display = "grid";
        }, { once: true });
        badge.appendChild(image);
    }

    node.appendChild(badge);
    return node;
}

function positionBattleMarkers(state) {
    if (!state?.chart || !Array.isArray(state.battleMarkerNodes) || state.battleMarkerNodes.length === 0) {
        return;
    }

    const timeScale = state.chart.timeScale?.();
    if (!timeScale || typeof state.series?.priceToCoordinate !== "function") {
        return;
    }

    const rect = state.container.getBoundingClientRect();
    state.battleMarkerNodes.forEach((entry) => {
        const x = timeScale.timeToCoordinate(entry.model.time);
        const yBase = state.series.priceToCoordinate(entry.model.value);

        if (!Number.isFinite(x) || !Number.isFinite(yBase) || x < 0 || x > rect.width) {
            entry.node.classList.remove("is-visible");
            return;
        }

        const y = clamp(yBase + (entry.model.yOffset ?? 0), 16, Math.max(16, rect.height - 16));
        entry.node.style.left = `${x}px`;
        entry.node.style.setProperty("--battle-marker-y", `${y}px`);
        entry.node.classList.add("is-visible");
    });
}

function cancelBattleMarkerRefresh(state) {
    if (state?.battleMarkerRefreshRafId) {
        window.cancelAnimationFrame(state.battleMarkerRefreshRafId);
        state.battleMarkerRefreshRafId = null;
    }
}

function scheduleBattleMarkerRefresh(state) {
    if (!state) {
        return;
    }

    cancelBattleMarkerRefresh(state);
    state.battleMarkerRefreshRafId = window.requestAnimationFrame(() => {
        state.battleMarkerRefreshRafId = null;
        positionBattleMarkers(state);
    });
}

function attachBattleMarkerSync(state) {
    if (!state?.chart || state.battleMarkersAttached) {
        return;
    }

    const timeScale = state.chart.timeScale?.();
    const refresh = () => scheduleBattleMarkerRefresh(state);

    if (typeof timeScale?.subscribeVisibleTimeRangeChange === "function") {
        timeScale.subscribeVisibleTimeRangeChange(refresh);
        state.battleUnsubscribeVisibleTimeRangeChange = () => {
            try {
                timeScale.unsubscribeVisibleTimeRangeChange(refresh);
            } catch {
            }
        };
    }

    if (typeof timeScale?.subscribeVisibleLogicalRangeChange === "function") {
        timeScale.subscribeVisibleLogicalRangeChange(refresh);
        state.battleUnsubscribeVisibleLogicalRangeChange = () => {
            try {
                timeScale.unsubscribeVisibleLogicalRangeChange(refresh);
            } catch {
            }
        };
    }

    if (typeof ResizeObserver !== "undefined") {
        const observer = new ResizeObserver(() => scheduleBattleMarkerRefresh(state));
        observer.observe(state.container);
        state.battleResizeObserver = observer;
    }

    state.battleMarkersAttached = true;
}

export function clearBattleMarkers(state) {
    if (!state) {
        return;
    }

    cancelBattleMarkerRefresh(state);

    if (Array.isArray(state.battleMarkerNodes)) {
        state.battleMarkerNodes.forEach((entry) => {
            try {
                entry?.node?.remove?.();
            } catch {
            }
        });
    }

    try {
        state.battleResizeObserver?.disconnect?.();
    } catch {
    }

    try {
        state.battleUnsubscribeVisibleTimeRangeChange?.();
    } catch {
    }

    try {
        state.battleUnsubscribeVisibleLogicalRangeChange?.();
    } catch {
    }

    state.battleResizeObserver = null;
    state.battleUnsubscribeVisibleTimeRangeChange = null;
    state.battleUnsubscribeVisibleLogicalRangeChange = null;
    state.battleMarkerNodes = [];
    state.battleMarkersAttached = false;
}

export function renderBattleMarkers(state, battleState, chartSide) {
    if (!state?.container || !battleState?.samples?.length) {
        clearBattleMarkers(state);
        return;
    }

    clearBattleMarkers(state);
    attachBattleMarkerSync(state);

    const markerRoot = ensureMarkerRoot(state);
    const markerNodes = battleState.samples.map((sample) => {
        const model = buildMarkerModel(sample, chartSide, battleState);
        const node = buildMarkerNode(model);
        markerRoot.appendChild(node);
        return { model, node };
    });

    state.battleMarkerNodes = markerNodes;
    scheduleBattleMarkerRefresh(state);
}

function buildTimelineDot(sample, battleState) {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = `tv-candle-battle-card__timeline-dot ${sample.winner === "left" ? "is-left" : sample.winner === "right" ? "is-right" : "is-tie"}`;
    dot.title = sample.winner === "left"
        ? `${formatBattleTime(sample.time)} - ${battleState.leftMeta.displayBase} venceu`
        : sample.winner === "right"
            ? `${formatBattleTime(sample.time)} - ${battleState.rightMeta.displayBase} venceu`
            : `${formatBattleTime(sample.time)} - Empate`;
    dot.setAttribute("aria-label", dot.title);
    return dot;
}

export function renderBattleTimeline(containerId, battleState) {
    const container = typeof document !== "undefined" ? document.getElementById(containerId) : null;
    if (!container) {
        return;
    }

    const signature = battleState?.timelineSignature ?? "";
    if (container.dataset.timelineSignature === signature) {
        return;
    }

    container.dataset.timelineSignature = signature;
    container.replaceChildren();

    if (!battleState?.samples?.length) {
        return;
    }

    const fragment = document.createDocumentFragment();
    battleState.samples.forEach((sample) => {
        fragment.appendChild(buildTimelineDot(sample, battleState));
    });
    container.appendChild(fragment);
}
