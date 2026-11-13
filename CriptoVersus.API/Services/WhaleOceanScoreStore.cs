using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace CriptoVersus.API.Services;

public sealed class WhaleOceanScoreStore
{
    private readonly IDbContextFactory<EthicAIDbContext> _dbFactory;
    private readonly MoneyFlowMatchRegistry _registry;
    private readonly IOptions<MoneyFlowTransportOptions> _options;
    private readonly ILogger<WhaleOceanScoreStore> _logger;

    public WhaleOceanScoreStore(
        IDbContextFactory<EthicAIDbContext> dbFactory,
        MoneyFlowMatchRegistry registry,
        IOptions<MoneyFlowTransportOptions> options,
        ILogger<WhaleOceanScoreStore> logger)
    {
        _dbFactory = dbFactory;
        _registry = registry;
        _options = options;
        _logger = logger;
    }

    /// <summary>
    /// Persists one row per deduplicated transport batch and active match. The
    /// unique key is also the durable replay guard after an API restart.
    /// </summary>
    public async Task PersistAsync(string sourceId, IReadOnlyList<MoneyFlowBatchDto> batches, CancellationToken ct)
    {
        if (!_options.Value.Enabled || !_options.Value.TransportEnabled || batches.Count == 0)
            return;

        var matchesBySymbol = new Dictionary<string, IReadOnlyList<int>>(StringComparer.Ordinal);
        foreach (var symbol in batches.Select(batch => MoneyFlowMatchRegistry.Normalize(batch.Symbol)).Distinct(StringComparer.Ordinal))
            matchesBySymbol[symbol] = await _registry.GetMatchesForSymbolAsync(symbol, ct);

        await using var db = await _dbFactory.CreateDbContextAsync(ct);
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        foreach (var batch in batches)
        {
            var symbol = MoneyFlowMatchRegistry.Normalize(batch.Symbol);
            if (!matchesBySymbol.TryGetValue(symbol, out var matchIds)) continue;
            foreach (var matchId in matchIds)
                await InsertIfNewAsync(db, matchId, sourceId.Trim(), batch with { Symbol = symbol }, ct);
        }

        await transaction.CommitAsync(ct);
    }

    public async Task<WhaleOceanScoreboardDto?> GetScoreboardAsync(int matchId, CancellationToken ct)
    {
        await using var db = await _dbFactory.CreateDbContextAsync(ct);
        var match = await db.Match.AsNoTracking()
            .Where(item => item.MatchId == matchId)
            .Select(item => new
            {
                item.MatchId,
                TeamA = item.TeamA.Currency!.Symbol,
                TeamB = item.TeamB.Currency!.Symbol,
                item.Status,
                item.EndTime
            })
            .SingleOrDefaultAsync(ct);
        if (match is null) return null;

        var finalized = match.Status != MatchStatus.Ongoing;
        var windowEnd = finalized && match.EndTime.HasValue
            ? new DateTimeOffset(DateTime.SpecifyKind(match.EndTime.Value, DateTimeKind.Utc))
            : DateTimeOffset.UtcNow;
        var windowStart = windowEnd.AddSeconds(-30);
        var rows = await db.WhaleOceanActivityBatch.AsNoTracking()
            .Where(row => row.MatchId == matchId)
            .ToListAsync(ct);

        return new WhaleOceanScoreboardDto
        {
            MatchId = matchId,
            WindowStartUtc = windowStart,
            WindowEndUtc = windowEnd,
            IsFinalized = finalized,
            TeamA = BuildTeam(match.TeamA, rows, windowStart),
            TeamB = BuildTeam(match.TeamB, rows, windowStart)
        };
    }

    private static WhaleOceanScoreboardTeamDto BuildTeam(
        string symbol,
        IReadOnlyList<WhaleOceanActivityBatch> rows,
        DateTimeOffset windowStart)
    {
        var normalized = MoneyFlowMatchRegistry.Normalize(symbol);
        var teamRows = rows.Where(row => row.Symbol == normalized).ToArray();
        return new WhaleOceanScoreboardTeamDto
        {
            Symbol = normalized,
            MatchTotal = Sum(teamRows),
            Last30Seconds = Sum(teamRows.Where(row => row.EventTimeUtc >= windowStart)),
            LastSequences = teamRows
                .GroupBy(row => row.SourceId, StringComparer.Ordinal)
                .Select(group => new MoneyFlowSourceSequenceDto
                {
                    SourceId = group.Key,
                    Symbol = normalized,
                    Sequence = group.Max(row => row.Sequence)
                })
                .ToArray()
        };
    }

    private static MoneyFlowCreatureCountsDto Sum(IEnumerable<WhaleOceanActivityBatch> rows)
    {
        var buy = new MoneyFlowCreatureSideCountsDto();
        var sell = new MoneyFlowCreatureSideCountsDto();
        foreach (var row in rows)
        {
            buy = buy with
            {
                Small = buy.Small + row.SmallBuy,
                Medium = buy.Medium + row.MediumBuy,
                Large = buy.Large + row.LargeBuy,
                Shark = buy.Shark + row.SharkBuy,
                Whale = buy.Whale + row.WhaleBuy
            };
            sell = sell with
            {
                Small = sell.Small + row.SmallSell,
                Medium = sell.Medium + row.MediumSell,
                Large = sell.Large + row.LargeSell,
                Shark = sell.Shark + row.SharkSell,
                Whale = sell.Whale + row.WhaleSell
            };
        }
        return new MoneyFlowCreatureCountsDto { Buy = buy, Sell = sell };
    }

    private static async Task InsertIfNewAsync(
        EthicAIDbContext db,
        int matchId,
        string sourceId,
        MoneyFlowBatchDto batch,
        CancellationToken ct)
    {
        var counts = batch.CreatureCounts;
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO whale_ocean_activity_batch
            (cd_match, tx_source_id, tx_symbol, nr_sequence, dt_window_start, dt_event_time, dt_received_at,
             bl_partial, nr_trade_count, nr_small_buy, nr_medium_buy, nr_large_buy, nr_shark_buy, nr_whale_buy,
             nr_small_sell, nr_medium_sell, nr_large_sell, nr_shark_sell, nr_whale_sell)
            VALUES
            ({matchId}, {sourceId}, {batch.Symbol}, {batch.Sequence}, {batch.WindowStartUtc}, {batch.EventTimeUtc}, {batch.ReceivedAtUtc},
             {batch.IsPartial}, {batch.TradeCount}, {counts.Buy.Small}, {counts.Buy.Medium}, {counts.Buy.Large}, {counts.Buy.Shark}, {counts.Buy.Whale},
             {counts.Sell.Small}, {counts.Sell.Medium}, {counts.Sell.Large}, {counts.Sell.Shark}, {counts.Sell.Whale})
            ON CONFLICT (cd_match, tx_source_id, tx_symbol, nr_sequence) DO NOTHING
            """, ct);
    }
}
