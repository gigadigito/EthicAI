using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DAL.NftFutebol
{
    public class Player
    {
        public string PlayerId { get; set; } // Por exemplo, wallet address
        public string Name { get; set; }
        public ICollection<Bet> Bets { get; set; }
    }
}
