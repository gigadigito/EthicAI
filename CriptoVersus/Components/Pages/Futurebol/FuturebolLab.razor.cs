using Microsoft.AspNetCore.Components;
using Microsoft.JSInterop;
using CriptoVersus.Web.Services;
using DTOs;

namespace CriptoVersus.Web.Components.Pages.Futurebol;

public partial class FuturebolLab
{
    private const string CanvasId = "futurebol-canvas";
    private const string DefaultSeed = "futurebol-demo-001";
    private static readonly TimeSpan MarketRefreshInterval = TimeSpan.FromSeconds(15);

    private IJSObjectReference? _module;
    private DotNetObjectReference<FuturebolLab>? _dotNetReference;
    private CancellationTokenSource? _marketUpdateCts;
    private Task? _marketUpdateTask;
    private CancellationTokenSource? _routeLoadCts;
    private MatchDto? _match;
    private FuturebolMatchPresentationModel? _initialPresentation;
    private FuturebolMarketSnapshotModel? _initialMarketSnapshot;
    private FuturebolOfficialMatchStateModel? _initialOfficialState;
    private bool _initializing;
    private bool _isPaused;
    private bool _isFixedCamera;
    private bool _disposed;
    private bool _simulateWebGlFailure;
    private bool _simulatePlayerAssetFailure;
    private string _quality = "High";
    private string _playerVisual = "Auto";
    private string _activeDataMode = "mock";
    private string _activeRouteKey = string.Empty;
    private bool _pendingRuntimeInitialization;
    private string? _error;
    private string? _marketWarning;

    [Inject] private CriptoVersusApiClient Api { get; set; } = default!;
    [Inject] private FuturebolMatchAdapter MatchAdapter { get; set; } = default!;
    [Inject] private ILogger<FuturebolLab> Logger { get; set; } = default!;

    [SupplyParameterFromQuery(Name = "matchId")]
    public int? MatchId { get; set; }

    [SupplyParameterFromQuery(Name = "failWebgl")]
    public bool SimulateWebGlFailure
    {
        get => _simulateWebGlFailure;
        set => _simulateWebGlFailure = value;
    }

    [SupplyParameterFromQuery(Name = "failPlayerAsset")]
    public bool SimulatePlayerAssetFailure
    {
        get => _simulatePlayerAssetFailure;
        set => _simulatePlayerAssetFailure = value;
    }

    private FuturebolOptions Options => FuturebolOptionsAccessor.Value;
    private string HomeSymbol => NormalizeSymbol(_match?.TeamA, Options.DefaultHomeSymbol);
    private string AwaySymbol => NormalizeSymbol(_match?.TeamB, Options.DefaultAwaySymbol);
    private string? HomeLogoUrl => ResolveLogoUrl(HomeSymbol);
    private string? AwayLogoUrl => ResolveLogoUrl(AwaySymbol);
    private string ActiveDataMode => _activeDataMode;

    protected override async Task OnParametersSetAsync()
    {
        if (!Options.Enabled)
            return;

        var routeKey = $"{MatchId?.ToString() ?? "demo"}|{Options.DataMode}";
        if (string.Equals(routeKey, _activeRouteKey, StringComparison.Ordinal))
            return;

        _activeRouteKey = routeKey;
        await StopMarketUpdatesAsync();
        _routeLoadCts?.Cancel();
        var routeLoadCts = new CancellationTokenSource();
        _routeLoadCts = routeLoadCts;
        try
        {
            await LoadRouteMarketDataAsync(routeLoadCts.Token);
            _pendingRuntimeInitialization = true;
        }
        catch (OperationCanceledException) when (routeLoadCts.IsCancellationRequested)
        {
        }
        finally
        {
            if (ReferenceEquals(_routeLoadCts, routeLoadCts))
                _routeLoadCts = null;
            routeLoadCts.Dispose();
        }
    }

    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        if (!Options.Enabled || (!firstRender && !_pendingRuntimeInitialization))
            return;

        _pendingRuntimeInitialization = false;
        await DisposeRuntimeAsync();
        await InitializeAsync();
        StartMarketUpdates();
    }

    private async Task InitializeAsync()
    {
        _initializing = true;
        _error = null;
        await InvokeAsync(StateHasChanged);

        try
        {
            _module ??= await JS.InvokeAsync<IJSObjectReference>(
                "import",
                "./js/dist/futurebol/futurebol-bootstrap.js");
            _dotNetReference ??= DotNetObjectReference.Create(this);

            await _module.InvokeVoidAsync(
                "initialize",
                CanvasId,
                new
                {
                    dataMode = ActiveDataMode,
                    homeSymbol = HomeSymbol,
                    awaySymbol = AwaySymbol,
                    homeLogoUrl = HomeLogoUrl,
                    awayLogoUrl = AwayLogoUrl,
                    matchId = _match?.MatchId,
                    initialMarketSnapshot = _initialMarketSnapshot,
                    initialOfficialState = _initialOfficialState,
                    initialPresentationState = _initialPresentation,
                    dataError = _marketWarning,
                    seed = _match is null ? DefaultSeed : $"futurebol-match-{_match.MatchId}",
                    quality = _quality,
                    development = Environment.IsDevelopment(),
                    simulateWebGlFailure = _simulateWebGlFailure,
                    simulatePlayerAssetFailure = _simulatePlayerAssetFailure,
                    playerVisual = _playerVisual,
                    presentationMode = "lab",
                    hudRootId = "futurebol-lab-root"
                },
                _dotNetReference);
        }
        catch (Exception ex)
        {
            _error = FriendlyError(ex);
        }
        finally
        {
            _initializing = false;
            await InvokeAsync(StateHasChanged);
        }
    }

    private async Task LoadRouteMarketDataAsync(CancellationToken ct)
    {
        _match = null;
        _initialPresentation = null;
        _initialMarketSnapshot = null;
        _initialOfficialState = null;
        _marketWarning = null;
        _activeDataMode = "mock";

        if (!string.Equals(Options.DataMode, "api", StringComparison.OrdinalIgnoreCase))
            return;

        if (MatchId is not > 0)
        {
            _marketWarning = "Modo API solicitado sem matchId; demonstração mock ativada.";
            return;
        }

        try
        {
            var match = await Api.GetMatchByIdAsync(
                MatchId.Value,
                includeParticipants: false,
                ct);
            if (match is null)
            {
                _marketWarning = $"Partida {MatchId.Value} não encontrada; demonstração mock ativada.";
                return;
            }

            var snapshots = await Api.GetMatchMetricSnapshotsAsync(
                match.MatchId,
                take: 100,
                ct) ?? [];
            var scoreEvents = await Api.GetMatchScoreEventsAsync(match.MatchId, ct) ?? [];
            var presentation = MatchAdapter.Build(match, null, snapshots, scoreEvents);
            _match = match;
            _initialPresentation = presentation;
            _initialMarketSnapshot = presentation.Market;
            _initialOfficialState = presentation.Official;
            _activeDataMode = "api";
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _marketWarning = "A API da partida não respondeu; demonstração mock ativada.";
            if (Environment.IsDevelopment())
                Logger.LogWarning(ex, "Futurebol initial market load failed. MatchId={MatchId}", MatchId);
        }
    }

    private void StartMarketUpdates()
    {
        if (_disposed
            || _module is null
            || !string.Equals(ActiveDataMode, "api", StringComparison.Ordinal)
            || _match is null)
        {
            return;
        }

        if (_marketUpdateTask is not null && !_marketUpdateTask.IsCompleted)
            return;

        _marketUpdateCts = new CancellationTokenSource();
        _marketUpdateTask = RunMarketUpdatesAsync(_marketUpdateCts.Token);
    }

    private async Task RunMarketUpdatesAsync(CancellationToken ct)
    {
        using var timer = new PeriodicTimer(MarketRefreshInterval);
        try
        {
            while (await timer.WaitForNextTickAsync(ct))
                await RefreshApiMarketAsync(ct);
        }
        catch (OperationCanceledException)
        {
        }
    }

    private async Task RefreshApiMarketAsync(CancellationToken ct)
    {
        if (_module is null || _match is null || _disposed)
            return;

        try
        {
            var match = await Api.GetMatchByIdAsync(
                _match.MatchId,
                includeParticipants: false,
                ct);
            if (match is null)
                throw new InvalidOperationException("A partida deixou de estar disponível.");

            var snapshots = await Api.GetMatchMetricSnapshotsAsync(
                match.MatchId,
                take: 100,
                ct) ?? [];
            var scoreEvents = await Api.GetMatchScoreEventsAsync(match.MatchId, ct) ?? [];
            var presentation = MatchAdapter.Build(match, null, snapshots, scoreEvents);
            _match = match;
            _initialPresentation = presentation;
            _initialMarketSnapshot = presentation.Market;
            _initialOfficialState = presentation.Official;
            await _module.InvokeVoidAsync(
                "updatePresentation",
                ct,
                CanvasId,
                presentation);
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            var message = "Falha temporária ao atualizar os dados da partida.";
            if (Environment.IsDevelopment())
                Logger.LogWarning(ex, "Futurebol market refresh failed. MatchId={MatchId}", _match?.MatchId);

            try
            {
                await _module.InvokeVoidAsync(
                    "reportMarketError",
                    ct,
                    CanvasId,
                    message);
            }
            catch (OperationCanceledException)
            {
            }
        }
    }

    private async Task StopMarketUpdatesAsync()
    {
        var cts = _marketUpdateCts;
        var task = _marketUpdateTask;
        _marketUpdateCts = null;
        _marketUpdateTask = null;

        try
        {
            cts?.Cancel();
            if (task is not null)
                await task;
        }
        catch (OperationCanceledException)
        {
        }
        finally
        {
            cts?.Dispose();
        }
    }

    [JSInvokable]
    public Task ReportFuturebolError(string message)
    {
        _error = string.IsNullOrWhiteSpace(message)
            ? "WebGL não está disponível neste navegador."
            : message;
        _initializing = false;
        return InvokeAsync(StateHasChanged);
    }

    private async Task TogglePauseAsync()
    {
        _isPaused = !_isPaused;
        await InvokeModuleAsync(_isPaused ? "pause" : "resume");
    }

    private Task ResetAsync()
    {
        _isPaused = false;
        return InvokeModuleAsync("reset");
    }

    private Task ForceHomeAsync() => InvokeModuleAsync("setPressure", "home");

    private Task ForceAwayAsync() => InvokeModuleAsync("setPressure", "away");

    private Task BalanceAsync() => InvokeModuleAsync("setPressure", "balanced");

    private Task ForceHomePassAsync() => InvokeModuleAsync("forcePass", "home");

    private Task ForceAwayPassAsync() => InvokeModuleAsync("forcePass", "away");

    private Task ForceHomeShotAsync() => InvokeModuleAsync("forceShot", "home");

    private Task ForceAwayShotAsync() => InvokeModuleAsync("forceShot", "away");

    private Task ForceSaveAsync() => InvokeModuleAsync("forceOutcome", "Saved");

    private Task ForceGoalAsync() => InvokeModuleAsync("forceOutcome", "Goal");

    private Task ResetPlayAsync() => InvokeModuleAsync("resetPlay");

    private async Task ToggleCameraAsync()
    {
        _isFixedCamera = !_isFixedCamera;
        await InvokeModuleAsync("setFixedCamera", _isFixedCamera);
    }

    private async Task SetQualityAsync(string quality)
    {
        _quality = quality is "Low" or "High" ? quality : "Medium";
        await InvokeModuleAsync("setQuality", _quality);
    }

    private async Task SetPlayerVisualAsync(string visual)
    {
        _playerVisual = visual is "Primitives" or "Skeletal" ? visual : "Auto";
        await InvokeModuleAsync("setPlayerVisual", _playerVisual);
    }

    private async Task RetryAsync()
    {
        _simulateWebGlFailure = false;
        await DisposeRuntimeAsync();
        await InitializeAsync();
    }

    private async Task InvokeModuleAsync(string method, params object?[] args)
    {
        if (_module is null || _disposed)
            return;

        var callArgs = new object?[args.Length + 1];
        callArgs[0] = CanvasId;
        Array.Copy(args, 0, callArgs, 1, args.Length);
        await _module.InvokeVoidAsync(method, callArgs);
    }

    private async Task DisposeRuntimeAsync()
    {
        if (_module is null)
            return;

        try
        {
            await _module.InvokeVoidAsync("dispose", CanvasId);
        }
        catch (JSDisconnectedException)
        {
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed)
            return;

        _routeLoadCts?.Cancel();
        await StopMarketUpdatesAsync();
        await DisposeRuntimeAsync();
        _disposed = true;
        _dotNetReference?.Dispose();

        if (_module is not null)
        {
            try
            {
                await _module.DisposeAsync();
            }
            catch (JSDisconnectedException)
            {
            }
        }
    }

    private string? ResolveLogoUrl(string symbol)
    {
        var resolved = Api.BuildBinanceIconUrl(symbol);
        return string.IsNullOrWhiteSpace(resolved) ? null : resolved;
    }

    private static string NormalizeSymbol(string? symbol, string fallback)
    {
        var normalized = EnvironmentIsolationGuard.NormalizeBinanceIconSymbol(symbol);
        if (!string.IsNullOrWhiteSpace(normalized))
            return normalized;
        normalized = EnvironmentIsolationGuard.NormalizeBinanceIconSymbol(fallback);
        return string.IsNullOrWhiteSpace(normalized) ? "?" : normalized;
    }

    private static string FriendlyError(Exception exception)
    {
        var message = exception.Message;
        return message.Contains("WebGL", StringComparison.OrdinalIgnoreCase)
            ? "WebGL não está disponível ou foi bloqueado. Verifique a aceleração gráfica e tente novamente."
            : "O módulo 3D encontrou uma falha isolada. Você pode tentar inicializá-lo novamente.";
    }
}
