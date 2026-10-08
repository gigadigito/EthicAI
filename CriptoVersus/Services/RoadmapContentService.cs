using System.Text.Json.Serialization;

namespace CriptoVersus.Web.Services;

public sealed class RoadmapContentService
{
    private readonly IConfiguration _configuration;
    private readonly RouteLocalizationService _routeLocalization;
    private readonly SupportedLanguageCatalog _languages;
    private readonly LocalizationService _localization;

    public RoadmapContentService(
        IConfiguration configuration,
        RouteLocalizationService routeLocalization,
        SupportedLanguageCatalog languages,
        LocalizationService localization)
    {
        _configuration = configuration;
        _routeLocalization = routeLocalization;
        _languages = languages;
        _localization = localization;
    }

    public RoadmapPageContent BuildPage(string? culture, string? fallbackBaseUri = null)
    {
        var normalizedCulture = NormalizeCulture(culture);
        var canonicalUrl = SeoDefaults.BuildPublicAbsoluteUrl(_configuration, _routeLocalization.BuildRoadmapPath(normalizedCulture));

        var i18n = _localization.GetSection<RoadmapI18nContent>("roadmap", normalizedCulture)
                   ?? _localization.GetSection<RoadmapI18nContent>("roadmap", _languages.DefaultLanguage.RouteCulture)
                   ?? new RoadmapI18nContent();

        return new RoadmapPageContent
        {
            Culture = normalizedCulture,
            PageTitle = i18n.PageTitle ?? string.Empty,
            MetaDescription = i18n.MetaDescription ?? string.Empty,
            CanonicalUrl = canonicalUrl,
            AlternateLinks = BuildAlternateLinks(),
            OpenGraph = new RoadmapOpenGraphMetadata
            {
                Title = i18n.OpenGraph?.Title ?? i18n.PageTitle ?? string.Empty,
                Description = i18n.OpenGraph?.Description ?? i18n.MetaDescription ?? string.Empty,
                Type = i18n.OpenGraph?.Type ?? "website",
                Url = canonicalUrl
            },
            Hero = new RoadmapHeroContent
            {
                Eyebrow = i18n.Hero?.Eyebrow ?? string.Empty,
                Title = i18n.Hero?.Title ?? string.Empty,
                Subtitle = i18n.Hero?.Subtitle ?? string.Empty,
                PrimaryCtaLabel = i18n.Hero?.PrimaryCtaLabel ?? string.Empty,
                PrimaryCtaHref = _routeLocalization.BuildHomePath(normalizedCulture),
                SecondaryCtaLabel = i18n.Hero?.SecondaryCtaLabel ?? string.Empty,
                SecondaryCtaHref = _routeLocalization.BuildHowItWorksPath(normalizedCulture)
            },
            StatusCards = (i18n.StatusCards ?? [])
                .Select(c => new RoadmapInfoCard(
                    c.Title ?? string.Empty,
                    c.Description ?? string.Empty,
                    c.Tag ?? string.Empty))
                .ToArray(),
            Phases = (i18n.Phases ?? [])
                .Select(p => new RoadmapPhase(
                    p.PhaseLabel ?? string.Empty,
                    p.Title ?? string.Empty,
                    ParsePhaseStatus(p.Status),
                    p.Description ?? string.Empty,
                    p.Items ?? [],
                    p.SortOrder))
                .OrderBy(p => p.SortOrder)
                .ToArray(),
            Principles = (i18n.Principles ?? [])
                .Select(c => new RoadmapInfoCard(
                    c.Title ?? string.Empty,
                    c.Description ?? string.Empty,
                    c.Tag ?? string.Empty))
                .ToArray(),
            NoticeTitle = i18n.NoticeTitle ?? string.Empty,
            NoticeText = i18n.NoticeText ?? string.Empty
        };
    }

    public string NormalizeCulture(string? culture)
    {
        if (string.IsNullOrWhiteSpace(culture))
            return _languages.DefaultLanguage.RouteCulture;

        var candidate = culture.Trim();

        if (_languages.TryGet(candidate, out var language))
            return language.RouteCulture;

        var neutral = candidate.Split('-', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).FirstOrDefault();
        if (neutral is not null && _languages.TryGet(neutral, out var neutralLanguage))
            return neutralLanguage.RouteCulture;

        return _languages.DefaultLanguage.RouteCulture;
    }

    private IReadOnlyList<AlternateLink> BuildAlternateLinks()
        => _languages.EnabledLanguages
            .Select(l => new AlternateLink(
                l.Culture,
                SeoDefaults.BuildPublicAbsoluteUrl(_configuration, _routeLocalization.BuildRoadmapPath(l.RouteCulture))))
            .ToArray();

    private static RoadmapPhaseStatus ParsePhaseStatus(string? status)
        => status?.Trim().ToLowerInvariant() switch
        {
            "completed" or "concluído" or "completado" or "terminé" or "abgeschlossen" or "completato" or "完了" => RoadmapPhaseStatus.Completed,
            "inprogress" or "in_progress" or "in-progress" or "em andamento" or "en curso" or "en cours" or "in bearbeitung" or "in corso" or "進行中" or "进行中" => RoadmapPhaseStatus.InProgress,
            "planned" or "planejado" or "planificado" or "planifié" or "geplant" or "pianificato" or "予定" or "计划中" => RoadmapPhaseStatus.Planned,
            "future" or "futuro" or "futur" or "zukünftig" or "未来" => RoadmapPhaseStatus.Future,
            "experimental" or "expérimental" or "experimentell" or "sperimentale" or "実験的" or "实验性" => RoadmapPhaseStatus.Experimental,
            _ => RoadmapPhaseStatus.Planned
        };
}

public sealed class RoadmapI18nContent
{
    [JsonPropertyName("pageTitle")]
    public string? PageTitle { get; set; }

    [JsonPropertyName("metaDescription")]
    public string? MetaDescription { get; set; }

    [JsonPropertyName("openGraph")]
    public RoadmapI18nOpenGraph? OpenGraph { get; set; }

    [JsonPropertyName("hero")]
    public RoadmapI18nHero? Hero { get; set; }

    [JsonPropertyName("statusCards")]
    public List<RoadmapI18nInfoCard>? StatusCards { get; set; }

    [JsonPropertyName("phases")]
    public List<RoadmapI18nPhase>? Phases { get; set; }

    [JsonPropertyName("principles")]
    public List<RoadmapI18nInfoCard>? Principles { get; set; }

    [JsonPropertyName("noticeTitle")]
    public string? NoticeTitle { get; set; }

    [JsonPropertyName("noticeText")]
    public string? NoticeText { get; set; }
}

public sealed class RoadmapI18nOpenGraph
{
    [JsonPropertyName("title")]
    public string? Title { get; set; }

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonPropertyName("type")]
    public string? Type { get; set; }
}

public sealed class RoadmapI18nHero
{
    [JsonPropertyName("eyebrow")]
    public string? Eyebrow { get; set; }

    [JsonPropertyName("title")]
    public string? Title { get; set; }

    [JsonPropertyName("subtitle")]
    public string? Subtitle { get; set; }

    [JsonPropertyName("primaryCtaLabel")]
    public string? PrimaryCtaLabel { get; set; }

    [JsonPropertyName("secondaryCtaLabel")]
    public string? SecondaryCtaLabel { get; set; }
}

public sealed class RoadmapI18nInfoCard
{
    [JsonPropertyName("title")]
    public string? Title { get; set; }

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonPropertyName("tag")]
    public string? Tag { get; set; }
}

public sealed class RoadmapI18nPhase
{
    [JsonPropertyName("phaseLabel")]
    public string? PhaseLabel { get; set; }

    [JsonPropertyName("title")]
    public string? Title { get; set; }

    [JsonPropertyName("status")]
    public string? Status { get; set; }

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonPropertyName("items")]
    public List<string>? Items { get; set; }

    [JsonPropertyName("sortOrder")]
    public int SortOrder { get; set; }
}

public sealed class RoadmapPageContent
{
    public string Culture { get; init; } = "pt";
    public string PageTitle { get; init; } = string.Empty;
    public string MetaDescription { get; init; } = string.Empty;
    public string CanonicalUrl { get; init; } = string.Empty;
    public IReadOnlyList<AlternateLink> AlternateLinks { get; init; } = [];
    public RoadmapOpenGraphMetadata OpenGraph { get; init; } = new();
    public RoadmapHeroContent Hero { get; init; } = new();
    public IReadOnlyList<RoadmapInfoCard> StatusCards { get; init; } = [];
    public IReadOnlyList<RoadmapPhase> Phases { get; init; } = [];
    public IReadOnlyList<RoadmapInfoCard> Principles { get; init; } = [];
    public string NoticeTitle { get; init; } = string.Empty;
    public string NoticeText { get; init; } = string.Empty;
}

public sealed class RoadmapOpenGraphMetadata
{
    public string Title { get; init; } = string.Empty;
    public string Description { get; init; } = string.Empty;
    public string Type { get; init; } = "website";
    public string Url { get; init; } = string.Empty;
}

public sealed class RoadmapHeroContent
{
    public string Eyebrow { get; init; } = string.Empty;
    public string Title { get; init; } = string.Empty;
    public string Subtitle { get; init; } = string.Empty;
    public string PrimaryCtaLabel { get; init; } = string.Empty;
    public string PrimaryCtaHref { get; init; } = "/";
    public string SecondaryCtaLabel { get; init; } = string.Empty;
    public string SecondaryCtaHref { get; init; } = "/";
}

public sealed record RoadmapInfoCard(string Title, string Description, string Tag);

public sealed record RoadmapPhase(
    string PhaseLabel,
    string Title,
    RoadmapPhaseStatus Status,
    string Description,
    IReadOnlyList<string> Items,
    int SortOrder);

public enum RoadmapPhaseStatus
{
    Completed,
    InProgress,
    Planned,
    Future,
    Experimental
}