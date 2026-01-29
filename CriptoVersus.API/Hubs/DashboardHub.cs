using Microsoft.AspNetCore.SignalR;
using System.Collections.Concurrent;

namespace CriptoVersus.API.Hubs
{
    public class DashboardHub : Hub
    {
        public static readonly ConcurrentDictionary<string, DateTimeOffset> Connections = new();

        public override Task OnConnectedAsync()
        {
            Connections[Context.ConnectionId] = DateTimeOffset.UtcNow;
            return base.OnConnectedAsync();
        }

        public override Task OnDisconnectedAsync(Exception? exception)
        {
            Connections.TryRemove(Context.ConnectionId, out _);
            return base.OnDisconnectedAsync(exception);
        }
    }
}
