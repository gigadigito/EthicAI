using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DAL.NftFutebol
{
    public class WorkerStatus
    {
        public string WorkerName { get; set; } = null!; // tx_worker_name (PK)

        public DateTime LastHeartbeat { get; set; }      // dt_last_heartbeat
        public DateTime? LastCycleStart { get; set; }    // dt_last_cycle_start
        public DateTime? LastCycleEnd { get; set; }      // dt_last_cycle_end
        public DateTime? LastSuccess { get; set; }       // dt_last_success

        public string? LastError { get; set; }           // tx_last_error
        public string Status { get; set; } = "Idle";     // in_status

        public DateTime UpdatedAt { get; set; }          // dt_updated_at
    }
}
