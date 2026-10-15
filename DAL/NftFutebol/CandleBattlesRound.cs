namespace DAL.NftFutebol;

// Arcade records never participate in ledger, settlement or Match.ScoreA/ScoreB.
public sealed class CandleBattlesRound
{
    public int MatchId { get; set; }
    public DateTime OpenTimeUtc { get; set; }
    public string LeftCandleJson { get; set; } = "{}";
    public string RightCandleJson { get; set; } = "{}";
    public decimal LeftStrength { get; set; }
    public decimal RightStrength { get; set; }
    public string Winner { get; set; } = "draw";
    public string RuleVersion { get; set; } = string.Empty;
    public DateTime ConfirmedAtUtc { get; set; }
}

public sealed class CandleBattlesState
{
    public int MatchId { get; set; }
    public DateTime NextOpenUtc { get; set; }
    public string? LeftFormingJson { get; set; }
    public string? RightFormingJson { get; set; }
    public DateTime UpdatedAtUtc { get; set; }
    public bool Complete { get; set; }
    public string Status { get; set; } = "waiting";
}
