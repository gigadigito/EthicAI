using DTOs;

namespace CriptoVersus.API.Services;

internal static class AudioRequestNormalizer
{
    public static string NormalizeLanguage(string? language)
    {
        var normalized = (language ?? string.Empty).Trim().ToLowerInvariant();
        return normalized switch
        {
            "pt" or "pt-br" => "pt-BR",
            "en" or "en-us" => "en-US",
            _ when string.IsNullOrWhiteSpace(normalized) => "en-US",
            _ => language!.Trim()
        };
    }

    public static string NormalizeEventType(string? eventType)
        => (eventType ?? string.Empty).Trim().ToLowerInvariant();

    public static string? NormalizeToken(string? value, bool upper = false)
    {
        var normalized = string.IsNullOrWhiteSpace(value) ? null : value.Trim();
        return normalized is null
            ? null
            : upper ? normalized.ToUpperInvariant() : normalized.ToLowerInvariant();
    }

    public static AudioResolveRequest Normalize(AudioResolveRequest request)
    {
        return new AudioResolveRequest
        {
            EventType = NormalizeEventType(request.EventType),
            Language = NormalizeLanguage(request.Language),
            TeamSymbol = NormalizeToken(request.TeamSymbol, upper: true),
            TeamName = string.IsNullOrWhiteSpace(request.TeamName) ? null : request.TeamName.Trim(),
            ContextKey = NormalizeToken(request.ContextKey),
            Intensity = NormalizeToken(request.Intensity),
            VoiceKey = NormalizeToken(request.VoiceKey)
        };
    }
}
