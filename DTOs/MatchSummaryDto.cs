using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DTOs
{
    public class MatchSummaryDto
    {
        public int Pending { get; set; }
        public int Ongoing { get; set; }
        public int CompletedLast24h { get; set; }

        public List<MatchDto> Upcoming { get; set; } = [];
        public List<MatchDto> OngoingList { get; set; } = [];
    }
}
