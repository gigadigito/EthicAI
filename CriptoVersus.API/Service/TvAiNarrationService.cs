using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using DAL.NftFutebol;
using DTOs;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace CriptoVersus.API.Services;

public interface ITvAiNarrationService
{
    Task<TvNarrationResponse> GenerateNarrationAsync(int matchId, TvNarrationRequest request, CancellationToken ct);
}

public sealed class CriptoVersusAiOptions
{
    public const string SectionName = "CriptoVersusAI";

    public bool Enabled { get; set; } = true;
    public string NarrationModel { get; set; } = "gpt-5-mini";
    public int NarrationCooldownSeconds { get; set; } = 90;
    public int NarrationMaxChars { get; set; } = 280;
}

public sealed class TvAiNarrationService : ITvAiNarrationService
{
    private static readonly string[] AiWorthyEvents =
    [
        "goal",
        "comeback",
        "momentum-shift",
        "hot-score-spike",
        "massive-breakout",
        "final-minutes",
        "manual-test"
    ];

    private static readonly string[] TemplateFriendlyEvents =
    [
        "initial",
        "leader-change",
        "pressure-rising",
        "tie",
        "fear-spike"
    ];

    private static readonly System.Collections.Concurrent.ConcurrentDictionary<int, SemaphoreSlim> MatchLocks = new();

    private readonly EthicAIDbContext _db;
    private readonly ITvHotMatchService _tvHotMatchService;
    private readonly HttpClient _httpClient;
    private readonly IMemoryCache _cache;
    private readonly ILogger<TvAiNarrationService> _logger;
    private readonly CriptoVersusAiOptions _options;
    private readonly IConfiguration _configuration;

    public TvAiNarrationService(
        EthicAIDbContext db,
        ITvHotMatchService tvHotMatchService,
        HttpClient httpClient,
        IMemoryCache cache,
        IOptions<CriptoVersusAiOptions> options,
        IConfiguration configuration,
        ILogger<TvAiNarrationService> logger)
    {
        _db = db;
        _tvHotMatchService = tvHotMatchService;
        _httpClient = httpClient;
        _cache = cache;
        _configuration = configuration;
        _logger = logger;
        _options = options.Value;
    }

    public async Task<TvNarrationResponse> GenerateNarrationAsync(int matchId, TvNarrationRequest request, CancellationToken ct)
    {
        var gate = MatchLocks.GetOrAdd(matchId, static _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(ct);

        try
        {
            return await GenerateCoreAsync(matchId, request, ct);
        }
        finally
        {
            gate.Release();
        }
    }

    private async Task<TvNarrationResponse> GenerateCoreAsync(int matchId, TvNarrationRequest request, CancellationToken ct)
    {
        var hotMatch = await _tvHotMatchService.GetMatchBroadcastAsync(matchId, ct)
            ?? throw new InvalidOperationException($"No TV broadcast context found for match {matchId}.");

        var culture = NormalizeNarrationCulture(request.Culture);
        var eventType = NormalizeEventType(request.EventType);
        var nowUtc = DateTime.UtcNow;
        var contextHash = BuildContextHash(matchId, eventType, hotMatch);

        var cacheKey = $"tv-ai-narration:{matchId}:{eventType}:{contextHash}";
        if (!request.ForceRefresh && _cache.TryGetValue<TvNarrationResponse>(cacheKey, out var cached))
            return cached!;

        var recentHistory = await _db.MatchAiNarrationHistory
            .AsNoTracking()
            .Where(x => x.MatchId == matchId)
            .OrderByDescending(x => x.CreatedAtUtc)
            .Take(8)
            .ToListAsync(ct);

        if (!request.ForceRefresh)
        {
            var sameContext = recentHistory
                .FirstOrDefault(x => string.Equals(x.EventType, eventType, StringComparison.OrdinalIgnoreCase)
                    && string.Equals(x.ContextHash, contextHash, StringComparison.OrdinalIgnoreCase));

            if (sameContext is not null)
            {
                var sameContextResponse = MapResponse(sameContext, "cache");
                _cache.Set(cacheKey, sameContextResponse, TimeSpan.FromMinutes(10));
                return sameContextResponse;
            }

            var latest = recentHistory.FirstOrDefault();
            if (latest is not null && (nowUtc - latest.CreatedAtUtc).TotalSeconds < Math.Max(15, _options.NarrationCooldownSeconds))
            {
                var cooldownResponse = MapResponse(latest, "cooldown");
                _cache.Set(cacheKey, cooldownResponse, TimeSpan.FromSeconds(Math.Max(15, _options.NarrationCooldownSeconds / 2)));
                return cooldownResponse;
            }
        }

        var narration = ShouldUseTemplate(eventType)
            ? BuildTemplateNarration(eventType, hotMatch, culture)
            : await TryGenerateAiNarrationAsync(matchId, hotMatch, recentHistory, eventType, culture, contextHash, ct)
                ?? BuildTemplateNarration(eventType, hotMatch, culture);

        var entity = new MatchAiNarrationHistory
        {
            MatchId = matchId,
            EventType = eventType,
            Culture = culture,
            Text = narration.Text,
            PromptHash = narration.PromptHash,
            ContextHash = contextHash,
            Source = narration.Source,
            Model = narration.Model,
            CreatedAtUtc = nowUtc,
            HotScoreSnapshot = hotMatch.HotScore,
            LeftScoreSnapshot = hotMatch.LeftScore,
            RightScoreSnapshot = hotMatch.RightScore,
            LeaderSymbolSnapshot = hotMatch.LeaderSymbol,
            MetadataJson = narration.MetadataJson
        };

        _db.MatchAiNarrationHistory.Add(entity);
        await _db.SaveChangesAsync(ct);

        var response = new TvNarrationResponse
        {
            MatchId = matchId,
            Text = narration.Text,
            Source = narration.Source,
            GeneratedAtUtc = entity.CreatedAtUtc,
            HistoryId = entity.Id
        };

        _cache.Set(cacheKey, response, TimeSpan.FromMinutes(10));
        return response;
    }

    private async Task<NarrationDraft?> TryGenerateAiNarrationAsync(
        int matchId,
        TvHotMatchDto hotMatch,
        List<MatchAiNarrationHistory> recentHistory,
        string eventType,
        string culture,
        string contextHash,
        CancellationToken ct)
    {
        if (!_options.Enabled || !ShouldUseAi(eventType))
            return null;

        var apiKey = ResolveApiKey();
        if (string.IsNullOrWhiteSpace(apiKey))
            return null;

        var recentNarrations = recentHistory
            .OrderByDescending(x => x.CreatedAtUtc)
            .Take(5)
            .Select(x => $"- {x.Text}")
            .ToArray();

        var usePortuguese = IsPortugueseCulture(culture);
        var systemPrompt = usePortuguese
            ? """
Voce e um narrador esportivo da CriptoVersus TV, uma arena de batalhas cripto em tempo real.

Escreva uma narracao curta, empolgante e clara para aparecer na transmissao.

Use somente os dados fornecidos.

Nao invente preco, volume, placar ou fatos.
Nao de recomendacao financeira.
Nao prometa ganhos.
Nao use emojis.
Nao repita frases ou ideias das narracoes anteriores.
Maximo 2 frases.
Maximo 280 caracteres.
Responda em portugues do Brasil.
"""
            : """
You are a sports-style commentator for CriptoVersus TV, a real-time crypto battle arena.

Write a short, exciting and clear narration for the broadcast overlay.

Use only the provided data.

Do not invent price, volume, score or facts.
Do not give financial advice.
Do not promise gains.
Do not use emojis.
Do not repeat phrases or ideas from earlier narrations.
Maximum 2 sentences.
Maximum 280 characters.
Respond in English.
""";

        var userPrompt = usePortuguese
            ? $"""
Gerar narracao para a partida:

Culture: {culture}
EventType: {eventType}

Partida:
{hotMatch.LeftSymbol} vs {hotMatch.RightSymbol}

Placar:
{hotMatch.LeftScore} x {hotMatch.RightScore}

Variacao:
{hotMatch.LeftChangePercent:0.##}% vs {hotMatch.RightChangePercent:0.##}%

Tempo:
{hotMatch.RemainingTimeLabel}

Pool:
{hotMatch.VolumeLabel}

HotScore:
{hotMatch.HotScore}

Momentum:
{hotMatch.MomentumLabel}

Motivo:
{hotMatch.Reason}

Lider:
{hotMatch.LeaderSymbol}

Pressao:
{hotMatch.PressureSymbol}

Ultimas narracoes:
{string.Join(Environment.NewLine, recentNarrations)}

Escreva uma nova narracao curta para a TV.
"""
            : $"""
Generate narration for the match:

Culture: {culture}
EventType: {eventType}

Match:
{hotMatch.LeftSymbol} vs {hotMatch.RightSymbol}

Score:
{hotMatch.LeftScore} x {hotMatch.RightScore}

Change:
{hotMatch.LeftChangePercent:0.##}% vs {hotMatch.RightChangePercent:0.##}%

Time:
{hotMatch.RemainingTimeLabel}

Pool:
{hotMatch.VolumeLabel}

HotScore:
{hotMatch.HotScore}

Momentum:
{hotMatch.MomentumLabel}

Reason:
{hotMatch.Reason}

Leader:
{hotMatch.LeaderSymbol}

Pressure:
{hotMatch.PressureSymbol}

Latest narrations:
{string.Join(Environment.NewLine, recentNarrations)}

Write a fresh short narration for TV.
""";

        var requestPayload = new
        {
            model = _options.NarrationModel,
            instructions = systemPrompt,
            input = userPrompt,
            max_output_tokens = 120
        };

        using var requestMessage = new HttpRequestMessage(HttpMethod.Post, "https://api.openai.com/v1/responses");
        requestMessage.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        requestMessage.Content = JsonContent.Create(requestPayload);

        try
        {
            using var response = await _httpClient.SendAsync(requestMessage, ct);
            var body = await response.Content.ReadAsStringAsync(ct);
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("TV AI narration OpenAI call failed for match {MatchId}: {StatusCode} {Body}", matchId, (int)response.StatusCode, body);
                return null;
            }

            var text = ExtractOpenAiText(body);
            if (string.IsNullOrWhiteSpace(text))
                return null;

            var sanitized = SanitizeNarration(text, _options.NarrationMaxChars);
            if (string.IsNullOrWhiteSpace(sanitized))
                return null;

            return new NarrationDraft(
                NormalizeCommentaryText(sanitized),
                "ai",
                _options.NarrationModel,
                ComputeHash(systemPrompt + userPrompt),
                JsonSerializer.Serialize(new
                {
                    provider = "openai",
                    matchId,
                    eventType,
                    contextHash
                }));
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "TV AI narration OpenAI exception for match {MatchId}", matchId);
            return null;
        }
    }

    private static string ExtractOpenAiText(string body)
    {
        using var document = JsonDocument.Parse(body);
        var root = document.RootElement;

        if (root.TryGetProperty("output_text", out var outputTextElement) && outputTextElement.ValueKind == JsonValueKind.String)
            return outputTextElement.GetString() ?? string.Empty;

        if (root.TryGetProperty("output_text", out outputTextElement) && outputTextElement.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in outputTextElement.EnumerateArray())
            {
                if (item.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(item.GetString()))
                    return item.GetString() ?? string.Empty;
            }
        }

        if (!root.TryGetProperty("output", out var outputElement) || outputElement.ValueKind != JsonValueKind.Array)
            return string.Empty;

        foreach (var outputItem in outputElement.EnumerateArray())
        {
            if (!outputItem.TryGetProperty("content", out var contentElement) || contentElement.ValueKind != JsonValueKind.Array)
                continue;

            foreach (var contentItem in contentElement.EnumerateArray())
            {
                if (contentItem.TryGetProperty("text", out var textElement) && textElement.ValueKind == JsonValueKind.String)
                    return textElement.GetString() ?? string.Empty;

                if (contentItem.TryGetProperty("text", out textElement)
                    && textElement.ValueKind == JsonValueKind.Object
                    && textElement.TryGetProperty("value", out var valueElement)
                    && valueElement.ValueKind == JsonValueKind.String)
                {
                    return valueElement.GetString() ?? string.Empty;
                }

                if (contentItem.TryGetProperty("value", out var directValueElement) && directValueElement.ValueKind == JsonValueKind.String)
                    return directValueElement.GetString() ?? string.Empty;
            }
        }

        return string.Empty;
    }

    private NarrationDraft BuildTemplateNarration(string eventType, TvHotMatchDto hotMatch, string culture)
    {
        var text = IsPortugueseCulture(culture)
            ? eventType switch
            {
                "goal" => $"{hotMatch.LeaderSymbol} converteu a pressao em ponto e a arena segue em ebulicao. {hotMatch.LeftScore} x {hotMatch.RightScore} com {hotMatch.RemainingTimeLabel} no relogio.",
                "leader-change" => $"{hotMatch.LeaderSymbol} assumiu o controle da disputa enquanto o fluxo ao vivo muda de lado. A batalha continua aberta em {hotMatch.RemainingTimeLabel}.",
                "momentum-shift" => $"Mudanca de momentum detectada: {hotMatch.PressureSymbol} reagiu e mudou o peso da arena. O duelo segue travado em {hotMatch.LeftScore} x {hotMatch.RightScore}.",
                "fear-spike" => $"A arena ficou instavel e o fluxo entrou em zona de cautela. {hotMatch.LeaderSymbol} ainda sustenta a frente neste {hotMatch.Reason.ToLowerInvariant()}.",
                "hot-score-spike" => $"Liquidez em alta: o hot score saltou para {hotMatch.HotScore} e a partida esquentou. {hotMatch.LeftSymbol} e {hotMatch.RightSymbol} seguem trocando pressao.",
                "final-minutes" => $"Minutos finais na CriptoVersus TV: restam {hotMatch.RemainingTimeLabel} para definir quem sustenta a lideranca. Qualquer reversao agora muda a transmissao inteira.",
                "manual-test" => $"Teste de narracao AI ativo para {hotMatch.LeftSymbol} vs {hotMatch.RightSymbol}. O card ja esta pronto para exibir comentarios persistidos.",
                _ => $"{hotMatch.LeftSymbol} e {hotMatch.RightSymbol} seguem em confronto ao vivo, com {hotMatch.LeaderSymbol} puxando a narrativa da arena neste momento."
            }
            : eventType switch
            {
                "goal" => $"{hotMatch.LeaderSymbol} turned pressure into a point and the arena is still boiling. {hotMatch.LeftScore} x {hotMatch.RightScore} with {hotMatch.RemainingTimeLabel} on the clock.",
                "leader-change" => $"{hotMatch.LeaderSymbol} just took control while the live flow swings to a new side. The battle stays open with {hotMatch.RemainingTimeLabel} remaining.",
                "momentum-shift" => $"Momentum shift detected: {hotMatch.PressureSymbol} reacted and changed the weight of the arena. The duel remains tight at {hotMatch.LeftScore} x {hotMatch.RightScore}.",
                "fear-spike" => $"The arena turned unstable and the flow moved into caution territory. {hotMatch.LeaderSymbol} still holds the edge in this {hotMatch.Reason.ToLowerInvariant()}.",
                "hot-score-spike" => $"Liquidity is surging: hot score jumped to {hotMatch.HotScore} and the match heated up fast. {hotMatch.LeftSymbol} and {hotMatch.RightSymbol} keep trading pressure.",
                "final-minutes" => $"Final minutes on CriptoVersus TV: {hotMatch.RemainingTimeLabel} left to decide who keeps the lead. Any reversal now could flip the whole broadcast.",
                "manual-test" => $"AI narration test is active for {hotMatch.LeftSymbol} vs {hotMatch.RightSymbol}. The overlay card is ready to display persisted commentary.",
                _ => $"{hotMatch.LeftSymbol} and {hotMatch.RightSymbol} remain locked in a live clash, with {hotMatch.LeaderSymbol} driving the arena narrative right now."
            };

        return new NarrationDraft(NormalizeCommentaryText(SanitizeNarration(text, _options.NarrationMaxChars)), "template", null, null, null);
    }

    private static bool ShouldUseAi(string eventType)
        => AiWorthyEvents.Contains(eventType, StringComparer.OrdinalIgnoreCase);

    private static bool ShouldUseTemplate(string eventType)
        => TemplateFriendlyEvents.Contains(eventType, StringComparer.OrdinalIgnoreCase);

    private static string NormalizeEventType(string? eventType)
    {
        if (string.IsNullOrWhiteSpace(eventType))
            return "initial";

        return eventType.Trim().ToLowerInvariant();
    }

    private static string NormalizeNarrationCulture(string? culture)
    {
        if (string.IsNullOrWhiteSpace(culture))
            return "en-US";

        return IsPortugueseCulture(culture) ? "pt-BR" : "en-US";
    }

    private static bool IsPortugueseCulture(string? culture)
        => !string.IsNullOrWhiteSpace(culture)
           && culture.StartsWith("pt", StringComparison.OrdinalIgnoreCase);

    private static string BuildContextHash(int matchId, string eventType, TvHotMatchDto hotMatch)
    {
        var hotScoreBucket = (hotMatch.HotScore / 10) * 10;
        var remainingBucket = Math.Max(0, (hotMatch.RemainingSeconds ?? 0) / 60 / 5);
        var raw = string.Join("|",
            matchId,
            eventType,
            hotMatch.LeftScore,
            hotMatch.RightScore,
            hotMatch.LeaderSymbol,
            hotMatch.PressureSymbol,
            hotScoreBucket,
            remainingBucket,
            hotMatch.MomentumLabel,
            hotMatch.Reason);

        return ComputeHash(raw);
    }

    private static string ComputeHash(string value)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(value));
        return Convert.ToHexString(bytes);
    }

    private static string SanitizeNarration(string value, int maxChars)
    {
        var cleaned = value.Replace("\r", " ").Replace("\n", " ").Trim();
        while (cleaned.Contains("  ", StringComparison.Ordinal))
            cleaned = cleaned.Replace("  ", " ", StringComparison.Ordinal);

        if (cleaned.Length <= maxChars)
            return cleaned;

        return cleaned[..Math.Min(maxChars, cleaned.Length)].TrimEnd();
    }

    private static string NormalizeCommentaryText(string value)
        => Regex.Replace(
            value,
            @"\b([A-Z0-9]{2,})USDT\b",
            static match => match.Groups[1].Value,
            RegexOptions.CultureInvariant);

    private TvNarrationResponse MapResponse(MatchAiNarrationHistory entity, string source)
        => new()
        {
            MatchId = entity.MatchId,
            Text = NormalizeCommentaryText(entity.Text),
            Source = source,
            GeneratedAtUtc = entity.CreatedAtUtc,
            HistoryId = entity.Id
        };

    private string? ResolveApiKey()
        => _configuration["OPENAI_API_KEY"]
            ?? Environment.GetEnvironmentVariable("OPENAI_API_KEY");

    private sealed record NarrationDraft(
        string Text,
        string Source,
        string? Model,
        string? PromptHash,
        string? MetadataJson);
}
