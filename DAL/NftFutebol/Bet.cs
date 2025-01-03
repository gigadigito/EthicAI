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
        public int TeamId { get; set; }
        public int UserId { get; set; } // Atualizado de PlayerId para UserId
        public int Position { get; set; }
        public decimal Amount { get; set; }
        public DateTime BetTime { get; set; }

        public virtual Match Match { get; set; }
        public virtual Team Team { get; set; }
        public virtual User User { get; set; } // Relacionamento com User
        public bool Claimed { get; set; }
        public DateTime? ClaimedAt { get; set; }
    }


}
