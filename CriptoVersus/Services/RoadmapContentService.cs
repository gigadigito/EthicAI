namespace CriptoVersus.Web.Services;

public sealed class RoadmapContentService
{
    private readonly IConfiguration _configuration;

    public RoadmapContentService(IConfiguration configuration)
    {
        _configuration = configuration;
    }

    public RoadmapPageContent BuildPage(string? culture, string? fallbackBaseUri = null)
    {
        var normalizedCulture = NormalizeCulture(culture);
        var baseUrl = ResolveBaseUrl(fallbackBaseUri);
        var canonicalUrl = BuildAbsoluteUrl(baseUrl, "/roadmap");

        return normalizedCulture == "en"
            ? BuildEnglishPage(baseUrl, canonicalUrl)
            : BuildPortuguesePage(baseUrl, canonicalUrl);
    }

    public string NormalizeCulture(string? culture)
        => string.Equals(culture, "en", StringComparison.OrdinalIgnoreCase) ? "en" : "pt";

    private RoadmapPageContent BuildPortuguesePage(string baseUrl, string canonicalUrl)
    {
        return new RoadmapPageContent
        {
            Culture = "pt",
            PageTitle = "Roadmap CriptoVersus | Evolução da Plataforma",
            MetaDescription = "Acompanhe o roadmap público do CriptoVersus: partidas cripto, histórico público, regras de pontuação, transparência, internacionalização e futuras integrações blockchain.",
            CanonicalUrl = canonicalUrl,
            AlternateLinks =
            [
                new AlternateLink("pt-br", BuildAbsoluteUrl(baseUrl, "/pt/roadmap")),
                new AlternateLink("en", BuildAbsoluteUrl(baseUrl, "/en/roadmap"))
            ],
            OpenGraph = new RoadmapOpenGraphMetadata
            {
                Title = "Roadmap CriptoVersus",
                Description = "Veja a evolução planejada do CriptoVersus, incluindo partidas cripto, histórico público, regras avançadas, i18n e integrações blockchain.",
                Type = "website",
                Url = canonicalUrl
            },
            Hero = new RoadmapHeroContent
            {
                Eyebrow = "Visão pública do produto",
                Title = "Roadmap CriptoVersus",
                Subtitle = "Acompanhe a evolução da plataforma, novas regras de partidas, melhorias de transparência e futuras integrações.",
                PrimaryCtaLabel = "Ver partidas ao vivo",
                PrimaryCtaHref = "/",
                SecondaryCtaLabel = "Entender as regras",
                SecondaryCtaHref = "/tokenomics"
            },
            StatusCards =
            [
                new RoadmapInfoCard("Em desenvolvimento ativo", "Plataforma em iteração constante, com novas entregas públicas e refinamento operacional.", "Ativo"),
                new RoadmapInfoCard("Partidas cripto automatizadas", "Ciclos entre moedas com acompanhamento de mercado, placar e atualização contínua.", "Automação"),
                new RoadmapInfoCard("Histórico público", "Resultados, contexto de partidas e visibilidade crescente para auditoria e consulta.", "Transparência"),
                new RoadmapInfoCard("Regras em evolução", "Modelos de pontuação e dinâmicas econômicas seguem sendo testados e ajustados.", "Iteração"),
                new RoadmapInfoCard("Preparado para expansão internacional", "Arquitetura de rotas, SEO e timezone local pensados para múltiplos idiomas.", "i18n-ready")
            ],
            Phases =
            [
                new RoadmapPhase(
                    "Fase 1",
                    "Fundação da Plataforma",
                    RoadmapPhaseStatus.InProgress,
                    "Base operacional para partidas públicas, ciclos iniciais e leitura de mercado.",
                    [
                        "Criação das partidas entre moedas",
                        "Integração com dados de mercado",
                        "Tela de partidas ao vivo",
                        "Histórico de partidas encerradas",
                        "Registro de resultados e placares"
                    ],
                    1),
                new RoadmapPhase(
                    "Fase 2",
                    "Transparência e Auditoria",
                    RoadmapPhaseStatus.InProgress,
                    "Camada pública para explicar melhor como cada partida evolui e como o resultado pode ser acompanhado.",
                    [
                        "Página pública de histórico",
                        "Detalhe publico da partida",
                        "Exibição clara de placar, desempenho e resultado",
                        "Melhorias em SEO",
                        "Metadados públicos por partida",
                        "Registro de eventos da partida para auditoria futura"
                    ],
                    2),
                new RoadmapPhase(
                    "Fase 3",
                    "Regras Avançadas de Pontuação",
                    RoadmapPhaseStatus.Planned,
                    "Novas regras para tornar a leitura do jogo mais rica, explicável e auditável.",
                    [
                        "Pontuação por diferença percentual",
                        "Pontuação por cruzamento de gráficos",
                        "Pontuação por volume em janelas de tempo",
                        "Logs de eventos da partida",
                        "Base para narrador IA no futuro"
                    ],
                    3),
                new RoadmapPhase(
                    "Fase 4",
                    "Economia Cíclica",
                    RoadmapPhaseStatus.Planned,
                    "Evolução do modelo para uma dinâmica mais próxima de pool competitiva experimental.",
                    [
                        "Participação automática em ciclos futuros",
                        "Melhor controle de saldo",
                        "Redução de perdas bruscas",
                        "Modelo mais próximo de pool competitiva do que aposta tradicional",
                        "Simulações e ajustes antes de produção ampla"
                    ],
                    4),
                new RoadmapPhase(
                    "Fase 5",
                    "Internacionalização",
                    RoadmapPhaseStatus.Planned,
                    "Estrutura de conteúdo e rotas preparada para expansão linguística e regional.",
                    [
                        "Rotas i18n",
                        "Conteúdo em português e inglês",
                        "Hreflang",
                        "SEO internacional",
                        "Timezone local por região"
                    ],
                    5),
                new RoadmapPhase(
                    "Fase 6",
                    "Integração Blockchain",
                    RoadmapPhaseStatus.Experimental,
                    "Camada on-chain tratada como extensão experimental da auditabilidade e da infraestrutura.",
                    [
                        "Integracao com Solana Devnet/Mainnet",
                        "Registro de posições e saldos on-chain quando fizer sentido",
                        "Separação entre lógica off-chain e liquidação on-chain",
                        "Maior auditabilidade publica"
                    ],
                    6),
                new RoadmapPhase(
                    "Fase 7",
                    "Narrador IA e Experiência",
                    RoadmapPhaseStatus.Future,
                    "Camada de experiência para destacar contexto, eventos importantes e leitura pós-jogo.",
                    [
                        "Narrador automático de partidas",
                        "Resumo pós-jogo",
                        "Destaques da partida",
                        "Explicação dos eventos decisivos",
                        "Compartilhamento social"
                    ],
                    7)
            ],
            Principles =
            [
                new RoadmapInfoCard("Transparência antes de escala", "Prioridade para explicar como o sistema funciona antes de acelerar distribuição.", "Princípio"),
                new RoadmapInfoCard("Regras claras antes de monetização", "Evolução do produto guiada por legibilidade operacional e regras compreensíveis.", "Princípio"),
                new RoadmapInfoCard("Segurança antes de automação", "Automatizar apenas quando o fluxo já estiver suficientemente validado.", "Princípio"),
                new RoadmapInfoCard("Histórico público antes de rankings", "Primeiro tornar resultados observáveis e consistentes, depois ampliar camadas competitivas.", "Princípio"),
                new RoadmapInfoCard("Dados verificáveis antes de narrativa", "Narrativas futuras devem nascer de eventos, logs e resultados rastreáveis.", "Princípio")
            ],
            NoticeTitle = "Aviso importante",
            NoticeText = "O CriptoVersus é uma plataforma experimental de partidas cripto baseadas em dados de mercado. As regras, modelos econômicos e integrações podem evoluir com o tempo. Nenhuma informação desta página representa promessa de ganho financeiro."
        };
    }

    private RoadmapPageContent BuildEnglishPage(string baseUrl, string canonicalUrl)
    {
        return new RoadmapPageContent
        {
            Culture = "en",
            PageTitle = "CriptoVersus Roadmap | Platform Evolution",
            MetaDescription = "Follow the public CriptoVersus roadmap: crypto matches, public match history, scoring rules, transparency, internationalization and future blockchain integrations.",
            CanonicalUrl = canonicalUrl,
            AlternateLinks =
            [
                new AlternateLink("pt-br", BuildAbsoluteUrl(baseUrl, "/pt/roadmap")),
                new AlternateLink("en", BuildAbsoluteUrl(baseUrl, "/en/roadmap"))
            ],
            OpenGraph = new RoadmapOpenGraphMetadata
            {
                Title = "CriptoVersus Roadmap",
                Description = "See the planned evolution of CriptoVersus, including crypto matches, public match history, advanced rules, i18n and blockchain integrations.",
                Type = "website",
                Url = canonicalUrl
            },
            Hero = new RoadmapHeroContent
            {
                Eyebrow = "Public product overview",
                Title = "CriptoVersus Roadmap",
                Subtitle = "Follow the platform evolution, new match rules, transparency improvements and future integrations.",
                PrimaryCtaLabel = "View live matches",
                PrimaryCtaHref = "/",
                SecondaryCtaLabel = "Read the rules",
                SecondaryCtaHref = "/tokenomics"
            },
            StatusCards =
            [
                new RoadmapInfoCard("Active development", "The platform is evolving continuously with public releases and operational refinements.", "Active"),
                new RoadmapInfoCard("Automated crypto matches", "Market-based cycles between assets with score tracking and continuous updates.", "Automation"),
                new RoadmapInfoCard("Public history", "Results and match context are becoming increasingly visible for audit and review.", "Transparency"),
                new RoadmapInfoCard("Rules in evolution", "Scoring models and economic dynamics are still being tested and refined.", "Iteration"),
                new RoadmapInfoCard("Ready for international expansion", "Routing, SEO and local timezone support are being shaped for multiple regions.", "i18n-ready")
            ],
            Phases =
            [
                new RoadmapPhase("Phase 1", "Platform Foundation", RoadmapPhaseStatus.InProgress, "Operational foundation for public matches, early cycles and market-driven game flow.",
                [
                    "Creation of matches between coins",
                    "Market data integration",
                    "Live match view",
                    "Completed match history",
                    "Result and score registration"
                ], 1),
                new RoadmapPhase("Phase 2", "Transparency and Auditability", RoadmapPhaseStatus.InProgress, "Public surfaces that explain how each match evolves and how results can be reviewed.",
                [
                    "Public history page",
                    "Public match detail page",
                    "Clear display of score, performance and result",
                    "SEO improvements",
                    "Public metadata per match",
                    "Match event records for future auditability"
                ], 2),
                new RoadmapPhase("Phase 3", "Advanced Scoring Rules", RoadmapPhaseStatus.Planned, "Richer match logic designed to stay explainable and data-driven.",
                [
                    "Scoring by percentage difference",
                    "Scoring by chart crossovers",
                    "Scoring by volume windows",
                    "Match event logs",
                    "Foundation for a future AI commentator"
                ], 3),
                new RoadmapPhase("Phase 4", "Cyclical Economy", RoadmapPhaseStatus.Planned, "Evolution toward a more experimental competitive pool model.",
                [
                    "Automatic participation in future cycles",
                    "Better balance control",
                    "Reduced abrupt losses",
                    "A model closer to a competitive pool than a traditional bet",
                    "Simulations and tuning before broader production"
                ], 4),
                new RoadmapPhase("Phase 5", "Internationalization", RoadmapPhaseStatus.Planned, "Routing and content structure prepared for multilingual expansion.",
                [
                    "i18n routes",
                    "Portuguese and English content",
                    "Hreflang",
                    "International SEO",
                    "Local timezone by region"
                ], 5),
                new RoadmapPhase("Phase 6", "Blockchain Integration", RoadmapPhaseStatus.Experimental, "An experimental on-chain layer focused on auditability and infrastructure where it makes sense.",
                [
                    "Solana Devnet/Mainnet integration",
                    "On-chain positions and balances where appropriate",
                    "Separation between off-chain logic and on-chain settlement",
                    "Stronger public auditability"
                ], 6),
                new RoadmapPhase("Phase 7", "AI Commentary and Experience", RoadmapPhaseStatus.Future, "Experience enhancements built on top of verifiable match data and public history.",
                [
                    "Automated match commentator",
                    "Post-match summaries",
                    "Match highlights",
                    "Explanations of decisive events",
                    "Social sharing"
                ], 7)
            ],
            Principles =
            [
                new RoadmapInfoCard("Transparency before scale", "Explain how the system works before trying to accelerate distribution.", "Principle"),
                new RoadmapInfoCard("Clear rules before monetization", "Product evolution should stay readable before it becomes broader.", "Principle"),
                new RoadmapInfoCard("Safety before automation", "Only automate flows after they are sufficiently validated.", "Principle"),
                new RoadmapInfoCard("Public history before rankings", "Make results observable before adding bigger competitive layers.", "Principle"),
                new RoadmapInfoCard("Verifiable data before narrative", "Any future narrative layer should be grounded in logs, events and results.", "Principle")
            ],
            NoticeTitle = "Important notice",
            NoticeText = "CriptoVersus is an experimental platform for crypto matches based on market data. Rules, economic models and integrations may evolve over time. Nothing on this page represents a promise of financial gain."
        };
    }

    private string ResolveBaseUrl(string? fallbackBaseUri)
    {
        var configuredBaseUrl = _configuration["CriptoVersus:PublicBaseUrl"];
        return !string.IsNullOrWhiteSpace(configuredBaseUrl)
            ? configuredBaseUrl.TrimEnd('/')
            : (fallbackBaseUri ?? "https://criptoversus.com").TrimEnd('/');
    }

    private static string BuildAbsoluteUrl(string baseUrl, string path)
        => new Uri(new Uri(baseUrl.TrimEnd('/') + "/"), path.TrimStart('/')).ToString();
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
