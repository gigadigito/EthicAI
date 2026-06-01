using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace CriptoVersus.API.Controllers;

[ApiController]
[Route("api/coin-social-profile")]
public sealed class CoinSocialProfileController : ControllerBase
{
    private readonly EthicAIDbContext _db;

    public CoinSocialProfileController(EthicAIDbContext db)
    {
        _db = db;
    }

    [AllowAnonymous]
    [HttpGet("{symbol}")]
    public async Task<ActionResult<CoinSocialProfileDto>> GetBySymbol(string symbol, CancellationToken ct)
    {
        var entity = await FindAsync(symbol, null, ct);
        return entity is null ? NotFound() : Ok(ToDto(entity));
    }

    [AllowAnonymous]
    [HttpGet]
    public async Task<ActionResult<CoinSocialProfileDto>> Get(
        [FromQuery] string? symbol,
        [FromQuery(Name = "coingecko_id")] string? coinGeckoId,
        CancellationToken ct)
    {
        var entity = await FindAsync(symbol, coinGeckoId, ct);
        return entity is null ? NotFound() : Ok(ToDto(entity));
    }

    private async Task<CoinSocialProfile?> FindAsync(string? symbol, string? coinGeckoId, CancellationToken ct)
    {
        var normalizedSymbol = NormalizeSymbol(symbol);
        var normalizedCoinGeckoId = NormalizeCoinGeckoId(coinGeckoId);

        if (string.IsNullOrWhiteSpace(normalizedSymbol) && string.IsNullOrWhiteSpace(normalizedCoinGeckoId))
            return null;

        return await _db.CoinSocialProfile
            .AsNoTracking()
            .Where(x =>
                (!string.IsNullOrWhiteSpace(normalizedSymbol) && x.Symbol != null && x.Symbol.ToUpper() == normalizedSymbol)
                || (!string.IsNullOrWhiteSpace(normalizedCoinGeckoId) && x.CoinGeckoId != null && x.CoinGeckoId.ToLower() == normalizedCoinGeckoId))
            .OrderByDescending(x => x.UpdatedAtUtc)
            .FirstOrDefaultAsync(ct);
    }

    private static CoinSocialProfileDto ToDto(CoinSocialProfile entity) => new()
    {
        Id = entity.Id,
        Symbol = entity.Symbol,
        CoinGeckoId = entity.CoinGeckoId,
        ContractAddress = entity.ContractAddress,
        Name = entity.Name,
        ThumbUrl = entity.ThumbUrl,
        LargeImageUrl = entity.LargeImageUrl,
        MarketCapRank = entity.MarketCapRank,
        IsMemeCoin = entity.IsMemeCoin,
        PrimaryColor = entity.PrimaryColor,
        SecondaryColor = entity.SecondaryColor,
        VisualStyle = entity.VisualStyle,
        TwitterHandle = entity.TwitterHandle,
        TelegramUrl = entity.TelegramUrl,
        WebsiteUrl = entity.WebsiteUrl,
        Source = entity.Source,
        LastCheckedUtc = entity.LastCheckedUtc,
        CreatedAtUtc = entity.CreatedAtUtc,
        UpdatedAtUtc = entity.UpdatedAtUtc
    };

    private static string NormalizeSymbol(string? symbol)
    {
        if (string.IsNullOrWhiteSpace(symbol))
            return string.Empty;

        return symbol.Trim()
            .ToUpperInvariant()
            .Replace("USDT", string.Empty, StringComparison.Ordinal)
            .Replace("USDC", string.Empty, StringComparison.Ordinal)
            .Replace("BUSD", string.Empty, StringComparison.Ordinal)
            .Replace("FDUSD", string.Empty, StringComparison.Ordinal);
    }

    private static string NormalizeCoinGeckoId(string? coinGeckoId)
        => string.IsNullOrWhiteSpace(coinGeckoId)
            ? string.Empty
            : coinGeckoId.Trim().ToLowerInvariant();
}
