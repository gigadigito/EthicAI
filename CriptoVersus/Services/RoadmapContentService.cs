namespace CriptoVersus.Web.Services;

public sealed class RoadmapContentService
{
    private readonly IConfiguration _configuration;
    private readonly RouteLocalizationService _routeLocalization;

    public RoadmapContentService(IConfiguration configuration, RouteLocalizationService routeLocalization)
    {
        _configuration = configuration;
        _routeLocalization = routeLocalization;
    }

    public RoadmapPageContent BuildPage(string? culture, string? fallbackBaseUri = null)
    {
        var normalizedCulture = NormalizeCulture(culture);
        var canonicalUrl = SeoDefaults.BuildPublicAbsoluteUrl(_configuration, _routeLocalization.BuildRoadmapPath(normalizedCulture));

        return normalizedCulture switch
        {
            "pt" => BuildPortuguesePage(canonicalUrl, normalizedCulture),
            "zh" => BuildChinesePage(canonicalUrl, normalizedCulture),
            _ => BuildEnglishPage(canonicalUrl, normalizedCulture)
        };
    }

    public string NormalizeCulture(string? culture)
        => string.Equals(culture, "en", StringComparison.OrdinalIgnoreCase)
            ? "en"
            : string.Equals(culture, "zh", StringComparison.OrdinalIgnoreCase)
                || string.Equals(culture, "zh-CN", StringComparison.OrdinalIgnoreCase)
                || string.Equals(culture, "zh-hans", StringComparison.OrdinalIgnoreCase)
                ? "zh"
                : "pt";

    private RoadmapPageContent BuildPortuguesePage(string canonicalUrl, string culture)
    {
        return new RoadmapPageContent
        {
            Culture = culture,
            PageTitle = "Roadmap CriptoVersus | Evolução da Plataforma",
            MetaDescription = "Acompanhe o roadmap público do CriptoVersus: partidas cripto, histórico público, regras de pontuação, transparência, internacionalização e futuras integrações blockchain.",
            CanonicalUrl = canonicalUrl,
            AlternateLinks =
            [
                new AlternateLink("en", SeoDefaults.BuildPublicAbsoluteUrl(_configuration, "/en/roadmap")),
                new AlternateLink("pt-BR", SeoDefaults.BuildPublicAbsoluteUrl(_configuration, "/pt/roadmap")),
                new AlternateLink("zh-CN", SeoDefaults.BuildPublicAbsoluteUrl(_configuration, "/zh/roadmap"))
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
                PrimaryCtaHref = _routeLocalization.BuildHomePath("pt"),
                SecondaryCtaLabel = "Entender as regras",
                SecondaryCtaHref = _routeLocalization.BuildHowItWorksPath("pt")
            },
            StatusCards =
            [
                new RoadmapInfoCard("Em desenvolvimento ativo", "Plataforma em iteração constante, com novas entregas públicas e refinamento operacional.", "Ativo"),
                new RoadmapInfoCard("Partidas cripto automatizadas", "Ciclos entre moedas com acompanhamento de mercado, placar e atualização contínua.", "Automação"),
                new RoadmapInfoCard("Histórico público", "Resultados, contexto de partidas e visibilidade crescente para auditoria e consulta.", "Transparência"),
                new RoadmapInfoCard("Regras em evolução", "Modelos de pontuação e dinâmicas econômicas seguem sendo testados e ajustados.", "Iteração"),
                new RoadmapInfoCard("Internacionalização concluída", "Rotas localizadas, SEO internacional, hreflang e suporte de idioma já foram entregues para a experiência pública.", "i18n-complete")
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
                        "Detalhe público da partida",
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
                    RoadmapPhaseStatus.Completed,
                    "Estrutura multilíngue entregue com rotas localizadas, conteúdo bilíngue e sinais SEO internacionais ativos.",
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
                        "Integração com Solana Devnet/Mainnet",
                        "Registro de posições e saldos on-chain quando fizer sentido",
                        "Separação entre lógica off-chain e liquidação on-chain",
                        "Maior auditabilidade pública"
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

    private RoadmapPageContent BuildChinesePage(string canonicalUrl, string culture)
    {
        return new RoadmapPageContent
        {
            Culture = culture,
            PageTitle = "CriptoVersus 路线图 | 平台演进",
            MetaDescription = "关注 CriptoVersus 的公开路线图：加密货币对战、公开历史记录、计分规则、透明度、本地化以及未来区块链集成。",
            CanonicalUrl = canonicalUrl,
            AlternateLinks =
            [
                new AlternateLink("en", SeoDefaults.BuildPublicAbsoluteUrl(_configuration, "/en/roadmap")),
                new AlternateLink("pt-BR", SeoDefaults.BuildPublicAbsoluteUrl(_configuration, "/pt/roadmap")),
                new AlternateLink("zh-CN", SeoDefaults.BuildPublicAbsoluteUrl(_configuration, "/zh/roadmap"))
            ],
            OpenGraph = new RoadmapOpenGraphMetadata
            {
                Title = "CriptoVersus 路线图",
                Description = "查看 CriptoVersus 的规划演进，包括加密货币对战、公开历史、进阶规则、本地化和区块链集成。",
                Type = "website",
                Url = canonicalUrl
            },
            Hero = new RoadmapHeroContent
            {
                Eyebrow = "公开产品概览",
                Title = "CriptoVersus 路线图",
                Subtitle = "跟踪平台演进、新的对战规则、透明度改进以及未来集成。",
                PrimaryCtaLabel = "查看实时对战",
                PrimaryCtaHref = _routeLocalization.BuildHomePath("zh"),
                SecondaryCtaLabel = "阅读规则说明",
                SecondaryCtaHref = _routeLocalization.BuildHowItWorksPath("zh")
            },
            StatusCards =
            [
                new RoadmapInfoCard("持续开发中", "平台持续迭代，新的公开交付和运营优化不断推出。", "活跃"),
                new RoadmapInfoCard("自动化加密对战", "资产之间的市场驱动周期，配合比分跟踪和持续更新。", "自动化"),
                new RoadmapInfoCard("公开历史", "结果和对战背景越来越透明，便于审计和复查。", "透明度"),
                new RoadmapInfoCard("规则持续演进", "计分模型和经济动态仍在测试和打磨中。", "迭代"),
                new RoadmapInfoCard("国际化已完成", "本地化路由、国际 SEO、hreflang 和公开语言支持已经上线。", "i18n-complete")
            ],
            Phases =
            [
                new RoadmapPhase(
                    "阶段 1",
                    "平台基础",
                    RoadmapPhaseStatus.InProgress,
                    "面向公开对战、早期周期和市场驱动玩法的运行基础。",
                    [
                        "创建币种之间的对战",
                        "市场数据集成",
                        "实时对战视图",
                        "已完成对战历史",
                        "结果与比分记录"
                    ],
                    1),
                new RoadmapPhase(
                    "阶段 2",
                    "透明度与可审计性",
                    RoadmapPhaseStatus.InProgress,
                    "帮助用户理解每场对战如何演进，以及结果如何被查看的公开层。",
                    [
                        "公开历史页面",
                        "公开对战详情页",
                        "清晰展示比分、表现和结果",
                        "SEO 改进",
                        "每场对战的公开元数据",
                        "用于未来审计的对战事件记录"
                    ],
                    2),
                new RoadmapPhase(
                    "阶段 3",
                    "进阶计分规则",
                    RoadmapPhaseStatus.Planned,
                    "更丰富的对战逻辑，保持可解释和数据驱动。",
                    [
                        "按百分比差值计分",
                        "按图表交叉计分",
                        "按时间窗口成交量计分",
                        "对战事件日志",
                        "未来 AI 解说基础"
                    ],
                    3),
                new RoadmapPhase(
                    "阶段 4",
                    "循环经济",
                    RoadmapPhaseStatus.Planned,
                    "向更具实验性的竞争池模型演进。",
                    [
                        "未来周期自动参与",
                        "更好的余额控制",
                        "减少突发性损失",
                        "更接近竞争池而非传统投注的模型",
                        "大规模上线前的模拟与调优"
                    ],
                    4),
                new RoadmapPhase(
                    "阶段 5",
                    "国际化",
                    RoadmapPhaseStatus.Completed,
                    "多语言路由、双语内容和国际 SEO 信号已经在公开体验中上线。",
                    [
                        "i18n 路由",
                        "葡萄牙语和英语内容",
                        "hreflang",
                        "国际 SEO",
                        "按地区使用本地时区"
                    ],
                    5),
                new RoadmapPhase(
                    "阶段 6",
                    "区块链集成",
                    RoadmapPhaseStatus.Experimental,
                    "把链上层作为审计性和基础设施的实验性扩展。",
                    [
                        "Solana Devnet/Mainnet 集成",
                        "在合适场景下记录链上仓位和余额",
                        "拆分链下逻辑与链上结算",
                        "更强的公开可审计性"
                    ],
                    6),
                new RoadmapPhase(
                    "阶段 7",
                    "AI 解说与体验",
                    RoadmapPhaseStatus.Future,
                    "基于可验证对战数据和公开历史的体验增强。",
                    [
                        "自动对战解说",
                        "赛后摘要",
                        "对战高光",
                        "关键事件说明",
                        "社交分享"
                    ],
                    7)
            ],
            Principles =
            [
                new RoadmapInfoCard("先透明，再扩展", "先解释系统如何工作，再考虑加速分发。", "原则"),
                new RoadmapInfoCard("先明确规则，再做变现", "产品演进应先保证可读性，再扩大规模。", "原则"),
                new RoadmapInfoCard("先安全，再自动化", "只有在流程足够验证后才自动化。", "原则"),
                new RoadmapInfoCard("先公开历史，再做排名", "先让结果可观察，再增加更强的竞争层。", "原则"),
                new RoadmapInfoCard("先可验证数据，再做叙事", "未来的叙事层应建立在日志、事件和结果之上。", "原则")
            ],
            NoticeTitle = "重要提示",
            NoticeText = "CriptoVersus 是一个基于市场数据的实验性加密对战平台。规则、经济模型和集成可能会随着时间演进。本页面不代表任何财务收益承诺。"
        };
    }
    private RoadmapPageContent BuildEnglishPage(string canonicalUrl, string culture)
    {
        return new RoadmapPageContent
        {
            Culture = culture,
            PageTitle = "CriptoVersus Roadmap | Platform Evolution",
            MetaDescription = "Follow the public CriptoVersus roadmap: crypto matches, public match history, scoring rules, transparency, internationalization and future blockchain integrations.",
            CanonicalUrl = canonicalUrl,
            AlternateLinks =
            [
                new AlternateLink("en", SeoDefaults.BuildPublicAbsoluteUrl(_configuration, "/en/roadmap")),
                new AlternateLink("pt-BR", SeoDefaults.BuildPublicAbsoluteUrl(_configuration, "/pt/roadmap")),
                new AlternateLink("zh-CN", SeoDefaults.BuildPublicAbsoluteUrl(_configuration, "/zh/roadmap"))
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
                PrimaryCtaHref = _routeLocalization.BuildHomePath("en"),
                SecondaryCtaLabel = "Read the rules",
                SecondaryCtaHref = _routeLocalization.BuildHowItWorksPath("en")
            },
            StatusCards =
            [
                new RoadmapInfoCard("Active development", "The platform is evolving continuously with public releases and operational refinements.", "Active"),
                new RoadmapInfoCard("Automated crypto matches", "Market-based cycles between assets with score tracking and continuous updates.", "Automation"),
                new RoadmapInfoCard("Public history", "Results and match context are becoming increasingly visible for audit and review.", "Transparency"),
                new RoadmapInfoCard("Rules in evolution", "Scoring models and economic dynamics are still being tested and refined.", "Iteration"),
                new RoadmapInfoCard("Internationalization completed", "Localized routes, international SEO, hreflang and public language support have already been delivered.", "i18n-complete")
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
                new RoadmapPhase("Phase 5", "Internationalization", RoadmapPhaseStatus.Completed, "Multilingual routing, bilingual content and international SEO signals are already live in the public experience.",
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


