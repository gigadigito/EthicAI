export type WhaleOceanSide = "buy" | "sell";
export type WhaleOceanEventKind = "shark" | "whale";
export type WhaleOceanVisualTier = "micro" | "small" | "medium" | "large" | "whale";
export type WhaleOceanFlowAnimalKind = "sardine" | "bluefish" | "mackerel" | "snook" | "grouper" | "barracuda" | "tuna" | "swordfish";
export type WhaleOceanAnimalKind = WhaleOceanFlowAnimalKind | "shark" | "whale";

export interface WhaleOceanSpecies {
    kind: WhaleOceanAnimalKind;
    name: string;
    financialLevel: number;
    visualLength: number;
    swimSpeed: number;
    fps: number;
}

export const WHALE_OCEAN_SPECIES: Readonly<Record<WhaleOceanAnimalKind, WhaleOceanSpecies>> = {
    sardine: { kind: "sardine", name: "Sardinha", financialLevel: 1, visualLength: 0.76, swimSpeed: 1.18, fps: 12 },
    bluefish: { kind: "bluefish", name: "Peixe-azul", financialLevel: 2, visualLength: 1.02, swimSpeed: 1.12, fps: 12 },
    mackerel: { kind: "mackerel", name: "Cavala", financialLevel: 3, visualLength: 1.32, swimSpeed: 1.08, fps: 12 },
    snook: { kind: "snook", name: "Robalo", financialLevel: 4, visualLength: 1.74, swimSpeed: 1.02, fps: 12 },
    grouper: { kind: "grouper", name: "Garoupa", financialLevel: 5, visualLength: 2.25, swimSpeed: 0.96, fps: 12 },
    barracuda: { kind: "barracuda", name: "Barracuda", financialLevel: 6, visualLength: 2.9, swimSpeed: 1.08, fps: 12 },
    tuna: { kind: "tuna", name: "Atum", financialLevel: 7, visualLength: 3.8, swimSpeed: 1.0, fps: 12 },
    swordfish: { kind: "swordfish", name: "Peixe-espada", financialLevel: 8, visualLength: 5.05, swimSpeed: 1.03, fps: 12 },
    shark: { kind: "shark", name: "Tubarão", financialLevel: 9, visualLength: 6.7, swimSpeed: 0.92, fps: 12 },
    whale: { kind: "whale", name: "Baleia", financialLevel: 10, visualLength: 10.6, swimSpeed: 0.76, fps: 12 }
};

export const WHALE_OCEAN_FLOW_SPECIES: readonly WhaleOceanFlowAnimalKind[] = [
    "sardine", "bluefish", "mackerel", "snook", "grouper", "barracuda", "tuna", "swordfish"
];

const FLOW_TIER_THRESHOLDS = [0.35, 0.55, 0.78, 1.08, 1.48, 2.0, 2.8] as const;

export interface WhaleOceanBatch {
    matchId: number;
    symbol: string;
    sequence: number;
    eventTimeUtc: string;
    tradeCount: number;
    takerBuyQuote: string;
    takerSellQuote: string;
    lastPrice: string;
    isPartial: boolean;
    isReplay?: boolean;
}

export interface WhaleOceanPressure {
    buy: number | null;
    sell: number | null;
    totalQuote: number;
}

export interface WhaleOceanEvent {
    id: string;
    kind: WhaleOceanEventKind;
    symbol: string;
    side: WhaleOceanSide;
    notionalUsdt: number;
    ratio: number;
    sequence: number;
    eventTimeUtc: string;
}

export interface WhaleOceanVisualProfile {
    tier: WhaleOceanVisualTier;
    kind: WhaleOceanFlowAnimalKind;
    relativeVolume: number;
    intensity: number;
    size: number;
    durationMs: number;
    trailLength: number;
    showLabel: boolean;
}

export function animalKindForVisualTier(tier: WhaleOceanVisualTier): WhaleOceanFlowAnimalKind {
    switch (tier) {
        case "whale": return "swordfish";
        case "large": return "tuna";
        case "medium": return "grouper";
        case "small": return "mackerel";
        default: return "sardine";
    }
}

export function animalKindForEvent(kind: WhaleOceanEventKind): WhaleOceanAnimalKind {
    return kind === "whale" ? "whale" : "shark";
}

/**
 * Maps an aggregated Money Flow lot to one of the eight non-exceptional species.
 * The comparison is symbol-local and has a seven-percent hysteresis band so a
 * normal fluctuation around a boundary does not make a school flicker species.
 */
export function animalKindForFinancialVolume(notional: number, baseline: number, previous?: WhaleOceanFlowAnimalKind): WhaleOceanFlowAnimalKind {
    const safeNotional = Number.isFinite(notional) && notional > 0 ? notional : 0;
    const safeBaseline = Number.isFinite(baseline) && baseline > 0 ? baseline : Math.max(safeNotional, 1);
    const relative = safeNotional / safeBaseline;
    const nextIndex = FLOW_TIER_THRESHOLDS.findIndex(threshold => relative < threshold);
    const classifiedIndex = nextIndex < 0 ? WHALE_OCEAN_FLOW_SPECIES.length - 1 : nextIndex;
    if (!previous) return WHALE_OCEAN_FLOW_SPECIES[classifiedIndex];

    const previousIndex = WHALE_OCEAN_FLOW_SPECIES.indexOf(previous);
    if (previousIndex < 0) return WHALE_OCEAN_FLOW_SPECIES[classifiedIndex];
    const lower = previousIndex === 0 ? 0 : FLOW_TIER_THRESHOLDS[previousIndex - 1] * 0.93;
    const upper = previousIndex === FLOW_TIER_THRESHOLDS.length ? Number.POSITIVE_INFINITY : FLOW_TIER_THRESHOLDS[previousIndex] * 1.07;
    return relative >= lower && relative < upper ? previous : WHALE_OCEAN_FLOW_SPECIES[classifiedIndex];
}

export function takerSideFromBuyerIsMaker(buyerIsMaker: boolean): WhaleOceanSide {
    return buyerIsMaker ? "sell" : "buy";
}

export function quoteNotional(price: number, quantity: number): number {
    if (!Number.isFinite(price) || !Number.isFinite(quantity) || price < 0 || quantity < 0)
        return 0;
    return price * quantity;
}

export function computePressure(buyQuote: number, sellQuote: number): WhaleOceanPressure {
    const buy = Number.isFinite(buyQuote) && buyQuote > 0 ? buyQuote : 0;
    const sell = Number.isFinite(sellQuote) && sellQuote > 0 ? sellQuote : 0;
    const total = buy + sell;
    if (total <= 0)
        return { buy: null, sell: null, totalQuote: 0 };

    return { buy: buy / total, sell: sell / total, totalQuote: total };
}

export function normalizeActivity(value: number, baseline: number): number {
    if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(baseline) || baseline <= 0)
        return 0;
    return Math.min(1, Math.log1p(value / baseline) / Math.log1p(8));
}

export function visualDensity(
    quote: number,
    baseline: number,
    pressure: number | null,
    quality: "Low" | "Medium" | "High"
): number {
    if (!Number.isFinite(quote) || quote <= 0) return 0;
    const pressureStrength = pressure ?? 0;
    return clampVisualEntityCount(18 + normalizeActivity(quote, baseline) * 80 + pressureStrength * 55, quality);
}

/** Presentation profile for a bounded, individually readable flow fish. */
export function visualProfile(notional: number, baseline: number): WhaleOceanVisualProfile {
    const safeNotional = Number.isFinite(notional) && notional > 0 ? notional : 0;
    const safeBaseline = Number.isFinite(baseline) && baseline > 0 ? baseline : safeNotional;
    const relativeVolume = safeBaseline > 0 ? safeNotional / safeBaseline : 0;
    const normalized = normalizeActivity(safeNotional, safeBaseline);

    let tier: WhaleOceanVisualTier = "micro";
    if (relativeVolume >= 6) tier = "whale";
    else if (relativeVolume >= 3) tier = "large";
    else if (relativeVolume >= 1.75) tier = "medium";
    else if (relativeVolume >= 1.25) tier = "small";

    const profiles: Record<WhaleOceanVisualTier, Omit<WhaleOceanVisualProfile, "tier" | "kind" | "relativeVolume" | "intensity">> = {
        micro: { size: 0.1, durationMs: 3_800, trailLength: 0.35, showLabel: false },
        small: { size: 0.14, durationMs: 5_200, trailLength: 0.65, showLabel: false },
        medium: { size: 0.21, durationMs: 7_000, trailLength: 1.05, showLabel: true },
        large: { size: 0.31, durationMs: 9_000, trailLength: 1.55, showLabel: true },
        whale: { size: 0.46, durationMs: 11_000, trailLength: 2.2, showLabel: true }
    };

    return {
        tier,
        kind: animalKindForFinancialVolume(safeNotional, safeBaseline),
        relativeVolume,
        intensity: Math.min(1, 0.2 + normalized * 0.8),
        ...profiles[tier]
    };
}

export function formatCompactVolume(value: number): string {
    if (!Number.isFinite(value) || value <= 0) return "—";
    const absolute = Math.abs(value);
    if (absolute >= 1_000_000_000) return `${trimCompact(value / 1_000_000_000)}B`;
    if (absolute >= 1_000_000) return `${trimCompact(value / 1_000_000)}M`;
    if (absolute >= 1_000) return `${trimCompact(value / 1_000)}K`;
    return trimCompact(value);
}

function trimCompact(value: number): string {
    return value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function clampVisualEntityCount(value: number, quality: "Low" | "Medium" | "High"): number {
    const limits = { Low: 180, Medium: 520, High: 1_100 };
    return Math.max(0, Math.min(limits[quality], Math.round(Number.isFinite(value) ? value : 0)));
}

function parseQuote(value: string): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function percentile(values: readonly number[], fraction: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((sorted.length - 1) * fraction)));
    return sorted[index];
}

interface SymbolHistory {
    samples: number[];
    lastSequence: number;
}

export interface VolumeEventDetectorOptions {
    historySize?: number;
    minimumSamples?: number;
    cooldownMs?: number;
}

/**
 * Presentation-only detector. It compares each symbol with its own recent
 * distribution, never with a fixed dollar threshold shared by all assets.
 */
export class VolumeEventDetector {
    private readonly histories = new Map<string, SymbolHistory>();
    private readonly lastEventAt = new Map<string, number>();
    private readonly historySize: number;
    private readonly minimumSamples: number;
    private readonly cooldownMs: number;

    public constructor(options: VolumeEventDetectorOptions = {}) {
        this.historySize = Math.max(8, options.historySize ?? 60);
        this.minimumSamples = Math.max(4, options.minimumSamples ?? 12);
        this.cooldownMs = Math.max(500, options.cooldownMs ?? 4_000);
    }

    public ingest(batch: WhaleOceanBatch, nowMs = Date.parse(batch.eventTimeUtc)): WhaleOceanEvent | null {
        const symbol = batch.symbol.trim().toUpperCase();
        if (!symbol || batch.isReplay || batch.isPartial) return null;

        const buy = parseQuote(batch.takerBuyQuote);
        const sell = parseQuote(batch.takerSellQuote);
        const total = buy + sell;
        if (total <= 0 || !Number.isFinite(total)) return null;

        const history = this.histories.get(symbol) ?? { samples: [], lastSequence: 0 };
        if (batch.sequence <= history.lastSequence) return null;

        const prior = history.samples;
        history.lastSequence = batch.sequence;
        const baseline = prior.length > 0 ? prior.reduce((sum, value) => sum + value, 0) / prior.length : 0;
        const p90 = percentile(prior, 0.9);
        const p95 = percentile(prior, 0.95);
        prior.push(total);
        while (prior.length > this.historySize) prior.shift();
        this.histories.set(symbol, history);

        if (history.samples.length < this.minimumSamples || baseline <= 0) return null;

        const ratio = total / baseline;
        const whale = ratio >= 8 && total >= Math.max(baseline * 4, p95 * 2);
        const shark = !whale && ratio >= 4 && total >= Math.max(baseline * 2, p90 * 1.25);
        if (!whale && !shark) return null;

        const side: WhaleOceanSide = buy >= sell ? "buy" : "sell";
        const eventKey = `${symbol}:${side}`;
        const timestamp = Number.isFinite(nowMs) ? nowMs : Date.now();
        const last = this.lastEventAt.get(eventKey);
        if (last !== undefined && timestamp - last < this.cooldownMs) return null;
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
