using System.Text.Json;
using BLL.NFTFutebol;
using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace CriptoVersus.API.Services;

/// <summary>
/// Contrato do diretor automatico de transmissao das Candle Battles na TV.
/// </summary>
public interface ICandleBattleBroadcastSelectionService
{
    /// <summary>
    /// Escolhe o conteudo a exibir agora: LIVE adequada, senao REPLAY disponivel, senao tela de espera.
    /// Enquanto o conteudo atual nao tiver terminado (encerramento real + janela de resultado final
    /// para LIVE; orcamento de exibicao para REPLAY), a mesma escolha e mantida, mesmo que outra
    /// partida passe a pontuar mais.
    /// </summary>
    Task<CandleBattleBroadcastSelectionDto> GetNextAsync(int? currentMatchId, string? culture, CancellationToken ct);

    /// <summary>
    /// Estado de transmissao de uma partida para o transmissor decidir a troca de conteudo.
    /// Retorna nulo quando a partida nao existe.
    /// </summary>
    Task<CandleBattleBroadcastStatusDto?> GetBroadcastStatusAsync(int matchId, CancellationToken ct);
}

/// <summary>
/// Seleciona automaticamente a melhor Candle Battle para transmissao continua.
///
/// A selecao e somente leitura: nao altera estado de partida, nao escreve rounds, nao reserva
/// nem confirma publicacoes sociais e nao toca nas regras de mercado, pontuacao ou animacao.
/// Metricas de interesse LIVE usam exclusivamente dados persistidos (rounds arcade confirmados);
/// o interesse de REPLAY reutiliza o calculo de <see cref="ICandleBattleSocialService"/>,
/// desconsiderando restricoes de publicacao social (<c>CanPost</c>, <c>AlreadyPublished</c>,
/// reservas), que nao sao restricoes de transmissao.
/// </summary>
public sealed class CandleBattleBroadcastSelectionService : ICandleBattleBroadcastSelectionService
{
    private readonly EthicAIDbContext _db;
    private readonly ICandleBattleSocialService _social;
    private readonly ICandleBattleBroadcastSessionStore _session;
    private readonly CandleBattleBroadcastOptions _options;
    private readonly IConfiguration _configuration;
    private readonly TimeProvider _time;
    private readonly ILogger<CandleBattleBroadcastSelectionService> _logger;

    public CandleBattleBroadcastSelectionService(EthicAIDbContext db, ICandleBattleSocialService social,
        ICandleBattleBroadcastSessionStore session, IOptions<CandleBattleBroadcastOptions> options,
        IConfiguration configuration, ILogger<CandleBattleBroadcastSelectionService> logger,
        TimeProvider? timeProvider = null)
    {
        _db = db;
        _social = social;
        _session = session;
        _options = options.Value;
        _configuration = configuration;
        _logger = logger;
        _time = timeProvider ?? TimeProvider.System;
        _options.Normalize();
    }

    public async Task<CandleBattleBroadcastSelectionDto> GetNextAsync(int? currentMatchId, string? culture, CancellationToken ct)
    {
        var now = _time.GetUtcNow().UtcDateTime;
        _options.Normalize();
        if (!_options.Enabled)
            return Unavailable(now, CandleBattleBroadcastSkipReasons.Disabled);

        try
        {
            return await GetNextCoreAsync(currentMatchId, culture ?? _options.PlaybackCulture, now, ct);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex,
                "Candle Battle broadcast selection failed. CurrentMatchId={CurrentMatchId}, GeneratedAtUtc={GeneratedAtUtc:o}",
                currentMatchId, now);
            // Nao troca de partida com base em resposta invalida: mantem o conteudo em exibicao.
            var sticky = _session.Selection is { } held && held.Available
                ? held with { GeneratedAtUtc = now }
                : null;
            return sticky ?? Unavailable(now, CandleBattleBroadcastSkipReasons.SourceUnavailable);
        }
    }

    public async Task<CandleBattleBroadcastStatusDto?> GetBroadcastStatusAsync(int matchId, CancellationToken ct)
    {
        var now = _time.GetUtcNow().UtcDateTime;
        _options.Normalize();
        var snapshot = await LoadSnapshotAsync(matchId, now, ct);
        return snapshot is null ? null : await BuildStatusAsync(snapshot, now, ct);
    }

    private async Task<CandleBattleBroadcastSelectionDto> GetNextCoreAsync(int? currentMatchId, string culture,
        DateTime now, CancellationToken ct)
    {
        var held = _session.Selection;
        var stickyId = currentMatchId ?? held?.MatchId;
        if (stickyId is { } id)
        {
            var snapshot = await LoadSnapshotAsync(id, now, ct);
            if (snapshot is not null)
            {
                var status = await BuildStatusAsync(snapshot, now, ct);
                if (status.Mode != CandleBattleBroadcastModes.None && !status.ShouldSwitch)
                {
                    var selection = await TryBuildSelectionAsync(snapshot, status, culture, now, ct);
                    if (selection is not null)
                    {
                        _session.SetSelection(selection, now, now);
                        _logger.LogInformation(
                            "Candle Battle broadcast hold. MatchId={MatchId}, Mode={Mode}, ShouldSwitch=false",
                            selection.MatchId, selection.Mode);
                        return selection;
                    }
                }
            }
        }

        if (_session.EmptyUntilUtc is { } emptyUntil && now < emptyUntil)
            return Unavailable(now, CandleBattleBroadcastSkipReasons.NoContent);

        var live = _options.PreferLive ? await SelectBestLiveAsync(culture, now, ct) : null;
        var replay = default(CandleBattleBroadcastSelectionDto);
        var sourceError = false;
        if (live is null && _options.AllowReplayFallback)
            (replay, sourceError) = await SelectBestReplayAsync(culture, now, ct);
        if (live is null && replay is null && !_options.PreferLive)
            live = await SelectBestLiveAsync(culture, now, ct);

        if (live is null && replay is null)
        {
            if (sourceError)
            {
                // Falha temporaria das origens: nao vira "sem conteudo" e nao entra no cache,
                // para a proxima consulta tentar de novo.
                _logger.LogWarning("Candle Battle broadcast source unavailable. GeneratedAtUtc={GeneratedAtUtc:o}", now);
                return Unavailable(now, CandleBattleBroadcastSkipReasons.SourceUnavailable);
            }

            var empty = Unavailable(now, CandleBattleBroadcastSkipReasons.NoContent);
            _session.Clear();
            _session.SetEmptyUntil(now.AddSeconds(_options.SelectionCacheSeconds));
            _logger.LogInformation(
                "Candle Battle broadcast has no content. GeneratedAtUtc={GeneratedAtUtc:o}, CacheSeconds={CacheSeconds}",
                now, _options.SelectionCacheSeconds);
            return empty;
        }

        var selected = live ?? replay!;
        _session.SetSelection(selected, now, now);
        if (selected.Mode == CandleBattleBroadcastModes.Replay && selected.MatchId is { } replayId)
            _session.MarkReplayShown(replayId, now, _options.ReplayHistorySize);
        _logger.LogInformation(
            "Candle Battle broadcast selected. MatchId={MatchId}, Mode={Mode}, InterestScore={InterestScore}, Reasons={Reasons}",
            selected.MatchId, selected.Mode, selected.InterestScore, string.Join(",", selected.SelectionReasons));
        return selected;
    }

    // ---------------------------------------------------------------- LIVE

    private async Task<CandleBattleBroadcastSelectionDto?> SelectBestLiveAsync(string culture, DateTime now, CancellationToken ct)
    {
        var matches = await _db.Match.AsNoTracking()
            .Include(x => x.TeamA).ThenInclude(x => x.Currency)
            .Include(x => x.TeamB).ThenInclude(x => x.Currency)
            .Where(x => x.Status == MatchStatus.Ongoing)
            .ToListAsync(ct);

        CandleBattleBroadcastSelectionDto? best = null;
        foreach (var match in matches)
        {
            ct.ThrowIfCancellationRequested();
            var snapshot = await LoadSnapshotAsync(match, now, ct);
            if (snapshot is null) continue;
            if (!IsLiveEligible(snapshot, now)) continue;
            var status = await BuildStatusAsync(snapshot, now, ct);
            var candidate = BuildLiveSelection(snapshot, status, culture, now);
            if (best is null || IsBetterLive(candidate, best)) best = candidate;
        }

        return best;
    }

    private bool IsLiveEligible(BroadcastSnapshot snapshot, DateTime now)
    {
        var match = snapshot.Match;
        if (match.Status != MatchStatus.Ongoing) return false;
        if (snapshot.Terminal) return false;
        if (match.StartTime is null) return false;
        if (snapshot.EffectiveEndUtc is null) return false;
        var remaining = (int)Math.Floor((snapshot.EffectiveEndUtc.Value - now).TotalSeconds);
        if (remaining < _options.MinimumLiveRemainingSeconds) return false;
        if (string.IsNullOrWhiteSpace(snapshot.SymbolA) || string.IsNullOrWhiteSpace(snapshot.SymbolB)) return false;
        if (MatchPairRules.IsForbiddenPair(snapshot.SymbolA, snapshot.SymbolB, _configuration)) return false;
        // Dados suficientes para renderizar: a partida precisa estar inscrita no arcade
        // ou ja ter rounds confirmados; uma partida sem nenhum dos dois renderizaria vazio.
        return snapshot.State is not null || snapshot.Rows.Count > 0;
    }

    private static bool IsBetterLive(CandleBattleBroadcastSelectionDto candidate, CandleBattleBroadcastSelectionDto best)
    {
        if (candidate.InterestScore != best.InterestScore) return candidate.InterestScore > best.InterestScore;
        var candidateAlternations = candidate.SelectionReasons.Contains(CandleBattleBroadcastInterest.ReasonLeadAlternations);
        var bestAlternations = best.SelectionReasons.Contains(CandleBattleBroadcastInterest.ReasonLeadAlternations);
        if (candidateAlternations != bestAlternations) return candidateAlternations;
        var candidateBalanced = candidate.SelectionReasons.Contains(CandleBattleBroadcastInterest.ReasonBalancedScore);
        var bestBalanced = best.SelectionReasons.Contains(CandleBattleBroadcastInterest.ReasonBalancedScore);
        if (candidateBalanced != bestBalanced) return candidateBalanced;
        if (candidate.RemainingSeconds != best.RemainingSeconds)
            return (candidate.RemainingSeconds ?? 0) > (best.RemainingSeconds ?? 0);
        // Desempate deterministico final.
        return (candidate.MatchId ?? 0) < (best.MatchId ?? 0);
    }

    // ---------------------------------------------------------------- REPLAY

    private async Task<(CandleBattleBroadcastSelectionDto? Selection, bool SourceError)> SelectBestReplayAsync(
        string culture, DateTime now, CancellationToken ct)
    {
        var lookbackStart = now.AddHours(-_options.ReplayLookbackHours);
        var matches = await _db.Match.AsNoTracking()
            .Include(x => x.TeamA).ThenInclude(x => x.Currency)
            .Include(x => x.TeamB).ThenInclude(x => x.Currency)
            .Where(x => x.Status == MatchStatus.Completed && x.EndTime != null
                && x.EndTime >= lookbackStart && x.EndTime <= now)
            .OrderByDescending(x => x.EndTime).ThenBy(x => x.MatchId)
            .Take(_options.MaxReplayCandidates * 2)
            .ToListAsync(ct);

        var candidates = new List<(CandleBattleBroadcastSelectionDto Dto, DateTime? ShownAtUtc)>();
        var readFailures = 0;
        foreach (var match in matches)
        {
            ct.ThrowIfCancellationRequested();
            if (candidates.Count >= _options.MaxReplayCandidates) break;
            var symbolA = match.TeamA?.Currency?.Symbol ?? string.Empty;
            var symbolB = match.TeamB?.Currency?.Symbol ?? string.Empty;
            if (MatchPairRules.IsForbiddenPair(symbolA, symbolB, _configuration)) continue;

            CandleBattleSocialResponse? battle;
            try
            {
                battle = await _social.GetByMatchIdAsync(match.MatchId, culture, true, ct);
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex)
            {
                readFailures++;
                _logger.LogWarning(ex, "Candle Battle replay candidate read failed. MatchId={MatchId}", match.MatchId);
                continue;
            }
            if (battle is null || !IsIntegralReplay(battle)) continue;

            var shownAtUtc = _session.GetReplayShownAtUtc(match.MatchId);
            var selection = new CandleBattleBroadcastSelectionDto
            {
                Available = true,
                Mode = CandleBattleBroadcastModes.Replay,
                MatchId = battle.MatchId,
                BattleId = battle.BattleId,
                AssetA = battle.AssetA.Symbol,
                AssetB = battle.AssetB.Symbol,
                ScoreA = battle.ScoreA,
                ScoreB = battle.ScoreB,
                InterestScore = battle.InterestScore,
                SelectionReasons = battle.SelectionReasons,
                MatchStatus = battle.Status,
                BattleStatus = battle.BattleStatus,
                IsFinished = true,
                ReplayAvailable = true,
                WinnerSymbol = battle.WinnerSymbol,
                StartTimeUtc = battle.StartTimeUtc,
                EndTimeUtc = battle.EndTimeUtc,
                RemainingSeconds = null,
                PlaybackUrl = BuildPlaybackUrl(battle.AssetA.Symbol, battle.AssetB.Symbol, battle.MatchId, culture),
                FinalResultDisplaySeconds = _options.FinalResultDisplaySeconds,
                StatusPollingSeconds = _options.StatusPollingSeconds,
                GeneratedAtUtc = now
            };
            candidates.Add((selection, shownAtUtc));
        }

        if (candidates.Count == 0)
            return (null, readFailures > 0);

        // Replays ainda nao exibidos vem primeiro; entre os ja exibidos, o menos recente primeiro.
        // Depois, maior interesse, reviravoltas, placar equilibrado e desempate deterministico.
        var ordered = candidates
            .OrderBy(x => x.ShownAtUtc is null ? 0 : 1)
            .ThenBy(x => x.ShownAtUtc ?? DateTime.MinValue)
            .ThenByDescending(x => x.Dto.InterestScore)
            .ThenByDescending(x => x.Dto.SelectionReasons.Contains("comeback"))
            .ThenByDescending(x => x.Dto.SelectionReasons.Contains(CandleBattleBroadcastInterest.ReasonBalancedScore))
            .ThenByDescending(x => x.Dto.EndTimeUtc ?? DateTime.MinValue)
            .ThenBy(x => x.Dto.MatchId ?? 0)
            .ToArray();
        return (ordered[0].Dto, false);
    }

    /// <summary>
    /// Replay utilizavel: rounds persistidos, validados e integros na janela exigida da partida,
    /// com encerramento real concluido. Nao considera <c>CanPost</c>, <c>AlreadyPublished</c> nem
    /// estado de reserva social, que nao sao restricoes de transmissao.
    ///
    /// A sequencia exigida espelha a regra de sequencia de publicacao de
    /// <see cref="CandleBattleSocialService.BuildResponse"/> (primeiro fecho exigido da partida e
    /// rounds contiguos de <see cref="CandleBattlesResolver.PeriodMs"/>), usando os mesmos
    /// <see cref="CandleBattlesResolver"/> daquela regra.
    /// </summary>
    private static bool IsIntegralReplay(CandleBattleSocialResponse battle)
    {
        if (!battle.ReplayAvailable
            || !string.Equals(battle.BattleStatus, "finished", StringComparison.Ordinal)
            || !string.Equals(battle.Status, nameof(MatchStatus.Completed), StringComparison.Ordinal)
            || battle.StartTimeUtc is null
            || battle.ExpectedConfrontations <= 0
            || battle.Rounds.Count != battle.ExpectedConfrontations)
            return false;

        var firstMs = new DateTimeOffset(DateTime.SpecifyKind(battle.StartTimeUtc.Value, DateTimeKind.Utc))
            .ToUnixTimeMilliseconds();
        firstMs = CandleBattlesResolver.FirstRequiredOpen(firstMs);
        return battle.Rounds
            .Select((round, index) => round.Left.OpenTime == firstMs + index * CandleBattlesResolver.PeriodMs)
            .All(x => x);
    }

    // ---------------------------------------------------------------- STATUS / SNAPSHOT

    private sealed record BroadcastSnapshot(
        Match Match,
        CandleBattlesState? State,
        IReadOnlyList<CandleBattlesRound> Rows,
        IReadOnlyList<CandleBattlesRoundDto> Projected,
        int ScoreA,
        int ScoreB,
        bool Terminal,
        DateTime? EffectiveEndUtc,
        string SymbolA,
        string SymbolB);

    private async Task<BroadcastSnapshot?> LoadSnapshotAsync(int matchId, DateTime now, CancellationToken ct)
    {
        var match = await _db.Match.AsNoTracking()
            .Include(x => x.TeamA).ThenInclude(x => x.Currency)
            .Include(x => x.TeamB).ThenInclude(x => x.Currency)
            .SingleOrDefaultAsync(x => x.MatchId == matchId, ct);
        return match is null ? null : await LoadSnapshotAsync(match, now, ct);
    }

    private async Task<BroadcastSnapshot?> LoadSnapshotAsync(Match match, DateTime now, CancellationToken ct)
    {
        var state = await _db.Set<CandleBattlesState>().AsNoTracking()
            .SingleOrDefaultAsync(x => x.MatchId == match.MatchId, ct);
        var query = _db.Set<CandleBattlesRound>().AsNoTracking().Where(x => x.MatchId == match.MatchId);
        if (match.StartTime.HasValue)
        {
            var startMs = ToUnixMs(match.StartTime.Value);
            var endMs = match.EndTime.HasValue ? ToUnixMs(match.EndTime.Value) : (long?)null;
            var firstMs = CandleBattlesResolver.FirstRequiredOpen(startMs);
            var windowCloseMs = CandleBattlesResolver.RequiredWindowClose(startMs, endMs);
            var firstUtc = FromUnixMs(firstMs);
            var lastOpenUtc = FromUnixMs(windowCloseMs - CandleBattlesResolver.PeriodMs);
            query = query.Where(x => x.OpenTimeUtc >= firstUtc && x.OpenTimeUtc <= lastOpenUtc);
        }
        var rows = await query.OrderBy(x => x.OpenTimeUtc).ToListAsync(ct);

        var projected = new List<CandleBattlesRoundDto>(rows.Count);
        foreach (var row in rows)
        {
            try { projected.Add(CandleBattlesRoundProjection.ToDto(row)); }
            catch (JsonException ex)
            {
                _logger.LogWarning(ex, "Candle Battle broadcast round ignored. MatchId={MatchId}, OpenTimeUtc={OpenTimeUtc}",
                    match.MatchId, row.OpenTimeUtc);
            }
        }

        var scoreA = 0;
        var scoreB = 0;
        foreach (var row in rows)
        {
            try
            {
                var winner = CandleBattlesRoundProjection.EffectiveWinner(row);
                if (winner == "left") scoreA++;
                else if (winner == "right") scoreB++;
            }
            catch (JsonException)
            {
                // Round malformado ja foi registrado acima e nao entra no placar.
            }
        }

        var effectiveEndUtc = ResolveEffectiveEnd(match);
        var terminal = IsTerminal(match, now);
        return new BroadcastSnapshot(match, state, rows, projected, scoreA, scoreB, terminal, effectiveEndUtc,
            match.TeamA?.Currency?.Symbol ?? string.Empty,
            match.TeamB?.Currency?.Symbol ?? string.Empty);
    }

    private async Task<CandleBattleBroadcastStatusDto> BuildStatusAsync(BroadcastSnapshot snapshot, DateTime now, CancellationToken ct)
    {
        var match = snapshot.Match;
        var mode = ResolveMode(snapshot, now);
        var remaining = mode == CandleBattleBroadcastModes.Live && snapshot.EffectiveEndUtc is { } endUtc
            ? Math.Max(0, (int)Math.Floor((endUtc - now).TotalSeconds))
            : (int?)null;

        var (shouldSwitch, switchReason) = await ResolveSwitchAsync(snapshot, mode, now, ct);
        return new CandleBattleBroadcastStatusDto
        {
            MatchId = match.MatchId,
            Mode = mode,
            MatchStatus = match.Status.ToString(),
            BattleStatus = snapshot.State?.Status ?? "unavailable",
            IsFinished = snapshot.Terminal,
            ReplayAvailable = snapshot.Rows.Count > 0,
            WinnerSymbol = ResolveWinnerSymbol(snapshot),
            StartTimeUtc = match.StartTime,
            EndTimeUtc = snapshot.EffectiveEndUtc,
            RemainingSeconds = remaining,
            ShouldSwitch = shouldSwitch,
            SwitchReason = switchReason,
            GeneratedAtUtc = now
        };
    }

    /// <summary>
    /// Janela de resultado final: depois do encerramento real a partida continua sendo o conteudo
    /// em exibicao (modo <c>live</c>, <c>isFinished</c> true) ate a animacao de vitoria e o
    /// resultado terminarem. Depois disso o conteudo vira replay ou sai do ar.
    /// </summary>
    private bool IsInFinalResultHold(BroadcastSnapshot snapshot, DateTime now)
    {
        if (!snapshot.Terminal || snapshot.Match.Status == MatchStatus.Cancelled) return false;
        if (snapshot.EffectiveEndUtc is not { } endUtc) return false;
        return (now - endUtc).TotalSeconds < _options.FinalResultDisplaySeconds;
    }

    private string ResolveMode(BroadcastSnapshot snapshot, DateTime now)
    {
        if (snapshot.Match.Status == MatchStatus.Cancelled) return CandleBattleBroadcastModes.None;
        if (IsInFinalResultHold(snapshot, now)) return CandleBattleBroadcastModes.Live;
        if (!snapshot.Terminal)
            return snapshot.Match.Status == MatchStatus.Ongoing ? CandleBattleBroadcastModes.Live : CandleBattleBroadcastModes.None;
        return snapshot.Match.Status == MatchStatus.Completed && snapshot.Rows.Count > 0
            ? CandleBattleBroadcastModes.Replay
            : CandleBattleBroadcastModes.None;
    }

    private async Task<(bool ShouldSwitch, string? Reason)> ResolveSwitchAsync(BroadcastSnapshot snapshot,
        string mode, DateTime now, CancellationToken ct)
    {
        if (mode == CandleBattleBroadcastModes.Replay)
        {
            var servedAtUtc = _session.Selection?.MatchId == snapshot.Match.MatchId ? _session.ServedAtUtc : null;
            if (servedAtUtc is null) return (false, CandleBattleBroadcastSwitchReasons.ReplayServingUnknown);
            var servedFor = (now - servedAtUtc.Value).TotalSeconds;
            if (servedFor >= _options.ReplayDisplaySeconds)
                return (true, CandleBattleBroadcastSwitchReasons.ReplayBudgetElapsed);
            if (_options.AllowLiveInterruptReplay && servedFor >= _options.ReplayMinimumDisplaySeconds
                && await SelectBestLiveAsync(_options.PlaybackCulture, now, ct) is not null)
                return (true, CandleBattleBroadcastSwitchReasons.LiveAvailable);
            return (false, null);
        }

        if (snapshot.Terminal)
        {
            if (snapshot.Match.Status == MatchStatus.Cancelled)
                return (true, CandleBattleBroadcastSwitchReasons.MatchEnded);
            var endUtc = snapshot.EffectiveEndUtc ?? now;
            // A animacao final e a exibicao do vencedor terminam depois da janela de resultado.
            return (now - endUtc).TotalSeconds >= _options.FinalResultDisplaySeconds
                ? (true, CandleBattleBroadcastSwitchReasons.FinalResultDisplayed)
                : (false, null);
        }

        return mode == CandleBattleBroadcastModes.Live
            ? (false, null)
            : (true, CandleBattleBroadcastSwitchReasons.NoContent);
    }

    private string? ResolveWinnerSymbol(BroadcastSnapshot snapshot)
    {
        // Vencedor definitivo so existe com encerramento real concluido pelo Worker
        // (estado arcade finalizado) e placar decidido.
        var final = snapshot.Match.Status == MatchStatus.Completed
            && snapshot.State is { Complete: true, Status: "finished" };
        if (!final || snapshot.ScoreA == snapshot.ScoreB) return null;
        return snapshot.ScoreA > snapshot.ScoreB ? snapshot.SymbolA : snapshot.SymbolB;
    }

    // ---------------------------------------------------------------- SELECTION BUILD

    /// <summary>
    /// Monta a selecao para um conteudo em exibicao. Retorna nulo quando o conteudo nao pode
    /// ser mantido (replay apos reinicio do processo sem replay integro validado), forcando
    /// uma nova selecao em vez de exibir conteudo invalido.
    /// </summary>
    private async Task<CandleBattleBroadcastSelectionDto?> TryBuildSelectionAsync(BroadcastSnapshot snapshot,
        CandleBattleBroadcastStatusDto status, string culture, DateTime now, CancellationToken ct)
    {
        if (status.Mode != CandleBattleBroadcastModes.Replay)
            return BuildLiveSelection(snapshot, status, culture, now);

        // Interesse de replay vem do CandleBattleSocial (regras ja existentes).
        var held = _session.Selection;
        if (held is { Mode: CandleBattleBroadcastModes.Replay } && held.MatchId == snapshot.Match.MatchId)
        {
            return held with
            {
                ScoreA = snapshot.ScoreA, ScoreB = snapshot.ScoreB,
                BattleStatus = status.BattleStatus, IsFinished = status.IsFinished,
                WinnerSymbol = status.WinnerSymbol, EndTimeUtc = status.EndTimeUtc,
                GeneratedAtUtc = now
            };
        }

        var battle = await _social.GetByMatchIdAsync(snapshot.Match.MatchId, culture, true, ct);
        return battle is not null && IsIntegralReplay(battle)
            ? BuildReplaySelection(snapshot, status, battle, culture, now)
            : null;
    }

    private CandleBattleBroadcastSelectionDto BuildLiveSelection(BroadcastSnapshot snapshot,
        CandleBattleBroadcastStatusDto status, string culture, DateTime now)
    {
        var interest = EvaluateLiveInterest(snapshot, now);
        return new CandleBattleBroadcastSelectionDto
        {
            Available = true,
            Mode = CandleBattleBroadcastModes.Live,
            MatchId = snapshot.Match.MatchId,
            BattleId = $"{snapshot.Match.MatchId}:5m",
            AssetA = snapshot.SymbolA,
            AssetB = snapshot.SymbolB,
            ScoreA = snapshot.ScoreA,
            ScoreB = snapshot.ScoreB,
            InterestScore = interest.Score,
            SelectionReasons = interest.Reasons,
            MatchStatus = status.MatchStatus,
            BattleStatus = status.BattleStatus,
            IsFinished = status.IsFinished,
            ReplayAvailable = snapshot.Rows.Count > 0,
            WinnerSymbol = status.WinnerSymbol,
            StartTimeUtc = snapshot.Match.StartTime,
            EndTimeUtc = snapshot.EffectiveEndUtc,
            RemainingSeconds = status.RemainingSeconds,
            PlaybackUrl = BuildPlaybackUrl(snapshot.SymbolA, snapshot.SymbolB, snapshot.Match.MatchId, culture),
            FinalResultDisplaySeconds = _options.FinalResultDisplaySeconds,
            StatusPollingSeconds = _options.StatusPollingSeconds,
            GeneratedAtUtc = now
        };
    }

    private CandleBattleBroadcastSelectionDto BuildReplaySelection(BroadcastSnapshot snapshot,
        CandleBattleBroadcastStatusDto status, CandleBattleSocialResponse? battle, string culture, DateTime now)
    {
        var interestScore = battle?.InterestScore ?? 0;
        var reasons = battle?.SelectionReasons ?? [];
        return new CandleBattleBroadcastSelectionDto
        {
            Available = true,
            Mode = CandleBattleBroadcastModes.Replay,
            MatchId = snapshot.Match.MatchId,
            BattleId = $"{snapshot.Match.MatchId}:5m",
            AssetA = snapshot.SymbolA,
            AssetB = snapshot.SymbolB,
            ScoreA = snapshot.ScoreA,
            ScoreB = snapshot.ScoreB,
            InterestScore = interestScore,
            SelectionReasons = reasons,
            MatchStatus = status.MatchStatus,
            BattleStatus = status.BattleStatus,
            IsFinished = true,
            ReplayAvailable = true,
            WinnerSymbol = status.WinnerSymbol,
            StartTimeUtc = snapshot.Match.StartTime,
            EndTimeUtc = snapshot.EffectiveEndUtc,
            RemainingSeconds = null,
            PlaybackUrl = BuildPlaybackUrl(snapshot.SymbolA, snapshot.SymbolB, snapshot.Match.MatchId, culture),
            FinalResultDisplaySeconds = _options.FinalResultDisplaySeconds,
            StatusPollingSeconds = _options.StatusPollingSeconds,
            GeneratedAtUtc = now
        };
    }

    private CandleBattleBroadcastInterestResult EvaluateLiveInterest(BroadcastSnapshot snapshot, DateTime now)
    {
        var rounds = snapshot.Projected;
        var decided = snapshot.ScoreA + snapshot.ScoreB;

        var lead = 0;
        var flips = 0;
        var runningA = 0;
        var runningB = 0;
        foreach (var round in rounds)
        {
            if (round.Winner == "left") runningA++;
            else if (round.Winner == "right") runningB++;
            var next = Math.Sign(runningA - runningB);
            if (lead != 0 && next != 0 && next != lead) flips++;
            if (next != 0) lead = next;
        }

        var volatilityRounds = rounds.Count <= _options.RecentVolatilityRounds
            ? rounds
            : rounds.Skip(rounds.Count - _options.RecentVolatilityRounds).ToArray();
        decimal? movement = null;
        var movementSamples = new List<decimal>();
        foreach (var round in volatilityRounds)
        {
            if (round.Left.Open <= 0 || round.Right.Open <= 0) continue;
            movementSamples.Add((Math.Abs(CandleBattlesResolver.PercentageChange(round.Left))
                + Math.Abs(CandleBattlesResolver.PercentageChange(round.Right))) / 2m);
        }
        if (movementSamples.Count > 0) movement = movementSamples.Average();

        var expectedSlots = Math.Max(1, _options.ActivityWindowMinutes * 60_000 / CandleBattlesResolver.PeriodMs);
        var windowStart = now.AddMinutes(-_options.ActivityWindowMinutes);
        decimal? activity = snapshot.Rows.Count == 0
            ? null
            : Math.Min(1m, (decimal)snapshot.Rows.Count(x => x.OpenTimeUtc >= windowStart) / expectedSlots);

        var metrics = new CandleBattleLiveMetrics(
            snapshot.ScoreA,
            snapshot.ScoreB,
            rounds.Count,
            movement,
            rounds.Count == 0 ? null : flips,
            activity,
            snapshot.EffectiveEndUtc is { } endUtc ? Math.Max(0, (int)Math.Floor((endUtc - now).TotalSeconds)) : 0,
            TvPopularSymbols.IsPopular(snapshot.SymbolA),
            TvPopularSymbols.IsPopular(snapshot.SymbolB));

        var interest = CandleBattleBroadcastInterest.Calculate(metrics, _options);
        _logger.LogDebug(
            "Candle Battle broadcast interest. MatchId={MatchId}, Score={Score}, Decided={Decided}, Flips={Flips}, Missing={Missing}",
            snapshot.Match.MatchId, interest.Score, decided, flips, string.Join(",", interest.MissingCriteria));
        return interest;
    }

    // ---------------------------------------------------------------- HELPERS

    private string? BuildPlaybackUrl(string symbolA, string symbolB, int matchId, string culture)
        => TvCandleBattlePublicUrl.TryBuild(ResolvePublicBaseUrl(), matchId, symbolA, symbolB, culture, out var url)
            ? url
            : null;

    private CandleBattleBroadcastSelectionDto Unavailable(DateTime now, string reason)
        => new()
        {
            Available = false,
            Mode = CandleBattleBroadcastModes.None,
            SkipReason = reason,
            FinalResultDisplaySeconds = _options.FinalResultDisplaySeconds,
            StatusPollingSeconds = _options.StatusPollingSeconds,
            GeneratedAtUtc = now
        };

    private DateTime? ResolveEffectiveEnd(Match match)
    {
        if (match.EndTime.HasValue) return match.EndTime.Value;
        return match.StartTime?.AddMinutes(_options.MatchDurationMinutes);
    }

    /// <summary>
    /// Encerramento real da partida: terminal por status, por <c>EndTime</c> alcancado ou pelo
    /// limite de duracao. Nao depende da conclusao de um candle de cinco minutos.
    /// </summary>
    private bool IsTerminal(Match match, DateTime nowUtc)
    {
        if (match.Status is MatchStatus.Completed or MatchStatus.Cancelled) return true;
        var endUtc = ResolveEffectiveEnd(match);
        return endUtc is not null && nowUtc >= endUtc.Value;
    }

    private string ResolvePublicBaseUrl()
    {
        var configured = _options.PublicBaseUrl?.Trim()
            ?? _configuration["SocialAutomation:PublicBaseUrl"]?.Trim()
            ?? _configuration["CriptoVersus:PublicBaseUrl"]?.Trim()
            ?? "https://criptoversus.com";
        return configured.TrimEnd('/');
    }

    private static long ToUnixMs(DateTime value)
        => new DateTimeOffset(DateTime.SpecifyKind(value, DateTimeKind.Utc)).ToUnixTimeMilliseconds();

    private static DateTime FromUnixMs(long value) => DateTimeOffset.FromUnixTimeMilliseconds(value).UtcDateTime;
}
