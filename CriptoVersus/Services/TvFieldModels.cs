namespace CriptoVersus.Web.Services;

public sealed class TvFieldPlayerPosition
{
    public string TeamSymbol { get; set; } = string.Empty;
    public int PlayerIndex { get; set; }
    public double XPercent { get; set; }
    public double YPercent { get; set; }
    public double Pressure { get; set; }
    public bool HasBall { get; set; }
    public bool IsAttacking { get; set; }
    public bool IsDefending { get; set; }
    public bool IsHighlighted { get; set; }
}

public sealed class TvFieldRecentEvent
{
    public string ClockLabel { get; set; } = string.Empty;
    public string TeamSymbol { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string ScoreLabel { get; set; } = string.Empty;
    public bool IsHighlight { get; set; }
}

public sealed class TvFieldStateDto
{
    public string TeamA { get; set; } = string.Empty;
    public string TeamB { get; set; } = string.Empty;
    public int ScoreA { get; set; }
    public int ScoreB { get; set; }
    public decimal? VariationA { get; set; }
    public decimal? VariationB { get; set; }
    public int PossessionA { get; set; }
    public int PossessionB { get; set; }
    public string MomentumOwner { get; set; } = string.Empty;
    public string Leader { get; set; } = string.Empty;
    public int HotScore { get; set; }
    public int Competitiveness { get; set; }
    public double TeamPressureA { get; set; }
    public double TeamPressureB { get; set; }
    public IReadOnlyList<TvFieldPlayerPosition> PlayerPositions { get; set; } = [];
    public IReadOnlyList<TvFieldRecentEvent> RecentEvents { get; set; } = [];
}
