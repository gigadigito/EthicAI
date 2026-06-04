export type EventTypeConfig = {
    id: string;
    title: string;
    subtitleTemplate: string;
    iconAsset: string;
    accentColors: [string, string];
    glowColor: string;
    animationStyle: string;
    soundCueId: string;
    priorityLevel: number;
};

export const eventTypeConfig: Record<string, EventTypeConfig> = {
    "graph-crossover": { id: "graph-crossover", title: "CRUZAMENTO DE GRAFICO", subtitleTemplate: "{TEAM} virou o duelo ao cruzar a linha de valorizacao.", iconAsset: "graph-crossover.png", accentColors: ["#9a5cff", "#9cff2f"], glowColor: "rgba(151, 102, 255, 0.58)", animationStyle: "pulse-surge", soundCueId: "goal", priorityLevel: 5 },
    "momentum-surge": { id: "momentum-surge", title: "SURTO DE MOMENTUM", subtitleTemplate: "{TEAM} acelerou a pressao e conquistou {POINTS} ponto(s).", iconAsset: "momentum-surge.png", accentColors: ["#39e0ff", "#2f7cff"], glowColor: "rgba(67, 198, 255, 0.52)", animationStyle: "slide-burst", soundCueId: "momentum", priorityLevel: 4 },
    "dominance-streak": { id: "dominance-streak", title: "SEQUENCIA DE DOMINIO", subtitleTemplate: "{TEAM} manteve dominio continuo sobre a arena.", iconAsset: "dominance-streak.png", accentColors: ["#ffdd66", "#ff8a2a"], glowColor: "rgba(255, 188, 77, 0.5)", animationStyle: "hero-glow", soundCueId: "dominance", priorityLevel: 5 },
    "volatility-impact": { id: "volatility-impact", title: "IMPACTO DE VOLATILIDADE", subtitleTemplate: "{TEAM} converteu instabilidade em vantagem imediata.", iconAsset: "volatility-impact.png", accentColors: ["#ff567a", "#ff2fd2"], glowColor: "rgba(255, 77, 134, 0.52)", animationStyle: "shock-pulse", soundCueId: "volatility", priorityLevel: 5 },
    "defensive-hold": { id: "defensive-hold", title: "BLOQUEIO DEFENSIVO", subtitleTemplate: "{TEAM} segurou a pressao e preservou a vantagem.", iconAsset: "defensive-hold.png", accentColors: ["#56e0d0", "#8aa6bf"], glowColor: "rgba(86, 224, 208, 0.42)", animationStyle: "shield-rise", soundCueId: "defense", priorityLevel: 3 },
    "comeback-event": { id: "comeback-event", title: "EVENTO DE VIRADA", subtitleTemplate: "{TEAM} reagiu e retomou o ritmo da partida.", iconAsset: "comeback-event.png", accentColors: ["#c9ff4d", "#ffd44d"], glowColor: "rgba(210, 255, 83, 0.46)", animationStyle: "rebound-rise", soundCueId: "comeback", priorityLevel: 4 },
    "sentiment-goal": { id: "sentiment-goal", title: "GOL DE SENTIMENTO", subtitleTemplate: "{TEAM} capturou a onda social e ganhou tracao.", iconAsset: "sentiment-goal.png", accentColors: ["#ff67cf", "#8f58ff"], glowColor: "rgba(255, 103, 207, 0.48)", animationStyle: "crowd-wave", soundCueId: "sentiment", priorityLevel: 4 },
    "breakout-event": { id: "breakout-event", title: "EVENTO DE BREAKOUT", subtitleTemplate: "{TEAM} rompeu a faixa critica com impacto de {POINTS} ponto(s).", iconAsset: "breakout-event.png", accentColors: ["#79ff5b", "#ffffff"], glowColor: "rgba(121, 255, 91, 0.52)", animationStyle: "flash-break", soundCueId: "breakout", priorityLevel: 5 }
};
