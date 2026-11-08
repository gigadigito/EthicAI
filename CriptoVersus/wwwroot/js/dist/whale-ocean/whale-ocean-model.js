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
    return clampVisualEntityCount(18 + normalizeActivity(quote, baseline) * 80 + pressureStrength * 55, quality);
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
    const limits = { Low: 180, Medium: 520, High: 1100 };
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
