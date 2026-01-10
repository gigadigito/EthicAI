using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DTOs
{
    public class CurrencyDto
    {
        public string Symbol { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public decimal PercentageChange { get; set; }
        public DateTime LastUpdatedUtc { get; set; }
        public int Rank { get; set; }
    }
}
