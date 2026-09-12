namespace BLL.Push;

public static class PushNotificationTexts
{
    private static readonly Dictionary<string, Dictionary<string, string>> Texts = new(StringComparer.OrdinalIgnoreCase)
    {
        ["en"] = new(StringComparer.OrdinalIgnoreCase)
        {
            ["score.title"] = "\u26bd Goal!",
            ["score.body"] = "{0} {1} \u00d7 {2} {3}",
            ["comeback.title"] = "\ud83d\udd25 {0} turned the match around!",
            ["comeback.body"] = "{0} {1} \u00d7 {2} {3}",
            ["finished.title"] = "\ud83c\udfc6 Match finished",
            ["finished.body"] = "{0} {1} \u00d7 {2} {3} \u2014 {4}",
            ["asset_playing.title"] = "\u26bd {0} is playing!",
            ["asset_playing.body"] = "{0} vs {1} started now.",
        },
        ["pt"] = new(StringComparer.OrdinalIgnoreCase)
        {
            ["score.title"] = "\u26bd Gol!",
            ["score.body"] = "{0} {1} \u00d7 {2} {3}",
            ["comeback.title"] = "\ud83d\udd25 {0} virou a partida!",
            ["comeback.body"] = "{0} {1} \u00d7 {2} {3}",
            ["finished.title"] = "\ud83c\udfc6 Partida encerrada",
            ["finished.body"] = "{0} {1} \u00d7 {2} {3} \u2014 {4}",
            ["asset_playing.title"] = "\u26bd {0} est\u00e1 jogando!",
            ["asset_playing.body"] = "{0} vs {1} come\u00e7ou agora.",
        },
        ["zh"] = new(StringComparer.OrdinalIgnoreCase)
        {
            ["score.title"] = "\u26bd \u8fdb\u7403!",
            ["score.body"] = "{0} {1} \u00d7 {2} {3}",
            ["comeback.title"] = "\ud83d\udd25 {0} \u9006\u8f6c\u4e86\u6bd4\u8d5b!",
            ["comeback.body"] = "{0} {1} \u00d7 {2} {3}",
            ["finished.title"] = "\ud83c\udfc6 \u6bd4\u8d5b\u7ed3\u675f",
            ["finished.body"] = "{0} {1} \u00d7 {2} {3} \u2014 {4}",
            ["asset_playing.title"] = "\u26bd {0} \u6b63\u5728\u6bd4\u8d5b\uff01",
            ["asset_playing.body"] = "{0} vs {1} \u521a\u521a\u5f00\u59cb\u3002",
        }
    };

    private static readonly string[] SupportedCultures = ["en", "pt", "zh"];

    public static (string title, string body) Get(
        string culture,
        string alertType,
        string teamA,
        int scoreA,
        int scoreB,
        string teamB,
        string? winnerName = null)
    {
        var normalizedCulture = NormalizeCulture(culture);
        var texts = Texts.TryGetValue(normalizedCulture, out var t) ? t : Texts["en"];

        var key = $"{alertType}.title";
        var title = texts.TryGetValue(key, out var titleValue) ? titleValue : texts["score.title"];

        key = $"{alertType}.body";
        var body = texts.TryGetValue(key, out var bodyValue) ? bodyValue : texts["score.body"];

        body = string.Format(body, teamA, scoreA, scoreB, teamB);

        if (alertType == "finished" && winnerName is not null)
        {
            body += $" \u2014 {winnerName}";
        }

        return (title, body);
    }

    public static (string title, string body) GetAssetPlaying(
        string culture,
        string symbol,
        string teamA,
        string teamB)
    {
        var normalizedCulture = NormalizeCulture(culture);
        var texts = Texts.TryGetValue(normalizedCulture, out var t) ? t : Texts["en"];

        var titleKey = "asset_playing.title";
        var title = texts.TryGetValue(titleKey, out var titleValue) ? titleValue : $" {symbol} is playing!";

        var bodyKey = "asset_playing.body";
        var body = texts.TryGetValue(bodyKey, out var bodyValue) ? bodyValue : $"{teamA} vs {teamB} started now.";

        body = string.Format(body, teamA, teamB);

        title = string.Format(title, symbol);

        return (title, body);
    }

    private static string NormalizeCulture(string? culture)
    {
        if (string.IsNullOrWhiteSpace(culture))
            return "en";

        var c = culture.ToLowerInvariant().Trim();
        foreach (var supported in SupportedCultures)
        {
            if (c.StartsWith(supported, StringComparison.Ordinal))
                return supported;
        }

        return "en";
    }
}
