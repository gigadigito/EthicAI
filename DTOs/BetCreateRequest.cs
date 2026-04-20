using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DTOs
{

        public class BetCreateRequest
        {
            public int UserId { get; set; }
            public int TeamId { get; set; }
            public decimal Amount { get; set; }
            public string? OnChainSignature { get; set; }
            public string? OnChainPositionAccount { get; set; }
            public string? OnChainPositionVault { get; set; }
            public string? OnChainAmountLamports { get; set; }
        }
    
}
