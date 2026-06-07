function setText(id, value) {
    const node = typeof document !== "undefined" ? document.getElementById(id) : null;
    if (node) {
        node.textContent = value;
    }
}

function setWidth(id, value) {
    const node = typeof document !== "undefined" ? document.getElementById(id) : null;
    if (node) {
        node.style.width = `${Math.max(0, Math.min(100, Number(value) || 0))}%`;
    }
}

function winnerClass(side) {
    return side === "left" ? "is-left" : side === "right" ? "is-right" : "";
}

function buildStatsMarkup(battleState) {
    const streakClass = winnerClass(battleState.streak?.winner);
    return `
<span class="tv-candle-battle-card__stats-title">ESTATISTICAS</span>
<div class="tv-candle-battle-card__stats-grid">
    <div class="tv-candle-battle-card__stats-row"><span>TOTAL DE CANDLES</span><strong>${battleState.summary.total}</strong></div>
    <div class="tv-candle-battle-card__stats-row"><span>${battleState.leftMeta.displayBase} VENCEU</span><strong class="is-left">${battleState.summary.leftWins}</strong></div>
    <div class="tv-candle-battle-card__stats-row"><span>${battleState.rightMeta.displayBase} VENCEU</span><strong class="is-right">${battleState.summary.rightWins}</strong></div>
    <div class="tv-candle-battle-card__stats-row"><span>EMPATES</span><strong>${battleState.summary.ties}</strong></div>
    <div class="tv-candle-battle-card__stats-row"><span>${battleState.leftMeta.displayBase} - LIQUIDO</span><strong class="is-left">${battleState.leftNet > 0 ? "+" : ""}${battleState.leftNet}</strong></div>
    <div class="tv-candle-battle-card__stats-row"><span>${battleState.rightMeta.displayBase} - LIQUIDO</span><strong class="is-right">${battleState.rightNet > 0 ? "+" : ""}${battleState.rightNet}</strong></div>
</div>
<div class="tv-candle-battle-card__stats-streak">
    <span>WIN STREAK ATUAL</span>
    <strong class="${streakClass}">${battleState.streakLabel}</strong>
</div>`;
}

function renderStatsPanel(id, battleState) {
    const node = typeof document !== "undefined" ? document.getElementById(id) : null;
    if (!node) {
        return;
    }

    const markup = buildStatsMarkup(battleState);
    if (node.dataset.statsMarkup === markup) {
        return;
    }

    node.dataset.statsMarkup = markup;
    node.innerHTML = markup;
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

    setText("tv-candle-battle-score-left", String(battleState.summary.leftWins));
    setText("tv-candle-battle-score-right", String(battleState.summary.rightWins));
    setText("tv-candle-battle-score-leader", buildLeaderLine(battleState));

    setText("tv-candle-battle-momentum-left", `${battleState.leftMeta.displayBase} ${battleState.momentum.leftPercent}%`);
    setText("tv-candle-battle-momentum-right", `${battleState.rightMeta.displayBase} ${battleState.momentum.rightPercent}%`);
    setWidth("tv-candle-battle-momentum-left-fill", battleState.momentum.leftPercent);
    setWidth("tv-candle-battle-momentum-right-fill", battleState.momentum.rightPercent);

    setText("tv-candle-battle-score-momentum-left", `${battleState.momentum.leftPercent}%`);
    setText("tv-candle-battle-score-momentum-right", `${battleState.momentum.rightPercent}%`);
    setWidth("tv-candle-battle-score-momentum-left-fill", battleState.momentum.leftPercent);
    setWidth("tv-candle-battle-score-momentum-right-fill", battleState.momentum.rightPercent);
    setText("tv-candle-battle-score-momentum-status", buildMomentumStatus(battleState));

    renderStatsPanel("tv-candle-battle-stats-left", battleState);
    renderStatsPanel("tv-candle-battle-stats-right", battleState);

    const root = typeof document !== "undefined" ? document.getElementById("tv-candle-battle-root") : null;
    if (root) {
        root.dataset.battleLeader = battleState.leader;
        root.dataset.battleMomentum = battleState.momentum.dominantSide;
    }
}
