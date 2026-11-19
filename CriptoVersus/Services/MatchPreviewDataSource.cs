using DTOs;

namespace CriptoVersus.Web.Services;

/// <summary>
/// Deterministic, scoped preview market. It deliberately only produces DTOs in
/// memory: no API client, database, SignalR connection, browser request or
/// persistence path is reachable from this class.
/// </summary>
public sealed class MatchPreviewDataSource : IMatchPreviewDataSource, IDisposable, IAsyncDisposable
{
    private const int HistoryLength = 180;
    private const int FirstVisibleStep = 72;
    private const int MatchId = -900001;
    private readonly CancellationTokenSource _lifetime = new();
    private readonly Task _clock;
    private readonly DateTime _activeStartUtc;
    private readonly object _disposalLock = new();
    private Task? _disposalTask;
    private int _disposed;
    private int _seed;
    private int _step = FirstVisibleStep;
    private bool _playing = true;
    private int _speed = 1;
    private string _scenario = "balanced";
    private string _state = "active";

    public MatchPreviewDataSource(MatchPreviewOptions options, IHostEnvironment environment)
    {
        if (!MatchPreviewOptions.IsAllowed(options, environment))
            throw new InvalidOperationException("Match preview data is only available when MatchPreview is enabled in Development.");

        _seed = options.Seed;
        _activeStartUtc = DateTime.UtcNow.AddMinutes(-FirstVisibleStep);
        _clock = RunClockAsync(_lifetime.Token);
    }

    public event Action? Changed;
    public int Seed => _seed;
    public bool IsPlaying => _playing;
    public int Speed => _speed;
    public string Scenario => _scenario;
    public string State => _state;

    public Task<MatchDto?> GetMatchAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (string.Equals(_state, "failure", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Simulated Match preview failure.");

        var market = BuildMarket();
        if (string.Equals(_state, "loading", StringComparison.OrdinalIgnoreCase))
            return Task.FromResult<MatchDto?>(new MatchDto
            {
                MatchId = MatchId,
                TeamA = "BTCUSDT",
                TeamB = "ETHUSDT",
                TeamAId = 9101,
                TeamBId = 9102,
                Status = "Pending",
                StartTime = DateTime.UtcNow.AddMinutes(8),
                RemainingMinutes = 90,
                ScoringRuleType = "PercentageCrossover"
            });

        var isPending = string.Equals(_state, "waiting", StringComparison.OrdinalIgnoreCase);
        var isCompleted = string.Equals(_state, "completed", StringComparison.OrdinalIgnoreCase);
        var start = isPending
            ? _activeStartUtc.AddMinutes(80)
            : _activeStartUtc;
        var leftWins = market.Events.Count(x => x.TeamId == 9101);
        var rightWins = market.Events.Count(x => x.TeamId == 9102);

        return Task.FromResult<MatchDto?>(new MatchDto
        {
            MatchId = MatchId,
            TeamA = "BTCUSDT",
            TeamB = "ETHUSDT",
            TeamAId = 9101,
            TeamBId = 9102,
            CurrencyIdA = 9101,
            CurrencyIdB = 9102,
            ScoreA = leftWins,
            ScoreB = rightWins,
            ScoreVersion = _step,
            ScoreUpdatedAtUtc = DateTime.UtcNow,
            CandleBattleLeftWins = leftWins,
            CandleBattleRightWins = rightWins,
            Status = isCompleted ? "Completed" : isPending ? "Pending" : "Ongoing",
            StartTime = start,
            EndTime = isCompleted ? _activeStartUtc.AddMinutes(90) : null,
            BettingCloseTime = isPending ? DateTimeOffset.UtcNow.AddMinutes(5) : DateTimeOffset.UtcNow.AddMinutes(-1),
            ElapsedMinutes = isPending ? 0 : Math.Min(90, _step),
            RemainingMinutes = isPending ? 90 : Math.Max(0, 90 - _step),
            IsFinished = isCompleted,
            PctA = market.LeftPercent,
            PctB = market.RightPercent,
            QuoteVolumeA = market.Snapshots.LastOrDefault(x => x.TeamId == 9101)?.QuoteVolume,
            QuoteVolumeB = market.Snapshots.LastOrDefault(x => x.TeamId == 9102)?.QuoteVolume,
            ScoringRuleType = "PercentageCrossover",
            WinnerTeamId = isCompleted ? (leftWins >= rightWins ? 9101 : 9102) : null,
            WinnerTeamSymbol = isCompleted ? (leftWins >= rightWins ? "BTCUSDT" : "ETHUSDT") : null,
            EndReasonCode = isCompleted ? "simulated_final" : null,
            EndReasonDetail = isCompleted ? "Development preview only — no funds, bets or match result exist." : null,
            TotalAmountTeamA = 42.75m,
            TotalAmountTeamB = 39.20m,
            TotalPool = 81.95m,
            TotalPoolAmount = 81.95m,
            LosingPool = 39.20m,
            WinningPool = 42.75m,
            HouseFeeAmount = 1.64m,
            TotalDistributed = 80.31m,
            WalletCountTeamA = 18,
            WalletCountTeamB = 16,
            BetCountTeamA = 24,
            BetCountTeamB = 19,
            TotalWalletCount = 34,
            HasBetsOnBothSides = true,
            HasValidFinancialDispute = true,
            PoolStrengthTeamA = 52,
            PoolStrengthTeamB = 48
        });
    }

    public Task<IReadOnlyList<MatchMetricSnapshotDto>> GetMetricSnapshotsAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (IsNoDataState()) return Task.FromResult<IReadOnlyList<MatchMetricSnapshotDto>>([]);
        var snapshots = BuildMarket().Snapshots;
        if (string.Equals(_state, "partial", StringComparison.OrdinalIgnoreCase))
            snapshots = snapshots.Where(x => x.TeamId == 9101 || x.CapturedAtUtc.Minute % 3 != 0).ToList();
        return Task.FromResult<IReadOnlyList<MatchMetricSnapshotDto>>(snapshots);
    }

    public Task<IReadOnlyList<MatchScoreEventDto>> GetScoreEventsAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<MatchScoreEventDto>>(IsNoDataState() ? [] : BuildMarket().Events);
    }

    public Task<ArenaSentimentPairDto?> GetArenaSentimentAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (IsNoDataState()) return Task.FromResult<ArenaSentimentPairDto?>(null);
        var market = BuildMarket();
        return Task.FromResult<ArenaSentimentPairDto?>(new ArenaSentimentPairDto
        {
            TeamA = Sentiment("BTCUSDT", market.LeftPercent, market.LeftVolume),
            TeamB = Sentiment("ETHUSDT", market.RightPercent, market.RightVolume)
        });
    }

    public void Play() { _playing = true; Notify(); }
    public void Pause() { _playing = false; Notify(); }
    public void Restart() { _step = FirstVisibleStep; _playing = false; Notify(); }
    public void Advance() { _step = Math.Min(HistoryLength, _step + 1); Notify(); }
    public void SetSpeed(int speed) { _speed = speed is 1 or 2 or 5 or 10 ? speed : 1; Notify(); }
    public void SetScenario(string scenario) { _scenario = NormalizeScenario(scenario); _step = FirstVisibleStep; Notify(); }
    public void SetState(string state) { _state = NormalizeState(state); Notify(); }
    public void SetSeed(int seed) { _seed = seed; _step = FirstVisibleStep; Notify(); }

    private async Task RunClockAsync(CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(500));
        try
        {
            while (await timer.WaitForNextTickAsync(cancellationToken))
            {
                if (Volatile.Read(ref _disposed) != 0)
                    break;

                if (!_playing || !string.Equals(_state, "active", StringComparison.OrdinalIgnoreCase)) continue;
                _step = Math.Min(HistoryLength, _step + _speed);
                if (_step >= HistoryLength) _playing = false;
                Notify();
            }
        }
        catch (OperationCanceledException) { }
    }

    private MarketFrame BuildMarket()
    {
        var random = new Random(StableScenarioSeed(_seed, _scenario));
        const decimal leftBase = 68250m;
        const decimal rightBase = 3650m;
        var left = leftBase;
        var right = rightBase;
        var snapshots = new List<MatchMetricSnapshotDto>();
        var events = new List<MatchScoreEventDto>();
        var start = new DateTime(2026, 11, 18, 12, 0, 0, DateTimeKind.Utc);
        var visible = string.Equals(_state, "loading", StringComparison.OrdinalIgnoreCase) ? 0 : _step;
        var previousLeader = 0;

        for (var index = 0; index < visible; index++)
        {
            var noiseA = ((decimal)random.NextDouble() - .5m) * .34m;
            var noiseB = ((decimal)random.NextDouble() - .5m) * .34m;
            var (driftA, driftB, volatility, volumeFactor) = Profile(index);
            var leftMove = driftA + (noiseA * volatility);
            var rightMove = driftB + (noiseB * volatility);
            left *= 1m + (leftMove / 100m);
            right *= 1m + (rightMove / 100m);
            var timestamp = start.AddMinutes(index);
            var leftPct = ((left / leftBase) - 1m) * 100m;
            var rightPct = ((right / rightBase) - 1m) * 100m;
            var leftVolume = (1_050_000m + (index * 9400m) + ((decimal)random.Next(0, 90_000))) * volumeFactor;
            var rightVolume = (780_000m + (index * 7400m) + ((decimal)random.Next(0, 70_000))) * volumeFactor;
            snapshots.Add(Snapshot(9101, "BTCUSDT", timestamp, left, leftPct, leftVolume, index));
            snapshots.Add(Snapshot(9102, "ETHUSDT", timestamp, right, rightPct, rightVolume, index));

            var leader = leftPct.CompareTo(rightPct);
            if (index > 12 && index % 12 == 0 && leader != 0 && leader != previousLeader)
            {
                var isLeft = leader > 0;
                events.Add(new MatchScoreEventDto
                {
                    MatchScoreEventId = events.Count + 1,
                    MatchId = MatchId,
                    TeamId = isLeft ? 9101 : 9102,
                    TeamSymbol = isLeft ? "BTCUSDT" : "ETHUSDT",
                    RuleType = "PercentageCrossover",
                    EventType = "Crossover",
                    Points = 1,
                    EventSequence = events.Count + 1,
                    TeamPercentageChange = isLeft ? leftPct : rightPct,
                    OpponentPercentageChange = isLeft ? rightPct : leftPct,
                    TeamQuoteVolume = isLeft ? leftVolume : rightVolume,
                    OpponentQuoteVolume = isLeft ? rightVolume : leftVolume,
                    MetricDelta = Math.Abs(leftPct - rightPct),
                    Description = $"Simulated crossover at minute {index}.",
                    EventTimeUtc = timestamp
                });
            }
            if (leader != 0) previousLeader = leader;
        }

        var lastLeft = snapshots.LastOrDefault(x => x.TeamId == 9101);
        var lastRight = snapshots.LastOrDefault(x => x.TeamId == 9102);
        return new MarketFrame(
            snapshots,
            events,
            lastLeft?.PercentageChange ?? 0m,
            lastRight?.PercentageChange ?? 0m,
            lastLeft?.QuoteVolume ?? 0m,
            lastRight?.QuoteVolume ?? 0m);
    }

    private (decimal Left, decimal Right, decimal Volatility, decimal Volume) Profile(int index)
    {
        var wave = (decimal)Math.Sin(index / 7d) * .055m;
        return _scenario switch
        {
            "bull" => (.16m + wave, .07m - wave, 1m, 1m),
            "bear" => (-.15m + wave, -.07m - wave, 1m, 1m),
            "sideways" => (wave, -wave * .8m, .65m, 1m),
            "high-volatility" => (wave * 2m, -wave * 1.8m, 3.2m, 1.4m),
            "low-volatility" => (.018m + wave * .15m, .014m - wave * .12m, .22m, .75m),
            "high-volume" => (.07m + wave, .055m - wave, 1m, 3.8m),
            "comeback" when index < 82 => (-.09m + wave, .12m - wave, 1.2m, 1.1m),
            "comeback" => (.19m + wave, -.055m - wave, 1.3m, 1.2m),
            _ => (.075m + wave, .07m - wave, 1.1m, 1m)
        };
    }

    private static MatchMetricSnapshotDto Snapshot(int teamId, string symbol, DateTime timestamp, decimal price, decimal percent, decimal volume, int index)
        => new()
        {
            MatchMetricSnapshotId = (index * 2L) + (teamId == 9101 ? 1 : 2),
            MatchId = MatchId,
            TeamId = teamId,
            TeamSymbol = symbol,
            CapturedAtUtc = timestamp,
            LastPrice = decimal.Round(price, 6),
            PercentageChange = decimal.Round(percent, 4),
            QuoteVolume = decimal.Round(volume, 2),
            TradeCount = 300 + index * 7
        };

    private static ArenaSentimentDto Sentiment(string symbol, decimal percent, decimal volume)
    {
        var score = Math.Clamp(50 + (int)Math.Round(percent * 8m), 5, 95);
        return new ArenaSentimentDto
        {
            Symbol = symbol,
            Score = score,
            Classification = score >= 75 ? "ExtremeGreed" : score >= 58 ? "Greed" : score <= 25 ? "ExtremeFear" : score <= 42 ? "Fear" : "Neutral",
            PriceMomentumScore = percent,
            VolumeScore = volume / 100000m,
            CalculatedAt = DateTime.UtcNow,
            HasSufficientData = true,
            DataCoverage = 1m,
            Note = "Deterministic development preview"
        };
    }

    private bool IsNoDataState()
        => string.Equals(_state, "no-data", StringComparison.OrdinalIgnoreCase)
            || string.Equals(_state, "loading", StringComparison.OrdinalIgnoreCase);

    private static string NormalizeScenario(string value) => value?.Trim().ToLowerInvariant() switch
    {
        "bull" or "bear" or "sideways" or "high-volatility" or "low-volatility" or "high-volume" or "balanced" or "comeback" => value.Trim().ToLowerInvariant(),
        _ => "balanced"
    };

    private static string NormalizeState(string value) => value?.Trim().ToLowerInvariant() switch
    {
        "waiting" or "active" or "completed" or "loading" or "failure" or "no-data" or "partial" => value.Trim().ToLowerInvariant(),
        _ => "active"
    };

    private static int StableScenarioSeed(int seed, string scenario)
    {
        unchecked
        {
            var hash = seed;
            foreach (var character in scenario)
                hash = (hash * 31) + character;
            return hash;
        }
    }

    private void Notify()
    {
        if (Volatile.Read(ref _disposed) != 0)
            return;

        Changed?.Invoke();
    }

    private Task BeginDisposal()
    {
        lock (_disposalLock)
        {
            if (_disposalTask is not null)
                return _disposalTask;

            Volatile.Write(ref _disposed, 1);
            _lifetime.Cancel();
            _disposalTask = CompleteDisposalAsync();
            return _disposalTask;
        }
    }

    private async Task CompleteDisposalAsync()
    {
        try
        {
            // Wait until the periodic clock stops using the cancellation token.
            await _clock.ConfigureAwait(false);
        }
        finally
        {
            Changed = null;
            _lifetime.Dispose();
        }
    }

    public void Dispose()
    {
        // Do not block the Blazor synchronization context waiting for the clock.
        // The task finishes disposal after RunClockAsync has exited.
        _ = BeginDisposal();
        GC.SuppressFinalize(this);
    }

    public async ValueTask DisposeAsync()
    {
        await BeginDisposal().ConfigureAwait(false);
        GC.SuppressFinalize(this);
    }

    private sealed record MarketFrame(
        List<MatchMetricSnapshotDto> Snapshots,
        List<MatchScoreEventDto> Events,
        decimal LeftPercent,
        decimal RightPercent,
        decimal LeftVolume,
        decimal RightVolume);
}
