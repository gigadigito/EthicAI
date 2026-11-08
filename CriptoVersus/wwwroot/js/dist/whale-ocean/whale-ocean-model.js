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
