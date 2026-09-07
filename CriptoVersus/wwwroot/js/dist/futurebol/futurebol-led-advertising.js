import { FUTUREBOL_FIELD } from "./futurebol-match-rules.js";
const phrases = {
    en: ["CRYPTO NEVER SLEEPS", "THE MARKET IS THE MATCH", "PRICE MOVES. PLAYERS MOVE."],
    pt: ["CRIPTO NÃO DORME", "O MERCADO É O JOGO", "PREÇOS MOVEM O JOGO"],
    zh: ["加密市场永不眠", "市场就是比赛", "价格驱动比赛"]
};
export function advertisingQuality(quality) {
    return quality === "High" ? { count: 5, width: 1024, height: 256 }
        : quality === "Medium" ? { count: 3, width: 768, height: 128 }
            : { count: 3, width: 512, height: 84 };
}
export function advertisingPrice(price) {
    if (price === undefined || !Number.isFinite(price) || price < 0)
        return "—";
    // Same precision policy as the current market bubble, with grouping for large prices.
    const digits = price >= 1 ? 2 : price >= 0.01 ? 3 : 4;
    return "$" + price.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
export function advertisingPercentage(value) {
    if (value === undefined || !Number.isFinite(value))
        return { text: "—", color: "#b7c7d8" };
    const rounded = Math.round(value * 100) / 100;
    return { text: `${rounded > 0 ? "▲ +" : rounded < 0 ? "▼ " : ""}${rounded.toFixed(2)}%`,
        color: rounded > 0 ? "#3fffb0" : rounded < 0 ? "#ff6673" : "#b7c7d8" };
}
export function advertisingMessage(input, teams, rotation) {
    const slot = ((rotation % 8) + 8) % 8;
    const cycle = Math.floor(rotation / 8);
    const localized = phrases[(input.locale ?? "en").split("-")[0]] ?? phrases.en;
    if (slot === 0 || slot === 4) {
        const team = "home";
        const asset = input[team];
        const percentage = advertisingPercentage(asset?.changePercent);
        return { type: "market", team, text: `${teams[team].symbol}  ${advertisingPrice(asset?.price)}`,
            percentage: percentage.text, percentageColor: percentage.color };
    }
    if (slot === 2 || slot === 6) {
        const team = "away";
        const asset = input[team];
        const percentage = advertisingPercentage(asset?.changePercent);
        return { type: "market", team, text: `${teams[team].symbol}  ${advertisingPrice(asset?.price)}`,
            percentage: percentage.text, percentageColor: percentage.color };
    }
    if (slot === 1) {
        if (input.headlines?.length)
            return { type: "news", text: input.headlines[cycle % input.headlines.length] };
        return { type: "system", text: "CRIPTO VERSUS" };
    }
    if (slot === 5) {
        if (input.matchMessage)
            return { type: "match", text: input.matchMessage };
        return { type: "system", text: localized[cycle % localized.length] };
    }
    const extraOffset = slot === 3 ? 0 : 1;
    const pool = input.extraMarkets ?? [];
    const extras = pool.filter(asset => asset.symbol !== teams.home.symbol && asset.symbol !== teams.away.symbol && Number.isFinite(asset.price) && asset.price >= 0);
    if (extras.length) {
        const asset = extras[(cycle + extraOffset) % extras.length];
        const percentage = advertisingPercentage(asset.changePercent);
        return { type: "market", text: `${asset.symbol}  ${advertisingPrice(asset.price)}`,
            percentage: percentage.text, percentageColor: percentage.color };
    }
    return { type: "system", text: localized[cycle % localized.length] };
}
export function fitAdvertisingText(text, maxWidth, measure) {
    const characters = Array.from(text.replace(/\s+/g, " ").trim()).slice(0, 180);
    if (measure(characters.join("")) <= maxWidth)
        return characters.join("");
    while (characters.length && measure(characters.join("") + "…") > maxWidth)
        characters.pop();
    return characters.join("") + "…";
}
/** Presentation only: borrows the player logo canvas; never owns or fetches a team logo. */
export class FuturebolLedAdvertising {
    constructor(B, scene, teams, quality, reducedMotion = false) {
        this.B = B;
        this.scene = scene;
        this.teams = teams;
        this.quality = quality;
        this.reducedMotion = reducedMotion;
        this.boards = [];
        this.elapsed = 0;
        this.textureUpdates = 0;
        this.disposed = false;
        this.extraLogElapsed = 0;
        this.recentMarkets = new Map();
        this.backing = new B.StandardMaterial("futurebol-led-backing", scene);
        this.backing.diffuseColor = B.Color3.FromHexString("#030b14");
        this.createBoards();
    }
    setQuality(quality) {
        if (this.disposed || quality === this.quality)
            return;
        this.clearBoards();
        this.quality = quality;
        this.createBoards();
    }
    reset() { this.elapsed = 0; for (const board of this.boards)
        board.slot = -1; }
    observeMarket(snapshot, now = Date.now()) {
        if (this.disposed)
            return;
        for (const asset of [snapshot.home, snapshot.away]) {
            if (!asset?.symbol || !Number.isFinite(asset.price) || asset.price < 0)
                continue;
            const symbol = asset.symbol.trim().toUpperCase();
            if (!symbol)
                continue;
            this.recentMarkets.delete(symbol);
            this.recentMarkets.set(symbol, { asset: { ...asset, symbol }, receivedAt: now });
        }
        while (this.recentMarkets.size > 16)
            this.recentMarkets.delete(this.recentMarkets.keys().next().value);
    }
    extraMarkets(now = Date.now()) {
        for (const [symbol, entry] of this.recentMarkets) {
            if (now - entry.receivedAt > 300000)
                this.recentMarkets.delete(symbol);
        }
        return [...this.recentMarkets.values()].map(entry => entry.asset).filter(asset => asset.symbol !== this.teams.home.symbol && asset.symbol !== this.teams.away.symbol);
    }
    update(deltaSeconds, input) {
        if (this.disposed)
            return;
        this.elapsed += Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
        this.extraLogElapsed += Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
        if (this.extraLogElapsed >= 10) {
            this.extraLogElapsed = 0;
            const extraSyms = (input.extraMarkets ?? []).filter(a => a.symbol !== this.teams.home.symbol && a.symbol !== this.teams.away.symbol &&
                Number.isFinite(a.price) && a.price >= 0).map(a => a.symbol);
            console.log(`[Futurebol][LED] extraMarketSource=${extraSyms.length ? "live" : "none"} extraSymbols=[${extraSyms.join(",")}]`);
        }
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
    diagnostics() {
        return { boards: this.boards.length, rotation: Math.floor(this.elapsed / 5),
            current: this.boards.map(board => board.text), textureUpdates: this.textureUpdates,
            extraSymbols: this.extraMarkets().map(asset => asset.symbol) };
    }
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.clearBoards();
        this.backing.dispose();
        this.recentMarkets.clear();
    }
    createBoards() {
        const B = this.B;
        const tier = advertisingQuality(this.quality);
        const span = FUTUREBOL_FIELD.halfLength * 0.84;
        const gap = 0.85;
        const width = span / tier.count - gap;
        const boxHeight = 1.33;
        const faceHeight = 1.20;
        const posY = 10.15;
        console.log(`[Futurebol][LED] version=LED_ADVERTISING_V2 boards=${tier.count} span=${span.toFixed(1)} gap=${gap} boxHeight=${boxHeight} faceHeight=${faceHeight}`);
        for (let index = 0; index < tier.count; index++) {
            const name = `futurebol-led-${index}`;
            const mesh = B.MeshBuilder.CreateBox(name, { width, height: boxHeight, depth: 0.16 }, this.scene);
            // The foreground void is the near canopy, which occludes ground-level boards.
            // Mount on its top (arena canopy y=9.45, z=-21.7), below its pitch-facing edge in projection.
            mesh.position.set(-span / 2 + (index + 0.5) * span / tier.count, posY, -FUTUREBOL_FIELD.halfWidth - 5.8);
            mesh.rotation.x = 0.55;
            mesh.material = this.backing;
            mesh.isPickable = false;
            const face = B.MeshBuilder.CreatePlane(`${name}-face`, { width: width - 0.1, height: faceHeight }, this.scene);
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
    draw(board, message) {
        const ctx = board.texture.getContext();
        const { width: w, height: h } = advertisingQuality(this.quality);
        ctx.fillStyle = "#030b14";
        ctx.fillRect(0, 0, w, h);
        const teamMaterial = message.team ? this.scene.materials.find(material => material.name.startsWith(message.team + "-") && material.name.endsWith("-team")) : undefined;
        ctx.strokeStyle = message.accentColor ?? teamMaterial?.diffuseColor.toHexString() ?? "#197c92";
        ctx.lineWidth = 3;
        ctx.strokeRect(2, 2, w - 4, h - 4);
        let left = 18;
        if (message.team) {
            const logo = this.scene.getMaterialByName(`futurebol-${message.team}-logo-material`);
            const texture = logo?.diffuseTexture;
            if (texture && texture instanceof this.B.DynamicTexture) {
                ctx.drawImage(texture.getContext().canvas, left, h * 0.12, h * 0.76, h * 0.76);
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
        for (let y = 4; y < h; y += 4)
            ctx.fillRect(4, y, w - 8, 1);
        board.texture.update(true);
        board.text = `${text} ${message.percentage ?? ""}`.trim();
        this.textureUpdates++;
    }
    clearBoards() {
        for (const board of this.boards) {
            board.face.dispose();
            board.mesh.dispose();
            board.material.dispose(false, false);
            board.texture.dispose();
        }
        this.boards = [];
    }
}
