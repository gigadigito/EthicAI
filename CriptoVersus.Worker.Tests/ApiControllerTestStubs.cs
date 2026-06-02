using DTOs;
using Microsoft.AspNetCore.SignalR;

namespace CriptoVersus.API.Hubs
{
    public sealed class DashboardHub : Hub
    {
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
