import type {
    FuturebolInitializeOptions,
    FuturebolTeam,
    FuturebolTeamVisualConfiguration,
    FuturebolTeamVisualConfigurationMap
} from './futurebol-types.js';

export function createFuturebolTeamVisualConfiguration(
    options: Pick<
        FuturebolInitializeOptions,
        | 'homeSymbol'
        | 'awaySymbol'
        | 'homeLogoUrl'
        | 'awayLogoUrl'
    >
): FuturebolTeamVisualConfigurationMap {
    return {
        home: normalizeTeam(options.homeSymbol, options.homeLogoUrl),
        away: normalizeTeam(options.awaySymbol, options.awayLogoUrl)
    };
}

export function resolveFuturebolTeamVisual(
    teams: FuturebolTeamVisualConfigurationMap,
    team: FuturebolTeam
): FuturebolTeamVisualConfiguration {
    return teams[team];
}

function normalizeTeam(
    symbol: string,
    logoUrl: string | null
): FuturebolTeamVisualConfiguration {
    const normalizedSymbol = symbol.trim().toUpperCase() || '?';
    const normalizedLogoUrl = logoUrl?.trim() || null;
    return {
        symbol: normalizedSymbol,
        logoUrl: normalizedLogoUrl
    };
}
