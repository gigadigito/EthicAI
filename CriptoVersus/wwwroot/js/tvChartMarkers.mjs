function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

export function getBattleFallbackLabel(symbol) {
    if (typeof symbol !== "string" || symbol.trim().length === 0) {
        return "?";
    }

    const compact = symbol.trim().replace(/[^a-z0-9]/gi, "");
    return compact.slice(0, compact.length >= 4 ? 3 : 2).toUpperCase() || "?";
}

export function ensureCompareCrossoverStyles() {
    if (typeof document === "undefined" || document.getElementById("tv-chart-crossover-styles")) {
        return;
    }

    const style = document.createElement("style");
    style.id = "tv-chart-crossover-styles";
    style.textContent = `
.tv-chart-crossover-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 4;
    overflow: hidden;
}

.tv-chart-crossover-marker {
    position: absolute;
    width: 0;
    top: 0;
    bottom: 0;
    opacity: 0;
    transition: opacity 180ms ease;
}

.tv-chart-crossover-marker.is-visible {
    opacity: 1;
}

.tv-chart-crossover-marker__beam {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 2px;
    transform: translateX(-50%);
    background: linear-gradient(180deg, transparent 0%, color-mix(in srgb, var(--battle-accent, #53c8ff) 82%, white 8%) 24%, color-mix(in srgb, var(--battle-accent, #53c8ff) 92%, transparent) 55%, transparent 100%);
    box-shadow: 0 0 16px color-mix(in srgb, var(--battle-accent, #53c8ff) 42%, transparent);
    opacity: 0.72;
}

.tv-chart-crossover-marker__beam::after {
    content: "";
    position: absolute;
    left: 50%;
    top: 50%;
    width: 10px;
    height: 44px;
    transform: translate(-50%, -50%);
    background: radial-gradient(circle, color-mix(in srgb, var(--battle-accent, #53c8ff) 42%, transparent) 0%, transparent 70%);
    filter: blur(4px);
    opacity: 0.8;
}

.tv-chart-crossover-marker__badge {
    position: absolute;
    left: 0;
    top: var(--battle-y, 50%);
    width: 36px;
    height: 36px;
    transform: translate(-50%, -50%);
    border-radius: 999px;
    display: grid;
    place-items: center;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--battle-accent, #53c8ff) 82%, white 14%);
    background:
        radial-gradient(circle at 30% 30%, rgba(255,255,255,.24), transparent 42%),
        linear-gradient(180deg, rgba(255,255,255,.12), rgba(255,255,255,0) 38%),
        linear-gradient(135deg, color-mix(in srgb, var(--battle-accent, #53c8ff) 30%, rgba(4, 10, 20, 0.94)), rgba(5, 12, 24, 0.96));
    box-shadow:
        0 0 0 1px color-mix(in srgb, var(--battle-accent, #53c8ff) 28%, transparent),
        0 0 22px color-mix(in srgb, var(--battle-accent, #53c8ff) 42%, transparent),
        0 10px 24px rgba(0,0,0,.32);
    animation: tvChartCrossoverPop 520ms cubic-bezier(.19,1,.22,1);
}

.tv-chart-crossover-marker.is-resting .tv-chart-crossover-marker__badge {
    animation: none;
}

.tv-chart-crossover-marker__badge img {
    width: 76%;
    height: 76%;
    object-fit: contain;
    filter: drop-shadow(0 0 8px rgba(255,255,255,.16));
}

.tv-chart-crossover-marker__fallback {
    font-size: 0.72rem;
    font-weight: 900;
    letter-spacing: 0.08em;
    color: #f4fbff;
    text-transform: uppercase;
    text-shadow: 0 1px 0 rgba(0,0,0,.36);
}

.tv-chart-score-marker {
    position: absolute;
    width: 0;
    top: 0;
    bottom: 0;
    opacity: 0;
    transition: opacity 180ms ease;
    pointer-events: none;
}

.tv-chart-score-marker.is-visible {
    opacity: 1;
}

.tv-chart-score-marker__beam {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 1px;
    transform: translateX(-50%);
    background: linear-gradient(180deg, transparent 0%, color-mix(in srgb, var(--battle-accent, #53c8ff) 76%, white 8%) 24%, color-mix(in srgb, var(--battle-accent, #53c8ff) 88%, transparent) 58%, transparent 100%);
    box-shadow: 0 0 14px color-mix(in srgb, var(--battle-accent, #53c8ff) 34%, transparent);
    opacity: 0.52;
}

.tv-chart-score-marker__badge {
    position: absolute;
    left: 0;
    top: var(--battle-y, 50%);
    width: 30px;
    height: 30px;
    transform: translate(-50%, -50%);
    border-radius: 999px;
    display: grid;
    place-items: center;
    overflow: visible;
    pointer-events: auto;
}

.tv-chart-score-marker__badge-shell {
    width: 100%;
    height: 100%;
    border-radius: 999px;
    display: grid;
    place-items: center;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--battle-accent, #53c8ff) 82%, white 14%);
    background:
        radial-gradient(circle at 30% 30%, rgba(255,255,255,.24), transparent 42%),
        linear-gradient(180deg, rgba(255,255,255,.12), rgba(255,255,255,0) 38%),
        linear-gradient(135deg, color-mix(in srgb, var(--battle-accent, #53c8ff) 30%, rgba(4, 10, 20, 0.94)), rgba(5, 12, 24, 0.96));
    box-shadow:
        0 0 0 1px color-mix(in srgb, var(--battle-accent, #53c8ff) 22%, transparent),
        0 0 18px color-mix(in srgb, var(--battle-accent, #53c8ff) 38%, transparent),
        0 10px 24px rgba(0,0,0,.28);
    animation: tvChartCrossoverPop 460ms cubic-bezier(.19,1,.22,1);
}

.tv-chart-score-marker__badge img {
    width: 76%;
    height: 76%;
    object-fit: contain;
    filter: drop-shadow(0 0 8px rgba(255,255,255,.16));
}

.tv-chart-score-marker__fallback {
    font-size: 0.68rem;
    font-weight: 900;
    letter-spacing: 0.08em;
    color: #f4fbff;
    text-transform: uppercase;
    text-shadow: 0 1px 0 rgba(0,0,0,.36);
}

.tv-chart-score-marker__tooltip {
    position: absolute;
    left: 50%;
    top: calc(100% + 10px);
    min-width: 158px;
    max-width: 220px;
    padding: 9px 10px;
    border-radius: 12px;
    background: linear-gradient(180deg, rgba(7, 15, 28, 0.96), rgba(4, 10, 22, 0.98));
    border: 1px solid color-mix(in srgb, var(--battle-accent, #53c8ff) 42%, rgba(255,255,255,.12));
    box-shadow: 0 14px 30px rgba(0,0,0,.34), 0 0 18px color-mix(in srgb, var(--battle-accent, #53c8ff) 16%, transparent);
    transform: translate(-50%, 4px);
    opacity: 0;
    pointer-events: none;
    transition: opacity 140ms ease, transform 140ms ease;
}

.tv-chart-score-marker__tooltip::before {
    content: "";
    position: absolute;
    left: 50%;
    top: -5px;
    width: 10px;
    height: 10px;
    background: inherit;
    border-left: 1px solid color-mix(in srgb, var(--battle-accent, #53c8ff) 42%, rgba(255,255,255,.12));
    border-top: 1px solid color-mix(in srgb, var(--battle-accent, #53c8ff) 42%, rgba(255,255,255,.12));
    transform: translateX(-50%) rotate(45deg);
}

.tv-chart-score-marker__badge:hover .tv-chart-score-marker__tooltip,
.tv-chart-score-marker__badge:focus-within .tv-chart-score-marker__tooltip {
    opacity: 1;
    transform: translate(-50%, 0);
}

.tv-chart-score-marker__tooltip-time {
    display: block;
    margin-bottom: 4px;
    font-size: 0.68rem;
    font-weight: 900;
    letter-spacing: 0.12em;
    color: rgba(207, 232, 255, 0.78);
    text-transform: uppercase;
}

.tv-chart-score-marker__tooltip-title {
    display: block;
    font-size: 0.82rem;
    font-weight: 900;
    color: #f7fcff;
}

.tv-chart-score-marker__tooltip-reason {
    display: block;
    margin-top: 4px;
    font-size: 0.72rem;
    line-height: 1.35;
    color: rgba(216, 230, 245, 0.82);
}

@keyframes tvChartCrossoverPop {
    0% { opacity: 0; transform: translate(-50%, -50%) scale(0.6); }
    68% { opacity: 1; transform: translate(-50%, -50%) scale(1.1); }
    100% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}
`;

    document.head.appendChild(style);
}

export function ensureCompareOverlayRoot(state) {
    ensureCompareCrossoverStyles();

    if (state.overlayRoot?.isConnected) {
        return state.overlayRoot;
    }

    const overlayRoot = document.createElement("div");
    overlayRoot.className = "tv-chart-crossover-layer";
    state.container.appendChild(overlayRoot);
    state.overlayRoot = overlayRoot;
    return overlayRoot;
}

export function buildCompareMarkerNode(meta) {
    const marker = document.createElement("div");
    marker.className = "tv-chart-crossover-marker";
    marker.style.setProperty("--battle-accent", meta.accentColor);

    const beam = document.createElement("div");
    beam.className = "tv-chart-crossover-marker__beam";

    const badge = document.createElement("div");
    badge.className = "tv-chart-crossover-marker__badge";

    const fallback = document.createElement("span");
    fallback.className = "tv-chart-crossover-marker__fallback";
    fallback.textContent = getBattleFallbackLabel(meta.symbol);
    badge.appendChild(fallback);

    if (meta.logoUrl) {
        const image = document.createElement("img");
        image.alt = "";
        image.src = meta.logoUrl;
        image.addEventListener("load", () => {
            fallback.style.display = "none";
        }, { once: true });
        image.addEventListener("error", () => {
            image.remove();
            fallback.style.display = "grid";
        }, { once: true });
        badge.appendChild(image);
    }

    marker.appendChild(beam);
    marker.appendChild(badge);
    return marker;
}

export function buildScoreEventMarkerNode(markerModel) {
    const marker = document.createElement("div");
    marker.className = "tv-chart-score-marker";
    marker.style.setProperty("--battle-accent", markerModel.accentColor);

    const beam = document.createElement("div");
    beam.className = "tv-chart-score-marker__beam";

    const badge = document.createElement("div");
    badge.className = "tv-chart-score-marker__badge";

    const badgeShell = document.createElement("div");
    badgeShell.className = "tv-chart-score-marker__badge-shell";

    const fallback = document.createElement("span");
    fallback.className = "tv-chart-score-marker__fallback";
    fallback.textContent = getBattleFallbackLabel(markerModel.teamSymbol);
    badgeShell.appendChild(fallback);

    if (markerModel.logoUrl) {
        const image = document.createElement("img");
        image.alt = "";
        image.src = markerModel.logoUrl;
        image.addEventListener("load", () => {
            fallback.style.display = "none";
        }, { once: true });
        image.addEventListener("error", () => {
            image.remove();
            fallback.style.display = "grid";
        }, { once: true });
        badgeShell.appendChild(image);
    }

    const tooltip = document.createElement("div");
    tooltip.className = "tv-chart-score-marker__tooltip";

    const tooltipTime = document.createElement("span");
    tooltipTime.className = "tv-chart-score-marker__tooltip-time";
    tooltipTime.textContent = markerModel.minuteLabel;

    const tooltipTitle = document.createElement("span");
    tooltipTitle.className = "tv-chart-score-marker__tooltip-title";
    tooltipTitle.textContent = `${markerModel.teamSymbol} +${markerModel.points}`;

    const tooltipReason = document.createElement("span");
    tooltipReason.className = "tv-chart-score-marker__tooltip-reason";
    tooltipReason.textContent = markerModel.reason;

    tooltip.appendChild(tooltipTime);
    tooltip.appendChild(tooltipTitle);
    tooltip.appendChild(tooltipReason);

    badge.appendChild(badgeShell);
    badge.appendChild(tooltip);
    badge.title = `${markerModel.minuteLabel}\n${markerModel.teamSymbol} +${markerModel.points}\n${markerModel.reason}`;
    marker.appendChild(beam);
    marker.appendChild(badge);
    return marker;
}

export function computeScoreMarkerPlacement(markerModel, positioner, options = {}) {
    const x = positioner?.timeToCoordinate?.(markerModel.time);
    const yBase = positioner?.priceToCoordinate?.(markerModel.value);
    const width = Number(options?.width ?? 0);
    const height = Number(options?.height ?? 0);

    if (!Number.isFinite(x) || !Number.isFinite(yBase) || width <= 0 || height <= 0) {
        options?.diagnostics?.warn?.("score event could not be positioned", {
            reason: "invalid-coordinate",
            marker: markerModel
        });
        return null;
    }

    if (x < 0 || x > width) {
        options?.diagnostics?.warn?.("score event could not be positioned", {
            reason: "time-out-of-range",
            marker: markerModel
        });
        return null;
    }

    return {
        x,
        y: clamp(yBase + (markerModel.stackOffsetPx ?? 0), 24, Math.max(24, height - 24))
    };
}

export function applyScoreMarkerPlacement(markerEntry, placement) {
    if (!markerEntry?.node) {
        return false;
    }

    if (!placement) {
        markerEntry.node.classList.remove("is-visible");
        return false;
    }

    markerEntry.node.style.left = `${placement.x}px`;
    markerEntry.node.style.setProperty("--battle-y", `${placement.y}px`);
    markerEntry.node.classList.add("is-visible");
    return true;
}
