namespace DTOs;

public static class ProceduralNarrativeText
{
    private static readonly Dictionary<string, string> KnownNames = new(StringComparer.OrdinalIgnoreCase)
    {
        ["BTC"] = "Bitcoin",
        ["ETH"] = "Ethereum",
        ["SOL"] = "Solana",
        ["TRX"] = "Tron",
        ["ADA"] = "Cardano",
        ["DOGE"] = "Dogecoin",
        ["AMP"] = "Amp",
        ["EPIC"] = "Epic"
    };

    public static string ResolveFriendlyName(
        string? rawSymbol,
        string? normalizedSymbol,
        params string?[] candidates)
    {
        foreach (var candidate in candidates)
        {
            var sanitized = SanitizeDisplayName(candidate, rawSymbol, normalizedSymbol);
            if (!string.IsNullOrWhiteSpace(sanitized))
                return sanitized;
        }

        if (!string.IsNullOrWhiteSpace(normalizedSymbol)
            && KnownNames.TryGetValue(normalizedSymbol.Trim(), out var knownName))
            return knownName;

        var fallback = ProceduralAudioNormalization.NormalizeTeamSymbol(normalizedSymbol ?? rawSymbol);
        return string.IsNullOrWhiteSpace(fallback) ? "CriptoVersus" : fallback;
    }

    public static string BuildTextPrompt(string eventType, string language, string teamName)
    {
        var normalizedEventType = ProceduralAudioNormalization.NormalizeEventTypeToken(eventType);
        var normalizedLanguage = ProceduralAudioNormalization.NormalizeLanguage(language);
        var safeTeamName = string.IsNullOrWhiteSpace(teamName) ? "CriptoVersus" : teamName.Trim();

        return (normalizedEventType, normalizedLanguage) switch
        {
            ("goal", "pt-BR") => $"É gol de {safeTeamName}! A arena CriptoVersus explode em emoção!",
            ("goal", "en-US") => $"What a goal by {safeTeamName}! The CriptoVersus Arena erupts!",
            ("momentum_shift", "pt-BR") => $"{safeTeamName} assume o controle da partida e muda completamente o ritmo da arena!",
            ("momentum_shift", "en-US") => $"{safeTeamName} takes control of the match and completely shifts the momentum!",
            ("volatility_spike", "pt-BR") => $"{safeTeamName} acelera forte dentro da arena e incendia o confronto!",
            ("volatility_spike", "en-US") => $"{safeTeamName} accelerates hard inside the arena and sets the battle on fire!",
            ("market_crash", "pt-BR") => $"{safeTeamName} sente o impacto e a arena acompanha cada segundo dessa queda!",
            ("market_crash", "en-US") => $"{safeTeamName} takes a heavy hit and the whole arena can feel the collapse!",
            ("market_pump", "pt-BR") => $"{safeTeamName} acelera forte dentro da arena e ganha o embalo da torcida!",
            ("market_pump", "en-US") => $"{safeTeamName} surges inside the arena and the crowd can feel the momentum rising!",
            ("dominant_lead", "pt-BR") => $"{safeTeamName} domina completamente o confronto e abre vantagem na arena!",
            ("dominant_lead", "en-US") => $"{safeTeamName} completely takes over the battle and opens a dominant lead!",
            ("comeback", "pt-BR") => $"{safeTeamName} vira o jogo e recoloca a arena inteira em estado de choque!",
            ("comeback", "en-US") => $"{safeTeamName} turns the match around and leaves the entire arena stunned!",
            ("equalizer", "pt-BR") => $"{safeTeamName} busca o empate e muda a temperatura da CriptoVersus Arena!",
            ("equalizer", "en-US") => $"{safeTeamName} finds the equalizer and changes the temperature of the arena!",
            ("score_event", "pt-BR") => $"{safeTeamName} mexe no placar e altera a energia da CriptoVersus Arena!",
            ("score_event", "en-US") => $"{safeTeamName} changes the scoreboard and shifts the energy inside the CriptoVersus Arena!",
            ("near_goal", "pt-BR") => $"{safeTeamName} passa muito perto do gol e levanta a arena!",
            ("near_goal", "en-US") => $"{safeTeamName} comes inches away from scoring and lifts the whole arena!",
            ("underdog_goal", "pt-BR") => $"{safeTeamName} surpreende todo mundo e marca um gol improvável!",
            ("underdog_goal", "en-US") => $"{safeTeamName} shocks everyone with an unlikely goal!",
            ("match_start", "pt-BR") => $"{safeTeamName} está pronto para começar mais uma batalha na CriptoVersus Arena!",
            ("match_start", "en-US") => $"{safeTeamName} is ready to kick off another battle in the CriptoVersus Arena!",
            ("final_whistle", "pt-BR") => $"Fim de jogo para {safeTeamName} na CriptoVersus Arena!",
            ("final_whistle", "en-US") => $"Final whistle for {safeTeamName} in the CriptoVersus Arena!",
            _ when normalizedLanguage == "pt-BR" => $"{safeTeamName} assume o protagonismo e agita a CriptoVersus Arena!",
            _ => $"{safeTeamName} takes center stage and shakes up the CriptoVersus Arena!"
        };
    }

    private static string? SanitizeDisplayName(string? candidate, string? rawSymbol, string? normalizedSymbol)
    {
        if (string.IsNullOrWhiteSpace(candidate))
            return null;

        var trimmed = candidate.Trim();
        if (string.IsNullOrWhiteSpace(trimmed))
            return null;

        var rawNormalized = ProceduralAudioNormalization.NormalizeToken(rawSymbol, upper: true);
        var symbolNormalized = ProceduralAudioNormalization.NormalizeTeamSymbol(normalizedSymbol ?? rawSymbol);
        var candidateUpper = trimmed.ToUpperInvariant();

        if (!string.IsNullOrWhiteSpace(rawNormalized) && candidateUpper == rawNormalized)
            return null;

        if (ContainsQuoteSuffix(candidateUpper))
            return null;

        if (!string.IsNullOrWhiteSpace(symbolNormalized)
            && KnownNames.TryGetValue(symbolNormalized, out var knownName))
            return knownName;

        return trimmed;
    }

    private static bool ContainsQuoteSuffix(string value)
    {
        foreach (var suffix in new[] { "USDT", "USDC", "FDUSD", "BUSD", "TUSD", "USDE", "USD", "BRL", "EUR" })
        {
            if (value.Contains(suffix, StringComparison.Ordinal))
                return true;
        }

        return false;
    }
}


