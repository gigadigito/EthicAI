using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DTOs
{
    public class BetCreateResponse
    {
        public int BetId { get; set; }
        public int MatchId { get; set; }
        public int UserId { get; set; }
        public int TeamId { get; set; }
        public decimal Amount { get; set; }
        public decimal UserBalanceAfterBet { get; set; }
        public DateTimeOffset BetTime { get; set; }
        public int Position { get; set; }
        public bool Claimed { get; set; }
        public bool? IsWinner { get; set; }
        public decimal? PayoutAmount { get; set; }
        public DateTimeOffset? SettledAt { get; set; }
        public DateTimeOffset? BettingCloseTime { get; set; }
        public string Message { get; set; } = string.Empty;
    }
}

