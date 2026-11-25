namespace DTOs;

public sealed class ArenaPressureRankingResponseDto
{
    public DateTime DayStartUtc { get; set; }
    public DateTime DayEndUtc { get; set; }
    public DateTime GeneratedAtUtc { get; set; }
    public bool MarketDataAvailable { get; set; }
    public string MarketDataStatus { get; set; } = string.Empty;
    public DateTime? MarketSnapshotUtc { get; set; }
    public bool DuplicateControlAvailable { get; set; }
    public int TotalCandidates { get; set; }
    public int Page { get; set; }
    public int PageSize { get; set; }
    public List<ArenaPressureRankedMatchDto> Items { get; set; } = [];
}

public sealed class ArenaPressureRankedMatchDto
{
    public int MatchId { get; set; }
    public string Status { get; set; } = string.Empty;
    public DateTime EndTimeUtc { get; set; }
    public string LeftSymbol { get; set; } = string.Empty;
    public string RightSymbol { get; set; } = string.Empty;
    public double HistoricalDurationSeconds { get; set; }
    public decimal QualityScore { get; set; }
    public ArenaPressureScoreBreakdownDto ScoreBreakdown { get; set; } = new();
    public ArenaPressureMetricsDto Metrics { get; set; } = new();
    public List<TopGainerMatchDto> TopGainersMatches { get; set; } = [];
    public List<string> Reasons { get; set; } = [];
    public bool VideoEligible { get; set; }
    public string DuplicateCheckStatus { get; set; } = "unavailable";
}

public sealed class ArenaPressureScoreBreakdownDto
{
    public decimal PressureReversals { get; set; }
    public decimal PressureMovement { get; set; }
    public decimal TopGainers { get; set; }
}

public sealed class ArenaPressureMetricsDto
{
    public int LeadChanges { get; set; }
    public int SignificantMovementCount { get; set; }
    public decimal MaxPressureSwing { get; set; }
    public decimal TotalVariation { get; set; }
    public decimal StaleRatio { get; set; }
}

public sealed class TopGainerMatchDto
{
    public string Symbol { get; set; } = string.Empty;
    public int Rank { get; set; }
    public decimal PriceChangePercent24h { get; set; }
}
