using BLL.NFTFutebol;
using DTOs;

namespace CriptoVersus.Web.Services;

/// <summary>
/// Turns a scenario fixture into production DTOs. All combat outcomes are
/// computed by <see cref="CandleBattlesResolver"/> — the mock never re-implements
/// winner, strength or scoring rules.
/// </summary>
public static class CandleBattleScenarioCompiler
{
    public const string WaitingStatus = "waiting";
    public const string LiveStatus = "live";
    public const string FinishedStatus = "finished";

    public static CandleBattleScenario Compile(CandleBattleScenarioFile file)
    {
        if (file is null) throw new ArgumentNullException(nameof(file));
        var match = file.Match ?? throw Invalid(file, "match section is required.");
        if (match.MatchId <= 0) throw Invalid(file, "match.matchId must be a positive fictional id.");
        if (string.IsNullOrWhiteSpace(match.LeftSymbol) || string.IsNullOrWhiteSpace(match.RightSymbol))
            throw Invalid(file, "both match symbols are required.");
        if (string.Equals(match.LeftSymbol, match.RightSymbol, StringComparison.OrdinalIgnoreCase))
            throw Invalid(file, "match symbols must differ.");
        if (match.StartTimeMs % CandleBattlesResolver.PeriodMs != 0)
            throw Invalid(file, "match.startTimeMs must align to the 5-minute period.");

        var status = match.Status?.Trim().ToLowerInvariant() ?? FinishedStatus;
        if (status is not (WaitingStatus or LiveStatus or FinishedStatus))
            throw Invalid(file, $"match.status '{match.Status}' is not supported.");

        var leftAll = BuildCandles(file, match.LeftSymbol, file.Series.Left, "series.left");
        var rightAll = BuildCandles(file, match.RightSymbol, file.Series.Right, "series.right");
        var matchCandles = CandleBattlesResolver.ExpectedRounds;
        if (leftAll.Count < CandleBattlesResolver.HistoryLength + matchCandles || rightAll.Count < CandleBattlesResolver.HistoryLength + matchCandles)
            throw Invalid(file, $"each series needs at least {CandleBattlesResolver.HistoryLength + matchCandles} candles (20 history + 18 match).");

        for (var i = 1; i < leftAll.Count; i++)
            if (leftAll[i].OpenTime != leftAll[i - 1].OpenTime + CandleBattlesResolver.PeriodMs)
                throw Invalid(file, "series.left timestamps must be strictly contiguous 5-minute intervals.");
        for (var i = 1; i < rightAll.Count; i++)
            if (rightAll[i].OpenTime != rightAll[i - 1].OpenTime + CandleBattlesResolver.PeriodMs)
                throw Invalid(file, "series.right timestamps must be strictly contiguous 5-minute intervals.");
        if (leftAll[0].OpenTime != rightAll[0].OpenTime)
            throw Invalid(file, "both series must start at the same open time.");

        var matchStartMs = leftAll[CandleBattlesResolver.HistoryLength].OpenTime;
        if (matchStartMs != match.StartTimeMs)
            throw Invalid(file, $"match.startTimeMs must equal the first match candle open ({matchStartMs}).");

        var totalRounds = new List<CandleBattlesRoundDto>(matchCandles);
        for (var i = 0; i < matchCandles; i++)
        {
            var index = CandleBattlesResolver.HistoryLength + i;
            var leftHistory = leftAll.GetRange(index - CandleBattlesResolver.HistoryLength, CandleBattlesResolver.HistoryLength);
            var rightHistory = rightAll.GetRange(index - CandleBattlesResolver.HistoryLength, CandleBattlesResolver.HistoryLength);
            totalRounds.Add(CandleBattlesResolver.Resolve(match.MatchId, leftAll[index], rightAll[index], leftHistory, rightHistory));
        }

        var revealed = status switch
        {
            WaitingStatus => 0,
            FinishedStatus => totalRounds.Count,
            _ => Math.Clamp(match.RevealRounds ?? totalRounds.Count, 0, totalRounds.Count)
        };
        if (status == FinishedStatus && revealed < totalRounds.Count)
            throw Invalid(file, "a finished match must reveal every stored round.");
        var rounds = totalRounds.Take(revealed).ToArray();

        var finished = status == FinishedStatus;
        var matchEndMs = matchStartMs + (long)matchCandles * CandleBattlesResolver.PeriodMs;
        var scoreLeft = rounds.Count(r => r.Winner == "left");
        var scoreRight = rounds.Count(r => r.Winner == "right");

        var feed = new CandleBattlesFeedDto(
            match.MatchId, match.LeftSymbol, match.RightSymbol, scoreLeft, scoreRight,
            finished, status,
            FormingCandle(leftAll, revealed),
            FormingCandle(rightAll, revealed),
            rounds, false, rounds.Length > 0 ? rounds[^1].Left.OpenTime : (long?)null,
            matchStartMs, finished ? matchEndMs : null,
            CandleBattlesResolver.ExpectedRounds,
            finished ? matchEndMs : matchStartMs + (long)revealed * CandleBattlesResolver.PeriodMs);

        var social = BuildSocial(file, match, leftAll, rightAll, rounds, scoreLeft, scoreRight, finished, matchStartMs, matchEndMs);
        var logos = new Dictionary<string, string>(file.Logos ?? new Dictionary<string, string>(), StringComparer.OrdinalIgnoreCase);

        return new CandleBattleScenario
        {
            Key = file.Scenario,
            Description = file.Description,
            MatchId = match.MatchId,
            LeftSymbol = match.LeftSymbol,
            RightSymbol = match.RightSymbol,
            MatchStartMs = matchStartMs,
            MatchEndMs = matchEndMs,
            Status = status,
            Finished = finished,
            Rounds = rounds,
            Feed = feed,
            Social = social,
            Logos = logos
        };
    }

    /// <summary>
    /// The candle that is forming at the revealed cursor. Fictional forming
    /// candles are unconfirmed snapshots inside their own 5-minute period; a
    /// finished match has none.
    /// </summary>
    private static CandleBattlesCandleDto? FormingCandle(List<CandleBattlesCandleDto> all, int revealed)
    {
        if (revealed >= CandleBattlesResolver.ExpectedRounds) return null;
        var index = CandleBattlesResolver.HistoryLength + revealed;
        if (index >= all.Count) return null;
        var next = all[index];
        return next with { Confirmed = false, UpdatedAt = next.OpenTime + CandleBattlesResolver.PeriodMs / 2, Strength = null };
    }

    private static List<CandleBattlesCandleDto> BuildCandles(CandleBattleScenarioFile file, string symbol,
        List<CandleBattleScenarioCandle>? series, string section)
    {
        if (series is null || series.Count == 0) throw Invalid(file, $"{section} is required.");
        var candles = new List<CandleBattlesCandleDto>(series.Count);
        foreach (var raw in series)
        {
            var candle = new CandleBattlesCandleDto(symbol, raw.OpenTimeMs, raw.OpenTimeMs + CandleBattlesResolver.PeriodMs,
                raw.OpenTimeMs + CandleBattlesResolver.PeriodMs, raw.Open, raw.High, raw.Low, raw.Close, raw.Volume, true);
            if (!CandleBattlesResolver.IsValid(candle))
                throw Invalid(file, $"{section} contains an invalid candle at {raw.OpenTimeMs}.");
            candles.Add(candle);
        }
        return candles;
    }

    private static CandleBattleSocialResponse BuildSocial(CandleBattleScenarioFile file, CandleBattleScenarioMatch match,
        List<CandleBattlesCandleDto> leftAll, List<CandleBattlesCandleDto> rightAll,
        IReadOnlyList<CandleBattlesRoundDto> rounds, int scoreLeft, int scoreRight,
        bool finished, long matchStartMs, long matchEndMs)
    {
        var leftMatch = leftAll.Skip(CandleBattlesResolver.HistoryLength).Take(CandleBattlesResolver.ExpectedRounds).ToArray();
        var rightMatch = rightAll.Skip(CandleBattlesResolver.HistoryLength).Take(CandleBattlesResolver.ExpectedRounds).ToArray();
        string? winnerSymbol = null;
        if (finished && scoreLeft != scoreRight)
            winnerSymbol = scoreLeft > scoreRight ? match.LeftSymbol : match.RightSymbol;

        // Mock previews are never publishable: no reservation, no publication
        // state and no public URL ever leave this builder.
        return new CandleBattleSocialResponse
        {
            Category = CandleBattleSocialCategories.Highlight,
            MatchId = match.MatchId,
            BattleId = $"{match.MatchId}:5m",
            BattleType = "candle_battles_arcade",
            Status = finished ? "Completed" : "Ongoing",
            BattleStatus = finished ? FinishedStatus : match.Status?.Trim().ToLowerInvariant() ?? LiveStatus,
            StartTimeUtc = DateTimeOffset.FromUnixTimeMilliseconds(matchStartMs).UtcDateTime,
            EndTimeUtc = finished ? DateTimeOffset.FromUnixTimeMilliseconds(matchEndMs).UtcDateTime : null,
            DurationMinutes = CandleBattlesResolver.ExpectedRounds * (int)(CandleBattlesResolver.PeriodMs / 60_000),
            AssetA = BuildAsset(match.LeftSymbol, leftMatch, file),
            AssetB = BuildAsset(match.RightSymbol, rightMatch, file),
            ScoreA = scoreLeft,
            ScoreB = scoreRight,
            WinnerSymbol = winnerSymbol,
            ConfrontationCount = rounds.Count,
            ExpectedConfrontations = CandleBattlesResolver.ExpectedRounds,
            InterestScore = file.Social?.InterestScore ?? 0,
            SelectionReasons = file.Social?.SelectionReasons?.ToArray() ?? [],
            Rounds = rounds,
            ReplayAvailable = rounds.Count > 0,
            ReplayUnavailableReason = rounds.Count > 0 ? null : "no_persisted_rounds",
            CanPost = false,
            SkipReason = "mock_preview",
            AlreadyPublished = false,
            Publication = null,
            PublicUrl = null,
            PublicUrlAvailable = false,
            GeneratedAtUtc = DateTimeOffset.FromUnixTimeMilliseconds(finished ? matchEndMs : matchStartMs).UtcDateTime
        };
    }

    private static CandleBattleSocialAssetDto BuildAsset(string symbol, CandleBattlesCandleDto[] matchCandles, CandleBattleScenarioFile file)
    {
        var pair = symbol.EndsWith("USDT", StringComparison.OrdinalIgnoreCase)
            ? $"{symbol[..^4]}/USDT" : symbol;
        decimal? opening = matchCandles.Length > 0 ? matchCandles[0].Open : null;
        decimal? closing = matchCandles.Length > 0 ? matchCandles[^1].Close : null;
        decimal? performance = opening is > 0 && closing is not null
            ? decimal.Round((closing.Value / opening.Value - 1m) * 100m, 6) : null;
        return new CandleBattleSocialAssetDto
        {
            Symbol = symbol,
            Pair = pair,
            LogoUrl = file.Logos != null && file.Logos.TryGetValue(symbol, out var logo) ? logo : string.Empty,
            OpeningPrice = opening,
            ClosingPrice = closing,
            PerformancePercent = performance,
            GreenCandles = matchCandles.Count(c => c.Close > c.Open),
            RedCandles = matchCandles.Count(c => c.Close < c.Open)
        };
    }

    private static InvalidDataException Invalid(CandleBattleScenarioFile file, string reason)
        => new($"Scenario '{file.Scenario}': {reason}");
}
