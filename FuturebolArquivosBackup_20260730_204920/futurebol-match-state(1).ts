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
import {
    FUTUREBOL_ACTION_TIMING,
    hasReachedContact
} from "./futurebol-action-timing.js";

const FIELD_HALF_LENGTH = 23;
const FIELD_HALF_WIDTH = 13;
const BALL_LIMIT_X = 27;
const GOAL_LINE_X = 25;
const BALL_GROUND_Y = 0.55;

const PASS_DURATION_SECONDS = 0.92;
const ATTACK_DURATION_SECONDS = 2.35;
const SHOT_DURATION_SECONDS = 0.76;
const RESET_DURATION_SECONDS = 2.05;

const OFFENSIVE_PRESSURE_THRESHOLD = 0.32;
const OFFENSIVE_TRIGGER_SECONDS = 3.2;
const MINIMUM_TARGET_SEPARATION = 1.75;
const MINIMUM_PLAYER_SEPARATION = 1.32;

interface FormationPlayer {
    id: string;
    team: FuturebolTeam;
    role: FuturebolRole;
    neutral: FuturebolVector3State;
    speed: number;
}

interface PlayPlan {
    lane: number;
    supportLane: number;
    tempo: number;
    passLead: number;
    shotPlacement: number;
}

const FORMATION: readonly FormationPlayer[] = [
    {
        id: "home-goalkeeper",
        team: "home",
        role: "goalkeeper",
        neutral: point(-21.2, 0, 0),
        speed: 3.2
    },
    {
        id: "home-defender",
        team: "home",
        role: "defender",
        neutral: point(-11, 0, 4.7),
        speed: 4.1
    },
    {
        id: "home-attacker",
        team: "home",
        role: "attacker",
        neutral: point(-3.5, 0, -3),
        speed: 5.2
    },
    {
        id: "away-goalkeeper",
        team: "away",
        role: "goalkeeper",
        neutral: point(21.2, 0, 0),
        speed: 3.2
    },
    {
        id: "away-defender",
        team: "away",
        role: "defender",
        neutral: point(11, 0, -4.7),
        speed: 4.1
    },
    {
        id: "away-attacker",
        team: "away",
        role: "attacker",
        neutral: point(3.5, 0, 3),
        speed: 5.2
    }
];

/**
 * Núcleo determinístico da partida Futurebol.
 *
 * A API pública foi preservada para continuar compatível com o engine,
 * o renderer e os testes existentes. A implementação interna organiza a
 * jogada em fases claras, utiliza o snapshot de mercado para pressão,
 * velocidade e probabilidade de gol, e evita movimento artificial quando
 * a partida está em Neutral ou Cooldown.
 */
export class FuturebolMatchState {
    public readonly players: FuturebolPlayerState[];
    public readonly ballPosition = point(0, BALL_GROUND_Y, 0);
    public readonly ballTarget = point(0, BALL_GROUND_Y, 0);

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
        return this.currentPlayPhase === "Outcome"
            ? this.currentOutcome
            : null;
    }

    private readonly seedHash: number;
    private readonly passStart = point(0, BALL_GROUND_Y, 0);
    private readonly passEnd = point(0, BALL_GROUND_Y, 0);
    private readonly shotStart = point(0, BALL_GROUND_Y, 0);
    private readonly shotEnd = point(0, BALL_GROUND_Y, 0);

    private phaseElapsed = 0;
    private playIndex = 0;
    private homeOffensiveSeconds = 0;
    private awayOffensiveSeconds = 0;
    private pendingOutcome: FuturebolPlayOutcome | null = null;
    private currentOutcome: FuturebolPlayOutcome = "Saved";
    private outcomeHoldSeconds = 1.2;
    private playPlan: PlayPlan = {
        lane: 0,
        supportLane: 0,
        tempo: 1,
        passLead: 1.8,
        shotPlacement: 0
    };

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
            animation: defaultAnimation(entry.role),
            animationTime: 0,
            actionProgress: 0
        }));
    }

    public applyMarket(
        snapshot: FuturebolMarketSnapshot,
        override: FuturebolPressureOverride
    ): void {
        this.latestSnapshot = snapshot;
        this.pressure = resolvePressure(snapshot, override);

        if (
            this.currentPlayPhase === "Neutral" ||
            this.currentPlayPhase === "Cooldown"
        ) {
            this.applyNeutralFormation();
        }
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
        this.phaseElapsed = FUTUREBOL_ACTION_TIMING.passPreparationStartSeconds;
    }

    public forceShot(
        team: FuturebolTeam,
        outcome: FuturebolPlayOutcome | null = null
    ): void {
        this.startPlay(team, outcome);
        this.transitionToAttacking();
        this.phaseElapsed = Math.max(0, ATTACK_DURATION_SECONDS - 1.2);
    }

    public forceOutcome(outcome: FuturebolPlayOutcome): void {
        this.pendingOutcome = outcome;
        this.currentOutcome = outcome;

        if (this.currentPlayPhase === "Shooting") {
            this.configureShotEnd();
            return;
        }

        if (this.activeTeam === null) {
            this.forceShot(
                this.pressure < 0 ? "away" : "home",
                outcome
            );
        }
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
        this.currentOutcome = "Saved";
        this.outcomeHoldSeconds = 1.2;
        this.homeOffensiveSeconds = 0;
        this.awayOffensiveSeconds = 0;
        this.playPlan = {
            lane: 0,
            supportLane: 0,
            tempo: 1,
            passLead: 1.8,
            shotPlacement: 0
        };

        this.resetPlayState("Neutral");

        this.players.forEach((player, index) => {
            const formation = FORMATION[index];
            copyPoint(player.position, formation.neutral);
            copyPoint(player.targetPosition, formation.neutral);
            player.currentSpeed = 0;
            player.facingAngle = player.team === "home" ? 0 : Math.PI;
            player.animation = defaultAnimation(player.role);
            player.animationTime = 0;
            player.actionProgress = 0;
        });
    }

    private updateAutomaticPlayTrigger(deltaSeconds: number): void {
        if (this.currentPlayPhase === "Cooldown") {
            this.cooldownRemainingSeconds = Math.max(
                0,
                this.cooldownRemainingSeconds - deltaSeconds
            );

            if (this.cooldownRemainingSeconds === 0) {
                this.currentPlayPhase = "Neutral";
                this.phaseElapsed = 0;
                this.applyNeutralFormation();
            }

            return;
        }

        if (this.currentPlayPhase !== "Neutral")
            return;

        const homePressing = this.pressure > OFFENSIVE_PRESSURE_THRESHOLD;
        const awayPressing = this.pressure < -OFFENSIVE_PRESSURE_THRESHOLD;

        this.homeOffensiveSeconds = homePressing
            ? this.homeOffensiveSeconds + deltaSeconds
            : Math.max(0, this.homeOffensiveSeconds - deltaSeconds * 1.8);

        this.awayOffensiveSeconds = awayPressing
            ? this.awayOffensiveSeconds + deltaSeconds
            : Math.max(0, this.awayOffensiveSeconds - deltaSeconds * 1.8);

        if (this.homeOffensiveSeconds >= OFFENSIVE_TRIGGER_SECONDS) {
            this.startPlay("home", null);
            return;
        }

        if (this.awayOffensiveSeconds >= OFFENSIVE_TRIGGER_SECONDS) {
            this.startPlay("away", null);
            return;
        }

        /*
         * Em mercado equilibrado o jogo não fica parado indefinidamente.
         * Após alguns segundos, uma equipe recebe a iniciativa de forma
         * determinística, mantendo replays e testes reproduzíveis.
         */
        const balancedTriggerSeconds =
            5.2 + deterministicUnit(this.seedHash, this.playIndex * 23 + 17) * 1.4;

        if (
            !homePressing &&
            !awayPressing &&
            this.phaseElapsed >= balancedTriggerSeconds
        ) {
            const favoredTeam = this.pressure > 0.08
                ? "home"
                : this.pressure < -0.08
                    ? "away"
                    : deterministicUnit(
                        this.seedHash,
                        this.playIndex * 29 + 7
                    ) >= 0.5
                        ? "home"
                        : "away";

            this.startPlay(favoredTeam, null);
        }
    }

    private updatePlayPhase(): void {
        this.releaseTransientAnimations();

        switch (this.currentPlayPhase) {
            case "Neutral":
            case "Cooldown":
                this.updateNeutralOrCooldown();
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

    private updateNeutralOrCooldown(): void {
        this.ballState = "Free";
        this.currentBallOwnerId = null;
        this.intendedReceiverId = null;
        setPoint(this.ballTarget, 0, BALL_GROUND_Y, 0);
        this.applyNeutralFormation();
    }

    private releaseTransientAnimations(): void {
        for (const player of this.players) {
            if (
                player.animation !== "kick" &&
                player.animation !== "goalkeeper-dive"
            ) {
                continue;
            }

            player.animation = defaultAnimation(player.role);
            player.actionProgress = 0;
        }
    }

    private startPlay(
        team: FuturebolTeam,
        outcome: FuturebolPlayOutcome | null
    ): void {
        this.playIndex += 1;
        this.activeTeam = team;
        this.playPlan = this.createPlayPlan(team);
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

    private createPlayPlan(team: FuturebolTeam): PlayPlan {
        const advantage = this.attackingAdvantage(team);
        const laneSeed = deterministicSigned(
            this.seedHash,
            this.playIndex * 7 + (team === "home" ? 1 : 2)
        );
        const supportSeed = deterministicSigned(
            this.seedHash,
            this.playIndex * 11 + (team === "home" ? 5 : 8)
        );
        const placementSeed = deterministicSigned(
            this.seedHash,
            this.playIndex * 13 + (team === "home" ? 3 : 9)
        );

        const lane = clamp(
            laneSeed * 3.15 + advantage * 0.65,
            -4.1,
            4.1
        );

        return {
            lane,
            supportLane: clamp(
                lane * -0.55 + supportSeed * 1.25,
                -4.8,
                4.8
            ),
            tempo: clamp(1 + advantage * 0.16, 0.86, 1.2),
            passLead: clamp(1.65 + advantage * 0.45, 1.35, 2.15),
            shotPlacement: clamp(
                lane * 0.18 + placementSeed * 2.25,
                -2.8,
                2.8
            )
        };
    }

    private updateBuildUp(): void {
        const team = this.requireActiveTeam();
        const direction = attackDirection(team);
        const defender = this.getPlayer(this.playerId(team, "defender"));
        const attacker = this.getPlayer(this.playerId(team, "attacker"));

        this.positionTeamsForPlay(
            team,
            defender.position.x,
            this.playPlan.lane
        );

        const buildDistance = Math.min(
            4.8,
            this.phaseElapsed * 2.6 * this.playPlan.tempo
        );

        defender.targetPosition.x = clamp(
            this.neutralFor(defender).x + direction * buildDistance,
            -17,
            17
        );
        defender.targetPosition.z = this.playPlan.lane * 0.7;

        attacker.targetPosition.x = direction * 1.8;
        attacker.targetPosition.z = this.playPlan.lane;

        this.setOwner(defender.id);
        this.intendedReceiverId = attacker.id;
        this.ballState = "Controlled";

        const contactProgress = clamp(
            (
                this.phaseElapsed -
                FUTUREBOL_ACTION_TIMING.passPreparationStartSeconds
            ) / FUTUREBOL_ACTION_TIMING.passDurationSeconds,
            0,
            1
        );

        if (contactProgress > 0) {
            defender.animation = "kick";
            defender.actionProgress = contactProgress;
        }

        if (
            hasReachedContact(
                contactProgress,
                FUTUREBOL_ACTION_TIMING.passContactRatio
            )
        ) {
            this.beginPass(defender, attacker);
        }
    }

    private beginPass(
        defender: FuturebolPlayerState,
        attacker: FuturebolPlayerState
    ): void {
        copyPoint(this.passStart, this.ballPosition);

        this.passEnd.x = clamp(
            attacker.targetPosition.x +
            attackDirection(attacker.team) * this.playPlan.passLead,
            -18.5,
            18.5
        );
        this.passEnd.y = BALL_GROUND_Y;
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
        const receiver = this.getPlayer(
            this.intendedReceiverId ?? this.playerId(team, "attacker")
        );
        const progress = clamp(
            this.phaseElapsed /
            (PASS_DURATION_SECONDS / this.playPlan.tempo),
            0,
            1
        );

        const currentBallX = lerp(this.passStart.x, this.passEnd.x, progress);

        this.positionTeamsForPlay(
            team,
            currentBallX,
            this.passEnd.z
        );

        receiver.targetPosition.x = this.passEnd.x;
        receiver.targetPosition.z = this.passEnd.z;

        passer.animation = "kick";
        passer.actionProgress = clamp(
            FUTUREBOL_ACTION_TIMING.passContactRatio +
            progress * (1 - FUTUREBOL_ACTION_TIMING.passContactRatio),
            0,
            1
        );

        this.setBallArc(
            this.passStart,
            this.passEnd,
            progress,
            1.35
        );

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
        const duration = ATTACK_DURATION_SECONDS / this.playPlan.tempo;
        const runProgress = smoothStep(
            clamp(this.phaseElapsed / duration, 0, 1)
        );

        this.positionTeamsForPlay(
            team,
            attacker.position.x,
            attacker.position.z
        );

        attacker.targetPosition.x = lerp(
            direction * 3.2,
            direction * 18.1,
            runProgress
        );
        attacker.targetPosition.z = lerp(
            this.playPlan.lane,
            this.playPlan.lane * 0.38,
            runProgress
        );

        defender.targetPosition.x = clamp(
            attacker.targetPosition.x - direction * 7.1,
            -16,
            16
        );
        defender.targetPosition.z = this.playPlan.supportLane;

        this.setOwner(attacker.id);
        this.ballState = "Controlled";

        if (this.phaseElapsed >= duration) {
            this.currentPlayPhase = "PreparingShot";
            this.phaseElapsed = 0;
            attacker.targetPosition.x = clamp(
                attacker.position.x + direction * 0.8,
                -19.5,
                19.5
            );
            attacker.targetPosition.z = attacker.position.z;
        }
    }

    private updateShotPreparation(): void {
        const team = this.requireActiveTeam();
        const attacker = this.getPlayer(this.playerId(team, "attacker"));

        this.positionTeamsForPlay(
            team,
            attacker.position.x,
            attacker.position.z
        );

        attacker.targetPosition.x = clamp(
            attacker.position.x + attackDirection(team) * 0.14,
            -19.5,
            19.5
        );
        attacker.targetPosition.z = attacker.position.z;
        attacker.animation = "kick";
        attacker.actionProgress = clamp(
            this.phaseElapsed /
            FUTUREBOL_ACTION_TIMING.shootDurationSeconds,
            0,
            1
        );

        this.setOwner(attacker.id);
        this.ballState = "Controlled";

        if (
            hasReachedContact(
                attacker.actionProgress,
                FUTUREBOL_ACTION_TIMING.shootContactRatio
            )
        ) {
            this.launchShot(attacker);
        }
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

        this.shotEnd.x = direction * (
            this.currentOutcome === "Goal"
                ? GOAL_LINE_X + 1.35
                : GOAL_LINE_X - 2.45
        );
        this.shotEnd.y = this.currentOutcome === "Goal" ? 1.05 : 0.86;
        this.shotEnd.z = this.playPlan.shotPlacement;

        copyPoint(this.ballTarget, this.shotEnd);
    }

    private updateShot(): void {
        const team = this.requireActiveTeam();
        const goalkeeper = this.getPlayer(
            this.playerId(opponent(team), "goalkeeper")
        );
        const attacker = this.getPlayer(this.playerId(team, "attacker"));
        const progress = clamp(
            this.phaseElapsed /
            (SHOT_DURATION_SECONDS / this.playPlan.tempo),
            0,
            1
        );

        this.positionTeamsForPlay(
            team,
            lerp(this.shotStart.x, this.shotEnd.x, progress),
            this.shotEnd.z
        );

        goalkeeper.targetPosition.z = clamp(
            this.shotEnd.z * 0.92,
            -3.1,
            3.1
        );

        /*
         * Pequeno atraso de reação deixa o chute legível e evita que o
         * goleiro comece deitado antes de a bola sair do pé.
         */
        if (progress >= 0.08) {
            goalkeeper.animation = "goalkeeper-dive";
            goalkeeper.actionProgress = smoothStep(
                clamp((progress - 0.08) / 0.92, 0, 1)
            );
        }

        attacker.animation = "kick";
        attacker.actionProgress = clamp(
            0.62 + progress * 0.38,
            0,
            1
        );

        this.setBallArc(
            this.shotStart,
            this.shotEnd,
            progress,
            this.currentOutcome === "Goal" ? 2.35 : 1.8
        );

        if (progress >= 1)
            this.finishShot(goalkeeper);
    }

    private finishShot(goalkeeper: FuturebolPlayerState): void {
        this.currentPlayPhase = "Outcome";
        this.phaseElapsed = 0;
        this.pendingOutcome = null;

        if (this.currentOutcome === "Goal") {
            if (this.activeTeam === "home")
                this.homeScore += 1;
            else
                this.awayScore += 1;

            this.ballState = "Free";
            this.currentBallOwnerId = null;
            this.outcomeHoldSeconds = 1.65;
            goalkeeper.animation = "goalkeeper-ready";
            goalkeeper.actionProgress = 0;
            return;
        }

        this.ballState = "Saved";
        this.setOwner(goalkeeper.id);
        this.outcomeHoldSeconds = 1.15;
    }

    private updateOutcome(): void {
        const team = this.requireActiveTeam();
        const goalkeeper = this.getPlayer(
            this.playerId(opponent(team), "goalkeeper")
        );

        this.positionTeamsForPlay(
            team,
            this.ballPosition.x,
            this.ballPosition.z
        );

        if (this.currentOutcome === "Saved") {
            const recoveryRatio = clamp(
                this.phaseElapsed / Math.max(0.001, this.outcomeHoldSeconds),
                0,
                1
            );

            goalkeeper.animation = recoveryRatio < 0.2
                ? "goalkeeper-dive"
                : "goalkeeper-ready";
            goalkeeper.actionProgress = recoveryRatio < 0.2
                ? 1 - recoveryRatio * 0.5
                : 0;

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
        setPoint(this.ballTarget, 0, BALL_GROUND_Y, 0);
        this.applyNeutralFormation();
    }

    private updateResetting(): void {
        this.applyNeutralFormation();
        setPoint(this.ballTarget, 0, BALL_GROUND_Y, 0);

        if (this.phaseElapsed >= RESET_DURATION_SECONDS) {
            setPoint(this.ballPosition, 0, BALL_GROUND_Y, 0);
            this.currentPlayPhase = "Cooldown";
            this.ballState = "Free";
            this.activeTeam = null;
            this.phaseElapsed = 0;
            this.cooldownRemainingSeconds =
                15 + deterministicUnit(
                    this.seedHash,
                    this.playIndex * 19 + 9
                ) * 10;
            this.snapPlayersAtNeutralWhenClose();
        }
    }

    /**
     * Posicionamento coletivo sem ruído temporal.
     *
     * Em vez de seno/cosseno por frame, cada função tática depende apenas
     * da bola, da equipe ativa e do plano determinístico da jogada. Isso
     * deixa o movimento legível e reproduzível.
     */
    private positionTeamsForPlay(
        attackingTeam: FuturebolTeam,
        activeX: number,
        activeZ: number
    ): void {
        const direction = attackDirection(attackingTeam);
        const defendingTeam = opponent(attackingTeam);
        const attackingGoalkeeper = this.getPlayer(
            this.playerId(attackingTeam, "goalkeeper")
        );
        const defendingGoalkeeper = this.getPlayer(
            this.playerId(defendingTeam, "goalkeeper")
        );
        const attackingDefender = this.getPlayer(
            this.playerId(attackingTeam, "defender")
        );
        const attackingAttacker = this.getPlayer(
            this.playerId(attackingTeam, "attacker")
        );
        const defendingDefender = this.getPlayer(
            this.playerId(defendingTeam, "defender")
        );
        const defendingAttacker = this.getPlayer(
            this.playerId(defendingTeam, "attacker")
        );

        attackingGoalkeeper.targetPosition.x =
            attackDirection(attackingGoalkeeper.team) * -21.2;
        attackingGoalkeeper.targetPosition.z = clamp(activeZ * 0.08, -1.4, 1.4);

        defendingGoalkeeper.targetPosition.x =
            attackDirection(defendingGoalkeeper.team) * -21.2;
        defendingGoalkeeper.targetPosition.z = clamp(activeZ * 0.18, -2.4, 2.4);

        attackingDefender.targetPosition.x = clamp(
            activeX - direction * 7.1,
            -16.5,
            16.5
        );
        attackingDefender.targetPosition.z = clamp(
            this.playPlan.supportLane,
            -8.8,
            8.8
        );

        attackingAttacker.targetPosition.x = clamp(
            activeX + direction * 1.25,
            -19.5,
            19.5
        );
        attackingAttacker.targetPosition.z = clamp(activeZ, -8.5, 8.5);

        /* defensor fecha a linha entre bola e gol */
        defendingDefender.targetPosition.x = clamp(
            activeX + direction * 3.9,
            -18.2,
            18.2
        );
        defendingDefender.targetPosition.z = clamp(
            activeZ * 0.82,
            -8.2,
            8.2
        );

        /* atacante sem bola recua para uma posição de contra-ataque */
        defendingAttacker.targetPosition.x = clamp(
            activeX - direction * 7.6,
            -13,
            13
        );
        defendingAttacker.targetPosition.z = clamp(
            -activeZ * 0.45,
            -7.8,
            7.8
        );
    }

    private applyNeutralFormation(): void {
        for (let index = 0; index < this.players.length; index++) {
            const player = this.players[index];
            const formation = FORMATION[index];

            copyPoint(player.targetPosition, formation.neutral);

            if (
                this.currentPlayPhase === "Neutral" ||
                this.currentPlayPhase === "Cooldown"
            ) {
                const distance = planarDistance(
                    player.position,
                    formation.neutral
                );

                if (distance <= 0.04) {
                    copyPoint(player.position, formation.neutral);
                    player.currentSpeed = 0;
                    player.animation = defaultAnimation(player.role);
                    player.actionProgress = 0;
                }
            }
        }
    }

    private snapPlayersAtNeutralWhenClose(): void {
        for (let index = 0; index < this.players.length; index++) {
            const player = this.players[index];
            const formation = FORMATION[index];

            if (planarDistance(player.position, formation.neutral) <= 0.18) {
                copyPoint(player.position, formation.neutral);
                copyPoint(player.targetPosition, formation.neutral);
                player.currentSpeed = 0;
                player.animation = defaultAnimation(player.role);
                player.actionProgress = 0;
            }
        }
    }

    private preventTargetOverlaps(): void {
        for (let first = 0; first < this.players.length; first++) {
            for (let second = first + 1; second < this.players.length; second++) {
                const a = this.players[first];
                const b = this.players[second];
                const dx = b.targetPosition.x - a.targetPosition.x;
                const dz = b.targetPosition.z - a.targetPosition.z;
                const distanceSquared = dx * dx + dz * dz;

                if (
                    distanceSquared >=
                    MINIMUM_TARGET_SEPARATION * MINIMUM_TARGET_SEPARATION
                ) {
                    continue;
                }

                const distance = Math.max(0.001, Math.sqrt(distanceSquared));
                const push = (MINIMUM_TARGET_SEPARATION - distance) * 0.5;
                const nx = distance > 0.01
                    ? dx / distance
                    : first % 2 === 0 ? 1 : -1;
                const nz = distance > 0.01
                    ? dz / distance
                    : second % 2 === 0 ? 1 : -1;

                a.targetPosition.x = clamp(
                    a.targetPosition.x - nx * push,
                    -FIELD_HALF_LENGTH,
                    FIELD_HALF_LENGTH
                );
                a.targetPosition.z = clamp(
                    a.targetPosition.z - nz * push,
                    -FIELD_HALF_WIDTH,
                    FIELD_HALF_WIDTH
                );
                b.targetPosition.x = clamp(
                    b.targetPosition.x + nx * push,
                    -FIELD_HALF_LENGTH,
                    FIELD_HALF_LENGTH
                );
                b.targetPosition.z = clamp(
                    b.targetPosition.z + nz * push,
                    -FIELD_HALF_WIDTH,
                    FIELD_HALF_WIDTH
                );
            }
        }
    }

    private separatePlayerPositions(): void {
        for (let first = 0; first < this.players.length; first++) {
            for (let second = first + 1; second < this.players.length; second++) {
                const a = this.players[first];
                const b = this.players[second];
                const dx = b.position.x - a.position.x;
                const dz = b.position.z - a.position.z;
                const distanceSquared = dx * dx + dz * dz;

                if (
                    distanceSquared >=
                    MINIMUM_PLAYER_SEPARATION * MINIMUM_PLAYER_SEPARATION
                ) {
                    continue;
                }

                const distance = Math.max(0.001, Math.sqrt(distanceSquared));
                const nx = distance > 0.01
                    ? dx / distance
                    : first % 2 === 0 ? 1 : -1;
                const nz = distance > 0.01
                    ? dz / distance
                    : second % 2 === 0 ? 1 : -1;
                const overlap = MINIMUM_PLAYER_SEPARATION - distance;
                const aShare = a.role === "goalkeeper"
                    ? 0
                    : b.role === "goalkeeper" ? 1 : 0.5;
                const bShare = b.role === "goalkeeper"
                    ? 0
                    : a.role === "goalkeeper" ? 1 : 0.5;

                a.position.x = clamp(
                    a.position.x - nx * overlap * aShare,
                    -FIELD_HALF_LENGTH,
                    FIELD_HALF_LENGTH
                );
                a.position.z = clamp(
                    a.position.z - nz * overlap * aShare,
                    -FIELD_HALF_WIDTH,
                    FIELD_HALF_WIDTH
                );
                b.position.x = clamp(
                    b.position.x + nx * overlap * bShare,
                    -FIELD_HALF_LENGTH,
                    FIELD_HALF_LENGTH
                );
                b.position.z = clamp(
                    b.position.z + nz * overlap * bShare,
                    -FIELD_HALF_WIDTH,
                    FIELD_HALF_WIDTH
                );
            }
        }
    }

    private movePlayers(deltaSeconds: number): void {
        for (const player of this.players) {
            const previousX = player.position.x;
            const previousZ = player.position.z;
            const distance = Math.hypot(
                player.targetPosition.x - previousX,
                player.targetPosition.z - previousZ
            );
            const maxStep = player.movementSpeed * deltaSeconds;
            const step = distance > 0.001
                ? Math.min(1, maxStep / distance)
                : 1;

            player.position.x = clamp(
                lerp(previousX, player.targetPosition.x, step),
                -FIELD_HALF_LENGTH,
                FIELD_HALF_LENGTH
            );
            player.position.z = clamp(
                lerp(previousZ, player.targetPosition.z, step),
                -FIELD_HALF_WIDTH,
                FIELD_HALF_WIDTH
            );
            player.currentSpeed = deltaSeconds > 0
                ? Math.hypot(
                    player.position.x - previousX,
                    player.position.z - previousZ
                ) / deltaSeconds
                : 0;
        }
    }

    private updateControlledBall(deltaSeconds: number): void {
        if (
            this.ballState === "Passing" ||
            this.ballState === "Shooting"
        ) {
            return;
        }

        if (
            this.ballState === "Controlled" &&
            this.currentBallOwnerId
        ) {
            const owner = this.getPlayer(this.currentBallOwnerId);
            const directionX = Math.cos(owner.facingAngle);
            const directionZ = Math.sin(owner.facingAngle);
            const sideX = -directionZ;
            const sideZ = directionX;
            const dribble = Math.sin(owner.animationTime * 2) *
                Math.min(0.14, owner.currentSpeed * 0.025);

            this.ballTarget.x = owner.position.x +
                directionX * (0.76 + dribble) + sideX * 0.19;
            this.ballTarget.y = BALL_GROUND_Y +
                Math.abs(Math.sin(owner.animationTime * 2)) *
                Math.min(0.1, owner.currentSpeed * 0.018);
            this.ballTarget.z = owner.position.z +
                directionZ * (0.76 + dribble) + sideZ * 0.19;
        }

        const responsiveness = this.ballState === "Controlled"
            ? 12
            : this.ballState === "Resetting" ? 2.1 : 3.1;
        const blend = 1 - Math.exp(-responsiveness * deltaSeconds);

        this.ballPosition.x = clamp(
            lerp(this.ballPosition.x, this.ballTarget.x, blend),
            -BALL_LIMIT_X,
            BALL_LIMIT_X
        );
        this.ballPosition.y = lerp(
            this.ballPosition.y,
            this.ballTarget.y,
            blend
        );
        this.ballPosition.z = clamp(
            lerp(this.ballPosition.z, this.ballTarget.z, blend),
            -FIELD_HALF_WIDTH,
            FIELD_HALF_WIDTH
        );
    }

    private updateFacingAndAnimation(deltaSeconds: number): void {
        for (const player of this.players) {
            let desiredAngle = player.facingAngle;
            const moveX = player.targetPosition.x - player.position.x;
            const moveZ = player.targetPosition.z - player.position.z;
            const distanceToBall = Math.hypot(
                this.ballPosition.x - player.position.x,
                this.ballPosition.z - player.position.z
            );

            if (player.animation === "kick") {
                const target =
                    this.currentPlayPhase === "Passing" &&
                    this.intendedReceiverId
                        ? this.getPlayer(this.intendedReceiverId).position
                        : pointForGoal(player.team);

                desiredAngle = Math.atan2(
                    target.z - player.position.z,
                    target.x - player.position.x
                );
            } else if (player.role === "goalkeeper") {
                desiredAngle = Math.atan2(
                    this.ballPosition.z - player.position.z,
                    this.ballPosition.x - player.position.x
                );
            } else if (distanceToBall < 4.2) {
                desiredAngle = Math.atan2(
                    this.ballPosition.z - player.position.z,
                    this.ballPosition.x - player.position.x
                );
            } else if (Math.hypot(moveX, moveZ) > 0.16) {
                desiredAngle = Math.atan2(moveZ, moveX);
            }

            const rotationBlend = 1 - Math.exp(-5.2 * deltaSeconds);
            player.facingAngle = lerpAngle(
                player.facingAngle,
                desiredAngle,
                rotationBlend
            );

            const specialAnimation =
                player.animation === "kick" ||
                player.animation === "goalkeeper-dive";

            if (!specialAnimation) {
                player.animation = movementAnimation(player);
                player.actionProgress = Math.max(
                    0,
                    player.actionProgress - deltaSeconds * 4
                );
            }

            const frequency = player.animation === "run"
                ? 5.8
                : player.animation === "walk" ? 3.5 : 1.4;

            player.animationTime += deltaSeconds * frequency *
                Math.max(
                    0.35,
                    Math.min(1.2, player.currentSpeed / 3.8)
                );
        }
    }

    private setBallArc(
        start: FuturebolVector3State,
        end: FuturebolVector3State,
        progress: number,
        arcHeight: number
    ): void {
        this.ballPosition.x = lerp(start.x, end.x, progress);
        this.ballPosition.y =
            lerp(start.y, end.y, progress) +
            4 * arcHeight * progress * (1 - progress);
        this.ballPosition.z = lerp(start.z, end.z, progress);
        copyPoint(this.ballTarget, end);
    }

    private resolveOutcome(team: FuturebolTeam): FuturebolPlayOutcome {
        const advantage = this.attackingAdvantage(team);
        const attackingAsset = this.assetFor(team);
        const defendingAsset = this.assetFor(opponent(team));
        const changeEdge = attackingAsset && defendingAsset
            ? clamp(
                (attackingAsset.changePercent - defendingAsset.changePercent) / 8,
                -0.2,
                0.2
            )
            : 0;
        const volumeEdge = attackingAsset && defendingAsset
            ? clamp(
                (attackingAsset.volumeStrength - defendingAsset.volumeStrength) / 180,
                -0.12,
                0.12
            )
            : 0;
        const shotDifficulty = Math.abs(this.playPlan.lane) / 18;
        const goalProbability = clamp(
            0.3 + advantage * 0.2 + changeEdge + volumeEdge - shotDifficulty,
            0.18,
            0.62
        );
        const roll = deterministicUnit(
            this.seedHash,
            this.playIndex * 31 + (team === "home" ? 3 : 11)
        );

        return roll < goalProbability ? "Goal" : "Saved";
    }

    private attackingAdvantage(team: FuturebolTeam): number {
        const signedPressure = team === "home"
            ? this.pressure
            : -this.pressure;

        return clamp(signedPressure, -1, 1);
    }

    private assetFor(team: FuturebolTeam) {
        return this.latestSnapshot?.[team] ?? null;
    }

    private setOwner(playerId: string): void {
        if (this.currentBallOwnerId === playerId)
            return;

        this.lastBallOwnerId =
            this.currentBallOwnerId ?? this.lastBallOwnerId;
        this.currentBallOwnerId = playerId;
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
        setPoint(this.ballPosition, 0, BALL_GROUND_Y, 0);
        setPoint(this.ballTarget, 0, BALL_GROUND_Y, 0);
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
        const formation = FORMATION.find(
            candidate => candidate.id === player.id
        );

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

function movementAnimation(
    player: FuturebolPlayerState
): FuturebolPlayerAnimation {
    if (player.role === "goalkeeper")
        return "goalkeeper-ready";

    if (player.currentSpeed > 3.5)
        return "run";

    if (player.currentSpeed > 0.22)
        return "walk";

    return "idle";
}

function defaultAnimation(role: FuturebolRole): FuturebolPlayerAnimation {
    return role === "goalkeeper"
        ? "goalkeeper-ready"
        : "idle";
}

function resolvePressure(
    snapshot: FuturebolMarketSnapshot,
    override: FuturebolPressureOverride
): number {
    if (override === "home")
        return 0.9;

    if (override === "away")
        return -0.9;

    if (override === "balanced")
        return 0;

    const momentumEdge =
        (snapshot.home.momentum - snapshot.away.momentum) / 55;
    const changeEdge =
        (snapshot.home.changePercent - snapshot.away.changePercent) / 6;
    const volumeEdge =
        (snapshot.home.volumeStrength - snapshot.away.volumeStrength) / 100;

    return clamp(
        momentumEdge * 0.76 +
        changeEdge * 0.16 +
        volumeEdge * 0.08,
        -1,
        1
    );
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

function setPoint(
    target: FuturebolVector3State,
    x: number,
    y: number,
    z: number
): void {
    target.x = x;
    target.y = y;
    target.z = z;
}

function copyPoint(
    target: FuturebolVector3State,
    source: FuturebolVector3State
): void {
    setPoint(target, source.x, source.y, source.z);
}

function planarDistance(
    first: FuturebolVector3State,
    second: FuturebolVector3State
): number {
    return Math.hypot(
        first.x - second.x,
        first.z - second.z
    );
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
}

function lerp(from: number, to: number, amount: number): number {
    return from + (to - from) * amount;
}

function smoothStep(value: number): number {
    const safeValue = clamp(value, 0, 1);
    return safeValue * safeValue * (3 - 2 * safeValue);
}

function lerpAngle(from: number, to: number, amount: number): number {
    const difference = Math.atan2(
        Math.sin(to - from),
        Math.cos(to - from)
    );

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
