namespace DAL.NftFutebol
{
    public class MatchScoreState
    {
        public int MatchId { get; set; }
        public int ThresholdsAwardedToTeamA { get; set; }
        public int ThresholdsAwardedToTeamB { get; set; }
        public int? LastPercentageLeaderTeamId { get; set; }
        public int? LastVolumeLeaderTeamId { get; set; }
        public DateTime? LastProcessedVolumeWindowStartUtc { get; set; }
        public DateTime? LastProcessedVolumeWindowEndUtc { get; set; }
        public int LastEventSequence { get; set; }
        public DateTime? LastSnapshotAtUtc { get; set; }
        public int CandleBattleWinsA { get; set; }
        public int CandleBattleWinsB { get; set; }
        public int? LastCandleBattleLeaderTeamId { get; set; }
        public DateTime? LastCandleBattleProcessedAtUtc { get; set; }
        public decimal? LastCandleBattleClosePriceA { get; set; }
        public decimal? LastCandleBattleClosePriceB { get; set; }
        public int LastCandleBattleLeftWins { get; set; }
        public int LastCandleBattleRightWins { get; set; }
        public int? LastCandleBattleDominanceTeamId { get; set; }
        public string? LastCandleBattleStateKey { get; set; }
        public int TeamAPressureCharges { get; set; }
        public int TeamBPressureCharges { get; set; }
        public int TotalPressureGoalsAwarded { get; set; }
        public int? LastPressureLeaderTeamId { get; set; }
        public int LastPressureLeaderCycles { get; set; }
        public DateTime? LastPressureGoalTeamAAtUtc { get; set; }
        public DateTime? LastPressureGoalTeamBAtUtc { get; set; }
        public int? CurrentPressureDominanceLeaderTeamId { get; set; }
        public DateTime? CurrentPressureDominanceStartedAtUtc { get; set; }
        public bool CurrentPressureDominanceResolved { get; set; }
        public bool CurrentPressureDominanceGoalAwarded { get; set; }
        public DateTime CreatedAtUtc { get; set; }
        public DateTime UpdatedAtUtc { get; set; }

        public Match Match { get; set; } = null!;
    }
}
