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

function buildSingleMarker(sample, chartSide, battleState) {
    if (!sample || sample.winner === "tie") {
        return null;
    }

    const winnerIsCurrentChart = sample.winner === chartSide;
    const winnerMeta = sample.winner === "left" ? battleState.leftMeta : battleState.rightMeta;

    return {
        time: sample.time,
        position: winnerIsCurrentChart ? "aboveBar" : "belowBar",
        shape: "circle",
        color: winnerIsCurrentChart
            ? winnerMeta.accentColor
            : chartSide === "left"
                ? "rgba(255, 166, 0, 0.72)"
                : "rgba(42, 201, 255, 0.72)"
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

    const markers = battleState.samples
        .map((sample) => buildSingleMarker(sample, chartSide, battleState))
        .filter(Boolean);

    applySeriesMarkers(state, markers);
}

function buildTimelineDot(sample, battleState, chartSide) {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "tv-candle-battle-card__timeline-dot";

    const rangeLabel = formatBattleTime(sample.time ?? sample.startTime);

    if (sample.winner === "tie") {
        dot.classList.add("is-empty");
        dot.title = `${rangeLabel} - Empate`;
        dot.setAttribute("aria-label", dot.title);
        return dot;
    }

    const currentChartWon = sample.winner === chartSide;
    const winnerMeta = sample.winner === "left" ? battleState.leftMeta : battleState.rightMeta;

    dot.classList.add(currentChartWon ? "is-win" : "is-loss");
    dot.title = `${rangeLabel} - ${winnerMeta.displayBase} venceu`;
    dot.setAttribute("aria-label", dot.title);

    const icon = document.createElement("span");
    icon.className = "tv-candle-battle-card__timeline-icon";
    icon.textContent = currentChartWon ? "✅" : "❌";

    dot.appendChild(icon);

    return dot;
}

export function renderBattleTimeline(containerId, battleState, chartSide = "left") {
    const container = typeof document !== "undefined" ? document.getElementById(containerId) : null;
    if (!container) {
        return;
    }

    const signature = `${battleState?.timelineSignature ?? ""}:${chartSide}`;
    if (container.dataset.timelineSignature === signature) {
        return;
    }

    container.dataset.timelineSignature = signature;
    container.replaceChildren();

    if (!battleState?.samples?.length) {
        return;
    }

    const samples = battleState.samples;
    container.style.gridTemplateColumns = `repeat(${samples.length}, minmax(18px, 1fr))`;

    const fragment = document.createDocumentFragment();

    samples.forEach((sample) => {
        fragment.appendChild(buildTimelineDot(sample, battleState, chartSide));
    });

    container.appendChild(fragment);
}