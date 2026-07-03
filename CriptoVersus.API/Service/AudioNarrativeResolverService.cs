using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;

namespace CriptoVersus.API.Services;

public interface IAudioNarrativeResolverService
{
    Task<AudioResolveRequest> ResolveAsync(AudioResolveRequest request, CancellationToken ct = default);
}

public sealed class AudioNarrativeResolverService : IAudioNarrativeResolverService
{
    private readonly EthicAIDbContext _db;
    private readonly ILogger<AudioNarrativeResolverService> _logger;

    public AudioNarrativeResolverService(
        EthicAIDbContext db,
        ILogger<AudioNarrativeResolverService> logger)
    {
        _db = db;
        _logger = logger;
    }

    public async Task<AudioResolveRequest> ResolveAsync(AudioResolveRequest request, CancellationToken ct = default)
    {
        var rawSymbol = string.IsNullOrWhiteSpace(request.RawSymbol)
            ? request.TeamSymbol
            : request.RawSymbol;
        var normalizedSymbol = ProceduralAudioNormalization.NormalizeTeamSymbol(
            request.NormalizedSymbol ?? request.TeamSymbol ?? rawSymbol);

        var currencyNames = await ResolveCurrencyNamesAsync(rawSymbol, normalizedSymbol, ct);
        var teamName = ProceduralNarrativeText.ResolveFriendlyName(
            rawSymbol,
            normalizedSymbol,
            request.TeamName,
            currencyNames.CurrencyName,
            currencyNames.CoinProfileName);

        var requestedTextPrompt = string.IsNullOrWhiteSpace(request.TextPrompt)
            ? null
            : request.TextPrompt.Trim();

        var textPrompt = string.IsNullOrWhiteSpace(requestedTextPrompt)
            ? ProceduralNarrativeText.BuildTextPrompt(
                request.EventType,
                request.Language,
                teamName)
            : TextMojibakeRepair.Normalize(requestedTextPrompt);

        if (!string.IsNullOrWhiteSpace(requestedTextPrompt)
            && TextMojibakeRepair.LooksLikeMojibake(requestedTextPrompt)
            && !string.Equals(requestedTextPrompt, textPrompt, StringComparison.Ordinal))
        {
            _logger.LogWarning(
                "Suspicious audio prompt repaired before normalization. OriginalTextPrompt={OriginalTextPrompt} RepairedTextPrompt={RepairedTextPrompt}",
                requestedTextPrompt,
                textPrompt);
        }

        var normalized = AudioRequestNormalizer.Normalize(new AudioResolveRequest
        {
            EventType = request.EventType,
            Language = request.Language,
            RawSymbol = rawSymbol,
            NormalizedSymbol = normalizedSymbol,
            TeamSymbol = normalizedSymbol,
            TeamName = teamName,
            TextPrompt = textPrompt,
            ContextKey = request.ContextKey,
            Intensity = request.Intensity,
            VoiceKey = request.VoiceKey,
            QueueIfMissing = request.QueueIfMissing,
            ForceQueue = request.ForceQueue
        });

        _logger.LogInformation(
            "Narrative audio resolved. RawSymbol={RawSymbol} NormalizedSymbol={NormalizedSymbol} TeamName={TeamName} EventType={EventType} Language={Language} RequestedTextPrompt={RequestedTextPrompt} FinalTextPrompt={TextPrompt} PromptSource={PromptSource}",
            normalized.RawSymbol,
            normalized.NormalizedSymbol,
            normalized.TeamName,
            normalized.EventType,
            normalized.Language,
            request.TextPrompt,
            normalized.TextPrompt,
            string.IsNullOrWhiteSpace(request.TextPrompt) ? "event-template" : "explicit-request");

        return normalized;
    }

    private async Task<(string? CurrencyName, string? CoinProfileName)> ResolveCurrencyNamesAsync(
        string? rawSymbol,
        string? normalizedSymbol,
        CancellationToken ct)
    {
        var raw = ProceduralAudioNormalization.NormalizeToken(rawSymbol, upper: true);
        var normalized = ProceduralAudioNormalization.NormalizeToken(normalizedSymbol, upper: true);

        string? currencyName = null;
        if (!string.IsNullOrWhiteSpace(raw) || !string.IsNullOrWhiteSpace(normalized))
        {
            var currencies = await _db.Currency
                .AsNoTracking()
                .Where(x =>
                    (!string.IsNullOrWhiteSpace(raw) && x.Symbol == raw)
                    || (!string.IsNullOrWhiteSpace(normalized) && x.Symbol == normalized))
                .OrderByDescending(x => x.Symbol == raw)
                .Select(x => new { x.Symbol, x.Name })
                .ToListAsync(ct);

            currencyName = currencies
                .Select(x => x.Name)
                .FirstOrDefault(x => !string.IsNullOrWhiteSpace(x));
        }

        string? profileName = null;
        if (!string.IsNullOrWhiteSpace(normalized))
        {
            profileName = await _db.CoinSocialProfile
                .AsNoTracking()
                .Where(x => x.Symbol == normalized)
                .Select(x => x.Name)
                .FirstOrDefaultAsync(ct);
        }

        return (currencyName, profileName);
    }
}


