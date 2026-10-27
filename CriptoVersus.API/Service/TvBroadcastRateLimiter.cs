using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;

namespace CriptoVersus.API.Services;

/// <summary>
/// Rate limit dos endpoints publicos de transmissao da Candle Battle TV.
/// Os endpoints sao anonimos e consultados continuamente por transmissores externos; o limite
/// por IP protege as consultas de banco de picos repetidos sem afetar o polling normal do
/// transmissor (uma requisicao a cada <c>StatusPollingSeconds</c>). Rejeicao responde 429 com
/// <c>Retry-After</c> e deve ser tratada pelo cliente como falha transitoria.
/// </summary>
public static class TvBroadcastRateLimiter
{
    public const string PolicyName = "tv-broadcast";

    /// <summary>Janela fixa de um minuto; folga de ~10x sobre o polling normal do transmissor.</summary>
    public const int DefaultPermitLimitPerMinute = 120;

    public static void AddTvBroadcastRateLimiting(this RateLimiterOptions options,
        int permitLimit = DefaultPermitLimitPerMinute)
    {
        ArgumentNullException.ThrowIfNull(options);

        var limit = Math.Clamp(permitLimit, 1, 100_000);
        options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
        options.OnRejected = (context, _) =>
        {
            context.HttpContext.Response.Headers.RetryAfter = "60";
            return ValueTask.CompletedTask;
        };
        options.AddPolicy(PolicyName, httpContext =>
        {
            var partitionKey = httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            return RateLimitPartition.GetFixedWindowLimiter(partitionKey, _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = limit,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
                AutoReplenishment = true
            });
        });
    }
}
