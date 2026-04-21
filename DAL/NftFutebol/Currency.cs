using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DAL.NftFutebol
{
    public class Currency
    {
        public int CurrencyId { get; set; } // cd_currency
        public string Name { get; set; } = string.Empty; // tx_name
        public string Symbol { get; set; } = string.Empty; // tx_symbol
        public double PercentageChange { get; set; } // nr_percentage_change
        public decimal QuoteVolume { get; set; } // nr_quote_volume
        public long TradesCount { get; set; } // nr_trades_count
        public DateTime LastUpdated { get; set; } // dt_last_updated
        public ICollection<Team> Teams { get; set; } = new List<Team>();
    }

}
