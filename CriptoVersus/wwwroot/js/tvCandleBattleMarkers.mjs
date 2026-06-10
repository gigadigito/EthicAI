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
    marker.style.width = "100%";

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

function resolveGroupedWinner(samples) {
    let leftCount = 0;
    let rightCount = 0;

    samples.forEach((sample) => {
        if (sample?.winner === "left") {
            leftCount += 1;
        } else if (sample?.winner === "right") {
            rightCount += 1;
        }
    });

    if (leftCount > rightCount) {
        return "left";
    }

    if (rightCount > leftCount) {
        return "right";
    }

    return "tie";
}

function groupTimelineSamples(samples) {
    const grouped = new Map();

    samples.forEach((sample) => {
        if (!sample || !Number.isFinite(sample.time)) {
            return;
        }

        const current = grouped.get(sample.time);
        if (current) {
            current.samples.push(sample);
            current.winner = resolveGroupedWinner(current.samples);
            return;
        }

        grouped.set(sample.time, {
            time: sample.time,
            samples: [sample],
            winner: sample.winner
        });
    });

    return Array.from(grouped.values());
}

export function renderBattleTimeline(containerId, battleState) {
    const container = typeof document !== "undefined"
        ? document.getElementById(containerId)
        : null;

    if (!container) {
        return;
    }

    if (!battleState?.samples?.length) {
        container.dataset.timelineSignature = "";
        container.replaceChildren();
        container.style.gridTemplateColumns = "";
        return;
    }

    const groupedSamples = groupTimelineSamples(battleState.samples);
    const groupedSignature = groupedSamples
        .map((sample) => `${sample.time}:${sample.winner}`)
        .join("|");

    if (container.dataset.timelineSignature === groupedSignature) {
        return;
    }

    container.dataset.timelineSignature = groupedSignature;
    container.replaceChildren();

    container.style.gridTemplateColumns =
        `repeat(${groupedSamples.length}, minmax(22px, 1fr))`;

    const fragment = document.createDocumentFragment();

    groupedSamples.forEach((sample) => {
        fragment.appendChild(buildTimelineMarker(sample, battleState));
    });

    container.appendChild(fragment);
}
