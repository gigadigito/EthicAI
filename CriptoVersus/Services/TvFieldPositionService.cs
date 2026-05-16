using System.Globalization;
using DTOs;

namespace CriptoVersus.Web.Services;

public sealed class TvFieldPositionService
{
    private readonly LocalizationService _localization;

    public TvFieldPositionService(LocalizationService localization)
    {
        _localization = localization;
    }

    public TvFieldStateDto BuildFieldState(
        MatchDto? match,
        TvHotMatchDto? hotMatch,
        IReadOnlyList<MatchScoreEventDto>? events,
        string culture)
    {
        if (match is null && hotMatch is null)
            return new TvFieldStateDto();

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
        (string TeamSymbol, int PlayerIndex) highlight)
    {
        var positions = new List<TvFieldPlayerPosition>(14);
        positions.AddRange(BuildTeamPositions(
            teamA,
            true,
            possessionA,
            variationA,
            leader,
            momentumOwner,
            hotScore,
            competitiveness,
            highlight));
        positions.AddRange(BuildTeamPositions(
            teamB,
            false,
            possessionB,
            variationB,
            leader,
            momentumOwner,
            hotScore,
            competitiveness,
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
        string teamSymbol,
        bool isLeft,
        int possession,
        decimal? variation,
        string leader,
        string momentumOwner,
        int hotScore,
        int competitiveness,
        (string TeamSymbol, int PlayerIndex) highlight)
    {
        // Future versions can replace this with movement driven by snapshots/candles.
        var heatFactor = Math.Clamp((hotScore - 50d) / 50d, 0d, 1d);
        var balanceFactor = Math.Clamp((competitiveness - 60d) / 40d, 0d, 1d);
        var possessionPush = ((possession - 50d) / 15d) * 10.5d;
        var variationPush = (double)(variation ?? 0m) * 1.8d;
        var leadPush = string.Equals(leader, teamSymbol, StringComparison.OrdinalIgnoreCase) ? 3.2d : -2.8d;
        var momentumPush = string.Equals(momentumOwner, teamSymbol, StringComparison.OrdinalIgnoreCase) ? 2.8d : -1.1d;
        var attackBias = possessionPush + variationPush + leadPush + momentumPush;

        var leftBase = isLeft ? 15d : 85d;
        var leftDirection = isLeft ? 1d : -1d;
        var xLines = new[] { 0d, 10d, 24d, 24d, 38d, 38d, 46d };
        var yLines = new[] { 50d, 28d, 42d, 62d, 26d, 74d, 50d };

        for (var i = 0; i < 7; i++)
        {
            var rowAttackWeight = i switch
            {
                0 => 0d,
                1 => 0.35d,
                2 or 3 => 0.55d,
                4 or 5 => 1.05d,
                _ => 1.35d
            };

            var xBase = leftBase + (xLines[i] * leftDirection);
            var x = xBase + (attackBias * rowAttackWeight * leftDirection) + BuildJitter(teamSymbol, i, hotScore, isXAxis: true);
            var y = yLines[i] + BuildVerticalAdjustment(i, possession, balanceFactor, heatFactor) + BuildJitter(teamSymbol, i, hotScore, isXAxis: false);
            var hasBall = i == 6 && string.Equals(momentumOwner, teamSymbol, StringComparison.OrdinalIgnoreCase);

            yield return new TvFieldPlayerPosition
            {
                TeamSymbol = teamSymbol,
                PlayerIndex = i,
                XPercent = Math.Clamp(x, isLeft ? 10d : 52d, isLeft ? 48d : 90d),
                YPercent = Math.Clamp(y, 15d, 84d),
                Pressure = Math.Clamp((possession - 50d) / 15d, -1d, 1d),
                HasBall = hasBall,
                IsAttacking = i >= 4 || (i >= 1 && attackBias * leftDirection > 4d),
                IsDefending = i <= 2 && attackBias * leftDirection < 0d,
                IsHighlighted = string.Equals(highlight.TeamSymbol, teamSymbol, StringComparison.OrdinalIgnoreCase)
                    && highlight.PlayerIndex == i
            };
        }
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

    private static double BuildJitter(string teamSymbol, int index, int hotScore, bool isXAxis)
    {
        var tick = DateTime.UtcNow.Second / 4;
        var seed = $"{teamSymbol}:{index}:{(isXAxis ? "x" : "y")}:{tick}";
        var hash = seed.Aggregate(17, (current, ch) => (current * 31) + ch);
        var normalized = Math.Sin(hash) * 0.5d + 0.5d;
        var amplitude = hotScore >= 75 ? 2.6d : 1.2d;
        return (normalized - 0.5d) * amplitude;
    }

    private static double BuildVerticalAdjustment(int playerIndex, int possession, double balanceFactor, double heatFactor)
    {
        var centerPull = playerIndex switch
        {
            0 => 0d,
            1 or 4 => -1.2d,
            2 or 5 => 1.2d,
            3 or 6 => 0d,
            _ => 0d
        };

        var pressureLift = ((possession - 50d) / 15d) * (playerIndex >= 4 ? -1.4d : .9d);
        var heatLift = heatFactor * (playerIndex is 4 or 5 or 6 ? 1.5d : .8d);
        var balancePull = balanceFactor * (playerIndex is 3 or 6 ? -1d : 0d);
        return centerPull + pressureLift + heatLift + balancePull;
    }
}
