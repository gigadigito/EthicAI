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
        public DateTime CreatedAtUtc { get; set; }
        public DateTime UpdatedAtUtc { get; set; }

        public Match Match { get; set; } = null!;
    }
}
