using DTOs;
using Microsoft.AspNetCore.SignalR;

namespace CriptoVersus.API.Hubs
{
    public sealed class DashboardHub : Hub
    {
    }
}

namespace CriptoVersus.API.Services
{
    public interface IMatchScoreRebuildService
    {
        Task<MatchScoreRebuildResult> RebuildAsync(int matchId, CancellationToken ct);
    }

    public sealed class MatchScoreRebuildResult
    {
        public int MatchId { get; init; }
        public string RuleType { get; init; } = string.Empty;
        public int SnapshotPairsProcessed { get; init; }
        public int EventsRebuilt { get; init; }
        public int ScoreA { get; init; }
        public int ScoreB { get; init; }
    }
}

namespace BLL.ArenaSentiment
{
    public interface IArenaSentimentService
    {
        Task<ArenaSentimentDto> GetArenaSentimentAsync(string symbol, CancellationToken ct = default);
        Task<ArenaSentimentPairDto> GetArenaSentimentForMatchAsync(string homeSymbol, string awaySymbol, CancellationToken ct = default);
        Task<ArenaPressureGoalResult> CalculateArenaPressureGoalAsync(int matchId, CancellationToken ct = default);
    }

    public sealed class ArenaPressureGoalResult
    {
        public bool GoalAwarded { get; init; }
        public int? WinnerTeamId { get; init; }
        public string? WinnerSymbol { get; init; }
        public string? LoserSymbol { get; init; }
        public int? WinnerScore { get; init; }
        public int? LoserScore { get; init; }
        public int? ScoreDiff { get; init; }
        public int ChargesBefore { get; init; }
        public int ChargesAfter { get; init; }
        public bool DataSufficient { get; init; }
    }
}
