using System.Globalization;
using System.Text;
using DTOs;

namespace CriptoVersus.API.Services;

public interface IPriceCrossoverSocialNarrativeService
{
    PriceCrossoverNarrative Build(
        PriceCrossoverSocialResponse response,
        string language,
        int maxCharacters);
}

/// <summary>
/// Gera a narrativa textual da partida a partir EXCLUSIVAMENTE de estatisticas confirmadas.
/// Nao usa IA externa. Deterministico: as mesmas estatisticas produzem sempre o mesmo texto.
///
/// Os padroes sao escolhidos por evidencia nos dados:
/// - <c>comeback</c>: apenas quando <see cref="PriceCrossoverComparativeStats.HasComeback"/> e verdadeiro,
///   ou seja, quando ha mudanca efetiva de lideranca de desempenho relativo E vitoria oficial.
/// - <c>crossover_duel</c>: refere-se explicitamente ao cruzamento das curvas de desempenho relativo,
///   nao a lideranca no placar.
/// </summary>
public sealed class PriceCrossoverSocialNarrativeService : IPriceCrossoverSocialNarrativeService
{
    private const string DisclaimerPt = "Conteudo informativo. Nao constitui recomendacao financeira.";
    private const string DisclaimerEn = "Informational content. Not financial advice.";

    public PriceCrossoverNarrative Build(
        PriceCrossoverSocialResponse response,
        string language,
        int maxCharacters)
    {
        ArgumentNullException.ThrowIfNull(response);

        var culture = ResolveCulture(language);
        var isEnglish = culture.TwoLetterISOLanguageName == "en";
        maxCharacters = Math.Max(80, maxCharacters);

        var pattern = ResolvePattern(response);
        var winner = ResolveWinner(response);

        var headline = BuildHeadline(response, winner, pattern, isEnglish, culture);
        var summary = BuildSummary(response, winner, pattern, isEnglish, culture);
        var highlights = BuildHighlights(response, winner, isEnglish, culture);
        var hashtags = BuildHashtags(response, winner, isEnglish);

        var body = BuildBody(response, winner, pattern, isEnglish, culture);
        var disclaimer = isEnglish ? DisclaimerEn : DisclaimerPt;

        var (text, wasTruncated) = ComposePostText(body, disclaimer, hashtags, maxCharacters);

        return new PriceCrossoverNarrative
        {
            Language = culture.Name,
            Headline = headline,
            Summary = summary,
            Highlights = highlights,
            SuggestedPostText = text,
            Pattern = pattern,
            Hashtags = hashtags,
            CharacterCount = text.Length,
            MaxCharacters = maxCharacters,
            WasTruncated = wasTruncated
        };
    }

    private static CultureInfo ResolveCulture(string? language)
    {
        if (string.IsNullOrWhiteSpace(language))
            return new CultureInfo("pt-BR");

        try
        {
            return new CultureInfo(language.Trim());
        }
        catch (CultureNotFoundException)
        {
            return new CultureInfo("pt-BR");
        }
    }

    private static string ResolvePattern(PriceCrossoverSocialResponse response)
    {
        var comparative = response.Comparative;
        var a = response.AssetA;
        var b = response.AssetB;

        if (comparative.HasComeback)
            return "comeback";

        if (comparative.TotalCrossovers >= 3 && comparative.LeadAlternated)
            return "crossover_duel";

        var aUp = (a.PerformancePercent ?? 0m) > 0m;
        var bUp = (b.PerformancePercent ?? 0m) > 0m;

        if (aUp != bUp && response.Official.WinnerTeamId is not null)
            return "opposite_moves";

        if (!aUp && !bUp)
            return "joint_decline";

        if (comparative.Competitiveness >= 70)
            return "balanced";

        return "dominant_win";
    }

    private static (string Symbol, int TeamId)? ResolveWinner(PriceCrossoverSocialResponse response)
    {
        if (response.Official.WinnerTeamId is null)
            return null;

        return response.Official.WinnerTeamId == response.AssetA.TeamId
            ? (response.AssetA.Symbol, response.AssetA.TeamId)
            : (response.AssetB.Symbol, response.AssetB.TeamId);
    }

    private static string BuildHeadline(
        PriceCrossoverSocialResponse response,
        (string Symbol, int TeamId)? winner,
        string pattern,
        bool isEnglish,
        CultureInfo culture)
    {
        var baseA = response.AssetA.BaseAsset;
        var baseB = response.AssetB.BaseAsset;

        return pattern switch
        {
            "comeback" => isEnglish
                ? $"{DisplaySymbol(winner?.Symbol, baseA, baseB)} completes the comeback against {OtherBase(response, winner, baseA, baseB)}"
                : $"{DisplaySymbol(winner?.Symbol, baseA, baseB)} completa a reviravolta contra {OtherBase(response, winner, baseA, baseB)}",
            "balanced" => isEnglish
                ? $"{baseA} and {baseB} split hairs in a tight Price Battle"
                : $"{baseA} e {baseB} empatam em um Price Battle decidido nos detalhes",
            "crossover_duel" => isEnglish
                ? $"{baseA} and {baseB} trade the relative lead throughout the match"
                : $"{baseA} e {baseB} alternam a vantagem relativa ao longo da partida",
            "opposite_moves" => isEnglish
                ? $"{baseA} and {baseB} move in opposite directions"
                : $"{baseA} e {baseB} seguem em direcoes opostas",
            "joint_decline" => isEnglish
                ? $"{baseA} and {baseB} both close lower, but one defends better"
                : $"{baseA} e {baseB} fecham em queda, mas um defende melhor o desempenho",
            _ => isEnglish
                ? $"{DisplaySymbol(winner?.Symbol, baseA, baseB)} takes the Price Battle against {OtherBase(response, winner, baseA, baseB)}"
                : $"{DisplaySymbol(winner?.Symbol, baseA, baseB)} vence {OtherBase(response, winner, baseA, baseB)} no Price Battle"
        };
    }

    private static string BuildSummary(
        PriceCrossoverSocialResponse response,
        (string Symbol, int TeamId)? winner,
        string pattern,
        bool isEnglish,
        CultureInfo culture)
    {
        var baseA = response.AssetA.BaseAsset;
        var baseB = response.AssetB.BaseAsset;
        var winnerBase = winner is null ? null : (winner.Value.TeamId == response.AssetA.TeamId ? baseA : baseB);

        return pattern switch
        {
            "comeback" => isEnglish
                ? $"{winnerBase} trailed on relative performance before taking the lead and winning the match."
                : $"{winnerBase} ficou para tras no desempenho relativo, assumiu a lideranca e venceu a partida.",
            "balanced" => isEnglish
                ? "The two assets stayed close for most of the match, with a small gap on the final score."
                : "Os dois ativos ficaram proximos durante quase toda a partida, com diferenca pequena no placar final.",
            "crossover_duel" => isEnglish
                ? "The relative-performance curves crossed several times, with the advantage changing hands repeatedly."
                : "As curvas de desempenho relativo se cruzaram varias vezes, com a vantagem mudando de lado repetidamente.",
            "opposite_moves" => isEnglish
                ? $"While one asset appreciated, the other closed below its starting price."
                : "Enquanto um ativo valorizou, o outro terminou abaixo do preco inicial.",
            "joint_decline" => isEnglish
                ? "Both assets closed lower, but one preserved its relative performance better."
                : "Os dois ativos apresentaram desvalorizacao, mas um deles conseguiu preservar melhor seu desempenho relativo.",
            _ => isEnglish
                ? $"{winnerBase} showed the better relative performance against {OtherBase(response, winner, baseA, baseB)}."
                : $"{winnerBase} apresentou melhor desempenho relativo contra {OtherBase(response, winner, baseA, baseB)}."
        };
    }

    private static IReadOnlyList<string> BuildHighlights(
        PriceCrossoverSocialResponse response,
        (string Symbol, int TeamId)? winner,
        bool isEnglish,
        CultureInfo culture)
    {
        var highlights = new List<string>();

        AddPercentHighlight(highlights, response.AssetA, isEnglish, culture);
        AddPercentHighlight(highlights, response.AssetB, isEnglish, culture);

        if (response.Comparative.PerformanceDifferencePercent is decimal diff)
        {
            highlights.Add(isEnglish
                ? $"Relative gap: {FormatPercent(Math.Abs(diff), culture)} percentage points."
                : $"Diferenca de desempenho: {FormatPercent(Math.Abs(diff), culture)} pontos percentuais.");
        }

        if (response.Comparative.TotalCrossovers > 0)
        {
            highlights.Add(isEnglish
                ? $"{response.Comparative.TotalCrossovers} relative-performance crossovers detected."
                : $"{response.Comparative.TotalCrossovers} cruzamentos de desempenho relativo detectados.");
        }

        if (response.Comparative.RelevantCrossovers > 0)
        {
            highlights.Add(isEnglish
                ? $"{response.Comparative.RelevantCrossovers} of them with a meaningful swing."
                : $"Destes, {response.Comparative.RelevantCrossovers} com oscilacao relevante.");
        }

        if (response.Comparative.HasComeback)
        {
            highlights.Add(isEnglish
                ? "The match had an effective lead reversal before the official result."
                : "A partida teve reversao efetiva de lideranca antes do resultado oficial.");
        }

        if (response.Official.ScoreA != response.Official.ScoreB)
        {
            highlights.Add(isEnglish
                ? $"Final score: {response.Official.ScoreA}-{response.Official.ScoreB}."
                : $"Placar final: {response.Official.ScoreA}-{response.Official.ScoreB}.");
        }
        else
        {
            highlights.Add(isEnglish
                ? $"Final score tied at {response.Official.ScoreA}-{response.Official.ScoreB}."
                : $"Placar final empatado em {response.Official.ScoreA}-{response.Official.ScoreB}.");
        }

        return highlights;
    }

    private static void AddPercentHighlight(
        List<string> highlights,
        PriceCrossoverAssetStats asset,
        bool isEnglish,
        CultureInfo culture)
    {
        if (asset.PerformancePercent is not decimal value)
            return;

        var baseAsset = string.IsNullOrEmpty(asset.BaseAsset) ? asset.Symbol : asset.BaseAsset;

        highlights.Add(isEnglish
            ? $"{baseAsset} {FormatSignedPercent(value, culture)}."
            : $"{baseAsset} {FormatSignedPercent(value, culture)}.");
    }

    private static string BuildBody(
        PriceCrossoverSocialResponse response,
        (string Symbol, int TeamId)? winner,
        string pattern,
        bool isEnglish,
        CultureInfo culture)
    {
        var sb = new StringBuilder();
        var baseA = response.AssetA.BaseAsset;
        var baseB = response.AssetB.BaseAsset;
        var winnerBase = winner is null ? null : (winner.Value.TeamId == response.AssetA.TeamId ? baseA : baseB);
        var loserBase = winner is null ? null : (winner.Value.TeamId == response.AssetA.TeamId ? baseB : baseA);

        sb.Append(pattern switch
        {
            "comeback" => isEnglish
                ? $"Comeback in the Price Battle: {winnerBase} was behind on relative performance, took the lead and closed the match ahead of {loserBase}."
                : $"Reviravolta no Price Battle: {winnerBase} esteve para tras no desempenho relativo, assumiu a lideranca e encerrou a partida a frente de {loserBase}.",
            "balanced" => isEnglish
                ? $"{baseA} vs {baseB} was a tight Price Battle: the relative-performance curves stayed close and the final gap was small."
                : $"{baseA} vs {baseB} foi um Price Battle equilibrado: as curvas de desempenho relativo ficaram proximas e a diferenca final foi pequena.",
            "crossover_duel" => isEnglish
                ? $"{baseA} vs {baseB}: the relative-performance curves crossed {response.Comparative.TotalCrossovers} times, with the advantage changing hands repeatedly."
                : $"{baseA} vs {baseB}: as curvas de desempenho relativo se cruzaram {response.Comparative.TotalCrossovers} vezes, com a vantagem alternando entre os ativos.",
            "opposite_moves" => isEnglish
                ? $"Opposite moves in {baseA} vs {baseB}: one asset appreciated while the other closed below its starting price."
                : $"Movimentos opostos em {baseA} vs {baseB}: um ativo valorizou enquanto o outro terminou abaixo do preco inicial.",
            "joint_decline" => isEnglish
                ? $"Both {baseA} and {baseB} closed lower, but one of them defended its relative performance better."
                : $"Tanto {baseA} quanto {baseB} apresentaram desvalorizacao, mas um deles preservou melhor o desempenho relativo.",
            _ => isEnglish
                ? $"{winnerBase} dominated {loserBase} in the Price Battle, closing with a clear advantage on relative performance."
                : $"{winnerBase} dominou o confronto contra {loserBase} no Price Battle, encerrando com vantagem clara no desempenho relativo."
        });

        if (response.AssetA.PerformancePercent is decimal perfA && response.AssetB.PerformancePercent is decimal perfB)
        {
            sb.Append(' ');
            sb.Append(isEnglish
                ? $"{baseA}: {FormatSignedPercent(perfA, culture)} | {baseB}: {FormatSignedPercent(perfB, culture)}."
                : $"{baseA}: {FormatSignedPercent(perfA, culture)} | {baseB}: {FormatSignedPercent(perfB, culture)}.");
        }

        if (response.Comparative.PerformanceDifferencePercent is decimal gap)
        {
            sb.Append(' ');
            sb.Append(isEnglish
                ? $"Relative gap of {FormatPercent(Math.Abs(gap), culture)} percentage points."
                : $"Diferenca de {FormatPercent(Math.Abs(gap), culture)} pontos percentuais no desempenho relativo.");
        }

        return sb.ToString();
    }

    private static IReadOnlyList<string> BuildHashtags(
        PriceCrossoverSocialResponse response,
        (string Symbol, int TeamId)? winner,
        bool isEnglish)
    {
        var tags = new List<string> { "CriptoVersus", "PriceBattle" };

        var winnerBase = winner is null ? null : (winner.Value.TeamId == response.AssetA.TeamId
            ? response.AssetA.BaseAsset
            : response.AssetB.BaseAsset);

        if (!string.IsNullOrWhiteSpace(winnerBase))
            tags.Add(winnerBase);

        tags.Add(response.AssetA.BaseAsset);
        tags.Add(response.AssetB.BaseAsset);

        return tags
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Select(x => x.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(5)
            .ToList();
    }

    private static (string Text, bool WasTruncated) ComposePostText(
        string body,
        string disclaimer,
        IReadOnlyList<string> hashtags,
        int maxCharacters)
    {
        var suffixBuilder = new StringBuilder();
        suffixBuilder.Append(" #");
        suffixBuilder.Append(string.Join(" #", hashtags));
        suffixBuilder.AppendLine();
        suffixBuilder.Append(disclaimer);

        var suffix = suffixBuilder.ToString();
        var available = maxCharacters - suffix.Length;
        if (available < 40)
            available = 40;

        var trimmedBody = body.Trim();
        var wasTruncated = false;

        if (trimmedBody.Length > available)
        {
            trimmedBody = trimmedBody[..available].TrimEnd();
            var lastStop = trimmedBody.LastIndexOfAny(['.', '!', '?', ';']);
            if (lastStop >= available - 40)
                trimmedBody = trimmedBody[..(lastStop + 1)];
            else
                trimmedBody = trimmedBody.TrimEnd() + "...";
            wasTruncated = true;
        }

        var text = trimmedBody + "\n\n" + suffix;
        return (text, wasTruncated);
    }

    private static string DisplaySymbol(string? symbol, string baseA, string baseB)
        => string.IsNullOrWhiteSpace(symbol) ? baseA : symbol;

    private static string OtherBase(
        PriceCrossoverSocialResponse response,
        (string Symbol, int TeamId)? winner,
        string baseA,
        string baseB)
    {
        if (winner is null)
            return baseB;

        return winner.Value.TeamId == response.AssetA.TeamId ? baseB : baseA;
    }

    private static string FormatPercent(decimal value, CultureInfo culture)
        => Math.Abs(value).ToString("0.0", culture);

    private static string FormatSignedPercent(decimal value, CultureInfo culture)
        => (value >= 0 ? "+" : "-") + Math.Abs(value).ToString("0.0", culture) + "%";
}
