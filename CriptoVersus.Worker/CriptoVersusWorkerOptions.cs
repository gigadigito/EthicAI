using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace CriptoVersus.Worker;

public class CriptoVersusWorkerOptions
{
    public int IntervalSeconds { get; set; }
    public int TopGainersTake { get; set; }
    public int DesiredActiveMatches { get; set; }
    public bool AutoEndOngoingMatches { get; set; }
    public int MatchDurationMinutes { get; set; }
    public ScoringOptions Scoring { get; set; } = new();
}

public class ScoringOptions
{
    public double PercentPerGoal { get; set; } = 2.0;
    public int MaxGoalsPerTeam { get; set; } = 7;
}
