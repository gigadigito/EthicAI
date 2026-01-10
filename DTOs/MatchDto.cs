using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DTOs
{

        public class MatchDto
        {
            public int MatchId { get; set; }

            // Times
            public string TeamA { get; set; } = string.Empty;
            public string TeamB { get; set; } = string.Empty;

            // Placares
            public int ScoreA { get; set; }
            public int ScoreB { get; set; }

            // Status
            public string Status { get; set; } = string.Empty;

            // Tempo
            public DateTime? StartTime { get; set; }
            public DateTime? EndTime { get; set; }

            // Auxiliares para UI
            public int ElapsedMinutes { get; set; }
            public int RemainingMinutes { get; set; }
            public bool IsFinished { get; set; }
        }
    


}
