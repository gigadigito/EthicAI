using DAL.NftFutebol;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace CriptoVersus.API.Services;

public sealed class MoneyFlowMatchRegistry : IAsyncDisposable
{
    private readonly IDbContextFactory<EthicAIDbContext> _dbFactory;
    private readonly IOptions<MoneyFlowTransportOptions> _options;
    private readonly MoneyFlowMetrics _metrics;
    private readonly ILogger<MoneyFlowMatchRegistry> _logger;
    private readonly SemaphoreSlim _refreshLock = new(1, 1);
    private Dictionary<string, int[]> _bySymbol = new(StringComparer.Ordinal);
    private DateTimeOffset _refreshedAt;

    public MoneyFlowMatchRegistry(
        IDbContextFactory<EthicAIDbContext> dbFactory,
        IOptions<MoneyFlowTransportOptions> options,
        MoneyFlowMetrics metrics,
        ILogger<MoneyFlowMatchRegistry> logger)
    {
        _dbFactory = dbFactory;
        _options = options;
        _metrics = metrics;
        _logger = logger;
    }

    public async Task<IReadOnlyList<int>> GetMatchesForSymbolAsync(string symbol, CancellationToken ct)
    {
        if (!_options.Value.Enabled || !_options.Value.TransportEnabled) return Array.Empty<int>();
        await RefreshIfStaleAsync(ct);
        return _bySymbol.TryGetValue(Normalize(symbol), out var matches) ? matches : Array.Empty<int>();
    }

    public async Task<bool> IsActiveAsync(int matchId, CancellationToken ct)
    {
        if (!_options.Value.Enabled || !_options.Value.TransportEnabled) return false;
        await RefreshIfStaleAsync(ct);
        return _bySymbol.Values.Any(ids => ids.Contains(matchId));
    }

    private async Task RefreshIfStaleAsync(CancellationToken ct)
    {
        var options = _options.Value.Validate();
        if (DateTimeOffset.UtcNow - _refreshedAt < TimeSpan.FromSeconds(options.RegistryRefreshSeconds)) return;
        await _refreshLock.WaitAsync(ct);
        try
        {
            if (DateTimeOffset.UtcNow - _refreshedAt < TimeSpan.FromSeconds(options.RegistryRefreshSeconds)) return;
            await using var db = await _dbFactory.CreateDbContextAsync(ct);
            var active = await db.Match.AsNoTracking()
                .Where(m => m.Status == MatchStatus.Ongoing && m.TeamA.Currency != null && m.TeamB.Currency != null)
                .Select(m => new { m.MatchId, A = m.TeamA.Currency.Symbol, B = m.TeamB.Currency.Symbol })
                .ToListAsync(ct);
            var next = new Dictionary<string, List<int>>(StringComparer.Ordinal);
            foreach (var match in active)
            {
                Add(next, match.A, match.MatchId);
                Add(next, match.B, match.MatchId);
            }
            _bySymbol = next.ToDictionary(pair => pair.Key, pair => pair.Value.Distinct().ToArray(), StringComparer.Ordinal);
            _refreshedAt = DateTimeOffset.UtcNow;
            _logger.LogInformation("Money-flow registry refreshed: symbols={SymbolCount} groups={GroupCount} matches=[{Matches}]",
                _bySymbol.Count, _bySymbol.Values.Sum(x => x.Length),
                string.Join(",", _bySymbol.SelectMany(p => p.Value.Select(id => $"{p.Key}->{id}")).Take(20)));
            _metrics.SetGroups(_bySymbol.Values.Sum(x => x.Length));
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Money-flow active match registry refresh failed; retaining the last snapshot.");
            _refreshedAt = DateTimeOffset.UtcNow.AddSeconds(-Math.Max(1, options.RegistryRefreshSeconds - 1));
        }
        finally { _refreshLock.Release(); }
    }

    private static void Add(Dictionary<string, List<int>> map, string? symbol, int matchId)
    {
        var normalized = Normalize(symbol);
        if (normalized.Length == 0) return;
        if (!map.TryGetValue(normalized, out var ids)) map[normalized] = ids = [];
        ids.Add(matchId);
    }

    public static string Normalize(string? symbol) => symbol?.Trim().ToUpperInvariant() ?? string.Empty;
    public ValueTask DisposeAsync() { _refreshLock.Dispose(); return ValueTask.CompletedTask; }
}
