namespace DTOs;

public sealed class ArenaSentimentDto
{
    public string Symbol { get; set; } = string.Empty;
    public int Score { get; set; }
    public string Classification { get; set; } = string.Empty;
    public decimal? PriceMomentumScore { get; set; }
    public decimal? VolumeScore { get; set; }
    public decimal? OrderBookScore { get; set; }
    public decimal? FundingScore { get; set; }
    public decimal? LongShortScore { get; set; }
    public decimal? VolatilityScore { get; set; }
    public DateTime CalculatedAt { get; set; }
    public bool HasSufficientData { get; set; }
    public decimal DataCoverage { get; set; }
    public string? Note { get; set; }
}

public sealed class ArenaSentimentPairDto
{
    public ArenaSentimentDto TeamA { get; set; } = new();
    public ArenaSentimentDto TeamB { get; set; } = new();
}
