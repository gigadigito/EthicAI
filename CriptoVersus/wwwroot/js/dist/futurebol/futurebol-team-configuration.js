export function createFuturebolTeamVisualConfiguration(options) {
    return {
        home: normalizeTeam(options.homeSymbol, options.homeLogoUrl),
        away: normalizeTeam(options.awaySymbol, options.awayLogoUrl)
    };
}
export function resolveFuturebolTeamVisual(teams, team) {
    return teams[team];
}
function normalizeTeam(symbol, logoUrl) {
    const normalizedSymbol = symbol.trim().toUpperCase() || '?';
    const normalizedLogoUrl = logoUrl?.trim() || null;
    return {
        symbol: normalizedSymbol,
        logoUrl: normalizedLogoUrl
    };
}
