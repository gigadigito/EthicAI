using DAL.NftFutebol;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace CriptoVersus.Worker.MarketFlow;

public interface IMarketFlowSymbolSource
{
    Task<IReadOnlyCollection<string>> GetSymbolsAsync(CancellationToken cancellationToken);
}

/// <summary>
/// Resolves the Binance symbols required by the Money Flow pipeline from the matches that are
/// currently <see cref="MatchStatus.Ongoing"/> in PostgreSQL, merged with the explicitly configured
/// supplemental symbols.
///
/// Selection policy when the combined set exceeds <see cref="MarketFlowOptions.MaxSymbols"/>:
/// symbols are ordered ordinally (stable and deterministic across refreshes) and only the first
/// <c>MaxSymbols</c> are retained. Explicitly configured symbols are always reserved first so a
/// deliberate operator override is never displaced by transient match traffic, then ongoing-match
/// symbols fill the remaining budget. Because the ordering is stable, the same set of symbols is
/// selected on every refresh while the underlying data is unchanged, so no churn is introduced.
/// When truncation occurs, a warning is logged listing the symbols that are deliberately left
/// unscribed so an operator can raise <c>MaxSymbols</c> or reduce the number of concurrent matches.
/// </summary>
public sealed class ActiveMatchMarketFlowSymbolSource(
    IServiceScopeFactory scopeFactory,
    IOptions<MarketFlowOptions> options,
    ILogger<ActiveMatchMarketFlowSymbolSource> logger) : IMarketFlowSymbolSource
{
    public async Task<IReadOnlyCollection<string>> GetSymbolsAsync(CancellationToken cancellationToken)
    {
        var configured = options.Value.Validate();

        // One scoped query per refresh: project only the two symbol columns so the database returns
        // a flat row set rather than materialised Team/Currency graphs.
        string[] matchSymbols;
        using (var scope = scopeFactory.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<EthicAIDbContext>();
            var rows = await db.Match.AsNoTracking()
                .Where(match => match.Status == MatchStatus.Ongoing)
                .Select(match => new
                {
                    Left = match.TeamA.Currency.Symbol,
                    Right = match.TeamB.Currency.Symbol
                })
                .ToListAsync(cancellationToken);
            matchSymbols = rows.SelectMany(row => new[] { row.Left, row.Right }).Where(static s => !string.IsNullOrWhiteSpace(s)).ToArray();
        }

        var active = PriceSymbolSetBuilder.NormalizeSymbols(matchSymbols).Order(StringComparer.Ordinal).ToArray();
        var explicitSymbols = PriceSymbolSetBuilder.NormalizeSymbols(configured.Symbols).Order(StringComparer.Ordinal).ToArray();

        // Explicit symbols are reserved first so they survive any truncation, then ongoing-match
        // symbols fill the remaining budget in a stable ordinal order.
        var selection = new List<string>(configured.MaxSymbols);
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var omitted = new List<string>();

        foreach (var symbol in explicitSymbols.Concat(active))
        {
            if (!seen.Add(symbol)) continue;
            if (selection.Count < configured.MaxSymbols)
                selection.Add(symbol);
            else
                omitted.Add(symbol);
        }

        if (omitted.Count > 0)
        {
            logger.LogWarning(
                "Market flow active symbols exceeded MaxSymbols={MaxSymbols}; selected {SelectedCount} symbols deterministically and left {OmittedCount} unscribed: {OmittedSymbols}. Raise CandleBattles:MoneyFlow:MaxSymbols or reduce concurrent matches to serve them all.",
                configured.MaxSymbols, selection.Count, omitted.Count, string.Join(",", omitted));
        }

        return selection;
    }
}
