import type {
    FuturebolInitializeOptions,
    FuturebolMarketSnapshot
} from '../futurebol-types.js';
import { ApiMarketSource } from './api-market-source.js';
import type { FuturebolMarketSource } from './futurebol-market-source.js';
import { MockMarketSource } from './mock-market-source.js';

export function createFuturebolMarketSource(
    options: FuturebolInitializeOptions
): FuturebolMarketSource {
    const mode = options.dataMode.trim().toLowerCase();
    if (mode === 'mock')
        return new MockMarketSource(options.homeSymbol, options.awaySymbol, options.seed, 500);

    if (mode === 'api') {
        return new ApiMarketSource(
            options.initialMarketSnapshot ?? createNeutralSnapshot(options)
        );
    }

    throw new Error(`Modo de dados Futurebol não suportado: ${options.dataMode}`);
}

function createNeutralSnapshot(
    options: Pick<FuturebolInitializeOptions, 'homeSymbol' | 'awaySymbol'>
): FuturebolMarketSnapshot {
    return {
        sequence: 0,
        timestamp: new Date().toISOString(),
        home: {
            symbol: options.homeSymbol,
            price: 0,
            changePercent: 0,
            momentum: 50,
            volumeStrength: 50
        },
        away: {
            symbol: options.awaySymbol,
            price: 0,
            changePercent: 0,
            momentum: 50,
            volumeStrength: 50
        }
    };
}
