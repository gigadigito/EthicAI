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

function buildTimelineBuckets(samples, maxDots) {
    if (!Array.isArray(samples) || samples.length === 0) {
        return [];
    }

    if (!Number.isFinite(maxDots) || maxDots <= 0 || samples.length <= maxDots) {
        return samples.map((sample) => ({
            winner: sample.winner,
            count: 1,
            startTime: sample.time,
            endTime: sample.time
        }));
    }

    const bucketSize = Math.ceil(samples.length / maxDots);
    const buckets = [];

    for (let index = 0; index < samples.length; index += bucketSize) {
        const group = samples.slice(index, index + bucketSize);
        const leftWins = group.filter((item) => item.winner === "left").length;
        const rightWins = group.filter((item) => item.winner === "right").length;
        const ties = group.length - leftWins - rightWins;
        let winner = "tie";

        if (leftWins > rightWins && leftWins >= ties) {
            winner = "left";
        } else if (rightWins > leftWins && rightWins >= ties) {
            winner = "right";
        }

        buckets.push({
            winner,
            count: group.length,
            startTime: group[0]?.time ?? 0,
            endTime: group[group.length - 1]?.time ?? 0
        });
    }

    return buckets;
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
    dot.style.gridColumn = `span ${Math.max(1, sample.count || 1)}`;
    const rangeLabel = sample.count > 1
        ? `${formatBattleTime(sample.startTime)}-${formatBattleTime(sample.endTime)}`
        : formatBattleTime(sample.startTime);
    dot.title = sample.winner === "left"
        ? `${rangeLabel} - ${battleState.leftMeta.displayBase} venceu${sample.count > 1 ? ` (${sample.count} candles)` : ""}`
        : sample.winner === "right"
            ? `${rangeLabel} - ${battleState.rightMeta.displayBase} venceu${sample.count > 1 ? ` (${sample.count} candles)` : ""}`
            : `${rangeLabel} - Empate${sample.count > 1 ? ` (${sample.count} candles)` : ""}`;
    dot.setAttribute("aria-label", dot.title);

    const bubble = document.createElement("span");
    bubble.className = "tv-candle-battle-card__timeline-dot-bubble";
    dot.appendChild(bubble);

    if (sample.winner === "left" || sample.winner === "right") {
        const meta = sample.winner === "left" ? battleState.leftMeta : battleState.rightMeta;
        const fallback = document.createElement("span");
        fallback.className = "tv-candle-battle-card__timeline-dot-fallback";
        fallback.textContent = fallbackLabel(meta.displayBase);
        bubble.appendChild(fallback);

        if (meta.logoUrl) {
            const image = document.createElement("img");
            image.alt = "";
            image.className = "tv-candle-battle-card__timeline-dot-icon";
            image.src = meta.logoUrl;
            image.addEventListener("load", () => {
                fallback.style.display = "none";
            }, { once: true });
            image.addEventListener("error", () => {
                image.remove();
                fallback.style.display = "grid";
            }, { once: true });
            bubble.appendChild(image);
        }
    } else {
        const tieMark = document.createElement("span");
        tieMark.className = "tv-candle-battle-card__timeline-dot-fallback";
        tieMark.textContent = "=";
        bubble.appendChild(tieMark);
    }

    if (sample.count > 1) {
        const countBadge = document.createElement("span");
        countBadge.className = "tv-candle-battle-card__timeline-dot-count";
        countBadge.textContent = `+${sample.count - 1}`;
        dot.appendChild(countBadge);
    }

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

    const trackWidth = Math.max(container.clientWidth || 0, 120);
    const maxDots = Math.max(10, Math.floor(trackWidth / 18));
    const samples = buildTimelineBuckets(battleState.samples, maxDots);
    const totalUnits = Math.max(1, samples.reduce((sum, sample) => sum + Math.max(1, sample.count || 1), 0));
    container.style.gridTemplateColumns = `repeat(${totalUnits}, minmax(0, 1fr))`;

    const fragment = document.createDocumentFragment();
    samples.forEach((sample) => {
        fragment.appendChild(buildTimelineDot(sample, battleState));
    });
    container.appendChild(fragment);
}
