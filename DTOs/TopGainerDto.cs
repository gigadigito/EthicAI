using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DTOs
{
    public class TopGainerDto
    {
        public string Symbol { get; set; } = string.Empty;   // "BTCUSDT"
        public string Name { get; set; } = string.Empty;     // opcional se tiver no DB
        public decimal PercentageChange { get; set; }        // nr_percentage_change
        public DateTime LastUpdatedUtc { get; set; }         // dt_last_updated (em UTC)
        public int Rank { get; set; }                        // 1..6 (para UI)
    }
}
