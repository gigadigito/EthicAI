using DAL.NftFutebol;

namespace BLL.NFTFutebol;

public readonly record struct MatchScoreEventTotals(
    int TeamAPoints,
    int TeamBPoints,
    int ScoringEventCount)
{
    public int TotalPoints => TeamAPoints + TeamBPoints;

    public static MatchScoreEventTotals FromEvents(
        IEnumerable<MatchScoreEvent> events,
        int teamAId)
    {
        ArgumentNullException.ThrowIfNull(events);

        var teamAPoints = 0;
        var teamBPoints = 0;
        var scoringEventCount = 0;

        foreach (var scoreEvent in events)
        {
            if (scoreEvent.Points <= 0)
                continue;

            scoringEventCount++;
            if (scoreEvent.TeamId == teamAId)
                teamAPoints += scoreEvent.Points;
            else
                teamBPoints += scoreEvent.Points;
        }

        return new MatchScoreEventTotals(teamAPoints, teamBPoints, scoringEventCount);
    }
}