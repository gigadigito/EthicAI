using CriptoVersus.API.Hubs;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using System.Text.Json;

[ApiController]
[Route("api/dashboard")]
public class DashboardNotifyController : ControllerBase
{
    private readonly IHubContext<DashboardHub> _hub;

    public DashboardNotifyController(IHubContext<DashboardHub> hub)
    {
        _hub = hub;
    }

    [HttpPost("notify")]
    public async Task<IActionResult> Notify()
    {
        var instance = new
        {
            reason = "pg_notify",
            utc = DateTimeOffset.UtcNow.ToString("O"),
            apiMachine = Environment.MachineName,
            apiPid = Environment.ProcessId,
            app = AppDomain.CurrentDomain.FriendlyName
        };

        await _hub.Clients.All.SendAsync("dashboard_changed", JsonSerializer.Serialize(instance));

        return Ok(new { ok = true, instance });
    }

}
