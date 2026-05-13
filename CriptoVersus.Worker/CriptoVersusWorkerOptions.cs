using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using DAL.NftFutebol;

namespace CriptoVersus.Worker;

public class CriptoVersusWorkerOptions
{
    public int IntervalSeconds { get; set; }
    public int TopGainersTake { get; set; }
    public int DesiredActiveMatches { get; set; }
    public bool AutoEndOngoingMatches { get; set; }
    public int MatchDurationMinutes { get; set; }
    public string DashboardNotifyUrl { get; set; } = "http://criptoversus-api:8080/api/dashboard/notify";
    public ScoringOptions Scoring { get; set; } = new();
    public SentimentOptions Sentiment { get; set; } = new();
    public SettlementOptions Settlement { get; set; } = new();
}

public class ScoringOptions
{
    public double PercentPerGoal { get; set; } = 2.0;
    public int MaxGoalsPerTeam { get; set; } = 7;
    public MatchScoringRuleType DefaultRuleType { get; set; } = MatchScoringRuleType.PercentThreshold;
    public int VolumeWindowMinutes { get; set; } = 15;
    public List<decimal> PercentThresholds { get; set; } = [2m, 8m, 16m];
}

public class SettlementOptions
{
    public decimal HouseFeeRate { get; set; } = 0.01m;
    public decimal LoserRefundRate { get; set; } = 0.94m;
    public bool AutoReenterEnabled { get; set; } = true;
    public decimal MinPositionCapital { get; set; } = 0.00000001m;
}

public class SentimentOptions
{
    public decimal MinimumCoverage { get; set; } = 0.55m;
    public int MinScoreDiff { get; set; } = 10;
    public int RequiredCycles { get; set; } = 2;
    public int GoalCooldownMinutes { get; set; } = 15;
    public int MaxGoalsPerMatch { get; set; } = 2;
    public int BlockFirstMinutes { get; set; } = 3;
}
