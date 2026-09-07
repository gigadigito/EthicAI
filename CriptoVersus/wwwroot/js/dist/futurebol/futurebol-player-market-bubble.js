const BUBBLE_OFFSET_Y = 0.22;
const SMOOTHING_SPEED = 10;
const SCREEN_CLAMP_MARGIN = 8;
const VISIBILITY_FADE_SPEED = 8;
const OFFSCREEN_MARGIN = 40;
export class FuturebolPlayerMarketBubble {
    constructor(canvas) {
        this.smoothedX = 0;
        this.smoothedY = 0;
        this.currentOpacity = 0;
        this.currentOwnerId = null;
        this.lastScreenWidth = 0;
        this.lastScreenHeight = 0;
        this.disposed = false;
        const parent = canvas.parentElement;
        if (!parent)
            throw new Error("Market bubble requires canvas.parentElement");
        if (getComputedStyle(parent).position === "static")
            parent.style.position = "relative";
        this.host = parent;
        this.el = document.createElement("div");
        this.el.className = "futurebol-player-market-bubble";
        this.el.style.cssText = "position:absolute;pointer-events:none;z-index:15;opacity:0;transform:translate(-50%,-100%) translateY(-12px);transition:opacity 150ms ease;will-change:transform,opacity;";
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
    update(input, screenW, screenH, deltaSeconds) {
        if (this.disposed)
            return;
        this.lastScreenWidth = screenW;
        this.lastScreenHeight = screenH;
        const hasOwner = input.visible
            && input.ownerPlayerId !== null
            && input.ownerTeam !== null;
        const asset = input.asset;
        const hasPercent = asset !== null && isFinite(asset.changePercent);
        const hasPrice = asset !== null && isFinite(asset.price) && asset.price > 0;
        const hasData = hasPercent || hasPrice;
        const isOffscreen = hasOwner && (input.headScreenX < -OFFSCREEN_MARGIN ||
            input.headScreenX > screenW + OFFSCREEN_MARGIN ||
            input.headScreenY < -OFFSCREEN_MARGIN ||
            input.headScreenY > screenH + OFFSCREEN_MARGIN);
        const shouldBeVisible = hasOwner && hasData && !isOffscreen;
        const targetOpacity = shouldBeVisible ? 1 : 0;
        const fadeStep = deltaSeconds > 0 ? VISIBILITY_FADE_SPEED * deltaSeconds : 0;
        this.currentOpacity = approach(this.currentOpacity, targetOpacity, fadeStep);
        if (this.currentOpacity < 0.01) {
            this.el.style.opacity = "0";
            this.currentOwnerId = null;
            return;
        }
        if (input.ownerPlayerId !== this.currentOwnerId) {
            this.currentOwnerId = input.ownerPlayerId;
            this.smoothedX = input.headScreenX;
            this.smoothedY = input.headScreenY;
        }
        const blend = deltaSeconds > 0
            ? 1 - Math.exp(-SMOOTHING_SPEED * Math.min(deltaSeconds, 0.1))
            : 0;
        this.smoothedX = lerp(this.smoothedX, input.headScreenX, blend);
        this.smoothedY = lerp(this.smoothedY, input.headScreenY, blend);
        let sx = clamp(this.smoothedX, SCREEN_CLAMP_MARGIN, screenW - SCREEN_CLAMP_MARGIN);
        let sy = clamp(this.smoothedY - BUBBLE_OFFSET_Y * screenH * 0.08, SCREEN_CLAMP_MARGIN, screenH - SCREEN_CLAMP_MARGIN);
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
        const accentColor = input.ownerTeam === "home" ? "#ff8c14" : "#14b8e0";
        this.el.style.setProperty("--bubble-accent", accentColor);
        this.el.style.left = `${sx}px`;
        this.el.style.top = `${sy}px`;
        this.el.style.opacity = String(clamp(this.currentOpacity, 0, 1));
    }
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.el.remove();
    }
    getDiagnostics() {
        return {
            ownerPlayerId: this.currentOwnerId,
            ownerTeam: null,
            price: null,
            changePercent: null,
            screenX: this.smoothedX,
            screenY: this.smoothedY,
            visible: this.currentOpacity > 0.5
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
function approach(current, target, maxStep) {
    if (maxStep <= 0)
        return current;
    const diff = target - current;
    if (Math.abs(diff) <= maxStep)
        return target;
    return current + Math.sign(diff) * maxStep;
}
