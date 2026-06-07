function fallbackLabel(symbol) {
    if (typeof symbol !== "string" || symbol.trim().length === 0) {
        return "?";
    }

    const compact = symbol.trim().replace(/[^a-z0-9]/gi, "").toUpperCase();
    return compact.slice(0, compact.length >= 4 ? 2 : 1) || "?";
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

function applySeriesMarkers(state, markers) {
    if (typeof state?.series?.setMarkers === "function") {
        state.series.setMarkers(markers);
        return;
    }

    if (typeof state?.LightweightCharts?.createSeriesMarkers === "function") {
        state.LightweightCharts.createSeriesMarkers(state.series, markers);
    }
}

function buildMarkerText(sample, chartSide, battleState) {
    if (sample.winner === "tie") {
        return "=";
    }

    if (sample.winner !== chartSide) {
        return "";
    }

    const meta = sample.winner === "left" ? battleState.leftMeta : battleState.rightMeta;
    return fallbackLabel(meta.displayBase);
}

function buildSingleMarker(sample, chartSide, battleState) {
    if (sample.winner === "tie") {
        return {
            time: sample.time,
            position: "aboveBar",
            shape: "circle",
            color: "rgba(154, 167, 184, 0.78)",
            text: "="
        };
    }

    const winnerIsCurrentChart = sample.winner === chartSide;
    const winnerMeta = sample.winner === "left" ? battleState.leftMeta : battleState.rightMeta;
    const accentColor = winnerMeta.accentColor;

    return {
        time: sample.time,
        position: winnerIsCurrentChart ? "aboveBar" : "belowBar",
        shape: "circle",
        color: winnerIsCurrentChart
            ? accentColor
            : chartSide === "left"
                ? "rgba(255, 91, 143, 0.72)"
                : "rgba(34, 240, 162, 0.72)",
        text: buildMarkerText(sample, chartSide, battleState)
    };
}

export function clearBattleMarkers(state) {
    if (!state?.series) {
        return;
    }

    try {
        applySeriesMarkers(state, []);
    } catch {
    }
}

export function renderBattleMarkers(state, battleState, chartSide) {
    if (!state?.series || !battleState?.samples?.length) {
        clearBattleMarkers(state);
        return;
    }

    const markers = battleState.samples.map((sample) => buildSingleMarker(sample, chartSide, battleState));
    applySeriesMarkers(state, markers);
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
