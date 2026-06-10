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

    setText("tv-candle-battle-score-momentum-left", `${battleState.momentum.leftPercent}%`);
    setText("tv-candle-battle-score-momentum-right", `${battleState.momentum.rightPercent}%`);
    setWidth("tv-candle-battle-score-momentum-left-fill", battleState.momentum.leftPercent);
    setWidth("tv-candle-battle-score-momentum-right-fill", battleState.momentum.rightPercent);
    setText("tv-candle-battle-score-momentum-status", buildMomentumStatus(battleState));

    const root = typeof document !== "undefined" ? document.getElementById("tv-candle-battle-root") : null;
    if (root) {
        root.dataset.battleLeader = battleState.leader;
        root.dataset.battleMomentum = battleState.momentum.dominantSide;
    }
}
