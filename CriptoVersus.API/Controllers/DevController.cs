using CriptoVersus.API.Hubs;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;

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
        await _hub.Clients.All.SendAsync("dashboard_changed");
        return Ok(new { ok = true, sent = "dashboard_changed" });
    }
}
