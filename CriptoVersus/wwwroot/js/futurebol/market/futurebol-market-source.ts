import type {
    FuturebolMarketSnapshot,
    FuturebolMarketSourceDiagnostics
} from '../futurebol-types.js';

export interface FuturebolMarketSource {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    getSnapshot(): FuturebolMarketSnapshot;
    getDiagnostics(): FuturebolMarketSourceDiagnostics;
    subscribe(callback: (snapshot: FuturebolMarketSnapshot) => void): () => void;
}
