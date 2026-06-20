function setText(node, value) {
    if (node) {
        node.textContent = value;
    }
}

function setWidth(node, value) {
    if (node) {
        node.style.width = `${Math.max(0, Math.min(100, Number(value) || 0))}%`;
    }
}

function winnerClass(side) {
    return side === "left" ? "is-left" : side === "right" ? "is-right" : "";
}

function buildStatsMarkup(battleState) {
    const streakClass = winnerClass(battleState.streak?.winner);
    const leaderSide = battleState.leader === "left"
        ? battleState.leftMeta
        : battleState.leader === "right"
            ? battleState.rightMeta
            : null;
    const leaderPercent = battleState.leader === "left"
        ? battleState.leftScorePercent
        : battleState.leader === "right"
            ? battleState.rightScorePercent
            : 50;
    const leaderBadge = battleState.leader === "tie"
        ? "DISPUTA EQUILIBRADA"
        : `${leaderSide?.displayBase ?? "LIDER"} LIDER`;
    const leaderLabel = battleState.leader === "left"
        ? battleState.leftMeta.displayBase
        : battleState.leader === "right"
            ? battleState.rightMeta.displayBase
            : "EMPATE";
    const leftLiquidations = 0;
    const rightLiquidations = 0;

    return `
<div class="tv-candle-battle__sidebar-top">
    <div class="tv-candle-battle__sidebar-kicker">
        <span>PAINEL TATICO</span>
        <strong class="${battleState.leader === "left" ? "is-left" : battleState.leader === "right" ? "is-right" : ""}">${leaderBadge}</strong>
    </div>
    <div class="tv-candle-battle__sidebar-leader">
        <span>PERFORMANCE</span>
        <strong>${leaderLabel} ${leaderPercent}%</strong>
    </div>
</div>

<section class="tv-candle-battle__sidebar-section">
    <header class="tv-candle-battle__sidebar-section-head">
        <span>ESTATISTICAS GERAIS</span>
    </header>
    <div class="tv-candle-battle__sidebar-grid">
        <div class="tv-candle-battle__sidebar-row"><span>TOTAL DE CANDLES</span><strong>${battleState.summary.total}</strong></div>
        <div class="tv-candle-battle__sidebar-row"><span>${battleState.leftMeta.displayBase} VENCEU</span><strong class="is-left">${battleState.summary.leftWins}</strong></div>
        <div class="tv-candle-battle__sidebar-row"><span>${battleState.rightMeta.displayBase} VENCEU</span><strong class="is-right">${battleState.summary.rightWins}</strong></div>
        <div class="tv-candle-battle__sidebar-row"><span>EMPATES</span><strong>${battleState.summary.ties}</strong></div>
    </div>
</section>

<section class="tv-candle-battle__sidebar-section">
    <header class="tv-candle-battle__sidebar-section-head">
        <span>LIQUIDACOES</span>
    </header>
    <div class="tv-candle-battle__sidebar-grid">
        <div class="tv-candle-battle__sidebar-row"><span>${battleState.leftMeta.displayBase} LIQUIDADO</span><strong class="is-left">${leftLiquidations}</strong></div>
        <div class="tv-candle-battle__sidebar-row"><span>${battleState.rightMeta.displayBase} LIQUIDADO</span><strong class="is-right">${rightLiquidations}</strong></div>
    </div>
</section>

<section class="tv-candle-battle__sidebar-section">
    <header class="tv-candle-battle__sidebar-section-head">
        <span>MOMENTUM</span>
        <strong>${battleState.momentum.leftPercent}% / ${battleState.momentum.rightPercent}%</strong>
    </header>
    <div class="tv-candle-battle__sidebar-momentum" aria-hidden="true">
        <i class="tv-candle-battle__sidebar-momentum-fill tv-candle-battle__sidebar-momentum-fill--left" style="width:${battleState.momentum.leftPercent}%;"></i>
        <i class="tv-candle-battle__sidebar-momentum-fill tv-candle-battle__sidebar-momentum-fill--right" style="width:${battleState.momentum.rightPercent}%;"></i>
    </div>
    <small class="tv-candle-battle__sidebar-muted">${buildMomentumStatus(battleState)}</small>
</section>

<section class="tv-candle-battle__sidebar-section">
    <header class="tv-candle-battle__sidebar-section-head">
        <span>WIN STREAK</span>
    </header>
    <div class="tv-candle-battle__sidebar-streak">
        <span class="tv-candle-battle__sidebar-streak-icon ${streakClass}"></span>
        <div>
            <small>STREAK ATUAL</small>
            <strong class="${streakClass}">${battleState.streakLabel}</strong>
        </div>
    </div>
</section>

<section class="tv-candle-battle__sidebar-section">
    <header class="tv-candle-battle__sidebar-section-head">
        <span>PERFORMANCE</span>
        <strong class="tv-candle-battle__sidebar-badge">LIDER ${leaderPercent}%</strong>
    </header>
    <div class="tv-candle-battle__sidebar-performance">
        <div class="tv-candle-battle__sidebar-row"><span>${battleState.leftMeta.displayBase}</span><strong class="is-left">${battleState.leftScorePercent}%</strong></div>
        <div class="tv-candle-battle__sidebar-row"><span>${battleState.rightMeta.displayBase}</span><strong class="is-right">${battleState.rightScorePercent}%</strong></div>
    </div>
</section>`;
}

function renderStatsPanel(root, battleState, instanceId) {
    const ids = [
        `${instanceId}-stats-panel`,
        `${instanceId}-stats-left`,
        `${instanceId}-stats-right`
    ];
    const markup = buildStatsMarkup(battleState);
    let rendered = false;

    if (typeof document === "undefined" || !root) {
        return;
    }

    ids.forEach((panelId) => {
        const node = root.querySelector(`[id="${panelId}"]`);
        if (!node || node.dataset.statsMarkup === markup) {
            return;
        }

        node.dataset.statsMarkup = markup;
        node.innerHTML = markup;
        rendered = true;
    });

    return rendered;
}

function buildLeaderLine(battleState) {
    if (battleState.leader === "left") {
        return `${battleState.leftMeta.displayBase} NA FRENTE`;
    }

    if (battleState.leader === "right") {
        return `${battleState.rightMeta.displayBase} NA FRENTE`;
    }

    return "MOMENTUM NEUTRO";
}

function buildMomentumStatus(battleState) {
    if (battleState.momentum.dominantSide === "left") {
        return `${battleState.leftMeta.displayBase} PRESSIONA`;
    }

    if (battleState.momentum.dominantSide === "right") {
        return `${battleState.rightMeta.displayBase} PRESSIONA`;
    }

    return "DISPUTA EQUILIBRADA";
}

export function renderCandleBattleHud(battleState) {
    if (!battleState) {
        return;
    }

    if (typeof document === "undefined") {
        return;
    }

    const roots = Array.from(document.querySelectorAll("[data-tv-candle-battle-instance]"));
    roots.forEach((root) => {
        const instanceId = root.dataset.tvCandleBattleInstance || root.id || "tv-candle-battle-root";
        setText(root.querySelector(`[id="${instanceId}-score-left"]`), String(battleState.summary.leftWins));
        setText(root.querySelector(`[id="${instanceId}-score-right"]`), String(battleState.summary.rightWins));
        setText(root.querySelector(`[id="${instanceId}-score-leader"]`), buildLeaderLine(battleState));

        setText(root.querySelector(`[id="${instanceId}-score-momentum-left"]`), `${battleState.momentum.leftPercent}%`);
        setText(root.querySelector(`[id="${instanceId}-score-momentum-right"]`), `${battleState.momentum.rightPercent}%`);
        setWidth(root.querySelector(`[id="${instanceId}-score-momentum-left-fill"]`), battleState.momentum.leftPercent);
        setWidth(root.querySelector(`[id="${instanceId}-score-momentum-right-fill"]`), battleState.momentum.rightPercent);
        setText(root.querySelector(`[id="${instanceId}-score-momentum-status"]`), buildMomentumStatus(battleState));

        //renderStatsPanel(root, battleState, instanceId);
        // O painel tático agora é controlado pelo TvCandleBattle.razor.
        // Não sobrescrever HTML renderizado pelo Razor.
        root.dataset.battleLeader = battleState.leader;
        root.dataset.battleMomentum = battleState.momentum.dominantSide;
    });
}
