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
    private readonly ILogger<DashboardHub> _log;
    private const string MoneyFlowMatchesKey = "moneyflow.matches";

    public DashboardHub(MoneyFlowMatchRegistry matchRegistry, MoneyFlowMetrics metrics, ILogger<DashboardHub> log)
    {
        _matchRegistry = matchRegistry;
        _metrics = metrics;
        _log = log;
    }

    public static string MoneyFlowGroup(int matchId) => $"{MoneyFlowGroupPrefix}{matchId}";

    // NOTE: hub methods must NOT declare a CancellationToken parameter here.
    // With the current runtime the JSON hub protocol includes it in the bind
    // types and every invocation fails during argument deserialization, before
    // the method body runs. Cancellation is taken from the connection instead.
    public async Task<bool> JoinMoneyFlow(int matchId)
    {
        var ct = Context.ConnectionAborted;
        if (matchId <= 0 || !await _matchRegistry.IsActiveAsync(matchId, ct))
        {
            _log.LogWarning("Money-flow join refused: match {MatchId} is not active", matchId);
            throw new HubException("The requested Candle Battle is not active.");
        }
        await Groups.AddToGroupAsync(Context.ConnectionId, MoneyFlowGroup(matchId), ct);
        var matches = GetConnectionMatches();
        if (matches.Add(matchId)) _metrics.ActiveSubscriptions.Add(1);
        _log.LogInformation("Money-flow join accepted: match {MatchId} connection {ConnectionId}", matchId, Context.ConnectionId);
        return true;
    }

    public async Task LeaveMoneyFlow(int matchId)
    {
        if (matchId <= 0) return;
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, MoneyFlowGroup(matchId));
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
