using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DTOs
{
    public class WorkerStatusDto
    {
        public string ServiceName { get; set; } = "CriptoVersus.Worker";

        public bool IsAlive { get; set; }              // heartbeat ok?
        public DateTime LastHeartbeatUtc { get; set; } // última vez que o worker rodou

        public DateTime? LastCycleStartUtc { get; set; }
        public DateTime? LastCycleEndUtc { get; set; }

        public string? LastError { get; set; }         // msg curta
        public DateTime? LastErrorUtc { get; set; }

        public int CycleIntervalSeconds { get; set; }  // ex: 60
        public int MatchDurationMinutes { get; set; }  // 90
        public int TargetUpcomingMatches { get; set; } // 3
    }
}
