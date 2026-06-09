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

export function clearBattleMarkers(state) {
    if (!state?.series) {
        return;
    }

    try {
        applySeriesMarkers(state, []);
    } catch {
    }
}

export function renderBattleMarkers(state) {
    clearBattleMarkers(state);
}

function buildTimelineMarker(sample, battleState) {
    const marker = document.createElement("span");
    marker.className = "tv-candle-battle-card__timeline-marker";

    const rangeLabel = formatBattleTime(sample.time);

    if (sample.winner === "left") {
        marker.classList.add("is-left");
        marker.title = `${rangeLabel} - ${battleState.leftMeta.displayBase} venceu`;
    } else if (sample.winner === "right") {
        marker.classList.add("is-right");
        marker.title = `${rangeLabel} - ${battleState.rightMeta.displayBase} venceu`;
    } else {
        marker.classList.add("is-tie");
        marker.title = `${rangeLabel} - Empate`;
    }

    marker.setAttribute("aria-label", marker.title);

    return marker;
}

export function renderBattleTimeline(containerId, battleState) {
    const container = typeof document !== "undefined"
        ? document.getElementById(containerId)
        : null;

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
        container.style.gridTemplateColumns = "";
        return;
    }

    const samples = battleState.samples;

    container.style.gridTemplateColumns =
        `repeat(${samples.length}, minmax(18px, 1fr))`;

    const fragment = document.createDocumentFragment();

    samples.forEach((sample) => {
        fragment.appendChild(buildTimelineMarker(sample, battleState));
    });

    container.appendChild(fragment);
}