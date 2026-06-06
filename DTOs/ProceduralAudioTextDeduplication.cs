using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace DTOs;

public static partial class ProceduralAudioTextDeduplication
{
    private static readonly Regex MultiWhitespaceRegex = BuildMultiWhitespaceRegex();
    private static readonly Regex IrrelevantPunctuationRegex = BuildIrrelevantPunctuationRegex();
    private static readonly Regex NumericValueRegex = BuildNumericValueRegex();

    public static string NormalizeNarrationText(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
            return string.Empty;

        var normalized = text.Trim().ToLowerInvariant();
        normalized = RemoveDiacritics(normalized);
        normalized = NumericValueRegex.Replace(normalized, "{num}");
        normalized = IrrelevantPunctuationRegex.Replace(normalized, " ");
        normalized = MultiWhitespaceRegex.Replace(normalized, " ").Trim();
        return normalized;
    }

    public static string ComputeTextHash(string? text, string? culture, string? voiceId)
    {
        var normalizedText = NormalizeNarrationText(text);
        var normalizedCulture = ProceduralAudioNormalization.NormalizeLanguage(culture);
        var normalizedVoice = ProceduralAudioNormalization.NormalizeToken(voiceId) ?? "default";
        var payload = $"{normalizedText}|{normalizedCulture}|{normalizedVoice}";
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(payload));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    public static string GetShortHash(string? hash, int length = 8)
    {
        if (string.IsNullOrWhiteSpace(hash))
            return "nohash";

        var normalizedLength = Math.Clamp(length, 4, 64);
        return hash.Length <= normalizedLength
            ? hash.ToLowerInvariant()
            : hash[..normalizedLength].ToLowerInvariant();
    }

    private static string RemoveDiacritics(string value)
    {
        var normalized = value.Normalize(NormalizationForm.FormD);
        var builder = new StringBuilder(normalized.Length);
        foreach (var ch in normalized)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(ch) != UnicodeCategory.NonSpacingMark)
                builder.Append(ch);
        }

        return builder.ToString().Normalize(NormalizationForm.FormC);
    }

    [GeneratedRegex(@"\s+", RegexOptions.Compiled)]
    private static partial Regex BuildMultiWhitespaceRegex();

    [GeneratedRegex(@"[^\p{L}\p{N}\{\}\s]+", RegexOptions.Compiled)]
    private static partial Regex BuildIrrelevantPunctuationRegex();

    [GeneratedRegex(@"\b\d+(?:[.,]\d+)?\b", RegexOptions.Compiled)]
    private static partial Regex BuildNumericValueRegex();
}
