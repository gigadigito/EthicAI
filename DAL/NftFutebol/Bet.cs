using System;
using System.Collections.Generic;
using System.Linq;
using System.Numerics;
using System.Text;
using System.Threading.Tasks;

namespace DAL.NftFutebol
{
    public class Bet
    {
        public int BetId { get; set; }
        public int MatchId { get; set; }
        public Match Match { get; set; }
        public int TeamId { get; set; } // ID do time apostado
        public Team Team { get; set; }
        public string PlayerId { get; set; } // ID do jogador
        public Player Player { get; set; }
        public decimal Amount { get; set; }
        public DateTime BetTime { get; set; }
    }

}
