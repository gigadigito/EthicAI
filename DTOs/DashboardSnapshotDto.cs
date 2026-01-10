
namespace DTOs
{
    public class DashboardSnapshotDto
    {
        public DateTime ServerTimeUtc { get; set; }

        public WorkerStatusDto Worker { get; set; } = new();

        public List<CurrencyDto> TopGainers { get; set; } = [];

        public MatchSummaryDto Matches { get; set; } = new();
    }

   

}
