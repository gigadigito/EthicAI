const SMOOTHING_SPEED = 14;
const SCREEN_CLAMP_MARGIN = 8;
const OFFSCREEN_MARGIN = 40;
const FADE_IN_DURATION = 0.15;
const FADE_OUT_DURATION = 0.2;
const MINIMUM_VISIBLE_SECONDS = 1.4;
const NULL_OWNER_GRACE_SECONDS = 0.6;
const HEAD_OFFSET_CSS_PX = 28;
const GLOBAL_STYLE_ID = "futurebol-market-bubble-global";
const GLOBAL_CSS = `
.futurebol-player-market-bubble {
    --bubble-accent: #ff8c14;
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 120px;
    padding: 9px 15px 10px;
    border-radius: 14px;
    background: linear-gradient(180deg, rgba(3, 22, 27, 0.97), rgba(2, 10, 16, 0.97));
    border: 2px solid var(--bubble-accent);
    box-shadow:
        0 0 8px var(--bubble-accent),
        0 0 18px color-mix(in srgb, var(--bubble-accent) 40%, transparent),
        inset 0 1px 0 rgba(255, 255, 255, 0.06);
    font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
    line-height: 1.2;
    white-space: nowrap;
    user-select: none;
    pointer-events: none;
    z-index: 20;
    transform: translate(-50%, -100%);
    will-change: transform, opacity;
    transition: opacity 150ms ease;
}
.futurebol-player-market-bubble__percent {
    font-size: clamp(18px, 1.3vw, 26px);
    font-weight: 800;
    line-height: 1;
    letter-spacing: 0.02em;
}
.futurebol-player-market-bubble__percent--positive {
    color: #3fffb0;
    text-shadow: 0 0 8px rgba(63, 255, 176, 0.35);
}
.futurebol-player-market-bubble__percent--negative {
    color: #ff6673;
    text-shadow: 0 0 8px rgba(255, 102, 115, 0.35);
}
.futurebol-player-market-bubble__price {
    font-size: clamp(12px, 0.85vw, 16px);
    font-weight: 650;
    color: rgba(238, 246, 255, 0.85);
    margin-top: 2px;
}
.futurebol-player-market-bubble__arrow {
    position: absolute;
    left: 50%;
    bottom: -10px;
    transform: translateX(-50%);
    width: 0;
    height: 0;
    border-left: 9px solid transparent;
    border-right: 9px solid transparent;
    border-top: 10px solid var(--bubble-accent);
    filter: drop-shadow(0 0 5px var(--bubble-accent));
}
@media (max-width: 720px) {
    .futurebol-player-market-bubble {
        min-width: 90px;
        padding: 7px 11px 8px;
        border-radius: 11px;
        border-width: 1.5px;
    }
    .futurebol-player-market-bubble__percent {
        font-size: clamp(16px, 4vw, 19px);
    }
    .futurebol-player-market-bubble__price {
        font-size: clamp(11px, 3vw, 13px);
    }
    .futurebol-player-market-bubble__arrow {
        border-left-width: 7px;
        border-right-width: 7px;
        border-top-width: 8px;
        bottom: -8px;
    }
}
`;
function ensureGlobalStyle() {
    if (typeof document === "undefined")
        return;
    if (document.getElementById(GLOBAL_STYLE_ID))
        return;
    const style = document.createElement("style");
    style.id = GLOBAL_STYLE_ID;
    style.textContent = GLOBAL_CSS;
    document.head.appendChild(style);
}
export class FuturebolPlayerMarketBubble {
    constructor(canvas) {
        this.smoothedX = 0;
        this.smoothedY = 0;
        this.renderedOpacity = 0;
        this.lifecycle = { state: "hidden" };
        this.disposed = false;
        ensureGlobalStyle();
        const parent = canvas.parentElement;
        if (!parent)
            throw new Error("Market bubble requires canvas.parentElement");
        if (getComputedStyle(parent).position === "static")
            parent.style.position = "relative";
        this.host = parent;
        this.el = document.createElement("div");
        this.el.className = "futurebol-player-market-bubble";
        this.el.style.opacity = "0";
        this.percentEl = document.createElement("span");
        this.percentEl.className = "futurebol-player-market-bubble__percent";
        this.el.appendChild(this.percentEl);
        this.priceEl = document.createElement("span");
        this.priceEl.className = "futurebol-player-market-bubble__price";
        this.el.appendChild(this.priceEl);
        this.arrowEl = document.createElement("span");
        this.arrowEl.className = "futurebol-player-market-bubble__arrow";
        this.el.appendChild(this.arrowEl);
        this.host.appendChild(this.el);
    }
    update(input, renderW, renderH, deltaSeconds, cssContainerW, cssContainerH) {
        if (this.disposed)
            return;
        const dt = Math.min(deltaSeconds, 0.1);
        const hasOwner = input.visible
            && input.ownerPlayerId !== null
            && input.ownerTeam !== null;
        const asset = input.asset;
        const hasPercent = asset !== null && isFinite(asset.changePercent);
        const hasPrice = asset !== null && isFinite(asset.price) && asset.price > 0;
        const hasData = hasPercent || hasPrice;
        const isOffscreen = hasOwner && (input.headScreenX < -OFFSCREEN_MARGIN ||
            input.headScreenX > renderW + OFFSCREEN_MARGIN ||
            input.headScreenY < -OFFSCREEN_MARGIN ||
            input.headScreenY > renderH + OFFSCREEN_MARGIN);
        const shouldBeVisible = hasOwner && hasData && !isOffscreen;
        this.lifecycle = this.tickLifecycle(this.lifecycle, shouldBeVisible, input, dt);
        const targetOpacity = this.lifecycle.state === "hidden" ? 0
            : this.lifecycle.state === "fadeOut" ? 0
                : 1;
        this.renderedOpacity = approachTo(this.renderedOpacity, targetOpacity, dt);
        if (this.renderedOpacity < 0.01 && this.lifecycle.state === "hidden") {
            this.el.style.opacity = "0";
            return;
        }
        const sx = input.headScreenX;
        const sy = input.headScreenY;
        const blend = dt > 0
            ? 1 - Math.exp(-SMOOTHING_SPEED * dt)
            : 0;
        if (this.lifecycle.state === "fadeIn" && this.lifecycle.elapsed < FADE_IN_DURATION * 0.5) {
            this.smoothedX = sx;
            this.smoothedY = sy;
        }
        else {
            this.smoothedX = lerp(this.smoothedX, sx, blend);
            this.smoothedY = lerp(this.smoothedY, sy, blend);
        }
        const contW = cssContainerW ?? renderW;
        const contH = cssContainerH ?? renderH;
        const scaleX = renderW > 0 ? contW / renderW : 1;
        const scaleY = renderH > 0 ? contH / renderH : 1;
        let cssX = this.smoothedX * scaleX;
        let cssY = this.smoothedY * scaleY - HEAD_OFFSET_CSS_PX;
        cssX = clamp(cssX, SCREEN_CLAMP_MARGIN, contW - SCREEN_CLAMP_MARGIN);
        cssY = clamp(cssY, SCREEN_CLAMP_MARGIN, contH - SCREEN_CLAMP_MARGIN);
        const activeTeam = this.getActiveTeam();
        const accentColor = activeTeam === "home" ? "#ff8c14" : "#14b8e0";
        this.el.style.setProperty("--bubble-accent", accentColor);
        this.updateContent(asset);
        this.el.style.left = `${cssX}px`;
        this.el.style.top = `${cssY}px`;
        this.el.style.opacity = String(clamp(this.renderedOpacity, 0, 1));
    }
    tickLifecycle(current, shouldBeVisible, input, dt) {
        const owner = input.ownerPlayerId;
        const team = input.ownerTeam;
        switch (current.state) {
            case "hidden": {
                if (!shouldBeVisible)
                    return current;
                return { state: "fadeIn", elapsed: 0, ownerId: owner, team };
            }
            case "fadeIn": {
                if (!shouldBeVisible && owner === null) {
                    return { state: "fadeOut", elapsed: 0, fromOpacity: 1, ownerId: owner, team };
                }
                const newElapsed = current.elapsed + dt;
                if (newElapsed >= FADE_IN_DURATION) {
                    return { state: "visible", elapsed: 0, totalVisible: 0, ownerId: owner ?? current.ownerId, team: team ?? current.team };
                }
                if (owner !== null && owner !== current.ownerId) {
                    return { state: "fadeIn", elapsed: current.elapsed, ownerId: owner, team };
                }
                return { state: "fadeIn", elapsed: newElapsed, ownerId: current.ownerId, team: current.team };
            }
            case "visible": {
                const newTotal = current.totalVisible + dt;
                if (owner !== null && owner !== current.ownerId) {
                    return { state: "visible", elapsed: 0, totalVisible: 0, ownerId: owner, team };
                }
                if (shouldBeVisible) {
                    return { state: "visible", elapsed: 0, totalVisible: newTotal, ownerId: owner ?? current.ownerId, team: team ?? current.team };
                }
                if (newTotal < MINIMUM_VISIBLE_SECONDS) {
                    return { state: "visible", elapsed: 0, totalVisible: newTotal, ownerId: current.ownerId, team: current.team };
                }
                if (owner === null) {
                    return { state: "grace", elapsed: 0, ownerId: current.ownerId, team: current.team };
                }
                return { state: "fadeOut", elapsed: 0, fromOpacity: 1, ownerId: current.ownerId, team: current.team };
            }
            case "grace": {
                if (shouldBeVisible && owner !== null) {
                    if (owner !== current.ownerId) {
                        return { state: "visible", elapsed: 0, totalVisible: 0, ownerId: owner, team };
                    }
                    return { state: "visible", elapsed: 0, totalVisible: MINIMUM_VISIBLE_SECONDS, ownerId: owner, team };
                }
                const newElapsed = current.elapsed + dt;
                if (newElapsed >= NULL_OWNER_GRACE_SECONDS) {
                    return { state: "fadeOut", elapsed: 0, fromOpacity: 1, ownerId: current.ownerId, team: current.team };
                }
                return { state: "grace", elapsed: newElapsed, ownerId: current.ownerId, team: current.team };
            }
            case "fadeOut": {
                const newElapsed = current.elapsed + dt;
                if (shouldBeVisible && owner !== null) {
                    return { state: "visible", elapsed: 0, totalVisible: 0, ownerId: owner, team };
                }
                if (newElapsed >= FADE_OUT_DURATION) {
                    return { state: "hidden" };
                }
                return { state: "fadeOut", elapsed: newElapsed, fromOpacity: current.fromOpacity, ownerId: current.ownerId, team: current.team };
            }
        }
    }
    getActiveTeam() {
        if (this.lifecycle.state === "hidden")
            return null;
        return this.lifecycle.team;
    }
    updateContent(asset) {
        const hasPercent = asset !== null && isFinite(asset.changePercent);
        const hasPrice = asset !== null && isFinite(asset.price) && asset.price > 0;
        if (hasPercent) {
            const sign = asset.changePercent >= 0 ? "+" : "";
            this.percentEl.textContent = `${sign}${formatPercent(asset.changePercent)}`;
            this.percentEl.className = "futurebol-player-market-bubble__percent" +
                (asset.changePercent >= 0
                    ? " futurebol-player-market-bubble__percent--positive"
                    : " futurebol-player-market-bubble__percent--negative");
        }
        else {
            this.percentEl.textContent = "";
        }
        if (hasPrice) {
            this.priceEl.textContent = `$${formatPrice(asset.price)}`;
        }
        else {
            this.priceEl.textContent = "";
        }
    }
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.el.remove();
    }
    getDiagnostics() {
        const ls = this.lifecycle;
        let ownerId = null;
        let team = null;
        let totalVisible = 0;
        let graceRemaining = 0;
        if (ls.state === "fadeIn") {
            ownerId = ls.ownerId;
            team = ls.team;
        }
        else if (ls.state === "visible") {
            ownerId = ls.ownerId;
            team = ls.team;
            totalVisible = ls.totalVisible;
        }
        else if (ls.state === "grace") {
            ownerId = ls.ownerId;
            team = ls.team;
            graceRemaining = NULL_OWNER_GRACE_SECONDS - ls.elapsed;
        }
        else if (ls.state === "fadeOut") {
            ownerId = ls.ownerId;
            team = ls.team;
        }
        return {
            ownerPlayerId: ownerId,
            ownerTeam: team,
            price: null,
            changePercent: null,
            screenX: this.smoothedX,
            screenY: this.smoothedY,
            visible: this.renderedOpacity > 0.5,
            opacity: this.renderedOpacity,
            timeSinceVisible: totalVisible,
            graceRemaining
        };
    }
}
function formatPercent(value) {
    return `${Math.abs(value).toFixed(2)}%`;
}
function formatPrice(value) {
    if (value >= 1)
        return value.toFixed(2);
    if (value >= 0.01)
        return value.toFixed(3);
    return value.toFixed(4);
}
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
function lerp(from, to, t) {
    return from + (to - from) * clamp(t, 0, 1);
}
function approachTo(current, target, dt) {
    if (dt <= 0)
        return current;
    const speed = target > current ? (1 / FADE_IN_DURATION) : (1 / FADE_OUT_DURATION);
    const maxStep = speed * dt;
    const diff = target - current;
    if (Math.abs(diff) <= maxStep)
        return target;
    return current + Math.sign(diff) * maxStep;
}
