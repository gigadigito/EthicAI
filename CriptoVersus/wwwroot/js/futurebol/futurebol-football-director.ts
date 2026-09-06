import type { FuturebolScenarioType, FuturebolAttackingStyle } from "./futurebol-action-types.js";
import type { FuturebolTeam, FuturebolMarketSnapshot } from "./futurebol-types.js";

export interface FootballDirectorContext {
    readonly attackingTeam: FuturebolTeam;
    readonly pressure: number;
    readonly homeScore: number;
    readonly awayScore: number;
    readonly elapsedSeconds: number;
    readonly matchDurationSeconds: number;
    readonly latestSnapshot: FuturebolMarketSnapshot | null;
    readonly officialGoalPending: boolean;
    readonly previousScenario: FuturebolScenarioType | null;
    readonly recentScenarios: readonly FuturebolScenarioType[];
    readonly seed: number;
    readonly playIndex: number;
}

export interface FootballDirectorDecision {
    readonly scenario: FuturebolScenarioType;
    readonly style: FuturebolAttackingStyle;
    readonly risk: number;
    readonly reason: string;
}

const RECENT_MEMORY_SIZE = 5;

const SCENARIO_WEIGHTS: Record<FuturebolScenarioType, number> = {
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

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function deterministicUnit(seed: number, salt: number): number {
    let value = (seed ^ Math.imul(salt, 0x9e3779b1)) >>> 0;
    value ^= value >>> 16;
    value = Math.imul(value, 0x7feb352d);
    value ^= value >>> 15;
    value = Math.imul(value, 0x846ca68b);
    value ^= value >>> 16;
    return (value >>> 0) / 4294967295;
}

function opponent(team: FuturebolTeam): FuturebolTeam {
    return team === "home" ? "away" : "home";
}

export class FuturebolFootballDirector {
    private recentHistory: FuturebolScenarioType[] = [];

    public decide(ctx: FootballDirectorContext): FootballDirectorDecision {
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

    public reset(): void {
        this.recentHistory = [];
    }

    public diagnostics(): {
        style: FuturebolAttackingStyle;
        risk: number;
        recentScenarios: readonly FuturebolScenarioType[];
    } {
        return {
            style: "Balanced",
            risk: 0.5,
            recentScenarios: [...this.recentHistory]
        };
    }

    private resolveStyle(ctx: FootballDirectorContext): FuturebolAttackingStyle {
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

        if (scoreDiff >= 2 && progress > 0.7) return "Controlled";
        if (scoreDiff <= -2 && progress > 0.7) return "Aggressive";

        if (signedPressure >= 0.6 && attackingMomentum > 0.3) return "Aggressive";
        if (signedPressure <= -0.3 && attackingMomentum < -0.2) return "Counter";

        if (Math.abs(signedPressure) < 0.15) return "Balanced";

        if (signedPressure > 0.3) return "Aggressive";
        if (signedPressure < -0.3) return "Counter";

        return "Balanced";
    }

    private resolveRisk(ctx: FootballDirectorContext): number {
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

        if (progress > 0.8 && scoreDiff < 0) risk += 0.15;
        if (progress > 0.8 && scoreDiff > 0) risk -= 0.15;

        if (ctx.officialGoalPending) risk = Math.max(risk, 0.7);

        return clamp(risk, 0.1, 0.9);
    }

    private adjustWeights(
        ctx: FootballDirectorContext,
        style: FuturebolAttackingStyle,
        risk: number
    ): Map<FuturebolScenarioType, number> {
        const weights = new Map<FuturebolScenarioType, number>();

        for (const [scenario, base] of Object.entries(SCENARIO_WEIGHTS)) {
            weights.set(scenario as FuturebolScenarioType, base);
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

    private applyStyleWeights(
        weights: Map<FuturebolScenarioType, number>,
        style: FuturebolAttackingStyle
    ): void {
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

    private applyRiskWeights(
        weights: Map<FuturebolScenarioType, number>,
        risk: number
    ): void {
        if (risk > 0.65) {
            this.boost(weights, "LongShot", 1.4);
            this.boost(weights, "PressureAttack", 1.3);
            this.boost(weights, "DirectAttack", 1.2);
            this.reduce(weights, "WingAttack", 0.7);
        } else if (risk < 0.35) {
            this.boost(weights, "WingAttack", 1.4);
            this.boost(weights, "GiveAndGo", 1.3);
            this.reduce(weights, "LongShot", 0.6);
            this.reduce(weights, "PressureAttack", 0.7);
        }
    }

    private applyMomentumWeights(
        weights: Map<FuturebolScenarioType, number>,
        ctx: FootballDirectorContext
    ): void {
        const attackingMomentum = ctx.attackingTeam === "home"
            ? ctx.latestSnapshot?.home.momentum ?? 0
            : ctx.latestSnapshot?.away.momentum ?? 0;

        if (attackingMomentum > 0.5) {
            this.boost(weights, "CounterAttack", 1.3);
            this.boost(weights, "ThroughBall", 1.2);
        } else if (attackingMomentum < -0.5) {
            this.boost(weights, "GiveAndGo", 1.2);
            this.boost(weights, "WingAttack", 1.1);
            this.reduce(weights, "CounterAttack", 0.7);
        }
    }

    private applyScoreWeights(
        weights: Map<FuturebolScenarioType, number>,
        ctx: FootballDirectorContext
    ): void {
        const attackingScore = ctx.attackingTeam === "home" ? ctx.homeScore : ctx.awayScore;
        const defendingScore = ctx.attackingTeam === "home" ? ctx.awayScore : ctx.homeScore;
        const scoreDiff = attackingScore - defendingScore;

        if (scoreDiff >= 2) {
            this.boost(weights, "GiveAndGo", 1.3);
            this.boost(weights, "WingAttack", 1.2);
            this.reduce(weights, "LongShot", 0.7);
        } else if (scoreDiff <= -2) {
            this.boost(weights, "DirectAttack", 1.3);
            this.boost(weights, "LongShot", 1.4);
            this.boost(weights, "PressureAttack", 1.2);
            this.reduce(weights, "WingAttack", 0.6);
        }
    }

    private applyTimeWeights(
        weights: Map<FuturebolScenarioType, number>,
        ctx: FootballDirectorContext
    ): void {
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
        } else if (progress > 0.8 && scoreDiff > 0) {
            this.boost(weights, "GiveAndGo", 1.3);
            this.boost(weights, "WingAttack", 1.2);
            this.reduce(weights, "DirectAttack", 0.7);
            this.reduce(weights, "LongShot", 0.6);
        }
    }

    private applyRepetitionPenalties(
        weights: Map<FuturebolScenarioType, number>,
        ctx: FootballDirectorContext
    ): void {
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

    private applyGoalPendingConstraint(
        weights: Map<FuturebolScenarioType, number>,
        ctx: FootballDirectorContext
    ): void {
        if (!ctx.officialGoalPending) return;

        for (const [scenario, weight] of weights) {
            if (scenario === "DirectAttack" || scenario === "ThroughBall" || scenario === "LongShot") {
                weights.set(scenario, weight * 1.5);
            } else if (scenario === "WingAttack") {
                weights.set(scenario, weight * 0.8);
            }
        }
    }

    private weightedSelect(
        weights: Map<FuturebolScenarioType, number>,
        ctx: FootballDirectorContext
    ): FuturebolScenarioType {
        let total = 0;
        const entries: [FuturebolScenarioType, number][] = [];

        for (const [scenario, weight] of weights) {
            const w = Math.max(0.01, weight);
            entries.push([scenario, w]);
            total += w;
        }

        const roll = deterministicUnit(ctx.seed, ctx.playIndex * 41 + 13) * total;
        let cumulative = 0;

        for (const [scenario, weight] of entries) {
            cumulative += weight;
            if (roll < cumulative) return scenario;
        }

        return entries[entries.length - 1][0];
    }

    private recordHistory(scenario: FuturebolScenarioType): void {
        this.recentHistory.push(scenario);
        if (this.recentHistory.length > RECENT_MEMORY_SIZE) {
            this.recentHistory.shift();
        }
    }

    private explainSelection(
        ctx: FootballDirectorContext,
        style: FuturebolAttackingStyle,
        risk: number,
        selected: FuturebolScenarioType
    ): string {
        return `style=${style} risk=${risk.toFixed(2)} pressure=${ctx.pressure.toFixed(2)} scenario=${selected}`;
    }

    private boost(weights: Map<FuturebolScenarioType, number>, key: FuturebolScenarioType, factor: number): void {
        const current = weights.get(key) ?? 0;
        weights.set(key, current * factor);
    }

    private reduce(weights: Map<FuturebolScenarioType, number>, key: FuturebolScenarioType, factor: number): void {
        const current = weights.get(key) ?? 0;
        weights.set(key, current * factor);
    }
}
