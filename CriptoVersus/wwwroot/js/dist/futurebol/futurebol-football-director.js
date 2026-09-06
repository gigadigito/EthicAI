const RECENT_MEMORY_SIZE = 5;
const SCENARIO_WEIGHTS = {
    DirectAttack: 22,
    GiveAndGo: 18,
    CounterAttack: 14,
    ThroughBall: 16,
    WingAttack: 12,
    LongShot: 10,
    PressureAttack: 8
};
const REPETITION_PENALTY = 0.35;
const CONSECUTIVE_PENALTY = 0.55;
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
function deterministicUnit(seed, salt) {
    let value = (seed ^ Math.imul(salt, 0x9e3779b1)) >>> 0;
    value ^= value >>> 16;
    value = Math.imul(value, 0x7feb352d);
    value ^= value >>> 15;
    value = Math.imul(value, 0x846ca68b);
    value ^= value >>> 16;
    return (value >>> 0) / 4294967295;
}
function opponent(team) {
    return team === "home" ? "away" : "home";
}
export class FuturebolFootballDirector {
    constructor() {
        this.recentHistory = [];
    }
    decide(ctx) {
        const style = this.resolveStyle(ctx);
        const risk = this.resolveRisk(ctx);
        const adjusted = this.adjustWeights(ctx, style, risk);
        const selected = this.weightedSelect(adjusted, ctx);
        this.recordHistory(selected);
        return {
            scenario: selected,
            style,
            risk,
            reason: this.explainSelection(ctx, style, risk, selected)
        };
    }
    reset() {
        this.recentHistory = [];
    }
    diagnostics() {
        return {
            style: "Balanced",
            risk: 0.5,
            recentScenarios: [...this.recentHistory]
        };
    }
    resolveStyle(ctx) {
        const signedPressure = ctx.attackingTeam === "home"
            ? ctx.pressure
            : -ctx.pressure;
        const attackingMomentum = ctx.attackingTeam === "home"
            ? ctx.latestSnapshot?.home.momentum ?? 0
            : ctx.latestSnapshot?.away.momentum ?? 0;
        const progress = ctx.matchDurationSeconds > 0
            ? ctx.elapsedSeconds / ctx.matchDurationSeconds
            : 0;
        const attackingScore = ctx.attackingTeam === "home" ? ctx.homeScore : ctx.awayScore;
        const defendingScore = ctx.attackingTeam === "home" ? ctx.awayScore : ctx.homeScore;
        const scoreDiff = attackingScore - defendingScore;
        if (scoreDiff >= 2 && progress > 0.7)
            return "Controlled";
        if (scoreDiff <= -2 && progress > 0.7)
            return "Aggressive";
        if (signedPressure >= 0.6 && attackingMomentum > 0.3)
            return "Aggressive";
        if (signedPressure <= -0.3 && attackingMomentum < -0.2)
            return "Counter";
        if (Math.abs(signedPressure) < 0.15)
            return "Balanced";
        if (signedPressure > 0.3)
            return "Aggressive";
        if (signedPressure < -0.3)
            return "Counter";
        return "Balanced";
    }
    resolveRisk(ctx) {
        const progress = ctx.matchDurationSeconds > 0
            ? ctx.elapsedSeconds / ctx.matchDurationSeconds
            : 0;
        const attackingScore = ctx.attackingTeam === "home" ? ctx.homeScore : ctx.awayScore;
        const defendingScore = ctx.attackingTeam === "home" ? ctx.awayScore : ctx.homeScore;
        const scoreDiff = attackingScore - defendingScore;
        const signedPressure = ctx.attackingTeam === "home"
            ? ctx.pressure
            : -ctx.pressure;
        let risk = 0.5;
        risk += signedPressure * 0.2;
        risk -= scoreDiff * 0.08;
        if (progress > 0.8 && scoreDiff < 0)
            risk += 0.15;
        if (progress > 0.8 && scoreDiff > 0)
            risk -= 0.15;
        if (ctx.officialGoalPending)
            risk = Math.max(risk, 0.7);
        return clamp(risk, 0.1, 0.9);
    }
    adjustWeights(ctx, style, risk) {
        const weights = new Map();
        for (const [scenario, base] of Object.entries(SCENARIO_WEIGHTS)) {
            weights.set(scenario, base);
        }
        this.applyStyleWeights(weights, style);
        this.applyRiskWeights(weights, risk);
        this.applyMomentumWeights(weights, ctx);
        this.applyScoreWeights(weights, ctx);
        this.applyTimeWeights(weights, ctx);
        this.applyRepetitionPenalties(weights, ctx);
        this.applyGoalPendingConstraint(weights, ctx);
        return weights;
    }
    applyStyleWeights(weights, style) {
        switch (style) {
            case "Aggressive":
                this.boost(weights, "DirectAttack", 1.3);
                this.boost(weights, "PressureAttack", 1.5);
                this.boost(weights, "ThroughBall", 1.2);
                this.reduce(weights, "GiveAndGo", 0.7);
                this.reduce(weights, "WingAttack", 0.8);
                break;
            case "Counter":
                this.boost(weights, "CounterAttack", 1.6);
                this.boost(weights, "ThroughBall", 1.3);
                this.reduce(weights, "DirectAttack", 0.7);
                this.reduce(weights, "PressureAttack", 0.6);
                break;
            case "Controlled":
                this.boost(weights, "GiveAndGo", 1.4);
                this.boost(weights, "WingAttack", 1.3);
                this.reduce(weights, "DirectAttack", 0.7);
                this.reduce(weights, "LongShot", 0.6);
                this.reduce(weights, "PressureAttack", 0.5);
                break;
            case "Balanced":
                break;
        }
    }
    applyRiskWeights(weights, risk) {
        if (risk > 0.65) {
            this.boost(weights, "LongShot", 1.4);
            this.boost(weights, "PressureAttack", 1.3);
            this.boost(weights, "DirectAttack", 1.2);
            this.reduce(weights, "WingAttack", 0.7);
        }
        else if (risk < 0.35) {
            this.boost(weights, "WingAttack", 1.4);
            this.boost(weights, "GiveAndGo", 1.3);
            this.reduce(weights, "LongShot", 0.6);
            this.reduce(weights, "PressureAttack", 0.7);
        }
    }
    applyMomentumWeights(weights, ctx) {
        const attackingMomentum = ctx.attackingTeam === "home"
            ? ctx.latestSnapshot?.home.momentum ?? 0
            : ctx.latestSnapshot?.away.momentum ?? 0;
        if (attackingMomentum > 0.5) {
            this.boost(weights, "CounterAttack", 1.3);
            this.boost(weights, "ThroughBall", 1.2);
        }
        else if (attackingMomentum < -0.5) {
            this.boost(weights, "GiveAndGo", 1.2);
            this.boost(weights, "WingAttack", 1.1);
            this.reduce(weights, "CounterAttack", 0.7);
        }
    }
    applyScoreWeights(weights, ctx) {
        const attackingScore = ctx.attackingTeam === "home" ? ctx.homeScore : ctx.awayScore;
        const defendingScore = ctx.attackingTeam === "home" ? ctx.awayScore : ctx.homeScore;
        const scoreDiff = attackingScore - defendingScore;
        if (scoreDiff >= 2) {
            this.boost(weights, "GiveAndGo", 1.3);
            this.boost(weights, "WingAttack", 1.2);
            this.reduce(weights, "LongShot", 0.7);
        }
        else if (scoreDiff <= -2) {
            this.boost(weights, "DirectAttack", 1.3);
            this.boost(weights, "LongShot", 1.4);
            this.boost(weights, "PressureAttack", 1.2);
            this.reduce(weights, "WingAttack", 0.6);
        }
    }
    applyTimeWeights(weights, ctx) {
        const progress = ctx.matchDurationSeconds > 0
            ? ctx.elapsedSeconds / ctx.matchDurationSeconds
            : 0;
        const attackingScore = ctx.attackingTeam === "home" ? ctx.homeScore : ctx.awayScore;
        const defendingScore = ctx.attackingTeam === "home" ? ctx.awayScore : ctx.homeScore;
        const scoreDiff = attackingScore - defendingScore;
        if (progress > 0.8 && scoreDiff < 0) {
            this.boost(weights, "DirectAttack", 1.4);
            this.boost(weights, "LongShot", 1.5);
            this.boost(weights, "PressureAttack", 1.3);
            this.reduce(weights, "WingAttack", 0.5);
        }
        else if (progress > 0.8 && scoreDiff > 0) {
            this.boost(weights, "GiveAndGo", 1.3);
            this.boost(weights, "WingAttack", 1.2);
            this.reduce(weights, "DirectAttack", 0.7);
            this.reduce(weights, "LongShot", 0.6);
        }
    }
    applyRepetitionPenalties(weights, ctx) {
        const recent = ctx.recentScenarios.slice(-RECENT_MEMORY_SIZE);
        for (const scenario of recent) {
            const current = weights.get(scenario) ?? 0;
            weights.set(scenario, current * (1 - REPETITION_PENALTY));
        }
        if (recent.length >= 2) {
            const lastTwo = recent.slice(-2);
            if (lastTwo[0] === lastTwo[1]) {
                const current = weights.get(lastTwo[0]) ?? 0;
                weights.set(lastTwo[0], current * (1 - CONSECUTIVE_PENALTY));
            }
        }
        if (recent.length >= 3) {
            const lastThree = recent.slice(-3);
            const allSame = lastThree.every(s => s === lastThree[0]);
            if (allSame) {
                const current = weights.get(lastThree[0]) ?? 0;
                weights.set(lastThree[0], current * 0.2);
            }
        }
    }
    applyGoalPendingConstraint(weights, ctx) {
        if (!ctx.officialGoalPending)
            return;
        for (const [scenario, weight] of weights) {
            if (scenario === "DirectAttack" || scenario === "ThroughBall" || scenario === "LongShot") {
                weights.set(scenario, weight * 1.5);
            }
            else if (scenario === "WingAttack") {
                weights.set(scenario, weight * 0.8);
            }
        }
    }
    weightedSelect(weights, ctx) {
        let total = 0;
        const entries = [];
        for (const [scenario, weight] of weights) {
            const w = Math.max(0.01, weight);
            entries.push([scenario, w]);
            total += w;
        }
        const roll = deterministicUnit(ctx.seed, ctx.playIndex * 41 + 13) * total;
        let cumulative = 0;
        for (const [scenario, weight] of entries) {
            cumulative += weight;
            if (roll < cumulative)
                return scenario;
        }
        return entries[entries.length - 1][0];
    }
    recordHistory(scenario) {
        this.recentHistory.push(scenario);
        if (this.recentHistory.length > RECENT_MEMORY_SIZE) {
            this.recentHistory.shift();
        }
    }
    explainSelection(ctx, style, risk, selected) {
        return `style=${style} risk=${risk.toFixed(2)} pressure=${ctx.pressure.toFixed(2)} scenario=${selected}`;
    }
    boost(weights, key, factor) {
        const current = weights.get(key) ?? 0;
        weights.set(key, current * factor);
    }
    reduce(weights, key, factor) {
        const current = weights.get(key) ?? 0;
        weights.set(key, current * factor);
    }
}
