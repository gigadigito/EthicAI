export const DEFAULT_WHALE_OCEAN_VISUAL_BUDGET = {
    maxVisibleAnimals: 24,
    maxLargeHighlightsPerTerritory: 2,
    maxSchoolAnimalsPerGroup: 6,
    maxOccupancyPerTerritory: 14,
    windowMs: 30000
};
export const WHALE_OCEAN_SIZE_CATEGORIES = {
    small: { minPx: 45, maxPx: 65 },
    medium: { minPx: 70, maxPx: 95 },
    large: { minPx: 100, maxPx: 135 },
    shark: { minPx: 145, maxPx: 185 },
    whale: { minPx: 190, maxPx: 240 }
};
export function sizeCategoryForKind(kind) {
    switch (kind) {
        case "shark": return "shark";
        case "whale": return "whale";
        case "tuna":
        case "swordfish": return "large";
        case "snook":
        case "grouper":
        case "barracuda": return "medium";
        default: return "small";
    }
}
export const WHALE_OCEAN_SPECIES = {
    sardine: { kind: "sardine", name: "Sardinha", financialLevel: 1, bodyLengthPx: 50, swimSpeed: 1.18, fps: 12 },
    bluefish: { kind: "bluefish", name: "Peixe-azul", financialLevel: 2, bodyLengthPx: 57, swimSpeed: 1.12, fps: 12 },
    mackerel: { kind: "mackerel", name: "Cavala", financialLevel: 3, bodyLengthPx: 64, swimSpeed: 1.08, fps: 12 },
    snook: { kind: "snook", name: "Robalo", financialLevel: 4, bodyLengthPx: 78, swimSpeed: 1.02, fps: 12 },
    grouper: { kind: "grouper", name: "Garoupa", financialLevel: 5, bodyLengthPx: 85, swimSpeed: 0.96, fps: 12 },
    barracuda: { kind: "barracuda", name: "Barracuda", financialLevel: 6, bodyLengthPx: 94, swimSpeed: 1.08, fps: 12 },
    tuna: { kind: "tuna", name: "Atum", financialLevel: 7, bodyLengthPx: 112, swimSpeed: 1.0, fps: 12 },
    swordfish: { kind: "swordfish", name: "Peixe-espada", financialLevel: 8, bodyLengthPx: 130, swimSpeed: 1.03, fps: 12 },
    shark: { kind: "shark", name: "Tubarão", financialLevel: 9, bodyLengthPx: 165, swimSpeed: 0.92, fps: 12 },
    whale: { kind: "whale", name: "Baleia", financialLevel: 10, bodyLengthPx: 215, swimSpeed: 0.76, fps: 12 }
};
export const WHALE_OCEAN_FLOW_SPECIES = [
    "sardine", "bluefish", "mackerel", "snook", "grouper", "barracuda", "tuna", "swordfish"
];
const FLOW_TIER_THRESHOLDS = [0.35, 0.55, 0.78, 1.08, 1.48, 2.0, 2.8];
export function animalKindForVisualTier(tier) {
    switch (tier) {
        case "whale": return "swordfish";
        case "large": return "tuna";
        case "medium": return "grouper";
        case "small": return "mackerel";
        default: return "sardine";
    }
}
export function animalKindForEvent(kind) {
    return kind === "whale" ? "whale" : "shark";
}
export function isLargeAnimalKind(kind) {
    return kind === "tuna" || kind === "swordfish" || kind === "shark" || kind === "whale";
}
export function isHighlightAnimalKind(kind) {
    return kind === "shark" || kind === "whale";
}
/** BUY always swims to the right and SELL always swims to the left. */
export function swimDirectionForSide(side) {
    return side === "buy" ? "right" : "left";
}
/**
 * Money-flow batches currently carry a symbol, not an explicit quote-currency
 * field. Keep this suffix list conservative so labels never claim a currency
 * that cannot be inferred from the public symbol contract.
 */
export function quoteCurrencyForSymbol(symbol) {
    const normalized = symbol.trim().toUpperCase();
    const knownQuotes = ["USDT", "USDC", "BUSD", "FDUSD", "TUSD", "USDP", "DAI", "BTC", "ETH", "BNB", "SOL", "EUR", "BRL", "TRY", "GBP", "JPY", "AUD"];
    return knownQuotes.find(quote => normalized.endsWith(quote)) ?? null;
}
/**
 * Maps an aggregated Money Flow lot to one of the eight non-exceptional species.
 * The comparison is symbol-local and has a seven-percent hysteresis band so a
 * normal fluctuation around a boundary does not make a school flicker species.
 */
export function animalKindForFinancialVolume(notional, baseline, previous) {
    const safeNotional = Number.isFinite(notional) && notional > 0 ? notional : 0;
    const safeBaseline = Number.isFinite(baseline) && baseline > 0 ? baseline : Math.max(safeNotional, 1);
    const relative = safeNotional / safeBaseline;
    const nextIndex = FLOW_TIER_THRESHOLDS.findIndex(threshold => relative < threshold);
    const classifiedIndex = nextIndex < 0 ? WHALE_OCEAN_FLOW_SPECIES.length - 1 : nextIndex;
    if (!previous)
        return WHALE_OCEAN_FLOW_SPECIES[classifiedIndex];
    const previousIndex = WHALE_OCEAN_FLOW_SPECIES.indexOf(previous);
    if (previousIndex < 0)
        return WHALE_OCEAN_FLOW_SPECIES[classifiedIndex];
    const lower = previousIndex === 0 ? 0 : FLOW_TIER_THRESHOLDS[previousIndex - 1] * 0.93;
    const upper = previousIndex === FLOW_TIER_THRESHOLDS.length ? Number.POSITIVE_INFINITY : FLOW_TIER_THRESHOLDS[previousIndex] * 1.07;
    return relative >= lower && relative < upper ? previous : WHALE_OCEAN_FLOW_SPECIES[classifiedIndex];
}
export function takerSideFromBuyerIsMaker(buyerIsMaker) {
    return buyerIsMaker ? "sell" : "buy";
}
export function quoteNotional(price, quantity) {
    if (!Number.isFinite(price) || !Number.isFinite(quantity) || price < 0 || quantity < 0)
        return 0;
    return price * quantity;
}
export function computePressure(buyQuote, sellQuote) {
    const buy = Number.isFinite(buyQuote) && buyQuote > 0 ? buyQuote : 0;
    const sell = Number.isFinite(sellQuote) && sellQuote > 0 ? sellQuote : 0;
    const total = buy + sell;
    if (total <= 0)
        return { buy: null, sell: null, totalQuote: 0 };
    return { buy: buy / total, sell: sell / total, totalQuote: total };
}
export function normalizeActivity(value, baseline) {
    if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(baseline) || baseline <= 0)
        return 0;
    return Math.min(1, Math.log1p(value / baseline) / Math.log1p(8));
}
export function visualDensity(quote, baseline, pressure, quality) {
    if (!Number.isFinite(quote) || quote <= 0)
        return 0;
    const pressureStrength = pressure ?? 0;
    const qualityLimit = { Low: 7, Medium: 10, High: 12 }[quality];
    return Math.max(1, Math.min(qualityLimit, Math.round(1 + normalizeActivity(quote, baseline) * 6 + pressureStrength * 2)));
}
/** Presentation profile for a bounded, individually readable flow fish. */
export function visualProfile(notional, baseline) {
    const safeNotional = Number.isFinite(notional) && notional > 0 ? notional : 0;
    const safeBaseline = Number.isFinite(baseline) && baseline > 0 ? baseline : safeNotional;
    const relativeVolume = safeBaseline > 0 ? safeNotional / safeBaseline : 0;
    const normalized = normalizeActivity(safeNotional, safeBaseline);
    let tier = "micro";
    if (relativeVolume >= 6)
        tier = "whale";
    else if (relativeVolume >= 3)
        tier = "large";
    else if (relativeVolume >= 1.75)
        tier = "medium";
    else if (relativeVolume >= 1.25)
        tier = "small";
    const profiles = {
        micro: { size: 0.1, durationMs: 3800, trailLength: 0.35, showLabel: false },
        small: { size: 0.14, durationMs: 5200, trailLength: 0.65, showLabel: false },
        medium: { size: 0.21, durationMs: 7000, trailLength: 1.05, showLabel: true },
        large: { size: 0.31, durationMs: 9000, trailLength: 1.55, showLabel: true },
        whale: { size: 0.46, durationMs: 11000, trailLength: 2.2, showLabel: true }
    };
    return {
        tier,
        kind: animalKindForFinancialVolume(safeNotional, safeBaseline),
        relativeVolume,
        intensity: Math.min(1, 0.2 + normalized * 0.8),
        ...profiles[tier]
    };
}
export function formatCompactVolume(value) {
    if (!Number.isFinite(value) || value <= 0)
        return "—";
    const absolute = Math.abs(value);
    if (absolute >= 1000000000)
        return `${trimCompact(value / 1000000000)}B`;
    if (absolute >= 1000000)
        return `${trimCompact(value / 1000000)}M`;
    if (absolute >= 1000)
        return `${trimCompact(value / 1000)}K`;
    return trimCompact(value);
}
function trimCompact(value) {
    return value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
export function clampVisualEntityCount(value, quality) {
    const limits = { Low: 12, Medium: 18, High: 24 };
    return Math.max(0, Math.min(limits[quality], Math.round(Number.isFinite(value) ? value : 0)));
}
function parseQuote(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
function percentile(values, fraction) {
    if (values.length === 0)
        return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((sorted.length - 1) * fraction)));
    return sorted[index];
}
/**
 * Presentation-only detector. It compares each symbol with its own recent
 * distribution, never with a fixed dollar threshold shared by all assets.
 */
export class VolumeEventDetector {
    constructor(options = {}) {
        this.histories = new Map();
        this.lastEventAt = new Map();
        this.historySize = Math.max(8, options.historySize ?? 60);
        this.minimumSamples = Math.max(4, options.minimumSamples ?? 12);
        this.cooldownMs = Math.max(500, options.cooldownMs ?? 4000);
    }
    ingest(batch, nowMs = Date.parse(batch.eventTimeUtc)) {
        const symbol = batch.symbol.trim().toUpperCase();
        if (!symbol || batch.isReplay || batch.isPartial)
            return null;
        const buy = parseQuote(batch.takerBuyQuote);
        const sell = parseQuote(batch.takerSellQuote);
        const total = buy + sell;
        if (total <= 0 || !Number.isFinite(total))
            return null;
        const history = this.histories.get(symbol) ?? { samples: [], lastSequence: 0 };
        if (batch.sequence <= history.lastSequence)
            return null;
        const prior = history.samples;
        history.lastSequence = batch.sequence;
        const baseline = prior.length > 0 ? prior.reduce((sum, value) => sum + value, 0) / prior.length : 0;
        const p90 = percentile(prior, 0.9);
        const p95 = percentile(prior, 0.95);
        prior.push(total);
        while (prior.length > this.historySize)
            prior.shift();
        this.histories.set(symbol, history);
        if (history.samples.length < this.minimumSamples || baseline <= 0)
            return null;
        const ratio = total / baseline;
        const whale = ratio >= 8 && total >= Math.max(baseline * 4, p95 * 2);
        const shark = !whale && ratio >= 4 && total >= Math.max(baseline * 2, p90 * 1.25);
        if (!whale && !shark)
            return null;
        const side = buy >= sell ? "buy" : "sell";
        const eventKey = `${symbol}:${side}`;
        const timestamp = Number.isFinite(nowMs) ? nowMs : Date.now();
        const last = this.lastEventAt.get(eventKey);
        if (last !== undefined && timestamp - last < this.cooldownMs)
            return null;
        this.lastEventAt.set(eventKey, timestamp);
        return {
            id: `${symbol}:${batch.sequence}`,
            kind: whale ? "whale" : "shark",
            symbol,
            side,
            notionalUsdt: total,
            ratio,
            sequence: batch.sequence,
            eventTimeUtc: batch.eventTimeUtc
        };
    }
}
