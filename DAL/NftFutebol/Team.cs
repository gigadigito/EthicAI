using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DAL.NftFutebol
{
    public class Team
    {
        public int TeamId { get; set; }
        public int CurrencyId { get; set; }
        public Currency Currency { get; set; } = null!;
        public ICollection<Bet> Bets { get; set; } = new List<Bet>();
        public ICollection<UserTeamPosition> UserPositions { get; set; } = new List<UserTeamPosition>();
        public ICollection<Match> MatchesAsTeamA { get; set; } = new List<Match>();
        public ICollection<Match> MatchesAsTeamB { get; set; } = new List<Match>();
        public ICollection<MatchMetricSnapshot> MetricSnapshots { get; set; } = new List<MatchMetricSnapshot>();
        public ICollection<MatchScoreEvent> ScoreEvents { get; set; } = new List<MatchScoreEvent>();
    }

}
