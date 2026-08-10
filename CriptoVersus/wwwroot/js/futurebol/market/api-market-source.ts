import type {
    FuturebolMarketSnapshot,
    FuturebolMarketSourceDiagnostics
} from '../futurebol-types.js';
import type { FuturebolMarketSource } from './futurebol-market-source.js';

export class ApiMarketSource implements FuturebolMarketSource {
    private readonly listeners = new Set<(snapshot: FuturebolMarketSnapshot) => void>();
    private snapshot: FuturebolMarketSnapshot;
    private connected = false;
    private error: string | null = null;

    public constructor(initialSnapshot: FuturebolMarketSnapshot) {
        this.snapshot = cloneSnapshot(initialSnapshot);
    }

    public async connect(): Promise<void> {
        if (this.connected)
            return;

        this.connected = true;
        this.emit(this.snapshot);
    }

    public async disconnect(): Promise<void> {
        this.connected = false;
        this.listeners.clear();
    }

    public getSnapshot(): FuturebolMarketSnapshot {
        return cloneSnapshot(this.snapshot);
    }

    public getDiagnostics(): FuturebolMarketSourceDiagnostics {
        return {
            mode: 'api',
            lastUpdatedAt: this.snapshot.timestamp,
            error: this.error
        };
    }

    public subscribe(callback: (snapshot: FuturebolMarketSnapshot) => void): () => void {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }

    public push(snapshot: FuturebolMarketSnapshot): void {
        this.snapshot = cloneSnapshot(snapshot);
        this.error = null;
        if (this.connected)
            this.emit(this.snapshot);
    }

    public reportError(message: string): void {
        this.error = message.trim() || 'Falha ao receber a atualização de mercado.';
    }

    private emit(snapshot: FuturebolMarketSnapshot): void {
        const copy = cloneSnapshot(snapshot);
        for (const listener of this.listeners)
            listener(copy);
    }
}

function cloneSnapshot(snapshot: FuturebolMarketSnapshot): FuturebolMarketSnapshot {
    return {
        ...snapshot,
        home: { ...snapshot.home },
        away: { ...snapshot.away }
    };
}
