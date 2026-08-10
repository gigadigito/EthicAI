import type {
    FuturebolAssetState,
    FuturebolMarketSnapshot,
    FuturebolMarketSourceDiagnostics
} from '../futurebol-types.js';
import type { FuturebolMarketSource } from "./futurebol-market-source.js";

const DEMO_EPOCH_MS = Date.parse("2026-01-01T00:00:00.000Z");

export class MockMarketSource implements FuturebolMarketSource {
    private readonly listeners = new Set<(snapshot: FuturebolMarketSnapshot) => void>();
    private readonly seedUnit: number;
    private timer: ReturnType<typeof setInterval> | null = null;
    private sequence = 0;
    private snapshot: FuturebolMarketSnapshot;

    public constructor(
        private readonly homeSymbol = "BTC",
        private readonly awaySymbol = "ETH",
        private readonly seed = "futurebol-demo-001",
        private readonly intervalMs = 500
    ) {
        this.seedUnit = seededUnit(seed);
        this.snapshot = this.createSnapshot(0);
    }

    public async connect(): Promise<void> {
        if (this.timer !== null)
            return;

        this.emit(this.snapshot);
        this.timer = setInterval(() => {
            this.sequence += 1;
            this.snapshot = this.createSnapshot(this.sequence);
            this.emit(this.snapshot);
        }, this.intervalMs);
    }

    public async disconnect(): Promise<void> {
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.listeners.clear();
    }

    public getSnapshot(): FuturebolMarketSnapshot {
        return cloneSnapshot(this.snapshot);
    }

    public getDiagnostics(): FuturebolMarketSourceDiagnostics {
        return {
            mode: 'mock',
            lastUpdatedAt: this.snapshot.timestamp,
            error: null
        };
    }

    public subscribe(callback: (snapshot: FuturebolMarketSnapshot) => void): () => void {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }

    public reset(): void {
        this.sequence = 0;
        this.snapshot = this.createSnapshot(0);
        this.emit(this.snapshot);
    }

    private emit(snapshot: FuturebolMarketSnapshot): void {
        const copy = cloneSnapshot(snapshot);
        for (const listener of this.listeners)
            listener(copy);
    }

    private createSnapshot(sequence: number): FuturebolMarketSnapshot {
        const cycleStep = sequence % 240;
        const wave = Math.sin((sequence + this.seedUnit * 9) * 0.21);
        const fineWave = Math.sin((sequence + this.seedUnit * 31) * 0.077);
        const [homeBase, awayBase] = phaseMomentum(cycleStep);
        const homeMomentum = clamp(homeBase + wave * 3.2 + fineWave * 1.6, 0, 100);
        const awayMomentum = clamp(awayBase - wave * 2.7 - fineWave * 1.2, 0, 100);
        const homeChange = (homeMomentum - 50) * 0.018 + wave * 0.06;
        const awayChange = (awayMomentum - 50) * 0.018 - wave * 0.05;

        return {
            sequence,
            timestamp: new Date(DEMO_EPOCH_MS + sequence * this.intervalMs).toISOString(),
            home: this.asset(this.homeSymbol, 65000, homeMomentum, homeChange, sequence, 0),
            away: this.asset(this.awaySymbol, 3500, awayMomentum, awayChange, sequence, 1)
        };
    }

    private asset(
        symbol: string,
        basePrice: number,
        momentum: number,
        changePercent: number,
        sequence: number,
        lane: number
    ): FuturebolAssetState {
        const priceWave = Math.sin((sequence + lane * 17 + this.seedUnit * 13) * 0.045);
        const volumeWave = Math.sin((sequence + lane * 29 + this.seedUnit * 7) * 0.13);
        return {
            symbol,
            price: round(basePrice * (1 + changePercent / 100 + priceWave * 0.0018), 2),
            changePercent: round(changePercent, 3),
            momentum: round(momentum, 2),
            volumeStrength: round(clamp(52 + Math.abs(momentum - 50) * 0.55 + volumeWave * 7, 0, 100), 2)
        };
    }
}

function phaseMomentum(step: number): [number, number] {
    const phase = Math.floor(step / 30) % 8;
    const progress = (step % 30) / 29;

    switch (phase) {
        case 0: return [50 + progress * 3, 50 - progress * 2];
        case 1: return [53 + progress * 29, 48 - progress * 16];
        case 2: return [82 - progress * 12, 32 + progress * 17];
        case 3: return [70 - progress * 28, 49 + progress * 30];
        case 4: return [42 + progress * 16, 79 - progress * 18];
        case 5: return [58 - progress * 31, 61 + progress * 24];
        case 6: return [27 + progress * 20, 85 - progress * 24];
        default: return [47 + progress * 3, 61 - progress * 11];
    }
}

function seededUnit(seed: string): number {
    let hash = 2166136261;
    for (let index = 0; index < seed.length; index++) {
        hash ^= seed.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 4294967295;
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, digits: number): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function cloneSnapshot(snapshot: FuturebolMarketSnapshot): FuturebolMarketSnapshot {
    return {
        ...snapshot,
        home: { ...snapshot.home },
        away: { ...snapshot.away }
    };
}
