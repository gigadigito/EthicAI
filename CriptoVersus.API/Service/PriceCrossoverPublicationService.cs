using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace CriptoVersus.API.Services;

public interface IPriceCrossoverPublicationService
{
    Task<PriceCrossoverPublicationState?> GetStateAsync(int matchId, CancellationToken ct);
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
public sealed class PriceCrossoverPublicationService : IPriceCrossoverPublicationService
{
    private readonly EthicAIDbContext _db;
    private readonly PriceCrossoverOptions _options;

    public PriceCrossoverPublicationService(EthicAIDbContext db, IOptions<PriceCrossoverOptions> options)
    {
        _db = db;
        _options = options.Value;
    }

    public async Task<PriceCrossoverPublicationState?> GetStateAsync(int matchId, CancellationToken ct)
    {
        var entity = await FindPublicationAsync(matchId, ct);
        return entity is null ? null : MapState(entity);
    }

    public async Task<PriceCrossoverPublicationResult> ReserveAsync(
        int matchId,
        PriceCrossoverReserveRequest request,
        CancellationToken ct)
    {
        var nowUtc = DateTime.UtcNow;
        var idempotencyKey = PriceCrossoverCategories.BuildIdempotencyKey(matchId);

        var existing = await FindPublicationAsync(matchId, ct);
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
            : _options.ReservationLeaseSeconds;

        var owner = string.IsNullOrWhiteSpace(request.Owner) ? null : request.Owner.Trim();
        var reason = owner is null
            ? "price_crossover_reservation"
            : $"price_crossover_reservation:{owner}";

        try
        {
            if (existing is null)
            {
                var entity = new SocialPostHistory
                {
                    MatchId = matchId,
                    Platform = _options.Platform,
                    PostText = string.Empty,
                    HotScore = 0,
                    Reason = reason,
                    CreatedAt = nowUtc,
                    Category = PriceCrossoverCategories.PriceCrossoverHighlight,
                    Status = PriceCrossoverPublicationStatuses.Reserved,
                    IdempotencyKey = idempotencyKey,
                    ReservedAtUtc = nowUtc,
                    LeaseExpiresAtUtc = nowUtc.AddSeconds(leaseSeconds)
                };

                _db.SocialPostHistory.Add(entity);
                await _db.SaveChangesAsync(ct);

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

            return new PriceCrossoverPublicationResult
            {
                Success = true,
                Result = "reserved",
                Publication = MapState(existing)
            };
        }
        catch (DbUpdateException)
        {
            // Violação do índice único em corrida: outra requisição venceu.
            var winner = await FindPublicationAsync(matchId, ct);
            return Fail("already_reserved", "Reserva concorrente detectada.", winner);
        }
    }

    public async Task<PriceCrossoverPublicationResult> ConfirmAsync(
        int matchId,
        PriceCrossoverConfirmRequest request,
        CancellationToken ct)
    {
        var entity = await FindPublicationAsync(matchId, ct);
        if (entity is null)
            return Fail("not_reserved", "Nenhuma reserva encontrada para esta partida.", null);

        if (entity.Status == PriceCrossoverPublicationStatuses.Posted)
            return Fail("already_published", "Publicacao ja confirmada.", entity);

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
    {
        var entity = await FindPublicationAsync(matchId, ct);
        if (entity is null)
            return Fail("not_reserved", "Nenhuma reserva encontrada para esta partida.", null);

        if (entity.Status == PriceCrossoverPublicationStatuses.Posted)
            return Fail("already_published", "Publicacao confirmada nao pode ser liberada.", entity);

        entity.Status = PriceCrossoverPublicationStatuses.Failed;
        entity.LastError = string.IsNullOrWhiteSpace(reason) ? "Reserva liberada." : reason.Trim();
        entity.LeaseExpiresAtUtc = null;

        await _db.SaveChangesAsync(ct);

        return new PriceCrossoverPublicationResult
        {
            Success = true,
            Result = "released",
            Publication = MapState(entity)
        };
    }

    private async Task<SocialPostHistory?> FindPublicationAsync(int matchId, CancellationToken ct)
    {
        var idempotencyKey = PriceCrossoverCategories.BuildIdempotencyKey(matchId);

        return await _db.SocialPostHistory
            .Where(x => x.IdempotencyKey == idempotencyKey)
            .OrderByDescending(x => x.Id)
            .FirstOrDefaultAsync(ct);
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
