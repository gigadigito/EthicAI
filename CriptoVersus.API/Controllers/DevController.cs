using CriptoVersus.API.Hubs;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using System.Text.Json;

[ApiController]
[Route("api/dev")]
public class DevController : ControllerBase
{
    private readonly IHubContext<DashboardHub> _hub;

    public DevController(IHubContext<DashboardHub> hub)
    {
        _hub = hub;
    }

    [HttpPost("dashboard-ping")]
    public async Task<IActionResult> DashboardPing()
    {
        await _hub.Clients.All.SendAsync("dashboard_changed", JsonSerializer.Serialize(new
        {
            reason = "pg_notify",
            utc = DateTime.UtcNow
        }));

        return Ok(new { ok = true, sent = "dashboard_changed" });
    }

    [HttpGet("connections")]
    public IActionResult Connections()
    {
        return Ok(new
        {
            apiMachine = Environment.MachineName,
            apiPid = Environment.ProcessId,
            count = DashboardHub.Connections.Count,
            ids = DashboardHub.Connections.Keys.Take(10).ToArray()
        });
    }

}
