using CriptoVersus.API.Services;
using Microsoft.AspNetCore.SignalR;
using System.Collections.Concurrent;

namespace CriptoVersus.API.Hubs;

public sealed class DashboardHub : Hub
{
    public const string MoneyFlowEventName = "money_flow_batch";
    private const string MoneyFlowGroupPrefix = "candle-battles-moneyflow:";
    public static readonly ConcurrentDictionary<string, DateTimeOffset> Connections = new();

    private readonly MoneyFlowMatchRegistry _matchRegistry;
    private readonly MoneyFlowMetrics _metrics;
    private const string MoneyFlowMatchesKey = "moneyflow.matches";

    public DashboardHub(MoneyFlowMatchRegistry matchRegistry, MoneyFlowMetrics metrics)
    {
        _matchRegistry = matchRegistry;
        _metrics = metrics;
    }

    public static string MoneyFlowGroup(int matchId) => $"{MoneyFlowGroupPrefix}{matchId}";

    public async Task<bool> JoinMoneyFlow(int matchId, CancellationToken ct = default)
    {
        if (matchId <= 0 || !await _matchRegistry.IsActiveAsync(matchId, ct))
            throw new HubException("The requested Candle Battle is not active.");
        await Groups.AddToGroupAsync(Context.ConnectionId, MoneyFlowGroup(matchId), ct);
        var matches = GetConnectionMatches();
        if (matches.Add(matchId)) _metrics.ActiveSubscriptions.Add(1);
        return true;
    }

    public async Task LeaveMoneyFlow(int matchId, CancellationToken ct = default)
    {
        if (matchId <= 0) return;
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, MoneyFlowGroup(matchId), ct);
        var matches = GetConnectionMatches();
        if (matches.Remove(matchId)) _metrics.ActiveSubscriptions.Add(-1);
    }

    public override Task OnConnectedAsync()
    {
        Connections[Context.ConnectionId] = DateTimeOffset.UtcNow;
        return base.OnConnectedAsync();
    }

    public override Task OnDisconnectedAsync(Exception? exception)
    {
        Connections.TryRemove(Context.ConnectionId, out _);
        var matches = GetConnectionMatches();
        foreach (var matchId in matches)
            _metrics.ActiveSubscriptions.Add(-1);
        matches.Clear();
        return base.OnDisconnectedAsync(exception);
    }

    private HashSet<int> GetConnectionMatches()
    {
        if (Context.Items.TryGetValue(MoneyFlowMatchesKey, out var value) && value is HashSet<int> existing)
            return existing;
        var created = new HashSet<int>();
        Context.Items[MoneyFlowMatchesKey] = created;
        return created;
    }
}
