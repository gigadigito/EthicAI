using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Npgsql;

namespace CriptoVersus.API.Services;

public interface IPriceCrossoverPublicationService
{
    Task<PriceCrossoverPublicationState?> GetStateAsync(int matchId, CancellationToken ct);

    /// <summary>
    /// Publicacoes CONFIRMADAS (<c>posted</c>) da categoria, desde <paramref name="sinceUtc"/>.
    /// Reservas e tentativas falhas nunca entram: rotacao de moedas considera apenas o que foi
    /// efetivamente publicado.
    /// </summary>
    Task<IReadOnlyList<PriceCrossoverPostedRecord>> GetRecentlyPostedAsync(DateTime sinceUtc, CancellationToken ct);

    Task<PriceCrossoverPublicationResult> ReserveAsync(int matchId, PriceCrossoverReserveRequest request, CancellationToken ct);
    Task<PriceCrossoverPublicationResult> ConfirmAsync(int matchId, PriceCrossoverConfirmRequest request, CancellationToken ct);
    Task<PriceCrossoverPublicationResult> ReleaseAsync(int matchId, string? reason, CancellationToken ct);
}

/// <summary>
/// Controle de duplicidade de publicacao social, persistido em <c>social_post_history</c>.
///
/// Regras:
/// - A chave <c>price_crossover_highlight:{matchId}</c> impede duplicidade por partida.
/// - Reserva e atomica: o indice unico parcial de <c>idempotency_key</c> e a guarda final em PostgreSQL;
///   a verificacao previa cobre o caso de providers sem suporte a restricao unica.
/// - Estados: <c>reserved</c>, <c>publishing</c>, <c>posted</c>, <c>failed</c>, <c>reconciliation_required</c>.
/// - Lease expirado permite reivindicar reserva. <c>reconciliation_required</c> BLOQUEIA nova reserva:
///   resultado desconhecido nunca gera republicacao automatica.
/// - O cooldown de <c>SocialAutomationService</c> e isolado por categoria, para que publicacoes desta
///   categoria nao bloqueiem (nem sejam bloqueadas por) outras categorias como o Win Rate 24H.
/// </summary>
public class SocialPublicationService
{
    private readonly EthicAIDbContext _db;
    private readonly string _category;
    private readonly string _platform;
    private readonly int _reservationLeaseSeconds;

    protected SocialPublicationService(EthicAIDbContext db, string category, string platform, int reservationLeaseSeconds)
    {
        _db = db;
        _category = category;
        _platform = platform;
        _reservationLeaseSeconds = reservationLeaseSeconds;
    }

    public async Task<PriceCrossoverPublicationState?> GetStateAsync(int matchId, CancellationToken ct)
    {
        var entity = await FindPublicationAsync(matchId, ct);
        return entity is null ? null : MapState(entity);
    }

    public async Task<IReadOnlyList<PriceCrossoverPostedRecord>> GetRecentlyPostedAsync(
        DateTime sinceUtc,
        CancellationToken ct)
    {
        var rows = await _db.SocialPostHistory
            .AsNoTracking()
            .Include(x => x.Match).ThenInclude(m => m.TeamA).ThenInclude(t => t.Currency)
            .Include(x => x.Match).ThenInclude(m => m.TeamB).ThenInclude(t => t.Currency)
            .Where(x => x.Category == _category
                && x.Status == PriceCrossoverPublicationStatuses.Posted
                && x.PostedAtUtc != null
                && x.PostedAtUtc >= sinceUtc)
            .OrderBy(x => x.PostedAtUtc)
            .ThenBy(x => x.Id)
            .ToListAsync(ct);

        return rows
            .Select(x => new PriceCrossoverPostedRecord
            {
                MatchId = x.MatchId,
                PostedAtUtc = x.PostedAtUtc!.Value,
                AssetASymbol = x.Match?.TeamA?.Currency?.Symbol ?? string.Empty,
                AssetBSymbol = x.Match?.TeamB?.Currency?.Symbol ?? string.Empty
            })
            .ToList();
    }

    public async Task<PriceCrossoverPublicationResult> ReserveAsync(
        int matchId,
        PriceCrossoverReserveRequest request,
        CancellationToken ct)
    {
        var clock = DateTime.UtcNow;
        var nowUtc = clock.AddTicks(-(clock.Ticks % 10));
        var idempotencyKey = BuildIdempotencyKey(matchId);

        var existing = await FindPublicationAsync(matchId, ct);
        await using var transaction = existing is not null && _db.Database.IsRelational()
            ? await _db.Database.BeginTransactionAsync(ct) : null;
        if (transaction is not null)
        {
            _db.Entry(existing!).State = EntityState.Detached;
            existing = await FindPublicationAsync(matchId, ct, forUpdate: true);
        }
        if (existing is not null)
        {
            switch (existing.Status)
            {
                case PriceCrossoverPublicationStatuses.Posted:
                    return Fail("already_published", "Partida ja publicada para esta categoria.", existing);

                case PriceCrossoverPublicationStatuses.ReconciliationRequired:
                    return Fail(
                        "reconciliation_required",
                        "Publicacao anterior com resultado desconhecido. Reconciliar antes de nova tentativa.",
                        existing);

                case PriceCrossoverPublicationStatuses.Reserved:
                case PriceCrossoverPublicationStatuses.Publishing:
                    var isExpired = existing.LeaseExpiresAtUtc is not null && existing.LeaseExpiresAtUtc.Value <= nowUtc;
                    if (!isExpired)
                        return Fail("already_reserved", "Partida ja reservada por outra publicacao.", existing);
                    break;

                case PriceCrossoverPublicationStatuses.Failed:
                    break;
            }
        }

        var leaseSeconds = request.LeaseSeconds is > 0
            ? Math.Min(request.LeaseSeconds.Value, 7200)
            : _reservationLeaseSeconds;

        var owner = string.IsNullOrWhiteSpace(request.Owner) ? null : request.Owner.Trim();
        var reason = owner is null
            ? $"{_category}_reservation"
            : $"{_category}_reservation:{owner}";

        try
        {
            if (existing is null)
            {
                var entity = new SocialPostHistory
                {
                    MatchId = matchId,
                    Platform = _platform,
                    PostText = string.Empty,
                    HotScore = 0,
                    Reason = reason,
                    CreatedAt = nowUtc,
                    Category = _category,
                    Status = PriceCrossoverPublicationStatuses.Reserved,
                    IdempotencyKey = idempotencyKey,
                    ReservedAtUtc = nowUtc,
                    LeaseExpiresAtUtc = nowUtc.AddSeconds(leaseSeconds)
                };

                _db.SocialPostHistory.Add(entity);
                await _db.SaveChangesAsync(ct);

                if (transaction is not null) await transaction.CommitAsync(ct);

                return new PriceCrossoverPublicationResult
                {
                    Success = true,
                    Result = "reserved",
                    Publication = MapState(entity)
                };
            }

            existing.Status = PriceCrossoverPublicationStatuses.Reserved;
            existing.ReservedAtUtc = nowUtc;
            existing.LeaseExpiresAtUtc = nowUtc.AddSeconds(leaseSeconds);
            existing.LastError = null;
            existing.Reason = reason;

            await _db.SaveChangesAsync(ct);
            if (transaction is not null) await transaction.CommitAsync(ct);

            return new PriceCrossoverPublicationResult
            {
                Success = true,
                Result = "reserved",
                Publication = MapState(existing)
            };
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException
            { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            // Violação do índice único em corrida: outra requisição venceu.
            if (transaction is not null) await transaction.RollbackAsync(ct);
            var winner = await FindPublicationAsync(matchId, ct, asNoTracking: true);
            return Fail("already_reserved", "Reserva concorrente detectada.", winner);
        }
    }

    public async Task<PriceCrossoverPublicationResult> ConfirmAsync(
        int matchId,
        PriceCrossoverConfirmRequest request,
        CancellationToken ct)
    {
        await using var transaction = _db.Database.IsRelational()
            ? await _db.Database.BeginTransactionAsync(ct) : null;
        var entity = await FindPublicationAsync(matchId, ct, forUpdate: transaction is not null);
        if (entity is null)
            return Fail("not_reserved", "Nenhuma reserva encontrada para esta partida.", null);

        if (entity.Status == PriceCrossoverPublicationStatuses.Posted)
        {
            var samePost = string.Equals(request.Outcome?.Trim(), "posted", StringComparison.OrdinalIgnoreCase)
                && (!string.IsNullOrWhiteSpace(request.ExternalPostId)
                    && string.Equals(request.ExternalPostId.Trim(), entity.ExternalPostId, StringComparison.Ordinal)
                    || !string.IsNullOrWhiteSpace(request.ExternalPostUrl)
                    && string.Equals(request.ExternalPostUrl.Trim(), entity.PostUrl, StringComparison.Ordinal));
            return samePost
                ? new PriceCrossoverPublicationResult { Success = true, Result = "posted", Publication = MapState(entity) }
                : Fail("already_published", "Publicacao ja confirmada.", entity);
        }

        if (request.ReservedAtUtc.HasValue && entity.ReservedAtUtc != request.ReservedAtUtc.Value)
            return Fail("stale_reservation", "A reserva informada nao e a reserva atual.", entity);

        if (entity.Status == PriceCrossoverPublicationStatuses.ReconciliationRequired)
            return Fail(
                "reconciliation_required",
                "Publicacao em reconciliacao. Liberar explicitamente antes de confirmar.",
                entity);

        var outcome = (request.Outcome ?? string.Empty).Trim().ToLowerInvariant();
        var nowUtc = DateTime.UtcNow;

        switch (outcome)
        {
            case "posted":
                entity.Status = PriceCrossoverPublicationStatuses.Posted;
                entity.PostedAtUtc = nowUtc;
                entity.ExternalPostId = request.ExternalPostId?.Trim();
                entity.PostUrl = request.ExternalPostUrl?.Trim();
                entity.LastError = null;
                entity.LeaseExpiresAtUtc = null;
                break;

            case "failed":
                entity.Status = PriceCrossoverPublicationStatuses.Failed;
                entity.LastError = string.IsNullOrWhiteSpace(request.Error)
                    ? "Falha reportada pelo workflow."
                    : request.Error.Trim();
                entity.LeaseExpiresAtUtc = null;
                break;

            case "unknown":
                // Resultado desconhecido: nunca republicar automaticamente.
                entity.Status = PriceCrossoverPublicationStatuses.ReconciliationRequired;
                entity.LastError = string.IsNullOrWhiteSpace(request.Error)
                    ? "Resultado da publicacao desconhecido. Reconciliacao necessaria."
                    : request.Error.Trim();
                entity.LeaseExpiresAtUtc = null;
                break;

            default:
                return Fail("invalid_outcome", "Outcome deve ser 'posted', 'failed' ou 'unknown'.", entity);
        }

        await _db.SaveChangesAsync(ct);
        if (transaction is not null) await transaction.CommitAsync(ct);

        return new PriceCrossoverPublicationResult
        {
            Success = true,
            Result = entity.Status!,
            Publication = MapState(entity)
        };
    }

    public async Task<PriceCrossoverPublicationResult> ReleaseAsync(
        int matchId,
        string? reason,
        CancellationToken ct)
        => await ReleaseAsync(matchId, reason, null, ct);

    public async Task<PriceCrossoverPublicationResult> ReleaseAsync(
        int matchId,
        string? reason,
        DateTime? reservedAtUtc,
        CancellationToken ct)
    {
        await using var transaction = _db.Database.IsRelational()
            ? await _db.Database.BeginTransactionAsync(ct) : null;
        var entity = await FindPublicationAsync(matchId, ct, forUpdate: transaction is not null);
        if (entity is null)
            return Fail("not_reserved", "Nenhuma reserva encontrada para esta partida.", null);

        if (entity.Status == PriceCrossoverPublicationStatuses.Posted)
            return Fail("already_published", "Publicacao confirmada nao pode ser liberada.", entity);

        if (reservedAtUtc.HasValue && entity.ReservedAtUtc != reservedAtUtc.Value)
            return Fail("stale_reservation", "A reserva informada nao e a reserva atual.", entity);

        entity.Status = PriceCrossoverPublicationStatuses.Failed;
        entity.LastError = string.IsNullOrWhiteSpace(reason) ? "Reserva liberada." : reason.Trim();
        entity.LeaseExpiresAtUtc = null;

        await _db.SaveChangesAsync(ct);
        if (transaction is not null) await transaction.CommitAsync(ct);

        return new PriceCrossoverPublicationResult
        {
            Success = true,
            Result = "released",
            Publication = MapState(entity)
        };
    }

    private async Task<SocialPostHistory?> FindPublicationAsync(
        int matchId, CancellationToken ct, bool forUpdate = false, bool asNoTracking = false)
    {
        var idempotencyKey = BuildIdempotencyKey(matchId);

        if (forUpdate)
            return (await _db.SocialPostHistory
                .FromSqlInterpolated($"SELECT * FROM social_post_history WHERE idempotency_key = {idempotencyKey} FOR UPDATE")
                .ToListAsync(ct)).SingleOrDefault();

        var query = _db.SocialPostHistory
            .Where(x => x.IdempotencyKey == idempotencyKey)
            .OrderByDescending(x => x.Id);
        return await (asNoTracking ? query.AsNoTracking() : query).FirstOrDefaultAsync(ct);
    }

    private static PriceCrossoverPublicationResult Fail(
        string result,
        string error,
        SocialPostHistory? entity)
        => new()
        {
            Success = false,
            Result = result,
            Error = error,
            Publication = entity is null ? null : MapState(entity)
        };

    private string BuildIdempotencyKey(int matchId) => $"{_category}:{matchId}";

    private static PriceCrossoverPublicationState MapState(SocialPostHistory entity)
        => new()
        {
            Id = entity.Id,
            MatchId = entity.MatchId,
            Category = entity.Category ?? string.Empty,
            Status = entity.Status ?? string.Empty,
            IdempotencyKey = entity.IdempotencyKey,
            ReservedAtUtc = entity.ReservedAtUtc,
            LeaseExpiresAtUtc = entity.LeaseExpiresAtUtc,
            PostedAtUtc = entity.PostedAtUtc,
            ExternalPostId = entity.ExternalPostId,
            ExternalPostUrl = entity.PostUrl,
            LastError = entity.LastError,
            IsLeaseExpired = entity.LeaseExpiresAtUtc is not null && entity.LeaseExpiresAtUtc.Value <= DateTime.UtcNow
        };
}

public sealed class PriceCrossoverPublicationService : SocialPublicationService, IPriceCrossoverPublicationService
{
    public PriceCrossoverPublicationService(EthicAIDbContext db, IOptions<PriceCrossoverOptions> options)
        : base(db, PriceCrossoverCategories.PriceCrossoverHighlight,
            options.Value.Platform, options.Value.ReservationLeaseSeconds) { }
}

public interface ICandleBattlePublicationService : IPriceCrossoverPublicationService
{
    Task<PriceCrossoverPublicationResult> ReleaseAsync(int matchId, string? reason, DateTime? reservedAtUtc, CancellationToken ct);
}

public sealed class CandleBattlePublicationService : SocialPublicationService, ICandleBattlePublicationService
{
    public CandleBattlePublicationService(EthicAIDbContext db, IOptions<CandleBattleSocialOptions> options)
        : base(db, CandleBattleSocialCategories.Highlight,
            options.Value.Platform, options.Value.ReservationLeaseSeconds) { }
}
