using System.Text.RegularExpressions;
using DAL.NftFutebol;

namespace CriptoVersus.API.Services;

public static partial class AudioAssetSuspicionInspector
{
    public const string ContainsUsdt = "contains_usdt";
    public const string ContainsLanguageCode = "contains_language_code";
    public const string UppercaseForMarker = "uppercase_for_marker";
    public const string NonLatinName = "non_latin_name";
    public const string RawSymbolLeak = "raw_symbol_leak";
    public const string TeamNameEqualsRawSymbol = "team_name_equals_raw_symbol";

    private static readonly HashSet<string> SupportedRules =
    [
        ContainsUsdt,
        ContainsLanguageCode,
        UppercaseForMarker,
        NonLatinName,
        RawSymbolLeak,
        TeamNameEqualsRawSymbol
    ];

    public static IReadOnlyList<string> Evaluate(AudioAsset asset)
    {
        var rules = new List<string>();
        var textPrompt = asset.TextPrompt ?? string.Empty;
        var rawSymbol = asset.RawSymbol ?? string.Empty;
        var teamName = asset.TeamName ?? string.Empty;
        var language = asset.Language ?? string.Empty;

        if (textPrompt.Contains("USDT", StringComparison.OrdinalIgnoreCase))
            rules.Add(ContainsUsdt);

        if (textPrompt.Contains("for PT-BR", StringComparison.OrdinalIgnoreCase)
            || textPrompt.Contains("for EN-US", StringComparison.OrdinalIgnoreCase))
        {
            rules.Add(ContainsLanguageCode);
        }

        if (textPrompt.Contains("FOR ", StringComparison.Ordinal))
            rules.Add(UppercaseForMarker);

        if ((string.Equals(language, "pt-BR", StringComparison.OrdinalIgnoreCase)
                || string.Equals(language, "en-US", StringComparison.OrdinalIgnoreCase))
            && ContainsNonLatinScript(textPrompt))
        {
            rules.Add(NonLatinName);
        }

        if (rawSymbol.EndsWith("USDT", StringComparison.OrdinalIgnoreCase)
            && !string.IsNullOrWhiteSpace(rawSymbol)
            && textPrompt.Contains(rawSymbol, StringComparison.OrdinalIgnoreCase))
        {
            rules.Add(RawSymbolLeak);
        }

        if (!string.IsNullOrWhiteSpace(teamName)
            && !string.IsNullOrWhiteSpace(rawSymbol)
            && string.Equals(teamName.Trim(), rawSymbol.Trim(), StringComparison.OrdinalIgnoreCase))
        {
            rules.Add(TeamNameEqualsRawSymbol);
        }

        return rules;
    }

    public static bool MatchesAny(AudioAsset asset, IReadOnlyCollection<string> rules)
    {
        var validRules = NormalizeRules(rules);
        if (validRules.Count == 0)
            return Evaluate(asset).Count > 0;

        var evaluated = Evaluate(asset);
        return evaluated.Any(validRules.Contains);
    }

    public static IReadOnlyList<string> NormalizeRules(IReadOnlyCollection<string>? rules)
    {
        if (rules is null || rules.Count == 0)
            return Array.Empty<string>();

        return rules
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Select(x => x.Trim().ToLowerInvariant())
            .Where(SupportedRules.Contains)
            .Distinct(StringComparer.Ordinal)
            .ToArray();
    }

    private static bool ContainsNonLatinScript(string input)
        => !string.IsNullOrWhiteSpace(input) && NonLatinScriptRegex().IsMatch(input);

    [GeneratedRegex("[^\\p{IsBasicLatin}\\p{IsLatin-1Supplement}\\p{IsLatinExtended-A}\\p{IsLatinExtended-B}\\p{IsGeneralPunctuation}\\p{IsCurrencySymbols}\\p{IsCombiningDiacriticalMarks}\\d\\s]", RegexOptions.CultureInvariant)]
    private static partial Regex NonLatinScriptRegex();
}
