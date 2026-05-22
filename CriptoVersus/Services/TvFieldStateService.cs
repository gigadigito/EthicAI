using System.Collections.Concurrent;
using DTOs;

namespace CriptoVersus.Web.Services;

public sealed class TvFieldStateService
{
    private readonly TvFieldPositionService _positionService;
    private static readonly ConcurrentDictionary<int, PossessionState> _possessionByMatch = new();

    public TvFieldStateService(TvFieldPositionService positionService)
    {
        _positionService = positionService;
    }

    public TvFieldStateDto BuildFieldState(
        MatchDto? match,
        TvHotMatchDto? hotMatch,
        IReadOnlyList<MatchScoreEventDto>? events,
        IReadOnlyList<MatchMetricSnapshotDto>? snapshots,
        string culture)
    {
        var state = _positionService.BuildFieldState(match, hotMatch, events, snapshots, culture);
        if (state.PlayerPositions.Count == 0)
            return state;

        var matchId = hotMatch?.MatchId ?? match?.MatchId ?? 0;
        if (matchId <= 0)
            return state;

        var ownerTeam = ResolveOwnerTeam(state);
        if (string.IsNullOrWhiteSpace(ownerTeam))
            return state;

        CleanupPossessionStatesIfNeeded();

        var possessionState = _possessionByMatch.AddOrUpdate(
            matchId,
            _ => new PossessionState(),
            (_, existing) => existing);

        possessionState.LastUpdatedUtc = DateTime.UtcNow;

        var teamPlayers = state.PlayerPositions
            .Where(player => string.Equals(player.TeamSymbol, ownerTeam, StringComparison.OrdinalIgnoreCase))
            .OrderBy(player => player.PlayerIndex)
            .ToList();

        var opponentPlayers = state.PlayerPositions
            .Where(player => !string.Equals(player.TeamSymbol, ownerTeam, StringComparison.OrdinalIgnoreCase))
            .OrderBy(player => player.PlayerIndex)
            .ToList();

        if (teamPlayers.Count == 0 || opponentPlayers.Count == 0)
            return state;

        var currentCarrier = ResolveCurrentCarrierIndex(state, ownerTeam, possessionState);
        var ownerPressure = string.Equals(ownerTeam, state.TeamA, StringComparison.OrdinalIgnoreCase)
            ? state.TeamPressureA
            : state.TeamPressureB;
        var ownerPossession = string.Equals(ownerTeam, state.TeamA, StringComparison.OrdinalIgnoreCase)
            ? state.PossessionA
            : state.PossessionB;
        var isLeftTeam = teamPlayers.Average(player => player.XPercent) < opponentPlayers.Average(player => player.XPercent);

        if (!string.Equals(possessionState.OwnerTeam, ownerTeam, StringComparison.OrdinalIgnoreCase))
        {
            possessionState.OwnerTeam = ownerTeam;
            possessionState.CurrentCarrierIndex = ResolveInitialCarrierIndex(ownerPossession, ownerPressure);
            possessionState.PreviousCarrierIndex = -1;
            possessionState.RecentReceivers.Clear();
            possessionState.NextDecisionUtc = DateTime.UtcNow.AddMilliseconds(ResolveDecisionDelayMs(ownerPossession, ownerPressure, ResolveRoleName(possessionState.CurrentCarrierIndex)));
        }
        else if (DateTime.UtcNow >= possessionState.NextDecisionUtc)
        {
            var nextCarrier = ResolveNextCarrierIndex(
                matchId,
                state,
                ownerTeam,
                teamPlayers,
                opponentPlayers,
                currentCarrier,
                ownerPossession,
                ownerPressure,
                isLeftTeam,
                possessionState);

            if (nextCarrier != currentCarrier)
            {
                possessionState.PreviousCarrierIndex = currentCarrier;
                possessionState.CurrentCarrierIndex = nextCarrier;
                possessionState.RecentReceivers.Enqueue(nextCarrier);
                while (possessionState.RecentReceivers.Count > 4)
                    possessionState.RecentReceivers.Dequeue();
            }

            possessionState.NextDecisionUtc = DateTime.UtcNow.AddMilliseconds(
                ResolveDecisionDelayMs(ownerPossession, ownerPressure, ResolveRoleName(possessionState.CurrentCarrierIndex)));
        }
        else
        {
            possessionState.CurrentCarrierIndex = currentCarrier;
        }

        var finalCarrierIndex = Math.Clamp(possessionState.CurrentCarrierIndex, 0, 6);
        var updatedPlayers = state.PlayerPositions
            .Select(player => new TvFieldPlayerPosition
            {
                TeamSymbol = player.TeamSymbol,
                PlayerIndex = player.PlayerIndex,
                XPercent = player.XPercent,
                YPercent = player.YPercent,
                Pressure = player.Pressure,
                HasBall = string.Equals(player.TeamSymbol, ownerTeam, StringComparison.OrdinalIgnoreCase)
                    && player.PlayerIndex == finalCarrierIndex,
                IsAttacking = player.IsAttacking,
                IsDefending = player.IsDefending,
                IsHighlighted = player.IsHighlighted
            })
            .ToList();

        state.PlayerPositions = updatedPlayers;
        return state;
    }

    private static string ResolveOwnerTeam(TvFieldStateDto state)
    {
        var liveOwner = state.PlayerPositions.FirstOrDefault(player => player.HasBall)?.TeamSymbol;
        if (!string.IsNullOrWhiteSpace(liveOwner))
            return liveOwner;

        if (!string.IsNullOrWhiteSpace(state.MomentumOwner))
            return state.MomentumOwner;

        if (!string.IsNullOrWhiteSpace(state.Leader))
            return state.Leader;

        return state.PossessionA >= state.PossessionB ? state.TeamA : state.TeamB;
    }

    private static int ResolveCurrentCarrierIndex(TvFieldStateDto state, string ownerTeam, PossessionState possessionState)
    {
        if (string.Equals(possessionState.OwnerTeam, ownerTeam, StringComparison.OrdinalIgnoreCase)
            && possessionState.CurrentCarrierIndex >= 0
            && possessionState.CurrentCarrierIndex <= 6)
            return possessionState.CurrentCarrierIndex;

        var liveCarrier = state.PlayerPositions.FirstOrDefault(player =>
            player.HasBall && string.Equals(player.TeamSymbol, ownerTeam, StringComparison.OrdinalIgnoreCase));

        if (liveCarrier is not null)
            return liveCarrier.PlayerIndex;

        return 3;
    }

    private static int ResolveNextCarrierIndex(
        int matchId,
        TvFieldStateDto state,
        string ownerTeam,
        IReadOnlyList<TvFieldPlayerPosition> teamPlayers,
        IReadOnlyList<TvFieldPlayerPosition> opponentPlayers,
        int currentCarrier,
        int ownerPossession,
        double ownerPressure,
        bool isLeftTeam,
        PossessionState possessionState)
    {
        var current = teamPlayers.First(player => player.PlayerIndex == currentCarrier);
        var currentRole = ResolveRoleName(currentCarrier);
        var isNeutralOrLowPressure = ownerPossession <= 55 && ownerPressure < 1.15d;
        var isOffensivePressure = ownerPossession >= 58 || ownerPressure > 1.55d || string.Equals(state.MomentumOwner, ownerTeam, StringComparison.OrdinalIgnoreCase);
        var bestIndex = currentCarrier;
        var bestScore = double.MinValue;
        var bestReason = "build-up";

        foreach (var candidate in teamPlayers)
        {
            if (candidate.PlayerIndex == currentCarrier)
                continue;

            var targetRole = ResolveRoleName(candidate.PlayerIndex);
            var distance = Math.Max(0.1d, Math.Sqrt(Math.Pow(candidate.XPercent - current.XPercent, 2) + Math.Pow(candidate.YPercent - current.YPercent, 2)));
            var nearestOpponent = opponentPlayers.Min(opponent =>
                Math.Sqrt(Math.Pow(candidate.XPercent - opponent.XPercent, 2) + Math.Pow(candidate.YPercent - opponent.YPercent, 2)));
            var forwardProgress = isLeftTeam
                ? candidate.XPercent - current.XPercent
                : current.XPercent - candidate.XPercent;

            var linkScore = CalculateRoleLinkScore(currentRole, targetRole, isNeutralOrLowPressure, isOffensivePressure, out var reason);
            var distanceScore = CalculateDistanceScore(currentRole, targetRole, distance, isOffensivePressure);
            var progressScore = CalculateProgressScore(currentRole, targetRole, forwardProgress, isNeutralOrLowPressure, isOffensivePressure);
            var spaceScore = Math.Clamp((nearestOpponent - 9d) / 18d, 0.24d, 1.22d);
            var pressureScore = CalculatePressureScore(targetRole, ownerPressure, isOffensivePressure);
            var repeatPenalty = CalculateRepeatPenalty(candidate.PlayerIndex, possessionState);
            var randomness = 0.94d + (Random.Shared.NextDouble() * 0.12d);

            var totalScore = linkScore * distanceScore * progressScore * spaceScore * pressureScore * repeatPenalty * randomness;
            if (totalScore <= bestScore)
                continue;

            bestScore = totalScore;
            bestIndex = candidate.PlayerIndex;
            bestReason = reason;
        }

        if (bestIndex != currentCarrier)
            Console.WriteLine($"[PASS_AI] from={currentRole} to={ResolveRoleName(bestIndex)} reason={bestReason}");

        return bestIndex;
    }

    private static double CalculateRoleLinkScore(string currentRole, string targetRole, bool isNeutralOrLowPressure, bool isOffensivePressure, out string reason)
    {
        reason = "recycle";

        if (currentRole == "Goalkeeper")
        {
            if (targetRole == "Defender") { reason = "build-up"; return 1.82d; }
            if (targetRole == "Midfielder") { reason = "build-up"; return 1.16d; }
            if (targetRole == "Forward") { reason = "long-ball"; return 0.54d; }
        }

        if (currentRole == "Defender")
        {
            if (targetRole == "Midfielder") { reason = "build-up"; return isNeutralOrLowPressure ? 1.94d : 1.48d; }
            if (targetRole == "Defender") { reason = "recycle"; return 1.12d; }
            if (targetRole == "Forward") { reason = isOffensivePressure ? "progressive" : "risk-pass"; return isOffensivePressure ? 1.05d : 0.62d; }
        }

        if (currentRole == "Midfielder")
        {
            if (targetRole == "Midfielder") { reason = "distribute"; return 1.34d; }
            if (targetRole == "Forward") { reason = isOffensivePressure ? "progressive" : "through-ball"; return isOffensivePressure ? 1.48d : 1.08d; }
            if (targetRole == "Defender") { reason = "recycle"; return 0.88d; }
        }

        if (currentRole == "Forward")
        {
            if (targetRole == "Midfielder") { reason = "back-pass"; return 1.44d; }
            if (targetRole == "Forward") { reason = "final-third"; return isOffensivePressure ? 1.12d : 0.84d; }
            if (targetRole == "Defender") { reason = "reset"; return 0.52d; }
        }

        return 1d;
    }

    private static double CalculateDistanceScore(string currentRole, string targetRole, double distance, bool isOffensivePressure)
    {
        var preferredDistance = (currentRole, targetRole) switch
        {
            ("Goalkeeper", "Defender") => 18d,
            ("Defender", "Defender") => 14d,
            ("Defender", "Midfielder") => 20d,
            ("Midfielder", "Midfielder") => 14d,
            ("Midfielder", "Forward") => isOffensivePressure ? 18d : 15d,
            ("Forward", "Midfielder") => 12d,
            ("Forward", "Forward") => 10d,
            _ => 14d
        };

        var tolerance = isOffensivePressure ? 14d : 11d;
        return Math.Clamp(1.32d - (Math.Abs(distance - preferredDistance) / tolerance), 0.35d, 1.32d);
    }

    private static double CalculateProgressScore(string currentRole, string targetRole, double forwardProgress, bool isNeutralOrLowPressure, bool isOffensivePressure)
    {
        if (currentRole == "Defender" && targetRole == "Midfielder")
            return forwardProgress > 0 ? 1.42d : 0.82d;

        if (currentRole == "Midfielder" && targetRole == "Forward")
            return forwardProgress > 0 ? (isOffensivePressure ? 1.34d : 1.14d) : 0.78d;

        if (currentRole == "Forward" && targetRole == "Midfielder")
            return forwardProgress < 0 ? 1.36d : 0.82d;

        if (currentRole == "Forward" && targetRole == "Forward")
            return isOffensivePressure ? 1.04d : 0.92d;

        if (currentRole == "Midfielder" && targetRole == "Defender")
            return isNeutralOrLowPressure ? 0.82d : 0.96d;

        return 1d;
    }

    private static double CalculatePressureScore(string targetRole, double ownerPressure, bool isOffensivePressure)
    {
        if (!isOffensivePressure)
            return 1d;

        return targetRole switch
        {
            "Forward" => 1d + Math.Clamp(ownerPressure, 0d, 3d) * 0.08d,
            "Midfielder" => 1d + Math.Clamp(ownerPressure, 0d, 3d) * 0.04d,
            _ => 0.96d
        };
    }

    private static double CalculateRepeatPenalty(int candidateIndex, PossessionState possessionState)
    {
        var penalty = 1d;

        if (possessionState.PreviousCarrierIndex == candidateIndex)
            penalty *= 0.42d;

        if (possessionState.RecentReceivers.Contains(candidateIndex))
            penalty *= 0.63d;

        return penalty;
    }

    private static int ResolveDecisionDelayMs(int possession, double pressure, string role)
    {
        var baseDelay = role switch
        {
            "Goalkeeper" => 4200,
            "Defender" => 3400,
            "Midfielder" => 2900,
            _ => 2400
        };

        if (possession >= 58 || pressure > 1.55d)
            baseDelay -= 400;

        return Math.Clamp(baseDelay, 1900, 4600);
    }

    private static int ResolveInitialCarrierIndex(int possession, double pressure)
    {
        if (possession >= 60 || pressure > 1.8d)
            return 3;

        if (possession <= 44 || pressure < -0.8d)
            return 2;

        return 3;
    }

    private static string ResolveRoleName(int playerIndex)
        => playerIndex switch
        {
            0 => "Goalkeeper",
            1 or 2 => "Defender",
            3 => "Midfielder",
            _ => "Forward"
        };

    private static void CleanupPossessionStatesIfNeeded()
    {
        if (_possessionByMatch.Count <= 120)
            return;

        var cutoff = DateTime.UtcNow.AddMinutes(-3);
        foreach (var entry in _possessionByMatch)
        {
            if (entry.Value.LastUpdatedUtc < cutoff)
                _possessionByMatch.TryRemove(entry.Key, out _);
        }
    }

    private sealed class PossessionState
    {
        public string OwnerTeam { get; set; } = string.Empty;
        public int CurrentCarrierIndex { get; set; } = -1;
        public int PreviousCarrierIndex { get; set; } = -1;
        public Queue<int> RecentReceivers { get; } = new();
        public DateTime NextDecisionUtc { get; set; } = DateTime.MinValue;
        public DateTime LastUpdatedUtc { get; set; } = DateTime.UtcNow;
    }
}
