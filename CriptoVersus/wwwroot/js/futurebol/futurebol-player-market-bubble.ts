import type { FuturebolAssetState, FuturebolTeam } from "./futurebol-types.js";

const BUBBLE_OFFSET_Y = 0.22;
const SMOOTHING_SPEED = 10;
const SCREEN_CLAMP_MARGIN = 8;
const VISIBILITY_FADE_SPEED = 8;
const OFFSCREEN_MARGIN = 40;

export interface FuturebolPlayerMarketBubbleInput {
    ownerPlayerId: string | null;
    ownerTeam: FuturebolTeam | null;
    asset: FuturebolAssetState | null;
    headScreenX: number;
    headScreenY: number;
    visible: boolean;
}

export interface FuturebolPlayerMarketBubbleDiagnostics {
    ownerPlayerId: string | null;
    ownerTeam: FuturebolTeam | null;
    price: number | null;
    changePercent: number | null;
    screenX: number;
    screenY: number;
    visible: boolean;
}

export class FuturebolPlayerMarketBubble {
    private readonly host: HTMLElement;
    private readonly el: HTMLDivElement;
    private readonly percentEl: HTMLSpanElement;
    private readonly priceEl: HTMLSpanElement;
    private readonly arrowEl: HTMLSpanElement;
    private smoothedX = 0;
    private smoothedY = 0;
    private currentOpacity = 0;
    private currentOwnerId: string | null = null;
    private lastScreenWidth = 0;
    private lastScreenHeight = 0;
    private disposed = false;

    public constructor(canvas: HTMLCanvasElement) {
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

    public update(
        input: FuturebolPlayerMarketBubbleInput,
        screenW: number,
        screenH: number,
        deltaSeconds: number
    ): void {
        if (this.disposed) return;

        this.lastScreenWidth = screenW;
        this.lastScreenHeight = screenH;

        const hasOwner = input.visible
            && input.ownerPlayerId !== null
            && input.ownerTeam !== null;

        const asset = input.asset;
        const hasPercent = asset !== null && isFinite(asset.changePercent);
        const hasPrice = asset !== null && isFinite(asset.price) && asset.price > 0;
        const hasData = hasPercent || hasPrice;

        const isOffscreen = hasOwner && (
            input.headScreenX < -OFFSCREEN_MARGIN ||
            input.headScreenX > screenW + OFFSCREEN_MARGIN ||
            input.headScreenY < -OFFSCREEN_MARGIN ||
            input.headScreenY > screenH + OFFSCREEN_MARGIN
        );

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
            const sign = asset!.changePercent >= 0 ? "+" : "";
            this.percentEl.textContent = `${sign}${formatPercent(asset!.changePercent)}`;
            this.percentEl.className = "futurebol-player-market-bubble__percent" +
                (asset!.changePercent >= 0
                    ? " futurebol-player-market-bubble__percent--positive"
                    : " futurebol-player-market-bubble__percent--negative");
        } else {
            this.percentEl.textContent = "";
        }

        if (hasPrice) {
            this.priceEl.textContent = `$${formatPrice(asset!.price)}`;
        } else {
            this.priceEl.textContent = "";
        }

        const accentColor = input.ownerTeam === "home" ? "#ff8c14" : "#14b8e0";
        this.el.style.setProperty("--bubble-accent", accentColor);

        this.el.style.left = `${sx}px`;
        this.el.style.top = `${sy}px`;
        this.el.style.opacity = String(clamp(this.currentOpacity, 0, 1));
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.el.remove();
    }

    public getDiagnostics(): FuturebolPlayerMarketBubbleDiagnostics {
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

function formatPercent(value: number): string {
    return `${Math.abs(value).toFixed(2)}%`;
}

function formatPrice(value: number): string {
    if (value >= 1) return value.toFixed(2);
    if (value >= 0.01) return value.toFixed(3);
    return value.toFixed(4);
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function lerp(from: number, to: number, t: number): number {
    return from + (to - from) * clamp(t, 0, 1);
}

function approach(current: number, target: number, maxStep: number): number {
    if (maxStep <= 0) return current;
    const diff = target - current;
    if (Math.abs(diff) <= maxStep) return target;
    return current + Math.sign(diff) * maxStep;
}
