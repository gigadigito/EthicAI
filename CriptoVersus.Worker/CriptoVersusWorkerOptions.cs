using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace CriptoVersus.Worker;

public sealed class CriptoVersusWorkerOptions
{
    public int IntervalSeconds { get; set; } = 30;
    public int TopGainersTake { get; set; } = 6;
    public int DesiredActiveMatches { get; set; } = 3;
}
