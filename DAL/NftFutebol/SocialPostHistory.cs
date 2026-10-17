namespace DAL.NftFutebol;

/// <summary>
/// Historico e controle de publicacoes sociais.
///
/// Linhas legadas possuem <see cref="Category"/>, <see cref="Status"/> e <see cref="IdempotencyKey"/> nulos
/// e continuam funcionando exatamente como antes. A coluna <see cref="PostText"/> permanece obrigatoria:
/// a reserva NAO usa <see cref="PostText"/> como mecanismo de controle; o estado fica em <see cref="Status"/>.
/// </summary>
public class SocialPostHistory
{
    public long Id { get; set; }
    public int MatchId { get; set; }
    public string Platform { get; set; } = string.Empty;
    public string PostText { get; set; } = string.Empty;
    public string? PostUrl { get; set; }
    public string? ExternalPostId { get; set; }
    public int HotScore { get; set; }
    public string? Reason { get; set; }
    public DateTime CreatedAt { get; set; }

    // ---- Controle de publicacao (expand-only; nulos em registros legados) ----

    /// <summary>
    /// Categoria da publicacao (ex.: <c>price_crossover_highlight</c>, <c>win_rate_24h</c>).
    /// Null em registros legados. Isola o cooldown entre categorias diferentes.
    /// </summary>
    public string? Category { get; set; }

    /// <summary>
    /// Estado do ciclo de publicacao: <c>reserved</c>, <c>publishing</c>, <c>posted</c>,
    /// <c>failed</c> ou <c>reconciliation_required</c>. Null em registros legados.
    /// </summary>
    public string? Status { get; set; }

    /// <summary>
    /// Chave de idempotencia (ex.: <c>price_crossover_highlight:{matchId}</c>).
    /// Indice unico parcial impede duplicidade por partida e categoria.
    /// </summary>
    public string? IdempotencyKey { get; set; }

    /// <summary>Instante em que a partida foi reservada.</summary>
    public DateTime? ReservedAtUtc { get; set; }

    /// <summary>Fim do lease da reserva. Apos expirar, a reserva pode ser reivindicada.</summary>
    public DateTime? LeaseExpiresAtUtc { get; set; }

    /// <summary>Instante confirmado da publicacao. Distinto de <see cref="CreatedAt"/>.</summary>
    public DateTime? PostedAtUtc { get; set; }

    /// <summary>Ultimo erro registrado, para diagnostico e reconciliacao.</summary>
    public string? LastError { get; set; }

    public Match Match { get; set; } = null!;
}
