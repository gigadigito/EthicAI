import type {
    FuturebolBallState,
    FuturebolMarketSnapshot,
    FuturebolOfficialMatchState,
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

/*
 * Distâncias maiores são intencionais: as cabeças-moeda ocupam mais espaço
 * visual do que a malha física original do humanoide.
 */
const MINIMUM_TARGET_SEPARATION = 2.35;
const MINIMUM_PLAYER_SEPARATION = 1.95;
const TARGET_SEPARATION_ITERATIONS = 4;
const POSITION_SEPARATION_ITERATIONS = 4;
const ARRIVAL_RADIUS = 1.35;
const STOP_RADIUS = 0.045;
const PLAYER_MAX_ACCELERATION = 11.5;

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
    public cooldownRemainingSeconds = 0;

    public get homeScore(): number {
        return this.officialMode
            ? this.officialMatchState?.homeScore ?? 0
            : this.localHomeScore;
    }

    public get awayScore(): number {
        return this.officialMode
            ? this.officialMatchState?.awayScore ?? 0
            : this.localAwayScore;
    }

    public get displayElapsedSeconds(): number {
        if (!this.officialMode)
            return this.elapsedSeconds;

        if (!this.officialMatchState)
            return 0;

        const official = this.officialMatchState;
        if (official.isFinished || !isOngoingStatus(official.status))
            return official.elapsedSeconds;

        return official.elapsedSeconds + Math.max(
            0,
            (Date.now() - this.officialStateAppliedAtMs) / 1000
        );
    }

    public get lastPlayOutcome(): FuturebolPlayOutcome | null {
        return this.currentPlayPhase === "Outcome"
            ? this.currentOutcome
            : null;
    }

    private readonly seedHash: number;
    private localHomeScore = 0;
    private localAwayScore = 0;
    private officialMatchState: FuturebolOfficialMatchState | null = null;
    private officialStateAppliedAtMs = 0;
    private readonly seenOfficialScoreEventIds = new Set<number>();
    private readonly pendingOfficialGoalTeams: FuturebolTeam[] = [];
    private officialGoalCinematicActive = false;
    private officialGoalCinematicTeam: FuturebolTeam | null = null;
    private readonly playerVelocities = new Map<string, FuturebolVector3State>();
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

    public constructor(
        seed = "futurebol-demo-001",
        private readonly officialMode = false
    ) {
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

        for (const player of this.players)
            this.playerVelocities.set(player.id, point(0, 0, 0));
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

    public applyOfficialMatchState(
        state: FuturebolOfficialMatchState,
        animateNewEvents = true
    ): void {
        if (
            this.officialMatchState &&
            state.sequence < this.officialMatchState.sequence
        ) {
            return;
        }

        const orderedEvents = [...state.scoreEvents]
            .filter(event => event.points > 0)
            .sort((left, right) => left.sequence - right.sequence || left.id - right.id);
        const newEvents = orderedEvents.filter(
            event => !this.seenOfficialScoreEventIds.has(event.id)
        );

        for (const event of orderedEvents)
            this.seenOfficialScoreEventIds.add(event.id);

        this.officialMatchState = {
            ...state,
            homeScore: Math.max(0, state.homeScore),
            awayScore: Math.max(0, state.awayScore),
            elapsedSeconds: Math.max(0, state.elapsedSeconds),
            scoreEvents: orderedEvents
        };
        this.officialStateAppliedAtMs = Date.now();

        if (!this.officialMode || !animateNewEvents)
            return;

        for (const event of newEvents)
            this.pendingOfficialGoalTeams.push(event.team);

        this.startNextOfficialGoalCinematic();
    }

    public update(deltaSeconds: number): void {
        const safeDelta = clamp(deltaSeconds, 0, 0.1);

        this.elapsedSeconds += safeDelta;
        this.phaseElapsed += safeDelta;

        this.updateAutomaticPlayTrigger(safeDelta);
        this.updatePlayPhase();
        this.constrainTargetsByRole();

        for (let iteration = 0; iteration < TARGET_SEPARATION_ITERATIONS; iteration++) {
            this.preventTargetOverlaps();
            this.constrainTargetsByRole();
        }

        this.movePlayers(safeDelta);

        for (let iteration = 0; iteration < POSITION_SEPARATION_ITERATIONS; iteration++)
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
        if (this.officialMode && outcome === "Goal")
            return;

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
        this.localHomeScore = 0;
        this.localAwayScore = 0;
        if (
            this.officialMode &&
            this.officialGoalCinematicActive &&
            this.officialGoalCinematicTeam
        ) {
            this.pendingOfficialGoalTeams.unshift(this.officialGoalCinematicTeam);
        } else if (!this.officialMode) {
            this.pendingOfficialGoalTeams.length = 0;
        }
        this.officialGoalCinematicActive = false;
        this.officialGoalCinematicTeam = null;
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

            const velocity = this.playerVelocities.get(player.id);
            if (velocity)
                setPoint(velocity, 0, 0, 0);
        });
    }

    private updateAutomaticPlayTrigger(deltaSeconds: number): void {
        if (
            this.officialMode &&
            !this.officialGoalCinematicActive &&
            this.pendingOfficialGoalTeams.length > 0 &&
            (this.currentPlayPhase === "Neutral" || this.currentPlayPhase === "Cooldown")
        ) {
            this.startNextOfficialGoalCinematic();
            return;
        }

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
        outcome: FuturebolPlayOutcome | null,
        officialGoalCinematic = false
    ): void {
        this.playIndex += 1;
        this.activeTeam = team;
        this.playPlan = this.createPlayPlan(team);
        this.pendingOutcome = this.officialMode && !officialGoalCinematic
            ? null
            : outcome;
        this.currentOutcome = this.officialMode && !officialGoalCinematic
            ? "Saved"
            : outcome ?? this.resolveOutcome(team);
        this.officialGoalCinematicActive = officialGoalCinematic;
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
            if (!this.officialMode) {
                if (this.activeTeam === "home")
                    this.localHomeScore += 1;
                else
                    this.localAwayScore += 1;
            }

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
        this.officialGoalCinematicActive = false;
        this.officialGoalCinematicTeam = null;
        this.currentPlayPhase = "Resetting";
        this.ballState = "Resetting";
        this.currentBallOwnerId = null;
        this.intendedReceiverId = null;
        this.phaseElapsed = 0;
        setPoint(this.ballTarget, 0, BALL_GROUND_Y, 0);
        this.applyNeutralFormation();
    }

    private startNextOfficialGoalCinematic(): void {
        if (
            !this.officialMode ||
            this.officialGoalCinematicActive ||
            this.pendingOfficialGoalTeams.length === 0
        ) {
            return;
        }

        const team = this.pendingOfficialGoalTeams.shift();
        if (!team)
            return;

        this.startPlay(team, "Goal", true);
        this.officialGoalCinematicTeam = team;
        this.transitionToAttacking();
        this.phaseElapsed = Math.max(0, ATTACK_DURATION_SECONDS - 1.2);
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

        /*
         * Goleiros permanecem em sua pequena área. Eles acompanham a bola
         * lateralmente, mas nunca são arrastados para o bloco de jogadores.
         */
        copyPoint(
            attackingGoalkeeper.targetPosition,
            this.neutralFor(attackingGoalkeeper)
        );
        attackingGoalkeeper.targetPosition.z = clamp(activeZ * 0.06, -1.25, 1.25);

        copyPoint(
            defendingGoalkeeper.targetPosition,
            this.neutralFor(defendingGoalkeeper)
        );
        defendingGoalkeeper.targetPosition.z = clamp(activeZ * 0.22, -2.65, 2.65);

        /*
         * Apoio ofensivo: o defensor fica atrás da bola e ocupa o corredor
         * oposto. Isso impede que atacante e defensor corram para o mesmo
         * ponto durante a construção.
         */
        attackingDefender.targetPosition.x = clamp(
            activeX - direction * 7.4,
            -16.6,
            16.6
        );
        attackingDefender.targetPosition.z = clamp(
            this.playPlan.supportLane,
            -8.9,
            8.9
        );

        /*
         * O atacante acompanha a progressão da bola, mas o chamador da fase
         * pode sobrescrever este alvo quando ele é o portador.
         */
        attackingAttacker.targetPosition.x = clamp(
            activeX + direction * 1.35,
            -19.4,
            19.4
        );
        attackingAttacker.targetPosition.z = clamp(activeZ, -8.4, 8.4);

        /*
         * Marcação: o defensor se posiciona entre a bola e o gol, mantendo
         * distância de abordagem. Ele não tenta ocupar a posição da bola.
         */
        const ownGoalX = attackDirection(defendingTeam) * -GOAL_LINE_X;
        const distanceToGoal = Math.abs(ownGoalX - activeX);
        const blockDistance = clamp(distanceToGoal * 0.28, 3.6, 5.8);

        defendingDefender.targetPosition.x = clamp(
            activeX + direction * blockDistance,
            -18.1,
            18.1
        );
        defendingDefender.targetPosition.z = clamp(
            activeZ * 0.62 - Math.sign(activeZ || this.playPlan.lane || 1) * 0.75,
            -8.1,
            8.1
        );

        /*
         * O atacante sem posse oferece saída de contra-ataque em vez de
         * participar da aglomeração ao redor da bola.
         */
        defendingAttacker.targetPosition.x = clamp(
            activeX - direction * 8.6,
            -12.8,
            12.8
        );
        defendingAttacker.targetPosition.z = clamp(
            -activeZ * 0.5 + this.playPlan.supportLane * 0.28,
            -7.5,
            7.5
        );
    }

    private applyNeutralFormation(): void {
        for (let index = 0; index < this.players.length; index++) {
            const player = this.players[index];
            const formation = FORMATION[index];

            copyPoint(player.targetPosition, formation.neutral);

            if (
                this.currentPlayPhase !== "Neutral" &&
                this.currentPlayPhase !== "Cooldown"
            ) {
                continue;
            }

            const distance = planarDistance(
                player.position,
                formation.neutral
            );

            const velocity = this.playerVelocities.get(player.id);
            const speed = velocity
                ? Math.hypot(velocity.x, velocity.z)
                : player.currentSpeed;

            /*
             * Zona de repouso maior que a precisão numérica do movimento.
             * Assim o jogador chega, para e não fica corrigindo centímetros.
             */
            if (distance <= 0.12 && speed <= 0.45) {
                copyPoint(player.position, formation.neutral);
                copyPoint(player.targetPosition, formation.neutral);
                player.currentSpeed = 0;
                player.animation = defaultAnimation(player.role);
                player.actionProgress = 0;

                if (velocity)
                    setPoint(velocity, 0, 0, 0);
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

                const velocity = this.playerVelocities.get(player.id);
                if (velocity)
                    setPoint(velocity, 0, 0, 0);
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
                const minimumDistance = this.minimumSeparationFor(a, b, true);

                if (distanceSquared >= minimumDistance * minimumDistance)
                    continue;

                const distance = Math.max(0.001, Math.sqrt(distanceSquared));
                const fallbackAngle = deterministicUnit(
                    this.seedHash,
                    this.playIndex * 101 + first * 17 + second * 31
                ) * Math.PI * 2;
                const nx = distance > 0.01
                    ? dx / distance
                    : Math.cos(fallbackAngle);
                const nz = distance > 0.01
                    ? dz / distance
                    : Math.sin(fallbackAngle);
                const overlap = minimumDistance - distance;

                const aMobility = this.targetMobility(a);
                const bMobility = this.targetMobility(b);
                const mobilityTotal = Math.max(0.001, aMobility + bMobility);
                const aShare = aMobility / mobilityTotal;
                const bShare = bMobility / mobilityTotal;

                a.targetPosition.x -= nx * overlap * aShare;
                a.targetPosition.z -= nz * overlap * aShare;
                b.targetPosition.x += nx * overlap * bShare;
                b.targetPosition.z += nz * overlap * bShare;
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
                const minimumDistance = this.minimumSeparationFor(a, b, false);

                if (distanceSquared >= minimumDistance * minimumDistance)
                    continue;

                const distance = Math.max(0.001, Math.sqrt(distanceSquared));
                const fallbackAngle = deterministicUnit(
                    this.seedHash,
                    this.playIndex * 149 + first * 19 + second * 37
                ) * Math.PI * 2;
                const nx = distance > 0.01
                    ? dx / distance
                    : Math.cos(fallbackAngle);
                const nz = distance > 0.01
                    ? dz / distance
                    : Math.sin(fallbackAngle);
                const overlap = minimumDistance - distance;

                const aMobility = this.positionMobility(a);
                const bMobility = this.positionMobility(b);
                const mobilityTotal = Math.max(0.001, aMobility + bMobility);
                const aShare = aMobility / mobilityTotal;
                const bShare = bMobility / mobilityTotal;

                a.position.x -= nx * overlap * aShare;
                a.position.z -= nz * overlap * aShare;
                b.position.x += nx * overlap * bShare;
                b.position.z += nz * overlap * bShare;

                this.constrainPlayerPosition(a);
                this.constrainPlayerPosition(b);

                /*
                 * Remove a componente de velocidade que empurraria os dois
                 * jogadores novamente um contra o outro no frame seguinte.
                 */
                const aVelocity = this.playerVelocities.get(a.id);
                const bVelocity = this.playerVelocities.get(b.id);

                if (aVelocity) {
                    const towardB = aVelocity.x * nx + aVelocity.z * nz;
                    if (towardB > 0) {
                        aVelocity.x -= nx * towardB;
                        aVelocity.z -= nz * towardB;
                    }
                }

                if (bVelocity) {
                    const towardA = bVelocity.x * -nx + bVelocity.z * -nz;
                    if (towardA > 0) {
                        bVelocity.x += nx * towardA;
                        bVelocity.z += nz * towardA;
                    }
                }
            }
        }
    }

    private movePlayers(deltaSeconds: number): void {
        for (const player of this.players) {
            const velocity = this.playerVelocities.get(player.id);
            if (!velocity)
                continue;

            const dx = player.targetPosition.x - player.position.x;
            const dz = player.targetPosition.z - player.position.z;
            const distance = Math.hypot(dx, dz);

            if (distance <= STOP_RADIUS) {
                copyPoint(player.position, player.targetPosition);
                setPoint(velocity, 0, 0, 0);
                player.currentSpeed = 0;
                continue;
            }

            /*
             * Arrival steering: corre quando está longe e desacelera ao chegar.
             * O movimento antigo usava velocidade máxima até o último frame,
             * criando pequenas ultrapassagens e correções visuais.
             */
            const arrivalRatio = smoothStep(
                clamp(distance / ARRIVAL_RADIUS, 0, 1)
            );
            const desiredSpeed = Math.max(
                0.16,
                player.movementSpeed * arrivalRatio
            );
            const inverseDistance = 1 / Math.max(distance, 0.001);
            const desiredVelocityX = dx * inverseDistance * desiredSpeed;
            const desiredVelocityZ = dz * inverseDistance * desiredSpeed;
            const acceleration = player.role === "goalkeeper"
                ? PLAYER_MAX_ACCELERATION * 0.78
                : PLAYER_MAX_ACCELERATION;
            const maximumVelocityChange = acceleration * deltaSeconds;

            velocity.x = approach(
                velocity.x,
                desiredVelocityX,
                maximumVelocityChange
            );
            velocity.z = approach(
                velocity.z,
                desiredVelocityZ,
                maximumVelocityChange
            );

            const previousX = player.position.x;
            const previousZ = player.position.z;

            player.position.x += velocity.x * deltaSeconds;
            player.position.z += velocity.z * deltaSeconds;
            this.constrainPlayerPosition(player);

            /*
             * Não permita que a inércia ultrapasse o alvo.
             */
            const remainingX = player.targetPosition.x - player.position.x;
            const remainingZ = player.targetPosition.z - player.position.z;
            if (dx * remainingX + dz * remainingZ <= 0) {
                copyPoint(player.position, player.targetPosition);
                setPoint(velocity, 0, 0, 0);
            }

            const frameSpeed = deltaSeconds > 0
                ? Math.hypot(
                    player.position.x - previousX,
                    player.position.z - previousZ
                ) / deltaSeconds
                : 0;

            player.currentSpeed = frameSpeed < 0.12 ? 0 : frameSpeed;
        }
    }

    private constrainTargetsByRole(): void {
        for (const player of this.players) {
            if (player.role === "goalkeeper") {
                const neutral = this.neutralFor(player);
                player.targetPosition.x = clamp(
                    player.targetPosition.x,
                    neutral.x - 0.42,
                    neutral.x + 0.42
                );
                player.targetPosition.z = clamp(
                    player.targetPosition.z,
                    -3.15,
                    3.15
                );
                player.targetPosition.y = 0;
                continue;
            }

            player.targetPosition.x = clamp(
                player.targetPosition.x,
                -20.1,
                20.1
            );
            player.targetPosition.z = clamp(
                player.targetPosition.z,
                -10.5,
                10.5
            );
            player.targetPosition.y = 0;
        }
    }

    private constrainPlayerPosition(player: FuturebolPlayerState): void {
        if (player.role === "goalkeeper") {
            const neutral = this.neutralFor(player);
            player.position.x = clamp(
                player.position.x,
                neutral.x - 0.55,
                neutral.x + 0.55
            );
            player.position.z = clamp(player.position.z, -3.35, 3.35);
            player.position.y = 0;
            return;
        }

        player.position.x = clamp(
            player.position.x,
            -FIELD_HALF_LENGTH,
            FIELD_HALF_LENGTH
        );
        player.position.z = clamp(
            player.position.z,
            -FIELD_HALF_WIDTH,
            FIELD_HALF_WIDTH
        );
        player.position.y = 0;
    }

    private minimumSeparationFor(
        first: FuturebolPlayerState,
        second: FuturebolPlayerState,
        target: boolean
    ): number {
        if (first.role === "goalkeeper" || second.role === "goalkeeper")
            return target ? 2.3 : 2.05;

        const ownerInPair =
            first.id === this.currentBallOwnerId ||
            second.id === this.currentBallOwnerId;

        if (ownerInPair)
            return target ? 2.72 : 2.18;

        if (first.team !== second.team)
            return target ? 2.55 : 2.08;

        return target
            ? MINIMUM_TARGET_SEPARATION
            : MINIMUM_PLAYER_SEPARATION;
    }

    private targetMobility(player: FuturebolPlayerState): number {
        if (player.role === "goalkeeper")
            return 0.04;

        if (player.id === this.currentBallOwnerId)
            return 0.22;

        if (player.id === this.intendedReceiverId)
            return 0.38;

        return player.role === "attacker" ? 0.82 : 1;
    }

    private positionMobility(player: FuturebolPlayerState): number {
        if (player.role === "goalkeeper")
            return 0.03;

        if (player.id === this.currentBallOwnerId)
            return 0.42;

        return 1;
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

function isOngoingStatus(status: string): boolean {
    return status.trim().toLowerCase() === "ongoing";
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

function approach(
    current: number,
    target: number,
    maximumDelta: number
): number {
    if (current < target)
        return Math.min(target, current + maximumDelta);

    if (current > target)
        return Math.max(target, current - maximumDelta);

    return target;
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
