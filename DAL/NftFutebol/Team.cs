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
        public Currency Currency { get; set; }
        public ICollection<Bet> Bets { get; set; }
        public ICollection<Match> MatchesAsTeamA { get; set; }
        public ICollection<Match> MatchesAsTeamB { get; set; }
    }

}
