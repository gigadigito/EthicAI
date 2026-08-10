import type {
    FuturebolBallState,
    FuturebolMarketSnapshot,
    FuturebolPlayerAnimation,
    FuturebolPlayerState,
    FuturebolPlayOutcome,
    FuturebolPlayPhase,
    FuturebolPressureOverride,
    FuturebolRole,
    FuturebolTeam,
    FuturebolVector3State
} from "./futurebol-types.js";
import { FUTUREBOL_ACTION_TIMING, hasReachedContact } from "./futurebol-action-timing.js";

const FIELD_HALF_LENGTH = 23;
const FIELD_HALF_WIDTH = 13;
const BALL_LIMIT_X = 27;
const GOAL_LINE_X = 25;
const PASS_DURATION = 0.92;
const SHOT_DURATION = 0.76;

interface FormationPlayer {
    id: string;
    team: FuturebolTeam;
    role: FuturebolRole;
    neutral: FuturebolVector3State;
    speed: number;
}

const FORMATION: FormationPlayer[] = [
    { id: "home-goalkeeper", team: "home", role: "goalkeeper", neutral: point(-21.2, 0, 0), speed: 3.2 },
    { id: "home-defender", team: "home", role: "defender", neutral: point(-11, 0, 4.7), speed: 4.1 },
    { id: "home-attacker", team: "home", role: "attacker", neutral: point(-3.5, 0, -3), speed: 5.2 },
    { id: "away-goalkeeper", team: "away", role: "goalkeeper", neutral: point(21.2, 0, 0), speed: 3.2 },
    { id: "away-defender", team: "away", role: "defender", neutral: point(11, 0, -4.7), speed: 4.1 },
    { id: "away-attacker", team: "away", role: "attacker", neutral: point(3.5, 0, 3), speed: 5.2 }
];

export class FuturebolMatchState {
    public readonly players: FuturebolPlayerState[];
    public readonly ballPosition = point(0, 0.55, 0);
    public readonly ballTarget = point(0, 0.55, 0);
    public elapsedSeconds = 0;
    public pressure = 0;
    public latestSnapshot: FuturebolMarketSnapshot | null = null;
    public currentBallOwnerId: string | null = null;
    public lastBallOwnerId: string | null = null;
    public intendedReceiverId: string | null = null;
    public ballState: FuturebolBallState = "Free";
    public currentPlayPhase: FuturebolPlayPhase = "Neutral";
    public activeTeam: FuturebolTeam | null = null;
    public homeScore = 0;
    public awayScore = 0;
    public cooldownRemainingSeconds = 0;
    public get lastPlayOutcome(): FuturebolPlayOutcome | null {
        return this.currentPlayPhase === "Outcome" ? this.currentOutcome : null;
    }

    private readonly seedHash: number;
    private readonly passStart = point(0, 0.55, 0);
    private readonly passEnd = point(0, 0.55, 0);
    private readonly shotStart = point(0, 0.55, 0);
    private readonly shotEnd = point(0, 0.55, 0);
    private phaseElapsed = 0;
    private playIndex = 0;
    private homeOffensiveSeconds = 0;
    private awayOffensiveSeconds = 0;
    private pendingOutcome: FuturebolPlayOutcome | null = null;
    private currentOutcome: FuturebolPlayOutcome = "Saved";
    private outcomeHoldSeconds = 1.2;
    private activeLane = 0;

    public constructor(seed = "futurebol-demo-001") {
        this.seedHash = hashString(seed);
        this.players = FORMATION.map(entry => ({
            id: entry.id,
            team: entry.team,
            role: entry.role,
            position: { ...entry.neutral },
            targetPosition: { ...entry.neutral },
            movementSpeed: entry.speed,
            currentSpeed: 0,
            facingAngle: entry.team === "home" ? 0 : Math.PI,
            animation: entry.role === "goalkeeper" ? "goalkeeper-ready" : "idle",
            animationTime: 0,
            actionProgress: 0
        }));
    }

    public applyMarket(snapshot: FuturebolMarketSnapshot, override: FuturebolPressureOverride): void {
        this.latestSnapshot = snapshot;
        this.pressure = resolvePressure(snapshot, override);
        if (this.currentPlayPhase === "Neutral" || this.currentPlayPhase === "Cooldown")
            this.applyNeutralFormation(snapshot.sequence);
    }

    public update(deltaSeconds: number): void {
        const safeDelta = clamp(deltaSeconds, 0, 0.1);
        this.elapsedSeconds += safeDelta;
        this.phaseElapsed += safeDelta;

        this.updateAutomaticPlayTrigger(safeDelta);
        this.updatePlayPhase();
        this.preventTargetOverlaps();
        this.movePlayers(safeDelta);
        this.separatePlayerPositions();
        this.updateControlledBall(safeDelta);
        this.updateFacingAndAnimation(safeDelta);
    }

    public forcePass(team: FuturebolTeam): void {
        this.startPlay(team, null);
        this.phaseElapsed = 1.05;
    }

    public forceShot(team: FuturebolTeam, outcome: FuturebolPlayOutcome | null = null): void {
        this.startPlay(team, outcome);
        this.transitionToAttacking();
        this.phaseElapsed = 1.15;
    }

    public forceOutcome(outcome: FuturebolPlayOutcome): void {
        this.pendingOutcome = outcome;
        this.currentOutcome = outcome;
        if (this.currentPlayPhase === "Shooting")
            this.configureShotEnd();
        else if (this.activeTeam === null)
            this.forceShot(this.pressure < 0 ? "away" : "home", outcome);
    }

    public resetPlay(): void {
        this.beginResetting();
    }

    public reset(): void {
        this.elapsedSeconds = 0;
        this.pressure = 0;
        this.latestSnapshot = null;
        this.homeScore = 0;
        this.awayScore = 0;
        this.playIndex = 0;
        this.pendingOutcome = null;
        this.homeOffensiveSeconds = 0;
        this.awayOffensiveSeconds = 0;
        this.resetPlayState("Neutral");

        this.players.forEach((player, index) => {
            const formation = FORMATION[index];
            Object.assign(player.position, formation.neutral);
            Object.assign(player.targetPosition, formation.neutral);
            player.currentSpeed = 0;
            player.facingAngle = player.team === "home" ? 0 : Math.PI;
            player.animation = player.role === "goalkeeper" ? "goalkeeper-ready" : "idle";
            player.animationTime = 0;
            player.actionProgress = 0;
        });
    }

    private updateAutomaticPlayTrigger(deltaSeconds: number): void {
        if (this.currentPlayPhase === "Cooldown") {
            this.cooldownRemainingSeconds = Math.max(0, this.cooldownRemainingSeconds - deltaSeconds);
            if (this.cooldownRemainingSeconds === 0) {
                this.currentPlayPhase = "Neutral";
                this.phaseElapsed = 0;
            }
            return;
        }

        if (this.currentPlayPhase !== "Neutral")
            return;

        this.homeOffensiveSeconds = this.pressure > 0.32
            ? this.homeOffensiveSeconds + deltaSeconds
            : Math.max(0, this.homeOffensiveSeconds - deltaSeconds * 1.8);
        this.awayOffensiveSeconds = this.pressure < -0.32
            ? this.awayOffensiveSeconds + deltaSeconds
            : Math.max(0, this.awayOffensiveSeconds - deltaSeconds * 1.8);

        if (this.homeOffensiveSeconds >= 3.2)
            this.startPlay("home", null);
        else if (this.awayOffensiveSeconds >= 3.2)
            this.startPlay("away", null);
    }

    private updatePlayPhase(): void {
        this.releaseTransientAnimations();
        switch (this.currentPlayPhase) {
            case "Neutral":
            case "Cooldown":
                this.ballState = "Free";
                this.ballTarget.x = 0;
                this.ballTarget.y = 0.55;
                this.ballTarget.z = 0;
                break;
            case "BuildUp":
                this.updateBuildUp();
                break;
            case "Passing":
                this.updatePass();
                break;
            case "Attacking":
                this.updateAttack();
                break;
            case "PreparingShot":
                this.updateShotPreparation();
                break;
            case "Shooting":
                this.updateShot();
                break;
            case "Outcome":
                this.updateOutcome();
                break;
            case "Resetting":
                this.updateResetting();
                break;
        }
    }

    private releaseTransientAnimations(): void {
        for (const player of this.players) {
            if (player.animation !== "kick" && player.animation !== "goalkeeper-dive")
                continue;
            player.animation = player.role === "goalkeeper" ? "goalkeeper-ready" : "idle";
            player.actionProgress = 0;
        }
    }

    private startPlay(team: FuturebolTeam, outcome: FuturebolPlayOutcome | null): void {
        this.playIndex += 1;
        this.activeTeam = team;
        this.activeLane = deterministicSigned(this.seedHash, this.playIndex * 7 + (team === "home" ? 1 : 2)) * 2.8;
        this.pendingOutcome = outcome;
        this.currentOutcome = outcome ?? this.resolveOutcome(team);
        this.currentPlayPhase = "BuildUp";
        this.phaseElapsed = 0;
        this.cooldownRemainingSeconds = 0;
        this.homeOffensiveSeconds = 0;
        this.awayOffensiveSeconds = 0;
        this.intendedReceiverId = this.playerId(team, "attacker");
        this.setOwner(this.playerId(team, "defender"));
        this.ballState = "Controlled";
    }

    private updateBuildUp(): void {
        const team = this.requireActiveTeam();
        const direction = attackDirection(team);
        const defender = this.getPlayer(this.playerId(team, "defender"));
        const attacker = this.getPlayer(this.playerId(team, "attacker"));
        this.positionTeamsForPlay(team, defender.position.x, this.activeLane);

        defender.targetPosition.x = clamp(this.neutralFor(defender).x + direction * Math.min(4.5, this.phaseElapsed * 2.7), -17, 17);
        defender.targetPosition.z = this.activeLane * 0.7;
        attacker.targetPosition.x = direction * 1.8;
        attacker.targetPosition.z = this.activeLane - direction * 2.6;
        this.setOwner(defender.id);
        this.intendedReceiverId = attacker.id;
        this.ballState = "Controlled";
        const contactProgress = clamp(
            (this.phaseElapsed - FUTUREBOL_ACTION_TIMING.passPreparationStartSeconds) / FUTUREBOL_ACTION_TIMING.passDurationSeconds,
            0,
            1
        );
        if (contactProgress > 0) {
            defender.animation = "kick";
            defender.actionProgress = contactProgress;
        }
        if (hasReachedContact(contactProgress, FUTUREBOL_ACTION_TIMING.passContactRatio))
            this.beginPass(defender, attacker);
    }

    private beginPass(defender: FuturebolPlayerState, attacker: FuturebolPlayerState): void {
        copyPoint(this.passStart, this.ballPosition);
        this.passEnd.x = attacker.targetPosition.x + attackDirection(attacker.team) * 1.8;
        this.passEnd.y = 0.55;
        this.passEnd.z = attacker.targetPosition.z;
        copyPoint(this.ballTarget, this.passEnd);
        this.lastBallOwnerId = defender.id;
        this.currentBallOwnerId = null;
        this.intendedReceiverId = attacker.id;
        this.ballState = "Passing";
        this.currentPlayPhase = "Passing";
        this.phaseElapsed = 0;
        defender.animation = "kick";
        defender.actionProgress = FUTUREBOL_ACTION_TIMING.passContactRatio;
    }

    private updatePass(): void {
        const team = this.requireActiveTeam();
        const passer = this.getPlayer(this.playerId(team, "defender"));
        const receiver = this.getPlayer(this.intendedReceiverId ?? this.playerId(team, "attacker"));
        const progress = clamp(this.phaseElapsed / PASS_DURATION, 0, 1);

        this.positionTeamsForPlay(team, lerp(this.passStart.x, this.passEnd.x, progress), this.passEnd.z);
        receiver.targetPosition.x = this.passEnd.x;
        receiver.targetPosition.z = this.passEnd.z;
        passer.animation = "kick";
        passer.actionProgress = clamp(FUTUREBOL_ACTION_TIMING.passContactRatio + progress * (1 - FUTUREBOL_ACTION_TIMING.passContactRatio), 0, 1);
        this.setBallArc(this.passStart, this.passEnd, progress, 1.35);

        if (progress >= 1) {
            this.setOwner(receiver.id);
            this.intendedReceiverId = null;
            this.ballState = "Controlled";
            this.transitionToAttacking();
        }
    }

    private transitionToAttacking(): void {
        const team = this.requireActiveTeam();
        this.currentPlayPhase = "Attacking";
        this.phaseElapsed = 0;
        this.setOwner(this.playerId(team, "attacker"));
        this.intendedReceiverId = null;
        this.ballState = "Controlled";
    }

    private updateAttack(): void {
        const team = this.requireActiveTeam();
        const direction = attackDirection(team);
        const attacker = this.getPlayer(this.playerId(team, "attacker"));
        const defender = this.getPlayer(this.playerId(team, "defender"));
        const runProgress = smoothStep(clamp(this.phaseElapsed / 2.55, 0, 1));

        this.positionTeamsForPlay(team, attacker.position.x, this.activeLane);
        attacker.targetPosition.x = lerp(direction * 3.2, direction * 18.1, runProgress);
        attacker.targetPosition.z = lerp(this.activeLane, this.activeLane * 0.42, runProgress);
        defender.targetPosition.x = clamp(attacker.targetPosition.x - direction * 7.2, -16, 16);
        defender.targetPosition.z = this.activeLane + direction * 3.2;
        this.setOwner(attacker.id);
        this.ballState = "Controlled";

        if (this.phaseElapsed >= 2.55) {
            this.currentPlayPhase = "PreparingShot";
            this.phaseElapsed = 0;
            attacker.targetPosition.x = clamp(attacker.position.x + direction * 0.8, -19.5, 19.5);
        }
    }

    private updateShotPreparation(): void {
        const team = this.requireActiveTeam();
        const attacker = this.getPlayer(this.playerId(team, "attacker"));
        this.positionTeamsForPlay(team, attacker.position.x, attacker.position.z);
        attacker.targetPosition.x = clamp(attacker.position.x + attackDirection(team) * 0.14, -19.5, 19.5);
        attacker.targetPosition.z = attacker.position.z;
        attacker.animation = "kick";
        attacker.actionProgress = clamp(this.phaseElapsed / FUTUREBOL_ACTION_TIMING.shootDurationSeconds, 0, 1);
        this.setOwner(attacker.id);
        this.ballState = "Controlled";

        if (hasReachedContact(attacker.actionProgress, FUTUREBOL_ACTION_TIMING.shootContactRatio))
            this.launchShot(attacker);
    }

    private launchShot(attacker: FuturebolPlayerState): void {
        copyPoint(this.shotStart, this.ballPosition);
        this.currentOutcome = this.pendingOutcome ?? this.currentOutcome;
        this.configureShotEnd();
        this.lastBallOwnerId = attacker.id;
        this.currentBallOwnerId = null;
        this.ballState = "Shooting";
        this.currentPlayPhase = "Shooting";
        this.phaseElapsed = 0;
    }

    private configureShotEnd(): void {
        const team = this.requireActiveTeam();
        const direction = attackDirection(team);
        const laneVariance = deterministicSigned(this.seedHash, this.playIndex * 13 + 5) * 2.35;
        this.shotEnd.x = direction * (this.currentOutcome === "Goal" ? GOAL_LINE_X + 1.35 : GOAL_LINE_X - 2.5);
        this.shotEnd.y = this.currentOutcome === "Goal" ? 1.05 : 0.85;
        this.shotEnd.z = clamp(this.activeLane * 0.25 + laneVariance, -2.8, 2.8);
        copyPoint(this.ballTarget, this.shotEnd);
    }

    private updateShot(): void {
        const team = this.requireActiveTeam();
        const goalkeeper = this.getPlayer(this.playerId(opponent(team), "goalkeeper"));
        const attacker = this.getPlayer(this.playerId(team, "attacker"));
        const progress = clamp(this.phaseElapsed / SHOT_DURATION, 0, 1);

        this.positionTeamsForPlay(team, lerp(this.shotStart.x, this.shotEnd.x, progress), this.shotEnd.z);
        goalkeeper.targetPosition.z = clamp(this.shotEnd.z * 0.92, -3.1, 3.1);
        goalkeeper.animation = "goalkeeper-dive";
        goalkeeper.actionProgress = smoothStep(progress);
        attacker.animation = "kick";
        attacker.actionProgress = clamp(0.62 + progress * 0.38, 0, 1);
        this.setBallArc(this.shotStart, this.shotEnd, progress, 2.35);

        if (progress >= 1)
            this.finishShot(goalkeeper);
    }

    private finishShot(goalkeeper: FuturebolPlayerState): void {
        this.currentPlayPhase = "Outcome";
        this.phaseElapsed = 0;
        this.pendingOutcome = null;

        if (this.currentOutcome === "Goal") {
            if (this.activeTeam === "home") this.homeScore += 1;
            else this.awayScore += 1;
            this.ballState = "Free";
            this.currentBallOwnerId = null;
            this.outcomeHoldSeconds = 1.75;
        } else {
            this.ballState = "Saved";
            this.setOwner(goalkeeper.id);
            this.outcomeHoldSeconds = 1.2;
        }
    }

    private updateOutcome(): void {
        const team = this.requireActiveTeam();
        const goalkeeper = this.getPlayer(this.playerId(opponent(team), "goalkeeper"));
        this.positionTeamsForPlay(team, this.ballPosition.x, this.ballPosition.z);

        if (this.currentOutcome === "Saved") {
            goalkeeper.animation = "goalkeeper-dive";
            goalkeeper.actionProgress = clamp(1 - this.phaseElapsed / this.outcomeHoldSeconds * 0.25, 0.72, 1);
            this.ballTarget.x = goalkeeper.position.x - attackDirection(team) * 0.38;
            this.ballTarget.y = 0.68;
            this.ballTarget.z = goalkeeper.position.z;
        }

        if (this.phaseElapsed >= this.outcomeHoldSeconds)
            this.beginResetting();
    }

    private beginResetting(): void {
        this.currentPlayPhase = "Resetting";
        this.ballState = "Resetting";
        this.currentBallOwnerId = null;
        this.intendedReceiverId = null;
        this.phaseElapsed = 0;
        this.ballTarget.x = 0;
        this.ballTarget.y = 0.55;
        this.ballTarget.z = 0;
        this.applyNeutralFormation(0);
    }

    private updateResetting(): void {
        this.applyNeutralFormation(0);
        this.ballTarget.x = 0;
        this.ballTarget.y = 0.55;
        this.ballTarget.z = 0;

        if (this.phaseElapsed >= 2.1) {
            this.ballPosition.x = 0;
            this.ballPosition.y = 0.55;
            this.ballPosition.z = 0;
            this.currentPlayPhase = "Cooldown";
            this.ballState = "Free";
            this.activeTeam = null;
            this.phaseElapsed = 0;
            this.cooldownRemainingSeconds = 15 + deterministicUnit(this.seedHash, this.playIndex * 19 + 9) * 10;
        }
    }

    private positionTeamsForPlay(attackingTeam: FuturebolTeam, activeX: number, activeZ: number): void {
        const direction = attackDirection(attackingTeam);
        for (let index = 0; index < this.players.length; index++) {
            const player = this.players[index];
            const variation = Math.sin(this.elapsedSeconds * 0.78 + index * 1.91 + this.seedHash * 0.00001) * 0.42;
            const ownDirection = attackDirection(player.team);

            if (player.role === "goalkeeper") {
                player.targetPosition.x = ownDirection * -21.25;
                player.targetPosition.z = clamp(activeZ * 0.16 + variation * 0.25, -2.2, 2.2);
                continue;
            }

            if (player.team === attackingTeam) {
                if (player.role === "defender") {
                    player.targetPosition.x = clamp(activeX - direction * 7.2, -16.5, 16.5);
                    player.targetPosition.z = clamp(activeZ + direction * 3.1 + variation, -9.5, 9.5);
                } else {
                    player.targetPosition.x = clamp(activeX + direction * 1.4, -19.5, 19.5);
                    player.targetPosition.z = clamp(activeZ + variation, -8.5, 8.5);
                }
            } else if (player.role === "defender") {
                player.targetPosition.x = clamp(activeX + direction * 4.4, -18.2, 18.2);
                player.targetPosition.z = clamp(activeZ * 0.78 + variation, -8.5, 8.5);
            } else {
                player.targetPosition.x = clamp(activeX - direction * 7.8, -13, 13);
                player.targetPosition.z = clamp(-activeZ * 0.45 + variation, -8.5, 8.5);
            }
        }
    }

    private applyNeutralFormation(_sequence: number): void {
        const shouldStandStill =
            this.currentPlayPhase === "Neutral" ||
            this.currentPlayPhase === "Cooldown";

        for (let index = 0; index < this.players.length; index++) {
            const player = this.players[index];
            const formation = FORMATION[index];

            /*
             * A formação neutra deve ser fixa.
             *
             * O código anterior usava seno/cosseno com elapsedSeconds e
             * sequence, alterando continuamente targetPosition. Isso fazia
             * os jogadores caminharem de um lado para o outro antes da jogada.
             *
             * A pressão continua sendo usada para decidir quando uma jogada
             * começa, mas não movimenta visualmente os jogadores em Neutral.
             */
            player.targetPosition.x = formation.neutral.x;
            player.targetPosition.y = formation.neutral.y;
            player.targetPosition.z = formation.neutral.z;

            /*
             * Quando já chegaram praticamente ao ponto neutro, elimina os
             * resíduos de interpolação para evitar passos e rotações mínimos.
             * Durante Resetting eles ainda caminham normalmente até a formação.
             */
            if (shouldStandStill) {
                const distanceToNeutral = Math.hypot(
                    player.position.x - formation.neutral.x,
                    player.position.z - formation.neutral.z
                );

                if (distanceToNeutral <= 0.04) {
                    player.position.x = formation.neutral.x;
                    player.position.y = formation.neutral.y;
                    player.position.z = formation.neutral.z;
                    player.currentSpeed = 0;
                    player.animation = player.role === "goalkeeper"
                        ? "goalkeeper-ready"
                        : "idle";
                    player.actionProgress = 0;
                }
            }
        }
    }

    private preventTargetOverlaps(): void {
        const minimumDistance = 1.75;
        for (let first = 0; first < this.players.length; first++) {
            for (let second = first + 1; second < this.players.length; second++) {
                const a = this.players[first];
                const b = this.players[second];
                const dx = b.targetPosition.x - a.targetPosition.x;
                const dz = b.targetPosition.z - a.targetPosition.z;
                const distanceSquared = dx * dx + dz * dz;
                if (distanceSquared >= minimumDistance * minimumDistance)
                    continue;

                const distance = Math.max(0.001, Math.sqrt(distanceSquared));
                const push = (minimumDistance - distance) * 0.5;
                const nx = distance > 0.01 ? dx / distance : (first % 2 === 0 ? 1 : -1);
                const nz = distance > 0.01 ? dz / distance : (second % 2 === 0 ? 1 : -1);
                a.targetPosition.x = clamp(a.targetPosition.x - nx * push, -FIELD_HALF_LENGTH, FIELD_HALF_LENGTH);
                a.targetPosition.z = clamp(a.targetPosition.z - nz * push, -FIELD_HALF_WIDTH, FIELD_HALF_WIDTH);
                b.targetPosition.x = clamp(b.targetPosition.x + nx * push, -FIELD_HALF_LENGTH, FIELD_HALF_LENGTH);
                b.targetPosition.z = clamp(b.targetPosition.z + nz * push, -FIELD_HALF_WIDTH, FIELD_HALF_WIDTH);
            }
        }
    }

    private separatePlayerPositions(): void {
        const minimumDistance = 1.32;
        for (let first = 0; first < this.players.length; first++) {
            for (let second = first + 1; second < this.players.length; second++) {
                const a = this.players[first];
                const b = this.players[second];
                const dx = b.position.x - a.position.x;
                const dz = b.position.z - a.position.z;
                const distanceSquared = dx * dx + dz * dz;
                if (distanceSquared >= minimumDistance * minimumDistance)
                    continue;

                const distance = Math.max(0.001, Math.sqrt(distanceSquared));
                const nx = distance > 0.01 ? dx / distance : (first % 2 === 0 ? 1 : -1);
                const nz = distance > 0.01 ? dz / distance : (second % 2 === 0 ? 1 : -1);
                const overlap = minimumDistance - distance;
                const aShare = a.role === "goalkeeper" ? 0 : b.role === "goalkeeper" ? 1 : 0.5;
                const bShare = b.role === "goalkeeper" ? 0 : a.role === "goalkeeper" ? 1 : 0.5;
                a.position.x = clamp(a.position.x - nx * overlap * aShare, -FIELD_HALF_LENGTH, FIELD_HALF_LENGTH);
                a.position.z = clamp(a.position.z - nz * overlap * aShare, -FIELD_HALF_WIDTH, FIELD_HALF_WIDTH);
                b.position.x = clamp(b.position.x + nx * overlap * bShare, -FIELD_HALF_LENGTH, FIELD_HALF_LENGTH);
                b.position.z = clamp(b.position.z + nz * overlap * bShare, -FIELD_HALF_WIDTH, FIELD_HALF_WIDTH);
            }
        }
    }

    private movePlayers(deltaSeconds: number): void {
        for (const player of this.players) {
            const previousX = player.position.x;
            const previousZ = player.position.z;
            const distance = Math.hypot(player.targetPosition.x - previousX, player.targetPosition.z - previousZ);
            const maxStep = player.movementSpeed * deltaSeconds;
            const step = distance > 0.001 ? Math.min(1, maxStep / distance) : 1;

            player.position.x = clamp(lerp(previousX, player.targetPosition.x, step), -FIELD_HALF_LENGTH, FIELD_HALF_LENGTH);
            player.position.z = clamp(lerp(previousZ, player.targetPosition.z, step), -FIELD_HALF_WIDTH, FIELD_HALF_WIDTH);
            player.currentSpeed = deltaSeconds > 0 ? Math.hypot(player.position.x - previousX, player.position.z - previousZ) / deltaSeconds : 0;
        }
    }

    private updateControlledBall(deltaSeconds: number): void {
        if (this.ballState === "Passing" || this.ballState === "Shooting")
            return;

        if (this.ballState === "Controlled" && this.currentBallOwnerId) {
            const owner = this.getPlayer(this.currentBallOwnerId);
            const directionX = Math.cos(owner.facingAngle);
            const directionZ = Math.sin(owner.facingAngle);
            const sideX = -directionZ;
            const sideZ = directionX;
            const dribble = Math.sin(owner.animationTime * 2) * Math.min(0.14, owner.currentSpeed * 0.025);
            this.ballTarget.x = owner.position.x + directionX * (0.76 + dribble) + sideX * 0.19;
            this.ballTarget.y = 0.55 + Math.abs(Math.sin(owner.animationTime * 2)) * Math.min(0.1, owner.currentSpeed * 0.018);
            this.ballTarget.z = owner.position.z + directionZ * (0.76 + dribble) + sideZ * 0.19;
        }

        const responsiveness = this.ballState === "Controlled" ? 12 : this.ballState === "Resetting" ? 2.1 : 3.1;
        const blend = 1 - Math.exp(-responsiveness * deltaSeconds);
        this.ballPosition.x = clamp(lerp(this.ballPosition.x, this.ballTarget.x, blend), -BALL_LIMIT_X, BALL_LIMIT_X);
        this.ballPosition.y = lerp(this.ballPosition.y, this.ballTarget.y, blend);
        this.ballPosition.z = clamp(lerp(this.ballPosition.z, this.ballTarget.z, blend), -FIELD_HALF_WIDTH, FIELD_HALF_WIDTH);
    }

    private updateFacingAndAnimation(deltaSeconds: number): void {
        for (const player of this.players) {
            let desiredAngle = player.facingAngle;
            const moveX = player.targetPosition.x - player.position.x;
            const moveZ = player.targetPosition.z - player.position.z;
            const distanceToBall = Math.hypot(this.ballPosition.x - player.position.x, this.ballPosition.z - player.position.z);

            if (player.animation === "kick") {
                const target = this.currentPlayPhase === "Passing" && this.intendedReceiverId
                    ? this.getPlayer(this.intendedReceiverId).position
                    : pointForGoal(player.team);
                desiredAngle = Math.atan2(target.z - player.position.z, target.x - player.position.x);
            } else if (player.role === "goalkeeper") {
                desiredAngle = Math.atan2(this.ballPosition.z - player.position.z, this.ballPosition.x - player.position.x);
            } else if (distanceToBall < 4.2) {
                desiredAngle = Math.atan2(this.ballPosition.z - player.position.z, this.ballPosition.x - player.position.x);
            } else if (Math.hypot(moveX, moveZ) > 0.16) {
                desiredAngle = Math.atan2(moveZ, moveX);
            }

            const rotationBlend = 1 - Math.exp(-5.2 * deltaSeconds);
            player.facingAngle = lerpAngle(player.facingAngle, desiredAngle, rotationBlend);

            const specialAnimation = player.animation === "kick" || player.animation === "goalkeeper-dive";
            if (!specialAnimation) {
                if (player.role === "goalkeeper")
                    player.animation = "goalkeeper-ready";
                else if (player.currentSpeed > 3.5)
                    player.animation = "run";
                else if (player.currentSpeed > 0.22)
                    player.animation = "walk";
                else
                    player.animation = "idle";
                player.actionProgress = Math.max(0, player.actionProgress - deltaSeconds * 4);
            }

            const frequency = player.animation === "run" ? 5.8 : player.animation === "walk" ? 3.5 : 1.4;
            player.animationTime += deltaSeconds * frequency * Math.max(0.35, Math.min(1.2, player.currentSpeed / 3.8));
        }
    }

    private setBallArc(start: FuturebolVector3State, end: FuturebolVector3State, progress: number, arcHeight: number): void {
        this.ballPosition.x = lerp(start.x, end.x, progress);
        this.ballPosition.y = lerp(start.y, end.y, progress) + 4 * arcHeight * progress * (1 - progress);
        this.ballPosition.z = lerp(start.z, end.z, progress);
        copyPoint(this.ballTarget, end);
    }

    private resolveOutcome(team: FuturebolTeam): FuturebolPlayOutcome {
        const attackingPressure = team === "home" ? Math.max(0, this.pressure) : Math.max(0, -this.pressure);
        const saveProbability = clamp(0.68 - attackingPressure * 0.22, 0.4, 0.76);
        const roll = deterministicUnit(this.seedHash, this.playIndex * 31 + (team === "home" ? 3 : 11));
        return roll < saveProbability ? "Saved" : "Goal";
    }

    private setOwner(playerId: string): void {
        if (this.currentBallOwnerId !== playerId) {
            this.lastBallOwnerId = this.currentBallOwnerId ?? this.lastBallOwnerId;
            this.currentBallOwnerId = playerId;
        }
    }

    private resetPlayState(phase: FuturebolPlayPhase): void {
        this.currentPlayPhase = phase;
        this.phaseElapsed = 0;
        this.activeTeam = null;
        this.currentBallOwnerId = null;
        this.lastBallOwnerId = null;
        this.intendedReceiverId = null;
        this.ballState = "Free";
        this.cooldownRemainingSeconds = 0;
        this.ballPosition.x = this.ballTarget.x = 0;
        this.ballPosition.y = this.ballTarget.y = 0.55;
        this.ballPosition.z = this.ballTarget.z = 0;
    }

    private playerId(team: FuturebolTeam, role: FuturebolRole): string {
        return `${team}-${role}`;
    }

    private getPlayer(id: string): FuturebolPlayerState {
        const player = this.players.find(candidate => candidate.id === id);
        if (!player)
            throw new Error(`Jogador Futurebol não encontrado: ${id}`);
        return player;
    }

    private neutralFor(player: FuturebolPlayerState): FuturebolVector3State {
        const formation = FORMATION.find(candidate => candidate.id === player.id);
        if (!formation)
            throw new Error(`Formação Futurebol não encontrada: ${player.id}`);
        return formation.neutral;
    }

    private requireActiveTeam(): FuturebolTeam {
        if (!this.activeTeam)
            throw new Error("Jogada Futurebol sem time ativo.");
        return this.activeTeam;
    }
}

function resolvePressure(snapshot: FuturebolMarketSnapshot, override: FuturebolPressureOverride): number {
    if (override === "home") return 0.9;
    if (override === "away") return -0.9;
    if (override === "balanced") return 0;
    return clamp((snapshot.home.momentum - snapshot.away.momentum) / 55, -1, 1);
}

function attackDirection(team: FuturebolTeam): number {
    return team === "home" ? 1 : -1;
}

function opponent(team: FuturebolTeam): FuturebolTeam {
    return team === "home" ? "away" : "home";
}

function pointForGoal(team: FuturebolTeam): FuturebolVector3State {
    return team === "home" ? HOME_GOAL : AWAY_GOAL;
}

const HOME_GOAL = point(GOAL_LINE_X, 1, 0);
const AWAY_GOAL = point(-GOAL_LINE_X, 1, 0);

function point(x: number, y: number, z: number): FuturebolVector3State {
    return { x, y, z };
}

function copyPoint(target: FuturebolVector3State, source: FuturebolVector3State): void {
    target.x = source.x;
    target.y = source.y;
    target.z = source.z;
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
}

function lerp(from: number, to: number, amount: number): number {
    return from + (to - from) * amount;
}

function smoothStep(value: number): number {
    return value * value * (3 - 2 * value);
}

function lerpAngle(from: number, to: number, amount: number): number {
    const difference = Math.atan2(Math.sin(to - from), Math.cos(to - from));
    return from + difference * amount;
}

function hashString(value: string): number {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
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

function deterministicSigned(seed: number, salt: number): number {
    return deterministicUnit(seed, salt) * 2 - 1;
}
