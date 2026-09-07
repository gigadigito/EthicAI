import type { DynamicTexture, Mesh, Scene, StandardMaterial } from "babylonjs";
import { FUTUREBOL_FIELD } from "./futurebol-match-rules.js";
import type { FuturebolAssetState, FuturebolMarketSnapshot, FuturebolQuality, FuturebolTeam, FuturebolTeamVisualConfigurationMap } from "./futurebol-types.js";

type BabylonApi = typeof import("babylonjs");
export interface FuturebolAdvertisingMessage {
    type: "market" | "team" | "system" | "match" | "news";
    text: string;
    team?: FuturebolTeam;
    percentage?: string;
    percentageColor?: string;
    accentColor?: string;
}
export interface FuturebolAdvertisingInput {
    home: FuturebolAssetState | null;
    away: FuturebolAssetState | null;
    headlines?: readonly string[];
    matchMessage?: string;
    locale?: string;
    extraMarkets?: readonly FuturebolAssetState[];
}
const phrases: Record<string, readonly string[]> = {
    en: ["CRYPTO NEVER SLEEPS", "THE MARKET IS THE MATCH", "PRICE MOVES. PLAYERS MOVE."],
    pt: ["CRIPTO NÃO DORME", "O MERCADO É O JOGO", "PREÇOS MOVEM O JOGO"],
    zh: ["加密市场永不眠", "市场就是比赛", "价格驱动比赛"]
};
export function advertisingQuality(quality: FuturebolQuality) {
    return quality === "High" ? { count: 5, width: 1024, height: 224 }
        : quality === "Medium" ? { count: 3, width: 768, height: 112 }
        : { count: 3, width: 512, height: 76 };
}
const FALLBACK_EXTRAS: readonly FuturebolAssetState[] = [
    { symbol: "BTC", price: 56234.20, changePercent: 2.31, momentum: 50, volumeStrength: 50 },
    { symbol: "ETH", price: 3125.40, changePercent: -1.12, momentum: 50, volumeStrength: 50 },
    { symbol: "SOL", price: 145.20, changePercent: 4.88, momentum: 50, volumeStrength: 50 },
    { symbol: "DOGE", price: 0.124, changePercent: 6.42, momentum: 50, volumeStrength: 50 },
    { symbol: "XRP", price: 0.61, changePercent: -0.94, momentum: 50, volumeStrength: 50 },
];
export function advertisingPrice(price: number | undefined): string {
    if (price === undefined || !Number.isFinite(price) || price < 0) return "—";
    // Same precision policy as the current market bubble, with grouping for large prices.
    const digits = price >= 1 ? 2 : price >= 0.01 ? 3 : 4;
    return "$" + price.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
export function advertisingPercentage(value: number | undefined) {
    if (value === undefined || !Number.isFinite(value)) return { text: "—", color: "#b7c7d8" };
    const rounded = Math.round(value * 100) / 100;
    return { text: `${rounded > 0 ? "▲ +" : rounded < 0 ? "▼ " : ""}${rounded.toFixed(2)}%`,
        color: rounded > 0 ? "#3fffb0" : rounded < 0 ? "#ff6673" : "#b7c7d8" };
}
export function advertisingMessage(input: FuturebolAdvertisingInput, teams: FuturebolTeamVisualConfigurationMap,
    rotation: number): FuturebolAdvertisingMessage {
    const slot = ((rotation % 8) + 8) % 8;
    const cycle = Math.floor(rotation / 8);
    const localized = phrases[(input.locale ?? "en").split("-")[0]] ?? phrases.en;
    if (slot === 0 || slot === 4) {
        const team = "home" as const;
        const asset = input[team];
        const percentage = advertisingPercentage(asset?.changePercent);
        return { type: "market", team, text: `${teams[team].symbol}  ${advertisingPrice(asset?.price)}`,
            percentage: percentage.text, percentageColor: percentage.color };
    }
    if (slot === 2 || slot === 6) {
        const team = "away" as const;
        const asset = input[team];
        const percentage = advertisingPercentage(asset?.changePercent);
        return { type: "market", team, text: `${teams[team].symbol}  ${advertisingPrice(asset?.price)}`,
            percentage: percentage.text, percentageColor: percentage.color };
    }
    if (slot === 1) {
        if (input.headlines?.length) return { type: "news", text: input.headlines[cycle % input.headlines.length] };
        return { type: "system", text: "CRIPTO VERSUS" };
    }
    if (slot === 5) {
        if (input.matchMessage) return { type: "match", text: input.matchMessage };
        return { type: "system", text: localized[cycle % localized.length] };
    }
    const extraOffset = slot === 3 ? 0 : 1;
    const pool = input.extraMarkets?.length ? input.extraMarkets : FALLBACK_EXTRAS;
    const extras = pool.filter(asset =>
        asset.symbol !== teams.home.symbol && asset.symbol !== teams.away.symbol && Number.isFinite(asset.price) && asset.price >= 0);
    if (extras.length) {
        const asset = extras[(cycle + extraOffset) % extras.length];
        const percentage = advertisingPercentage(asset.changePercent);
        return { type: "market", text: `${asset.symbol}  ${advertisingPrice(asset.price)}`,
            percentage: percentage.text, percentageColor: percentage.color };
    }
    return { type: "system", text: localized[cycle % localized.length] };
}
export function fitAdvertisingText(text: string, maxWidth: number, measure: (text: string) => number): string {
    const characters = Array.from(text.replace(/\s+/g, " ").trim()).slice(0, 180);
    if (measure(characters.join("")) <= maxWidth) return characters.join("");
    while (characters.length && measure(characters.join("") + "…") > maxWidth) characters.pop();
    return characters.join("") + "…";
}

interface Board { mesh: Mesh; face: Mesh; material: StandardMaterial; texture: DynamicTexture; slot: number; text: string; }

/** Presentation only: borrows the player logo canvas; never owns or fetches a team logo. */
export class FuturebolLedAdvertising {
    private boards: Board[] = [];
    private elapsed = 0;
    private textureUpdates = 0;
    private disposed = false;
    private readonly recentMarkets = new Map<string, { asset: FuturebolAssetState; receivedAt: number }>();
    private backing: StandardMaterial;
    public constructor(private readonly B: BabylonApi, private readonly scene: Scene,
        private readonly teams: FuturebolTeamVisualConfigurationMap, private quality: FuturebolQuality,
        private readonly reducedMotion = false) {
        this.backing = new B.StandardMaterial("futurebol-led-backing", scene);
        this.backing.diffuseColor = B.Color3.FromHexString("#030b14");
        this.createBoards();
    }
    public setQuality(quality: FuturebolQuality): void {
        if (this.disposed || quality === this.quality) return;
        this.clearBoards();
        this.quality = quality;
        this.createBoards();
    }
    public reset(): void { this.elapsed = 0; for (const board of this.boards) board.slot = -1; }
    public observeMarket(snapshot: FuturebolMarketSnapshot, now = Date.now()): void {
        if (this.disposed) return;
        for (const asset of [snapshot.home, snapshot.away]) {
            if (!asset?.symbol || !Number.isFinite(asset.price) || asset.price < 0) continue;
            const symbol = asset.symbol.trim().toUpperCase();
            if (!symbol) continue;
            this.recentMarkets.delete(symbol);
            this.recentMarkets.set(symbol, { asset: { ...asset, symbol }, receivedAt: now });
        }
        while (this.recentMarkets.size > 16) this.recentMarkets.delete(this.recentMarkets.keys().next().value!);
    }
    public extraMarkets(now = Date.now()): FuturebolAssetState[] {
        for (const [symbol, entry] of this.recentMarkets) {
            if (now - entry.receivedAt > 300_000) this.recentMarkets.delete(symbol);
        }
        return [...this.recentMarkets.values()].map(entry => entry.asset).filter(asset =>
            asset.symbol !== this.teams.home.symbol && asset.symbol !== this.teams.away.symbol);
    }
    public update(deltaSeconds: number, input: FuturebolAdvertisingInput): void {
        if (this.disposed) return;
        this.elapsed += Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
        this.boards.forEach((board, index) => {
            const time = this.elapsed + index * 5.7;
            const slot = Math.floor(time / 5);
            if (slot !== board.slot) {
                board.slot = slot;
                this.draw(board, advertisingMessage({ ...input, extraMarkets: input.extraMarkets ?? this.extraMarkets() }, this.teams, slot));
            }
            const phase = time % 5;
            const brightness = this.reducedMotion ? 0.85 : 0.85 * Math.min(1, phase / 0.18, (5 - phase) / 0.18);
            board.texture.level = brightness;
        });
    }
    public diagnostics() {
        return { boards: this.boards.length, rotation: Math.floor(this.elapsed / 5),
            current: this.boards.map(board => board.text), textureUpdates: this.textureUpdates,
            extraSymbols: this.extraMarkets().map(asset => asset.symbol) };
    }
    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.clearBoards();
        this.backing.dispose();
        this.recentMarkets.clear();
    }
    private createBoards(): void {
        const B = this.B;
        const tier = advertisingQuality(this.quality);
        const span = FUTUREBOL_FIELD.halfLength * 0.80;
        const width = span / tier.count - 0.55;
        for (let index = 0; index < tier.count; index++) {
            const name = `futurebol-led-${index}`;
            const mesh = B.MeshBuilder.CreateBox(name, { width, height: 1.18, depth: 0.16 }, this.scene);
            // The foreground void is the near canopy, which occludes ground-level boards.
            // Mount on its top (arena canopy y=9.45, z=-21.7), below its pitch-facing edge in projection.
            mesh.position.set(-span / 2 + (index + 0.5) * span / tier.count, 10.08, -FUTUREBOL_FIELD.halfWidth - 5.8);
            mesh.rotation.x = 0.55;
            mesh.material = this.backing;
            mesh.isPickable = false;
            const face = B.MeshBuilder.CreatePlane(`${name}-face`, { width: width - 0.1, height: 1.08 }, this.scene);
            face.parent = mesh;
            face.position.z = -0.086;
            face.isPickable = false;
            const texture = new B.DynamicTexture(`${name}-texture`, { width: tier.width, height: tier.height }, this.scene, false);
            const material = new B.StandardMaterial(`${name}-material`, this.scene);
            material.diffuseColor = B.Color3.Black();
            material.specularColor = B.Color3.Black();
            material.emissiveTexture = texture;
            material.emissiveColor.set(0, 0, 0);
            material.disableLighting = true;
            face.material = material;
            this.boards.push({ mesh, face, texture, material, slot: -1, text: "" });
        }
    }
    private draw(board: Board, message: FuturebolAdvertisingMessage): void {
        const ctx = board.texture.getContext() as CanvasRenderingContext2D;
        const { width: w, height: h } = advertisingQuality(this.quality);
        ctx.fillStyle = "#030b14";
        ctx.fillRect(0, 0, w, h);
        const teamMaterial = message.team ? this.scene.materials.find(material =>
            material.name.startsWith(message.team + "-") && material.name.endsWith("-team")) as StandardMaterial | undefined : undefined;
        ctx.strokeStyle = message.accentColor ?? teamMaterial?.diffuseColor.toHexString() ?? "#197c92";
        ctx.lineWidth = 3;
        ctx.strokeRect(2, 2, w - 4, h - 4);
        let left = 18;
        if (message.team) {
            const logo = this.scene.getMaterialByName(`futurebol-${message.team}-logo-material`) as StandardMaterial | null;
            const texture = logo?.diffuseTexture;
            if (texture && texture instanceof this.B.DynamicTexture) {
                ctx.drawImage(texture.getContext().canvas as HTMLCanvasElement, left, h * 0.12, h * 0.76, h * 0.76);
                left += h * 0.88;
            }
        }
        const stacked = this.quality === "High" && !!message.percentage;
        ctx.font = `bold ${Math.round(h * (stacked ? 0.32 : 0.43))}px Arial, sans-serif`;
        ctx.textBaseline = "middle";
        const percentWidth = message.percentage && !stacked ? ctx.measureText(message.percentage).width + 24 : 0;
        ctx.fillStyle = "#eafcff";
        const text = fitAdvertisingText(message.text, w - left - percentWidth - 18, value => ctx.measureText(value).width);
        ctx.fillText(text, left, h * (stacked ? 0.3 : 0.52));
        if (message.percentage) {
            ctx.fillStyle = message.percentageColor ?? "#b7c7d8";
            ctx.fillText(message.percentage, stacked ? left : w - percentWidth, h * (stacked ? 0.73 : 0.52));
        }
        ctx.fillStyle = "rgba(3,11,20,0.12)";
        for (let y = 4; y < h; y += 4) ctx.fillRect(4, y, w - 8, 1);
        board.texture.update(true);
        board.text = `${text} ${message.percentage ?? ""}`.trim();
        this.textureUpdates++;
    }
    private clearBoards(): void {
        for (const board of this.boards) {
            board.face.dispose();
            board.mesh.dispose();
            board.material.dispose(false, false);
            board.texture.dispose();
        }
        this.boards = [];
    }
}
