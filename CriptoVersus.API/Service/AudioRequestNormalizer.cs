using DTOs;

namespace CriptoVersus.API.Services;

internal static class AudioRequestNormalizer
{
    public static string NormalizeLanguage(string? language) => ProceduralAudioNormalization.NormalizeLanguage(language);

    public static string NormalizeEventType(string? eventType) => ProceduralAudioNormalization.NormalizeEventTypeToken(eventType);

    public static string? NormalizeToken(string? value, bool upper = false) => ProceduralAudioNormalization.NormalizeToken(value, upper);

    public static string? NormalizeTeamSymbol(string? teamSymbol) => ProceduralAudioNormalization.NormalizeTeamSymbol(teamSymbol);

    public static AudioResolveRequest Normalize(AudioResolveRequest request)
    {
        return new AudioResolveRequest
        {
            EventType = NormalizeEventType(request.EventType),
            Language = NormalizeLanguage(request.Language),
            RawSymbol = string.IsNullOrWhiteSpace(request.RawSymbol) ? null : request.RawSymbol.Trim().ToUpperInvariant(),
            NormalizedSymbol = NormalizeTeamSymbol(request.NormalizedSymbol ?? request.TeamSymbol ?? request.RawSymbol),
            TeamSymbol = NormalizeTeamSymbol(request.TeamSymbol ?? request.NormalizedSymbol ?? request.RawSymbol),
            TeamName = string.IsNullOrWhiteSpace(request.TeamName) ? null : request.TeamName.Trim(),
            TextPrompt = string.IsNullOrWhiteSpace(request.TextPrompt) ? null : request.TextPrompt.Trim(),
            ContextKey = NormalizeToken(request.ContextKey),
            Intensity = NormalizeToken(request.Intensity),
            VoiceKey = NormalizeToken(request.VoiceKey),
            QueueIfMissing = request.QueueIfMissing,
            ForceQueue = request.ForceQueue
        };
    }
}
