namespace CriptoVersus.Web.Services;

public sealed record SupportedLanguage(
    string RouteCulture,
    string Culture,
    string DisplayName,
    string NativeName,
    string ShortName,
    string OgLocale,
    bool IsEstablished = false,
    bool Enabled = true,
    params string[] Aliases);

/// <summary>
/// Immutable application-wide registry for localized routes, UI and SEO metadata.
/// Add a culture here and its route, selector, culture validation and sitemap discovery follow it.
/// </summary>
public sealed class SupportedLanguageCatalog
{
    private static readonly IReadOnlyList<SupportedLanguage> Languages =
    [
        new("en", "en-US", "English", "English", "EN", "en_US", true, true, "en-us"),
        new("pt", "pt-BR", "Portuguese (Brazil)", "Português (Brasil)", "PT", "pt_BR", true, true, "pt-br"),
        new("zh", "zh-CN", "Chinese (Simplified)", "中文", "ZH", "zh_CN", true, true, "zh-cn", "zh-hans", "zh-hans-cn"),
        new("es", "es-ES", "Spanish", "Español", "ES", "es_ES", false, true, "es-es"),
        new("fr", "fr-FR", "French", "Français", "FR", "fr_FR", false, true, "fr-fr"),
        new("de", "de-DE", "German", "Deutsch", "DE", "de_DE", false, true, "de-de"),
        new("it", "it-IT", "Italian", "Italiano", "IT", "it_IT", false, true, "it-it"),
        new("ja", "ja-JP", "Japanese", "日本語", "JA", "ja_JP", false, true, "ja-jp")
    ];

    public IReadOnlyList<SupportedLanguage> EnabledLanguages => Languages.Where(language => language.Enabled).ToArray();

    public IReadOnlyList<SupportedLanguage> AdditionalLanguages => Languages.Where(language => language.Enabled && !language.IsEstablished).ToArray();

    public SupportedLanguage DefaultLanguage => Languages[0];

    public bool TryGet(string? value, out SupportedLanguage language)
    {
        language = DefaultLanguage;
        if (string.IsNullOrWhiteSpace(value))
            return false;

        var candidate = value.Trim();
        var match = Languages.FirstOrDefault(item => item.Enabled &&
            (item.RouteCulture.Equals(candidate, StringComparison.OrdinalIgnoreCase)
             || item.Culture.Equals(candidate, StringComparison.OrdinalIgnoreCase)
             || item.Aliases.Any(alias => alias.Equals(candidate, StringComparison.OrdinalIgnoreCase))));

        if (match is null)
            return false;

        language = match;
        return true;
    }

    public SupportedLanguage GetOrDefault(string? value)
        => TryGet(value, out var language) ? language : DefaultLanguage;
}
