namespace BLL.ArenaSentiment;

public sealed class ArenaSentimentOptions
{
    public const string ConfigSection = "CriptoVersusWorker:Sentiment";

    public decimal MinimumCoverage { get; set; } = 0.55m;
    public int MinScoreDiff { get; set; } = 10;
    public int RequiredCycles { get; set; } = 2;
    public int GoalCooldownMinutes { get; set; } = 15;
    public int MaxGoalsPerMatch { get; set; } = 2;
    public int BlockFirstMinutes { get; set; } = 3;
}
