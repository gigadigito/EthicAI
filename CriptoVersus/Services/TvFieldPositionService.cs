using System.Globalization;
using System.Collections.Concurrent;
using DTOs;

namespace CriptoVersus.Web.Services;

public sealed class TvFieldPositionService
{
    private readonly LocalizationService _localization;
    private static readonly ConcurrentDictionary<string, SmoothedPlayerState> _smoothedPositions = new(StringComparer.Ordinal);
    private static readonly ConcurrentDictionary<string, int> _lastBallCarrierByTeam = new(StringComparer.Ordinal);
    private static readonly ConcurrentDictionary<string, long> _lastLogTickByKey = new(StringComparer.Ordinal);

    public TvFieldPositionService(LocalizationService localization)
    {
        _localization = localization;
    }

    public TvFieldStateDto BuildFieldState(
        MatchDto? match,
        TvHotMatchDto? hotMatch,
        IReadOnlyList<MatchScoreEventDto>? events,
        IReadOnlyList<MatchMetricSnapshotDto>? snapshots,
        string culture)
    {
        if (match is null && hotMatch is null)
            return new TvFieldStateDto();

        var matchId = hotMatch?.MatchId ?? match?.MatchId ?? 0;
        var teamA = hotMatch?.LeftSymbol ?? match?.TeamA ?? "-";
        var teamB = hotMatch?.RightSymbol ?? match?.TeamB ?? "-";
        var scoreA = hotMatch?.LeftScore ?? match?.ScoreA ?? 0;
        var scoreB = hotMatch?.RightScore ?? match?.ScoreB ?? 0;
        var variationA = hotMatch?.LeftChangePercent ?? match?.PctA;
        var variationB = hotMatch?.RightChangePercent ?? match?.PctB;
        var leader = ResolveLeader(teamA, teamB, scoreA, scoreB, variationA, variationB, hotMatch?.LeaderSymbol);
        var competitiveness = CalculateCompetitiveness(scoreA, scoreB, variationA, variationB, hotMatch?.HotScore);
        var momentumOwner = ResolveMomentumOwner(teamA, teamB, hotMatch?.MomentumLabel, hotMatch?.PressureSymbol, leader);
        var possessionA = CalculatePossession(scoreA, scoreB, variationA, variationB, teamA, momentumOwner, hotMatch?.HotScore ?? competitiveness, competitiveness);
        var possessionB = 100 - possessionA;
        var pressureA = CalculateTeamPressure(possessionA, variationA, scoreA, scoreB);
        var pressureB = CalculateTeamPressure(possessionB, variationB, scoreB, scoreA);
        var highlight = CalculateHighlightedPlayer(teamA, teamB, scoreA, scoreB, momentumOwner, events);

        var flowA = CalculateMarketFlow(teamA, snapshots);
        var flowB = CalculateMarketFlow(teamB, snapshots);

        if (TvLog.ShouldLog($"flow:{matchId}:{teamA}", 2500))
            Console.WriteLine($"[TV_FLOW] {teamA} pressure={flowA.Pressure:F2} attack={flowA.AttackIntensity:F2} territory={flowA.TerritorialAdvance:F2} momentum={flowA.MomentumAcceleration:F2}");

        if (TvLog.ShouldLog($"flow:{matchId}:{teamB}", 2500))
            Console.WriteLine($"[TV_FLOW] {teamB} pressure={flowB.Pressure:F2} attack={flowB.AttackIntensity:F2} territory={flowB.TerritorialAdvance:F2} momentum={flowB.MomentumAcceleration:F2}");

        // Snapshots drive the "live match" feel. Possession/score still anchors territory so the UI remains coherent.
        var ballOwner = ResolveBallOwner(teamA, teamB, possessionA, possessionB, momentumOwner, flowA, flowB);
        var ballCarrierA = ResolveBallCarrierIndex(teamA, matchId, flowA, possessionA);
        var ballCarrierB = ResolveBallCarrierIndex(teamB, matchId, flowB, possessionB);

        MaybeLogBallCarrier(matchId, teamA, ballOwner, ballCarrierA);
        MaybeLogBallCarrier(matchId, teamB, ballOwner, ballCarrierB);

        return new TvFieldStateDto
        {
            TeamA = teamA,
            TeamB = teamB,
            ScoreA = scoreA,
            ScoreB = scoreB,
            VariationA = variationA,
            VariationB = variationB,
            PossessionA = possessionA,
            PossessionB = possessionB,
            MomentumOwner = momentumOwner,
            Leader = leader,
            HotScore = hotMatch?.HotScore ?? competitiveness,
            Competitiveness = competitiveness,
            TeamPressureA = pressureA,
            TeamPressureB = pressureB,
            PlayerPositions = CalculatePlayerPositions(
                matchId,
                teamA,
                teamB,
                possessionA,
                possessionB,
                variationA,
                variationB,
                leader,
                momentumOwner,
                hotMatch?.HotScore ?? competitiveness,
                competitiveness,
                flowA,
                flowB,
                ballOwner,
                ballCarrierA,
                ballCarrierB,
                highlight),
            RecentEvents = BuildRecentEvents(match, teamA, teamB, scoreA, scoreB, events, culture)
        };
    }

    public int CalculatePossession(
        int scoreA,
        int scoreB,
        decimal? variationA,
        decimal? variationB,
        string teamA,
        string momentumOwner,
        int hotScore,
        int competitiveness)
    {
        var scoreDelta = scoreA - scoreB;
        var variationDelta = (double)((variationA ?? 0m) - (variationB ?? 0m));
        var momentumBoost = string.Equals(momentumOwner, teamA, StringComparison.OrdinalIgnoreCase) ? 4d : -4d;
        var heatBias = ((hotScore - 50d) / 50d) * 2d;
        var competitivenessBias = ((competitiveness - 50d) / 50d) * -1.5d;
        var raw = 50d + (scoreDelta * 4.4d) + (variationDelta * 3.2d) + momentumBoost + heatBias + competitivenessBias;

        return (int)Math.Round(Math.Clamp(raw, 35d, 65d), MidpointRounding.AwayFromZero);
    }

    public double CalculateTeamPressure(int possession, decimal? variation, int score, int opponentScore)
    {
        var pressure = ((possession - 50d) / 15d) + (double)(variation ?? 0m) + ((score - opponentScore) * 0.9d);
        return Math.Clamp(pressure, -4d, 4d);
    }

    public IReadOnlyList<TvFieldPlayerPosition> CalculatePlayerPositions(
        int matchId,
        string teamA,
        string teamB,
        int possessionA,
        int possessionB,
        decimal? variationA,
        decimal? variationB,
        string leader,
        string momentumOwner,
        int hotScore,
        int competitiveness,
        MarketFlowState flowA,
        MarketFlowState flowB,
        string ballOwner,
        int ballCarrierA,
        int ballCarrierB,
        (string TeamSymbol, int PlayerIndex) highlight)
    {
        var positions = new List<TvFieldPlayerPosition>(14);

        positions.AddRange(BuildTeamPositions(
            matchId,
            teamA,
            true,
            possessionA,
            variationA,
            leader,
            momentumOwner,
            hotScore,
            competitiveness,
            flowA,
            string.Equals(ballOwner, teamA, StringComparison.OrdinalIgnoreCase),
            ballCarrierA,
            highlight));

        positions.AddRange(BuildTeamPositions(
            matchId,
            teamB,
            false,
            possessionB,
            variationB,
            leader,
            momentumOwner,
            hotScore,
            competitiveness,
            flowB,
            string.Equals(ballOwner, teamB, StringComparison.OrdinalIgnoreCase),
            ballCarrierB,
            highlight));

        return positions;
    }

    public (string TeamSymbol, int PlayerIndex) CalculateHighlightedPlayer(
        string teamA,
        string teamB,
        int scoreA,
        int scoreB,
        string momentumOwner,
        IReadOnlyList<MatchScoreEventDto>? events)
    {
        var latestEvent = events?
            .OrderByDescending(x => x.MatchScoreEventId)
            .FirstOrDefault();

        if (latestEvent is not null && !string.IsNullOrWhiteSpace(latestEvent.TeamSymbol))
            return (latestEvent.TeamSymbol, 6);

        if (!string.IsNullOrWhiteSpace(momentumOwner))
            return (momentumOwner, 5);

        return scoreA >= scoreB ? (teamA, 5) : (teamB, 5);
    }

    private IReadOnlyList<TvFieldRecentEvent> BuildRecentEvents(
        MatchDto? match,
        string teamA,
        string teamB,
        int scoreA,
        int scoreB,
        IReadOnlyList<MatchScoreEventDto>? events,
        string culture)
    {
        if (events is not null && events.Count > 0)
        {
            return events
                .OrderByDescending(x => x.MatchScoreEventId)
                .Take(5)
                .Select(x => new TvFieldRecentEvent
                {
                    ClockLabel = FormatArenaClock(match?.StartTime, x.EventTimeUtc),
                    TeamSymbol = x.TeamSymbol,
                    Description = BuildEventDescription(x, culture),
                    ScoreLabel = BuildScoreLabel(teamA, teamB, scoreA, scoreB, x.TeamSymbol),
                    IsHighlight = string.Equals(x.EventType, "goal", StringComparison.OrdinalIgnoreCase)
                        || x.Points > 0
                })
                .ToList();
        }

        return
        [
            new TvFieldRecentEvent
            {
                ClockLabel = "--:--",
                TeamSymbol = ResolveLeader(teamA, teamB, scoreA, scoreB, match?.PctA, match?.PctB, null),
                Description = scoreA == scoreB
                    ? T("field.recentEventsFallbackTight", culture)
                    : T("field.recentEventsFallbackLead", culture),
                ScoreLabel = $"{scoreA}-{scoreB}",
                IsHighlight = true
            }
        ];
    }

    private IEnumerable<TvFieldPlayerPosition> BuildTeamPositions(
        int matchId,
        string teamSymbol,
        bool isLeft,
        int possession,
        decimal? variation,
        string leader,
        string momentumOwner,
        int hotScore,
        int competitiveness,
        MarketFlowState flow,
        bool hasBall,
        int ballCarrierIndex,
        (string TeamSymbol, int PlayerIndex) highlight)
    {
        var heatFactor = Math.Clamp((hotScore - 50d) / 50d, 0d, 1d);
        var balanceFactor = Math.Clamp((competitiveness - 60d) / 40d, 0d, 1d);

        var territorialIntensity = CalculateTerritorialPressure(possession, flow.TerritorialAdvance);
        var attackIntensity = CalculateAttackIntensity(flow.AttackIntensity, flow.Pressure);
        var defensiveRetreat = CalculateDefensiveRetreat(flow.DefensiveRetreat, flow.Pressure);
        var momentumAcceleration = CalculateMomentumAcceleration(flow.MomentumAcceleration);

        var possessionPush = territorialIntensity * 8.0d;
        var variationPush = Math.Clamp((double)(variation ?? 0m) * 0.28d, -3.2d, 3.2d);
        var leadPush = string.Equals(leader, teamSymbol, StringComparison.OrdinalIgnoreCase) ? 1.1d : -0.9d;
        var momentumPush = string.Equals(momentumOwner, teamSymbol, StringComparison.OrdinalIgnoreCase) ? 1.4d : -0.6d;

        // Snapshots should drive movement. Legacy factors still bias slightly so behavior doesn't collapse when snapshots are missing.
        var flowBias = (flow.Pressure * 6.4d) + (flow.MomentumAcceleration * 2.8d);
        var attackBias = possessionPush + variationPush + leadPush + momentumPush + flowBias;

        var leftBase = isLeft ? 17d : 83d;
        var leftDirection = isLeft ? 1d : -1d;

        var territorialAdvance = flow.TerritorialAdvance * 10.0d;
        var teamShift = (possessionPush * 0.22d) + (territorialAdvance * 0.35d);

        if (TvLog.ShouldLog($"territory:{matchId}:{teamSymbol}", 2500))
            Console.WriteLine($"[TV_TERRITORY] {teamSymbol} possession={possession}% territorial={territorialIntensity:F2} teamShift={teamShift:F2}");

        var isLateralMarket = Math.Abs(flow.Pressure) < 0.18d && Math.Abs(flow.MomentumAcceleration) < 0.18d;
        var compactness = isLateralMarket ? 1d : Math.Clamp(0.55d - (Math.Abs(flow.Pressure) * 0.25d) - (Math.Abs(flow.MomentumAcceleration) * 0.25d), 0d, 0.65d);
        var lineScale =
            1d
            + (attackIntensity * 0.22d)
            - (defensiveRetreat * 0.18d)
            - (compactness * 0.28d)
            + (momentumAcceleration * 0.06d);

        var xLines = new[]
        {
            0d,
            9d,
            18d,
            24d,
            33d,
            40d,
            47d
        };

        var yLines = new[]
        {
            50d,
            30d,
            43d,
            61d,
            29d,
            71d,
            50d
        };

        for (var i = 0; i < 7; i++)
        {
            var rowAttackWeight = i switch
            {
                0 => 0.03d,
                1 => 0.22d,
                2 or 3 => 0.42d,
                4 or 5 => 0.72d,
                _ => 0.95d
            };

            var scaledLine = i == 0 ? 0d : xLines[i] * lineScale;
            var xBase = leftBase + (scaledLine * leftDirection);

            var x =
                xBase
                + (teamShift * leftDirection)
                + (attackBias * rowAttackWeight * leftDirection)
                + BuildMicroJitter(teamSymbol, i, isXAxis: true);

            var y =
                yLines[i]
                + BuildVerticalAdjustment(i, territorialIntensity, balanceFactor, heatFactor, attackIntensity, defensiveRetreat, compactness)
                + BuildMicroJitter(teamSymbol, i, isXAxis: false);

            x = ClampToVisibleField(x, isLeft, i, possession, flow.TerritorialAdvance);
            y = ClampToVisibleFieldY(y, i, defensiveRetreat, compactness);

            var playerHasBall = hasBall && i == ballCarrierIndex;

            // Smooth the resulting positions to avoid teleports (the render runs faster than snapshot updates).
            var targetX = x;
            var targetY = y;
            (x, y) = SmoothPosition(matchId, teamSymbol, i, targetX, targetY);

            var shouldLogPlayers = TvLog.ShouldLog($"players:{matchId}:{teamSymbol}", 3000);
            if (shouldLogPlayers)
                Console.WriteLine($"[TV_PLAYER] {teamSymbol} idx={i} x={x:F1} y={y:F1} ball={playerHasBall}");

            if (playerHasBall && TvLog.ShouldLog($"smooth:{matchId}:{teamSymbol}", 3000))
                Console.WriteLine($"[TV_SMOOTH] {teamSymbol}:{i} targetX={targetX:F1} finalX={x:F1}");

            yield return new TvFieldPlayerPosition
            {
                TeamSymbol = teamSymbol,
                PlayerIndex = i,
                XPercent = x,
                YPercent = y,
                Pressure = Math.Clamp(flow.Pressure, -1d, 1d),
                HasBall = playerHasBall,
                IsAttacking = i >= 4 || (i >= 2 && (attackBias > 3d || attackIntensity > 0.55d)),
                IsDefending = i <= 2 && (attackBias < -2d || defensiveRetreat > 0.55d),
                IsHighlighted = string.Equals(highlight.TeamSymbol, teamSymbol, StringComparison.OrdinalIgnoreCase)
                    && highlight.PlayerIndex == i
            };
        }
    }

    private static double ClampToVisibleField(double x, bool isLeft, int playerIndex, int possession, double territorialAdvance)
    {
        var safeMin = 12d;
        var safeMax = 88d;

        if (isLeft)
        {
            var maxAdvance = possession switch
            {
                >= 64 => 66d,
                >= 60 => 61d,
                >= 56 => 56d,
                >= 52 => 52d,
                _ => 48d
            };

            // Snapshots can create burst pressure; allow extra advance but never leave the field or invalidate possession bands.
            maxAdvance += Math.Clamp(territorialAdvance, 0d, 2d) * 6.0d;

            var minRetreat = playerIndex == 0 ? 13d : 15d;
            return Math.Clamp(x, minRetreat, Math.Min(maxAdvance, safeMax));
        }
        else
        {
            var minAdvance = possession switch
            {
                >= 64 => 34d,
                >= 60 => 39d,
                >= 56 => 44d,
                >= 52 => 48d,
                _ => 52d
            };

            minAdvance -= Math.Clamp(territorialAdvance, 0d, 2d) * 6.0d;

            var maxRetreat = playerIndex == 0 ? 87d : 85d;
            return Math.Clamp(x, Math.Max(minAdvance, safeMin), maxRetreat);
        }
    }

    private static double ClampToVisibleFieldY(double y, int playerIndex, double defensiveRetreat, double compactness)
    {
        var baseMin = 20d;
        var baseMax = 80d;

        // Defensive blocks are naturally narrower; keep the block from drifting out of bounds.
        var tighten = (defensiveRetreat * 0.35d) + (compactness * 0.25d);
        var min = baseMin + (tighten * 3.5d);
        var max = baseMax - (tighten * 3.5d);

        // Keep wingers slightly wider when in full attack to avoid an overly compact blob.
        if (playerIndex is 4 or 5)
        {
            min -= 0.6d;
            max += 0.6d;
        }

        return Math.Clamp(y, min, max);
    }

    private static int ResolveBallCarrierIndex(string teamSymbol, int matchId, MarketFlowState flow, int possession)
    {
        var tick = DateTime.UtcNow.Second + (matchId * 7) + teamSymbol.GetHashCode(StringComparison.OrdinalIgnoreCase);

        var isAttacking = possession >= 60 || flow.AttackIntensity >= 0.62d || flow.TerritorialAdvance >= 0.55d;
        var isDefending = possession <= 40 || flow.DefensiveRetreat >= 0.62d || flow.TerritorialAdvance <= -0.55d;

        if (isAttacking)
            return 4 + (Math.Abs(tick) % 3);

        if (isDefending)
            return 1 + (Math.Abs(tick) % 3);

        return 2 + (Math.Abs(tick) % 3);
    }

    private static string ResolveLeader(
        string teamA,
        string teamB,
        int scoreA,
        int scoreB,
        decimal? variationA,
        decimal? variationB,
        string? hotLeader)
    {
        if (!string.IsNullOrWhiteSpace(hotLeader))
            return hotLeader;

        if (scoreA != scoreB)
            return scoreA > scoreB ? teamA : teamB;

        return (variationA ?? 0m) >= (variationB ?? 0m) ? teamA : teamB;
    }

    private static string ResolveMomentumOwner(
        string teamA,
        string teamB,
        string? momentumLabel,
        string? pressureSymbol,
        string leader)
    {
        if (!string.IsNullOrWhiteSpace(momentumLabel))
        {
            if (momentumLabel.Contains(teamA, StringComparison.OrdinalIgnoreCase))
                return teamA;

            if (momentumLabel.Contains(teamB, StringComparison.OrdinalIgnoreCase))
                return teamB;
        }

        if (!string.IsNullOrWhiteSpace(pressureSymbol))
            return pressureSymbol;

        return leader;
    }

    private static int CalculateCompetitiveness(
        int scoreA,
        int scoreB,
        decimal? variationA,
        decimal? variationB,
        int? hotScore)
    {
        if (hotScore.HasValue && hotScore.Value > 0)
            return hotScore.Value;

        var scoreGap = Math.Abs(scoreA - scoreB);
        var variationGap = Math.Abs((variationA ?? 0m) - (variationB ?? 0m));

        return Math.Clamp(92 - (scoreGap * 14) - (int)(variationGap * 8m), 38, 96);
    }

    private string BuildEventDescription(MatchScoreEventDto scoreEvent, string culture)
    {
        if (!string.IsNullOrWhiteSpace(scoreEvent.Description))
            return scoreEvent.Description;

        if (scoreEvent.Points > 0)
            return T("field.goalFor", culture, scoreEvent.TeamSymbol);

        return T("field.recentEventsFallbackLead", culture);
    }

    private static string BuildScoreLabel(string teamA, string teamB, int scoreA, int scoreB, string eventTeam)
    {
        if (string.Equals(eventTeam, teamA, StringComparison.OrdinalIgnoreCase))
            return $"{scoreA}-{scoreB}";

        if (string.Equals(eventTeam, teamB, StringComparison.OrdinalIgnoreCase))
            return $"{scoreB}-{scoreA}";

        return $"{scoreA}-{scoreB}";
    }

    private static string FormatArenaClock(DateTime? matchStartUtc, DateTime eventTimeUtc)
    {
        if (!matchStartUtc.HasValue)
            return eventTimeUtc.ToString("HH:mm", CultureInfo.InvariantCulture);

        var elapsed = eventTimeUtc - matchStartUtc.Value.ToUniversalTime();
        if (elapsed < TimeSpan.Zero)
            elapsed = TimeSpan.Zero;

        var minutes = (int)Math.Floor(elapsed.TotalMinutes);
        return $"{minutes:00}:{elapsed.Seconds:00}";
    }

    private string T(string key, string culture, params object?[] args)
        => _localization.T($"tv.{key}", culture, args);

    private static double BuildMicroJitter(string teamSymbol, int index, bool isXAxis)
    {
        var tick = DateTime.UtcNow.Ticks / TimeSpan.TicksPerMillisecond;
        var seed = $"{teamSymbol}:{index}:{(isXAxis ? "x" : "y")}:{tick / 40}";
        var hash = seed.Aggregate(17, (current, ch) => (current * 31) + ch);
        var normalized = Math.Sin(hash) * 0.5d + 0.5d;
        var amplitude = 0.14d;

        return (normalized - 0.5d) * amplitude;
    }

    private static double BuildVerticalAdjustment(
        int playerIndex,
        double territorialIntensity,
        double balanceFactor,
        double heatFactor,
        double attackIntensity,
        double defensiveRetreat,
        double compactness)
    {
        var centerPull = playerIndex switch
        {
            0 => 0d,
            1 or 4 => -0.8d,
            2 or 5 => 0.8d,
            3 or 6 => 0d,
            _ => 0d
        };

        var blockNarrowing = (defensiveRetreat * 0.95d) + (compactness * 0.65d);
        var widthFactor = 1d - (blockNarrowing * 0.55d);

        // When pressing, spread slightly; when defending, compact.
        var pressureWidth = territorialIntensity * 0.9d * (playerIndex is 4 or 5 ? 0.8d : 0.35d);
        var pressureLift = territorialIntensity * (playerIndex >= 4 ? -0.55d : 0.35d);
        var heatLift = heatFactor * (playerIndex is 4 or 5 or 6 ? 0.8d : .4d);
        var balancePull = balanceFactor * (playerIndex is 3 or 6 ? -0.5d : 0d);

        var attackSpread = (attackIntensity * 0.85d) * (playerIndex is 4 or 5 ? 0.9d : 0.25d);
        var vertical = (centerPull + pressureWidth + attackSpread) * widthFactor;

        return vertical + pressureLift + heatLift + balancePull;
    }

    private MarketFlowState CalculateMarketFlow(string teamSymbol, IReadOnlyList<MatchMetricSnapshotDto>? snapshots)
    {
        if (snapshots is null || snapshots.Count < 2 || string.IsNullOrWhiteSpace(teamSymbol))
            return new MarketFlowState();

        var recent = snapshots
            .Where(x => string.Equals(x.TeamSymbol, teamSymbol, StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(x => x.CapturedAtUtc)
            .Take(8)
            .OrderBy(x => x.CapturedAtUtc)
            .ToList();

        if (recent.Count < 2)
            return new MarketFlowState();

        var first = recent[0];
        var last = recent[^1];

        var minutes = Math.Max(0.5d, (last.CapturedAtUtc - first.CapturedAtUtc).TotalMinutes);
        var pctFirst = (double)first.PercentageChange;
        var pctLast = (double)last.PercentageChange;
        var slope = (pctLast - pctFirst) / minutes;

        var pctDeltas = new List<double>(recent.Count - 1);
        var volumeSeries = new List<double>(recent.Count);
        var tradeSeries = new List<double>(recent.Count);

        for (var i = 0; i < recent.Count; i++)
        {
            volumeSeries.Add((double)recent[i].QuoteVolume);
            tradeSeries.Add(recent[i].TradeCount);

            if (i == 0)
                continue;

            pctDeltas.Add((double)(recent[i].PercentageChange - recent[i - 1].PercentageChange));
        }

        var lastDelta = pctDeltas.Count == 0 ? 0d : pctDeltas[^1];
        var prevAvgDelta = pctDeltas.Count <= 1
            ? 0d
            : pctDeltas.Take(pctDeltas.Count - 1).Average();

        var acceleration = lastDelta - prevAvgDelta;
        var momentum = pctDeltas.Count == 0 ? 0d : pctDeltas.Skip(Math.Max(0, pctDeltas.Count - 3)).Average();

        // Amplify: snapshots must visibly drive the field. These are in "pct-change points per snapshot/minute".
        momentum *= 8.0d;
        slope *= 6.0d;
        acceleration *= 12.0d;

        var volumeLast = volumeSeries[^1];
        var volumePrevAvg = volumeSeries.Count <= 1 ? volumeLast : volumeSeries.Take(volumeSeries.Count - 1).Average();
        var volumeGrowth = CalculateGrowthFactor(volumePrevAvg, volumeLast);

        var tradeLast = tradeSeries[^1];
        var tradePrevAvg = tradeSeries.Count <= 1 ? tradeLast : tradeSeries.Take(tradeSeries.Count - 1).Average();
        var tradeGrowth = CalculateGrowthFactor(tradePrevAvg, tradeLast);

        var activity = 1.0d + (volumeGrowth * 0.75d) + (tradeGrowth * 0.45d);
        activity = Math.Clamp(activity, 0.35d, 2.25d);

        // Pressure: react aggressively to short-term slope/momentum and to acceleration bursts.
        var rawPressure = ((slope * 1.0d) + (momentum * 1.0d) + (acceleration * 0.85d)) * activity;
        var pressure = Math.Clamp(rawPressure, -2.0d, 2.0d);

        // Attack/defense intensity: allow > 1 so movement can be obvious; clamps happen later at field edges.
        var attackIntensity = Math.Clamp((Math.Max(0d, pressure) * 0.70d) + Math.Max(0d, volumeGrowth) * 0.85d + Math.Max(0d, acceleration) * 0.20d, 0d, 2.0d);
        var defensiveRetreat = Math.Clamp((Math.Max(0d, -pressure) * 0.70d) + Math.Max(0d, -volumeGrowth) * 0.85d + Math.Max(0d, -acceleration) * 0.20d, 0d, 2.0d);

        var momentumAcceleration = Math.Clamp(acceleration * 0.55d, -2.0d, 2.0d);

        // Territorial: aggressive blend (as requested) so pumps/dumps visibly shift the block.
        var territorialAdvance =
            (pressure * 0.7d)
            + (momentum * 0.9d)
            + (acceleration * 1.2d);
        territorialAdvance = Math.Clamp(territorialAdvance, -2.0d, 2.0d);

        return new MarketFlowState
        {
            Pressure = pressure,
            AttackIntensity = attackIntensity,
            DefensiveRetreat = defensiveRetreat,
            MomentumAcceleration = momentumAcceleration,
            TerritorialAdvance = territorialAdvance
        };
    }

    private static double CalculateGrowthFactor(double previousAverage, double current)
    {
        var safePrev = Math.Max(0.0001d, previousAverage);
        var safeCur = Math.Max(0.0001d, current);
        var ratio = safeCur / safePrev;
        var log = Math.Log(ratio);
        // Allow bigger "volume shock" signals so the field actually reacts.
        return Math.Clamp(log, -2d, 2d);
    }

    private static double CalculateTerritorialPressure(int possession, double territorialAdvance)
    {
        // Possession anchors the overall territory. Snapshots can add short bursts but shouldn't invalidate the bar.
        var basePressure = Math.Clamp((possession - 50d) / 15d, -1d, 1d);
        var flowBoost = Math.Clamp(territorialAdvance, -2d, 2d) * 0.70d;
        return Math.Clamp(basePressure + flowBoost, -1d, 1d);
    }

    private static double CalculateAttackIntensity(double attackIntensity, double pressure)
        => Math.Clamp(attackIntensity + Math.Max(0d, pressure) * 0.10d, 0d, 1d);

    private static double CalculateDefensiveRetreat(double defensiveRetreat, double pressure)
        => Math.Clamp(defensiveRetreat + Math.Max(0d, -pressure) * 0.10d, 0d, 1d);

    private static double CalculateMomentumAcceleration(double momentumAcceleration)
        => Math.Clamp(momentumAcceleration, -1d, 1d);

    private static string ResolveBallOwner(
        string teamA,
        string teamB,
        int possessionA,
        int possessionB,
        string momentumOwner,
        MarketFlowState flowA,
        MarketFlowState flowB)
    {
        // Momentum owner remains a strong signal; snapshots/pressure can flip possession in real time.
        var flowDelta = flowA.Pressure - flowB.Pressure;
        if (flowDelta >= 0.35d && possessionA >= 47)
            return teamA;

        if (flowDelta <= -0.35d && possessionB >= 47)
            return teamB;

        if (!string.IsNullOrWhiteSpace(momentumOwner))
            return momentumOwner;

        return possessionA >= possessionB ? teamA : teamB;
    }

    private static (double X, double Y) SmoothPosition(int matchId, string teamSymbol, int playerIndex, double targetX, double targetY)
    {
        if (matchId <= 0 || string.IsNullOrWhiteSpace(teamSymbol))
            return (targetX, targetY);

        // Avoid unbounded growth if the TV keeps switching matches.
        if (_smoothedPositions.Count > 700)
        {
            var cutoff = DateTime.UtcNow.AddSeconds(-45);
            foreach (var entry in _smoothedPositions)
            {
                if (entry.Value.LastUpdatedUtc < cutoff)
                    _smoothedPositions.TryRemove(entry.Key, out _);
            }
        }

        var key = $"{matchId}:{teamSymbol}:{playerIndex}";
        var now = DateTime.UtcNow;

        var current = _smoothedPositions.AddOrUpdate(
            key,
            _ => new SmoothedPlayerState(targetX, targetY, now),
            (_, previous) =>
            {
                var dt = (now - previous.LastUpdatedUtc).TotalSeconds;
                dt = Math.Clamp(dt, 0d, 0.25d);

                // Exponential smoothing: fast enough to feel responsive, slow enough to avoid teleports.
                var alpha = 1d - Math.Exp(-dt * 22.0d);
                var x = Lerp(previous.X, targetX, alpha);
                var y = Lerp(previous.Y, targetY, alpha);
                return new SmoothedPlayerState(x, y, now);
            });

        return (current.X, current.Y);
    }

    private static double Lerp(double a, double b, double t) => a + ((b - a) * Math.Clamp(t, 0d, 1d));

    private sealed record SmoothedPlayerState(double X, double Y, DateTime LastUpdatedUtc);

    private static void MaybeLogBallCarrier(int matchId, string teamSymbol, string ballOwner, int ballCarrierIndex)
    {
        if (matchId <= 0 || string.IsNullOrWhiteSpace(teamSymbol))
            return;

        var key = $"{matchId}:{teamSymbol}";
        if (!_lastBallCarrierByTeam.TryGetValue(key, out var last) || last != ballCarrierIndex)
        {
            _lastBallCarrierByTeam[key] = ballCarrierIndex;
            if (TvLog.ShouldLog($"ball:{key}", 750))
                Console.WriteLine($"[TV_BALL] {teamSymbol} carrier={ballCarrierIndex} owner={ballOwner}");
        }
    }

    private static class TvLog
    {
        public static bool ShouldLog(string key, int intervalMs)
        {
            var nowTick = Environment.TickCount64;
            var lastTick = _lastLogTickByKey.GetOrAdd(key, _ => 0);
            if (nowTick - lastTick < intervalMs)
                return false;

            _lastLogTickByKey[key] = nowTick;
            return true;
        }
    }
}
