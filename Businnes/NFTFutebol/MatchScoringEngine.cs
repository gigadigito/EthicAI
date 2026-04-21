using DAL.NftFutebol;

namespace BLL.NFTFutebol
{
    public interface IMatchScoringEngine
    {
        MatchScoringResult Evaluate(MatchScoringContext context);
    }

    public sealed class MatchScoringEngine : IMatchScoringEngine
    {
        public MatchScoringResult Evaluate(MatchScoringContext context)
        {
            ArgumentNullException.ThrowIfNull(context);
            ArgumentNullException.ThrowIfNull(context.State);

            return context.RuleType switch
            {
                MatchScoringRuleType.PercentThreshold => EvaluatePercentThreshold(context),
                MatchScoringRuleType.PercentageCrossover => EvaluatePercentageCrossover(context),
                MatchScoringRuleType.VolumeWindow => EvaluateVolumeWindow(context),
                MatchScoringRuleType.VolumeCrossover => EvaluateVolumeCrossover(context),
                _ => MatchScoringResult.Empty(context.State)
            };
        }

        private static MatchScoringResult EvaluatePercentThreshold(MatchScoringContext context)
        {
            var events = new List<PendingMatchScoreEvent>();
            var teamAScore = context.CurrentScoreA;
            var teamBScore = context.CurrentScoreB;
            var thresholds = context.PercentThresholds.OrderBy(x => x).ToArray();
            var delta = Math.Abs(context.TeamA.PercentageChange - context.TeamB.PercentageChange);

            if (context.TeamA.PercentageChange != context.TeamB.PercentageChange && thresholds.Length > 0)
            {
                var teamIsA = context.TeamA.PercentageChange > context.TeamB.PercentageChange;
                var awardedCount = teamIsA
                    ? context.State.ThresholdsAwardedToTeamA
                    : context.State.ThresholdsAwardedToTeamB;

                while (awardedCount < thresholds.Length && delta >= thresholds[awardedCount])
                {
                    var threshold = thresholds[awardedCount];

                    events.Add(new PendingMatchScoreEvent
                    {
                        TeamId = teamIsA ? context.TeamA.TeamId : context.TeamB.TeamId,
                        RuleType = MatchScoringRuleType.PercentThreshold,
                        EventType = "PERCENT_THRESHOLD_REACHED",
                        ReasonCode = $"PERCENT_DIFF_GTE_{threshold:0.##}",
                        Points = 1,
                        TeamPercentageChange = teamIsA ? context.TeamA.PercentageChange : context.TeamB.PercentageChange,
                        OpponentPercentageChange = teamIsA ? context.TeamB.PercentageChange : context.TeamA.PercentageChange,
                        MetricDelta = delta,
                        EventTimeUtc = context.EvaluatedAtUtc,
                        Description = $"{(teamIsA ? context.TeamA.Symbol : context.TeamB.Symbol)} marcou 1 ponto ao atingir diferenca de valorizacao igual ou superior a {threshold:0.##}%."
                    });

                    if (teamIsA)
                    {
                        teamAScore++;
                        context.State.ThresholdsAwardedToTeamA++;
                    }
                    else
                    {
                        teamBScore++;
                        context.State.ThresholdsAwardedToTeamB++;
                    }

                    awardedCount++;
                }
            }

            ApplyPercentageCrossover(
                context,
                events,
                ref teamAScore,
                ref teamBScore);

            return MatchScoringResult.From(context.State, teamAScore, teamBScore, events);
        }

        private static MatchScoringResult EvaluatePercentageCrossover(MatchScoringContext context)
        {
            var events = new List<PendingMatchScoreEvent>();
            var teamAScore = context.CurrentScoreA;
            var teamBScore = context.CurrentScoreB;

            ApplyPercentageCrossover(
                context,
                events,
                ref teamAScore,
                ref teamBScore);

            return MatchScoringResult.From(context.State, teamAScore, teamBScore, events);
        }

        private static void ApplyPercentageCrossover(
            MatchScoringContext context,
            List<PendingMatchScoreEvent> events,
            ref int teamAScore,
            ref int teamBScore)
        {
            if (context.PreviousTeamA is null || context.PreviousTeamB is null)
            {
                context.State.LastPercentageLeaderTeamId = ResolveLeader(
                    context.TeamA.TeamId,
                    context.TeamA.PercentageChange,
                    context.TeamB.TeamId,
                    context.TeamB.PercentageChange);

                return;
            }

            var previousDiff = context.PreviousTeamA.PercentageChange - context.PreviousTeamB.PercentageChange;
            var currentDiff = context.TeamA.PercentageChange - context.TeamB.PercentageChange;

            if (previousDiff < 0m && currentDiff >= 0m)
            {
                teamAScore++;
                events.Add(new PendingMatchScoreEvent
                {
                    TeamId = context.TeamA.TeamId,
                    RuleType = MatchScoringRuleType.PercentageCrossover,
                    EventType = "PERCENTAGE_CROSSOVER_UP",
                    ReasonCode = "PERCENTAGE_CROSSOVER_UP",
                    Points = 1,
                    TeamPercentageChange = context.TeamA.PercentageChange,
                    OpponentPercentageChange = context.TeamB.PercentageChange,
                    MetricDelta = currentDiff,
                    EventTimeUtc = context.EvaluatedAtUtc,
                    Description = $"{context.TeamA.Symbol} marcou 1 ponto por cruzar a linha de valorizacao percentual para cima."
                });
            }
            else if (previousDiff > 0m && currentDiff <= 0m)
            {
                teamBScore++;
                events.Add(new PendingMatchScoreEvent
                {
                    TeamId = context.TeamB.TeamId,
                    RuleType = MatchScoringRuleType.PercentageCrossover,
                    EventType = "PERCENTAGE_CROSSOVER_UP",
                    ReasonCode = "PERCENTAGE_CROSSOVER_UP",
                    Points = 1,
                    TeamPercentageChange = context.TeamB.PercentageChange,
                    OpponentPercentageChange = context.TeamA.PercentageChange,
                    MetricDelta = -currentDiff,
                    EventTimeUtc = context.EvaluatedAtUtc,
                    Description = $"{context.TeamB.Symbol} marcou 1 ponto por cruzar a linha de valorizacao percentual para cima."
                });
            }

            context.State.LastPercentageLeaderTeamId = ResolveLeader(
                context.TeamA.TeamId,
                context.TeamA.PercentageChange,
                context.TeamB.TeamId,
                context.TeamB.PercentageChange);
        }

        private static MatchScoringResult EvaluateVolumeCrossover(MatchScoringContext context)
        {
            var events = new List<PendingMatchScoreEvent>();
            var teamAScore = context.CurrentScoreA;
            var teamBScore = context.CurrentScoreB;

            if (context.PreviousTeamA is null || context.PreviousTeamB is null)
            {
                context.State.LastVolumeLeaderTeamId = ResolveLeader(
                    context.TeamA.TeamId,
                    context.TeamA.QuoteVolume,
                    context.TeamB.TeamId,
                    context.TeamB.QuoteVolume);

                return MatchScoringResult.From(context.State, teamAScore, teamBScore, events);
            }

            var previousDiff = context.PreviousTeamA.QuoteVolume - context.PreviousTeamB.QuoteVolume;
            var currentDiff = context.TeamA.QuoteVolume - context.TeamB.QuoteVolume;

            if (previousDiff < 0m && currentDiff >= 0m)
            {
                teamAScore++;
                events.Add(new PendingMatchScoreEvent
                {
                    TeamId = context.TeamA.TeamId,
                    RuleType = MatchScoringRuleType.VolumeCrossover,
                    EventType = "VOLUME_CROSSOVER_UP",
                    ReasonCode = "VOLUME_CROSSOVER_UP",
                    Points = 1,
                    TeamQuoteVolume = context.TeamA.QuoteVolume,
                    OpponentQuoteVolume = context.TeamB.QuoteVolume,
                    MetricDelta = currentDiff,
                    EventTimeUtc = context.EvaluatedAtUtc,
                    Description = $"{context.TeamA.Symbol} marcou 1 ponto por cruzar a linha de volume para cima."
                });
            }
            else if (previousDiff > 0m && currentDiff <= 0m)
            {
                teamBScore++;
                events.Add(new PendingMatchScoreEvent
                {
                    TeamId = context.TeamB.TeamId,
                    RuleType = MatchScoringRuleType.VolumeCrossover,
                    EventType = "VOLUME_CROSSOVER_UP",
                    ReasonCode = "VOLUME_CROSSOVER_UP",
                    Points = 1,
                    TeamQuoteVolume = context.TeamB.QuoteVolume,
                    OpponentQuoteVolume = context.TeamA.QuoteVolume,
                    MetricDelta = -currentDiff,
                    EventTimeUtc = context.EvaluatedAtUtc,
                    Description = $"{context.TeamB.Symbol} marcou 1 ponto por cruzar a linha de volume para cima."
                });
            }

            context.State.LastVolumeLeaderTeamId = ResolveLeader(
                context.TeamA.TeamId,
                context.TeamA.QuoteVolume,
                context.TeamB.TeamId,
                context.TeamB.QuoteVolume);

            return MatchScoringResult.From(context.State, teamAScore, teamBScore, events);
        }

        private static MatchScoringResult EvaluateVolumeWindow(MatchScoringContext context)
        {
            var events = new List<PendingMatchScoreEvent>();
            var teamAScore = context.CurrentScoreA;
            var teamBScore = context.CurrentScoreB;

            foreach (var window in context.ClosedVolumeWindows.OrderBy(x => x.WindowStartUtc))
            {
                if (window.TeamAVolume == window.TeamBVolume)
                {
                    context.State.LastProcessedVolumeWindowStartUtc = window.WindowStartUtc;
                    context.State.LastProcessedVolumeWindowEndUtc = window.WindowEndUtc;
                    continue;
                }

                var teamIsA = window.TeamAVolume > window.TeamBVolume;
                var teamId = teamIsA ? context.TeamA.TeamId : context.TeamB.TeamId;
                var symbol = teamIsA ? context.TeamA.Symbol : context.TeamB.Symbol;
                var teamVolume = teamIsA ? window.TeamAVolume : window.TeamBVolume;
                var opponentVolume = teamIsA ? window.TeamBVolume : window.TeamAVolume;

                events.Add(new PendingMatchScoreEvent
                {
                    TeamId = teamId,
                    RuleType = MatchScoringRuleType.VolumeWindow,
                    EventType = "VOLUME_WINDOW_WINNER",
                    ReasonCode = "VOLUME_WINDOW_WINNER",
                    Points = 1,
                    TeamQuoteVolume = teamVolume,
                    OpponentQuoteVolume = opponentVolume,
                    MetricDelta = teamVolume - opponentVolume,
                    WindowStartUtc = window.WindowStartUtc,
                    WindowEndUtc = window.WindowEndUtc,
                    EventTimeUtc = window.WindowEndUtc,
                    Description = $"{symbol} marcou 1 ponto por vencer a janela de volume de {window.WindowStartUtc:HH:mm} as {window.WindowEndUtc:HH:mm}."
                });

                if (teamIsA)
                    teamAScore++;
                else
                    teamBScore++;

                context.State.LastProcessedVolumeWindowStartUtc = window.WindowStartUtc;
                context.State.LastProcessedVolumeWindowEndUtc = window.WindowEndUtc;
            }

            return MatchScoringResult.From(context.State, teamAScore, teamBScore, events);
        }

        private static int? ResolveLeader(int teamAId, decimal metricA, int teamBId, decimal metricB)
        {
            if (metricA == metricB)
                return null;

            return metricA > metricB ? teamAId : teamBId;
        }
    }

    public sealed class MatchScoringContext
    {
        public required MatchScoringRuleType RuleType { get; init; }
        public required int CurrentScoreA { get; init; }
        public required int CurrentScoreB { get; init; }
        public required TeamMetricPoint TeamA { get; init; }
        public required TeamMetricPoint TeamB { get; init; }
        public TeamMetricPoint? PreviousTeamA { get; init; }
        public TeamMetricPoint? PreviousTeamB { get; init; }
        public required MatchScoreState State { get; init; }
        public required DateTime EvaluatedAtUtc { get; init; }
        public required IReadOnlyCollection<decimal> PercentThresholds { get; init; }
        public IReadOnlyCollection<ClosedVolumeWindow> ClosedVolumeWindows { get; init; } = Array.Empty<ClosedVolumeWindow>();
    }

    public sealed class MatchScoringResult
    {
        public int ScoreA { get; init; }
        public int ScoreB { get; init; }
        public MatchScoreState State { get; init; } = null!;
        public IReadOnlyCollection<PendingMatchScoreEvent> Events { get; init; } = Array.Empty<PendingMatchScoreEvent>();

        public static MatchScoringResult Empty(MatchScoreState state)
            => From(state, 0, 0, []);

        public static MatchScoringResult From(
            MatchScoreState state,
            int scoreA,
            int scoreB,
            IReadOnlyCollection<PendingMatchScoreEvent> events)
        {
            state.UpdatedAtUtc = DateTime.UtcNow;

            return new MatchScoringResult
            {
                ScoreA = scoreA,
                ScoreB = scoreB,
                State = state,
                Events = events
            };
        }
    }

    public sealed class PendingMatchScoreEvent
    {
        public int TeamId { get; init; }
        public MatchScoringRuleType RuleType { get; init; }
        public string EventType { get; init; } = string.Empty;
        public string? ReasonCode { get; init; }
        public int Points { get; init; }
        public decimal? TeamPercentageChange { get; init; }
        public decimal? OpponentPercentageChange { get; init; }
        public decimal? TeamQuoteVolume { get; init; }
        public decimal? OpponentQuoteVolume { get; init; }
        public decimal? MetricDelta { get; init; }
        public DateTime? WindowStartUtc { get; init; }
        public DateTime? WindowEndUtc { get; init; }
        public string Description { get; init; } = string.Empty;
        public DateTime EventTimeUtc { get; init; }
    }

    public sealed class TeamMetricPoint
    {
        public int TeamId { get; init; }
        public string Symbol { get; init; } = string.Empty;
        public decimal PercentageChange { get; init; }
        public decimal QuoteVolume { get; init; }
        public long TradeCount { get; init; }
    }

    public sealed class ClosedVolumeWindow
    {
        public required DateTime WindowStartUtc { get; init; }
        public required DateTime WindowEndUtc { get; init; }
        public required decimal TeamAVolume { get; init; }
        public required decimal TeamBVolume { get; init; }
    }
}
