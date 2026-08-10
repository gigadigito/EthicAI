export type FuturebolTeam = "home" | "away";
export type FuturebolRole = "goalkeeper" | "defender" | "attacker";
export type FuturebolQuality = "Low" | "Medium" | "High";
export type FuturebolPlayerVisualPreference = "Auto" | "Primitives" | "Skeletal";
export type FuturebolPlayerVisualKind = "Primitives" | "Skeletal";
export type FuturebolVisualAnimationState =
    | "Idle"
    | "Walk"
    | "Run"
    | "Dribble"
    | "Pass"
    | "Shoot"
    | "GoalkeeperReady"
    | "GoalkeeperDiveLeft"
    | "GoalkeeperDiveRight"
    | "Celebrate"
    | "Disappointed";
export type FuturebolPressureOverride = FuturebolTeam | "balanced" | null;
export type FuturebolBallState = "Free" | "Controlled" | "Passing" | "Shooting" | "Saved" | "Resetting";
export type FuturebolPlayPhase =
    | "Neutral"
    | "BuildUp"
    | "Passing"
    | "Attacking"
    | "PreparingShot"
    | "Shooting"
    | "Outcome"
    | "Resetting"
    | "Cooldown";
export type FuturebolPlayerAnimation =
    | "idle"
    | "walk"
    | "run"
    | "kick"
    | "goalkeeper-ready"
    | "goalkeeper-dive";
export type FuturebolPlayOutcome = "Goal" | "Saved";

export interface FuturebolVector3State {
    x: number;
    y: number;
    z: number;
}

export interface FuturebolPlayerState {
    id: string;
    team: FuturebolTeam;
    role: FuturebolRole;
    position: FuturebolVector3State;
    targetPosition: FuturebolVector3State;
    movementSpeed: number;
    currentSpeed: number;
    facingAngle: number;
    animation: FuturebolPlayerAnimation;
    animationTime: number;
    actionProgress: number;
}

export interface FuturebolAssetState {
    symbol: string;
    price: number;
    changePercent: number;
    momentum: number;
    volumeStrength: number;
}

export interface FuturebolMarketSnapshot {
    sequence: number;
    timestamp: string;
    home: FuturebolAssetState;
    away: FuturebolAssetState;
}

export interface FuturebolOfficialScoreEvent {
    id: number;
    sequence: number;
    team: FuturebolTeam;
    points: number;
    eventType: string;
    occurredAtUtc: string;
}

export interface FuturebolOfficialMatchState {
    matchId: number;
    sequence: number;
    status: string;
    homeScore: number;
    awayScore: number;
    elapsedSeconds: number;
    isFinished: boolean;
    observedAtUtc: string;
    scoreEvents: FuturebolOfficialScoreEvent[];
}

export interface FuturebolTeamVisualConfiguration {
    symbol: string;
    logoUrl: string | null;
}

export type FuturebolTeamVisualConfigurationMap = Record<
    FuturebolTeam,
    FuturebolTeamVisualConfiguration
>;

export interface FuturebolInitializeOptions {
    dataMode: string;
    homeSymbol: string;
    awaySymbol: string;
    homeLogoUrl: string | null;
    awayLogoUrl: string | null;
    matchId: number | null;
    initialMarketSnapshot: FuturebolMarketSnapshot | null;
    initialOfficialState: FuturebolOfficialMatchState | null;
    dataError: string | null;
    seed: string;
    quality: FuturebolQuality;
    development: boolean;
    simulateWebGlFailure: boolean;
    simulatePlayerAssetFailure: boolean;
    playerVisual: FuturebolPlayerVisualPreference;
}

export interface FuturebolVisualUpdateContext {
    phase: FuturebolPlayPhase;
    activeTeam: FuturebolTeam | null;
    ballOwnerId: string | null;
    outcome: FuturebolPlayOutcome | null;
}

export interface FuturebolPlayerVisualDiagnostics {
    kind: FuturebolPlayerVisualKind;
    skeletonCount: number;
    currentAnimation: FuturebolVisualAnimationState | null;
    requestedAnimation: FuturebolVisualAnimationState | null;
}

export interface FuturebolLogoTextureDiagnostic {
    symbol: string;
    logoUrl: string | null;
    loaded: boolean;
    fallbackActive: boolean;
    error: string | null;
}

export type FuturebolLogoTextureDiagnosticMap = Record<
    FuturebolTeam,
    FuturebolLogoTextureDiagnostic
>;

export interface FuturebolMarketSourceDiagnostics {
    mode: "mock" | "api";
    lastUpdatedAt: string | null;
    error: string | null;
}

export interface FuturebolDotNetReference {
    invokeMethodAsync(methodName: "ReportFuturebolError", message: string): Promise<void>;
}
