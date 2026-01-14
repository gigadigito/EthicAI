using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DTOs
{
    public record HealthItem(bool Ok, string Message);
    public record WorkerHealth(Dictionary<string, HealthItem> Checks)
    {
        public bool IsDegraded => Checks.Values.Any(x => !x.Ok);
    }
}
