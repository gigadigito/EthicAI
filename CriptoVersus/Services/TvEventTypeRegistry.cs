using System.Globalization;
using DTOs;

namespace CriptoVersus.Web.Services;

public sealed record TvEventTypeDefinition(
    string Id,
    string TitlePt,
    string TitleEn,
    string SubtitleTemplatePt,
    string SubtitleTemplateEn,
    string IconAssetPath,
    string IconFallback,
    string AccentStart,
    string AccentEnd,
    string GlowColor,
    string AnimationStyle,
    string SoundCueId,
    int PriorityLevel)
{
    public string GetTitle(string culture)
        => TvEventTypeRegistry.IsPortuguese(culture) ? TitlePt : TitleEn;

    public string GetSubtitle(string culture, MatchScoreEventDto item, string fallbackSubtitle)
    {
        if (!string.IsNullOrWhiteSpace(fallbackSubtitle))
        {
            return fallbackSubtitle;
        }

        var template = TvEventTypeRegistry.IsPortuguese(culture) ? SubtitleTemplatePt : SubtitleTemplateEn;
        return template
            .Replace("{TEAM}", item.TeamSymbol ?? string.Empty, StringComparison.Ordinal)
            .Replace("{POINTS}", item.Points.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal)
            .Replace("{DELTA}", item.MetricDelta?.ToString("0.##", CultureInfo.InvariantCulture) ?? "0", StringComparison.Ordinal);
    }
}

public sealed record TvGoalEventCardModel(
    long EventId,
    string EventTypeId,
    string TeamSymbol,
    string TeamLogoUrl,
    string EventTitle,
    string EventSubtitle,
    string TimerLabel,
    string RewardLabel,
    string IconAssetPath,
    string IconFallback,
    string AccentStart,
    string AccentEnd,
    string GlowColor,
    string AnimationStyle,
    string SoundCueId,
    int PriorityLevel,
    bool IsHero,
    bool IsHighPriority,
    string EnterFrom,
    string RawDescription);

public static class TvEventTypeRegistry
{
    private static readonly IReadOnlyDictionary<string, TvEventTypeDefinition> Definitions =
        new Dictionary<string, TvEventTypeDefinition>(StringComparer.OrdinalIgnoreCase)
        {
            ["graph-crossover"] = new("graph-crossover", "CRUZAMENTO DE GRAFICO", "GRAPH CROSSOVER GOAL", "{TEAM} virou o duelo ao cruzar a linha de valorizacao.", "{TEAM} flipped the duel by crossing the valuation line.", "/images/tv/events/graph-crossover.png", "✕", "#9a5cff", "#9cff2f", "rgba(151, 102, 255, 0.58)", "pulse-surge", "goal", 5),
            ["momentum-surge"] = new("momentum-surge", "SURTO DE MOMENTUM", "MOMENTUM SURGE", "{TEAM} acelerou a pressao e conquistou {POINTS} ponto(s).", "{TEAM} accelerated pressure and claimed {POINTS} point(s).", "/images/tv/events/momentum-surge.png", "⇡", "#39e0ff", "#2f7cff", "rgba(67, 198, 255, 0.52)", "slide-burst", "momentum", 4),
            ["dominance-streak"] = new("dominance-streak", "SEQUENCIA DE DOMINIO", "DOMINANCE STREAK", "{TEAM} manteve dominio continuo sobre a arena.", "{TEAM} held continuous dominance over the arena.", "/images/tv/events/dominance-streak.png", "♛", "#ffdd66", "#ff8a2a", "rgba(255, 188, 77, 0.5)", "hero-glow", "dominance", 5),
            ["volatility-impact"] = new("volatility-impact", "IMPACTO DE VOLATILIDADE", "VOLATILITY IMPACT", "{TEAM} converteu instabilidade em vantagem imediata.", "{TEAM} converted instability into immediate advantage.", "/images/tv/events/volatility-impact.png", "⚡", "#ff567a", "#ff2fd2", "rgba(255, 77, 134, 0.52)", "shock-pulse", "volatility", 5),
            ["defensive-hold"] = new("defensive-hold", "BLOQUEIO DEFENSIVO", "DEFENSIVE HOLD", "{TEAM} segurou a pressao e preservou a vantagem.", "{TEAM} absorbed pressure and preserved the lead.", "/images/tv/events/defensive-hold.png", "🛡", "#56e0d0", "#8aa6bf", "rgba(86, 224, 208, 0.42)", "shield-rise", "defense", 3),
            ["comeback-event"] = new("comeback-event", "EVENTO DE VIRADA", "COMEBACK EVENT", "{TEAM} reagiu e retomou o ritmo da partida.", "{TEAM} answered back and seized match rhythm again.", "/images/tv/events/comeback-event.png", "↺", "#c9ff4d", "#ffd44d", "rgba(210, 255, 83, 0.46)", "rebound-rise", "comeback", 4),
            ["sentiment-goal"] = new("sentiment-goal", "GOL DE SENTIMENTO", "SENTIMENT GOAL", "{TEAM} capturou a onda social e ganhou tracao.", "{TEAM} captured the social wave and gained traction.", "/images/tv/events/sentiment-goal.png", "◉", "#ff67cf", "#8f58ff", "rgba(255, 103, 207, 0.48)", "crowd-wave", "sentiment", 4),
            ["breakout-event"] = new("breakout-event", "EVENTO DE BREAKOUT", "BREAKOUT EVENT", "{TEAM} rompeu a faixa critica com impacto de {POINTS} ponto(s).", "{TEAM} broke through the critical band with a {POINTS}-point impact.", "/images/tv/events/breakout-event.png", "✦", "#79ff5b", "#ffffff", "rgba(121, 255, 91, 0.52)", "flash-break", "breakout", 5),
            ["candle-battle-dominance"] = new("candle-battle-dominance", "DOMÍNIO DO CANDLE BATTLE", "CANDLE BATTLE DOMINANCE", "{TEAM} abriu domínio no Candle Battle.", "{TEAM} opened Candle Battle dominance.", "/images/tv/events/candle-battle-lead-change.png", "⚔", "#53c8ff", "#ff9f43", "rgba(83, 200, 255, 0.52)", "pulse-surge", "goal", 5),
            ["candle-battle-lead-change"] = new("candle-battle-dominance", "DOMÍNIO DO CANDLE BATTLE", "CANDLE BATTLE DOMINANCE", "{TEAM} abriu domínio no Candle Battle.", "{TEAM} opened Candle Battle dominance.", "/images/tv/events/candle-battle-lead-change.png", "⚔", "#53c8ff", "#ff9f43", "rgba(83, 200, 255, 0.52)", "pulse-surge", "goal", 5)
        };

    public static TvEventTypeDefinition Resolve(MatchScoreEventDto? item)
    {
        if (item is null)
        {
            return Definitions["graph-crossover"];
        }

        var combined = string.Join(" ", new[] { item.RuleType, item.EventType, item.ReasonCode, item.Description }.Where(static value => !string.IsNullOrWhiteSpace(value))).ToUpperInvariant();

        if (combined.Contains("CROSS", StringComparison.Ordinal) || combined.Contains("CRUZ", StringComparison.Ordinal)) return Definitions["graph-crossover"];
        if (combined.Contains("MOMENTUM", StringComparison.Ordinal) || combined.Contains("PRESSURE", StringComparison.Ordinal) || combined.Contains("SURGE", StringComparison.Ordinal)) return Definitions["momentum-surge"];
        if (combined.Contains("CANDLE", StringComparison.Ordinal) || combined.Contains("DOMINANCE", StringComparison.Ordinal) || combined.Contains("LEAD_CHANGE", StringComparison.Ordinal) || combined.Contains("CANDLE_BATTLE", StringComparison.Ordinal)) return Definitions["candle-battle-dominance"];
        if (combined.Contains("DOMIN", StringComparison.Ordinal) || combined.Contains("STREAK", StringComparison.Ordinal) || combined.Contains("CROWN", StringComparison.Ordinal)) return Definitions["dominance-streak"];
        if (combined.Contains("VOLAT", StringComparison.Ordinal) || combined.Contains("SHOCK", StringComparison.Ordinal) || combined.Contains("LIGHTNING", StringComparison.Ordinal)) return Definitions["volatility-impact"];
        if (combined.Contains("DEFEN", StringComparison.Ordinal) || combined.Contains("HOLD", StringComparison.Ordinal) || combined.Contains("WALL", StringComparison.Ordinal) || combined.Contains("GOALKEEPER", StringComparison.Ordinal)) return Definitions["defensive-hold"];
        if (combined.Contains("COMEBACK", StringComparison.Ordinal) || combined.Contains("REVERS", StringComparison.Ordinal) || combined.Contains("VIRADA", StringComparison.Ordinal)) return Definitions["comeback-event"];
        if (combined.Contains("SENTIMENT", StringComparison.Ordinal) || combined.Contains("SOCIAL", StringComparison.Ordinal) || combined.Contains("CROWD", StringComparison.Ordinal)) return Definitions["sentiment-goal"];
        if (combined.Contains("BREAK", StringComparison.Ordinal) || combined.Contains("THRESHOLD", StringComparison.Ordinal) || combined.Contains("2%", StringComparison.Ordinal) || combined.Contains("BURST", StringComparison.Ordinal)) return Definitions["breakout-event"];
        return Definitions["graph-crossover"];
    }

    public static bool IsPortuguese(string? culture)
        => !string.IsNullOrWhiteSpace(culture) && culture.StartsWith("pt", StringComparison.OrdinalIgnoreCase);
}
