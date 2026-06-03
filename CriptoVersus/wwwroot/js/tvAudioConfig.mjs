export const tvAudioMap = {
    goal: "/audio/tv/goal-sting.mp3",
    nearGoal: "/audio/tv/near-goal.mp3",
    pressure: "/audio/tv/pressure-rise.mp3",
    comeback: "/audio/tv/comeback.mp3",
    equalizer: "/audio/tv/equalizer.mp3",
    momentum: "/audio/tv/momentum-swing.mp3",
    fearSpike: "/audio/tv/fear-spike.mp3",
    fearCollapse: "/audio/tv/fear-collapse.mp3",
    finalMinutes: "/audio/tv/final-minutes.mp3",
    victory: "/audio/tv/victory.mp3",
    replay: "/audio/tv/replay-vinyl.mp3",
    switchSide: "/audio/tv/switch-side.mp3",
    crowdRise: "/audio/tv/stadium-crowd-loop.mp3",
    whistle: "/audio/tv/whistle.mp3",
    kickoff: "/audio/tv/kickoff.mp3",
    halftime: "/audio/tv/halftime.mp3",
    lastMinute: "/audio/tv/final-minutes.mp3",
    counterAttack: "/audio/tv/counter-attack.mp3",
    marketCrash: "/audio/tv/market-crash.mp3",
    marketPump: "/audio/tv/market-pump.mp3",
    clutchSave: "/audio/tv/clutch-save.mp3",
    bigCandleMovement: "/audio/tv/big-candle-movement.mp3",
    ballRecovery: "/audio/tv/ball-recovery.mp3",
    highlightMoment: "/audio/tv/highlight-moment.mp3",
    suddenReversal: "/audio/tv/sudden-reversal.mp3"
};

export const ambientTracks = [
    {
        src: "/audio/tv/stadium-crowd-loop.mp3?v=20260521-1",
        mood: "standard",
        intensity: 0.56,
        tags: ["stadium", "crowd", "base", "clean"]
    }
];

export const tvAudioChannelMap = {
    crowdRise: "ambient",
    goal: "fx",
    nearGoal: "fx",
    pressure: "fx",
    comeback: "fx",
    equalizer: "fx",
    momentum: "fx",
    fearSpike: "fx",
    fearCollapse: "fx",
    finalMinutes: "fx",
    victory: "fx",
    replay: "fx",
    switchSide: "fx",
    whistle: "ui",
    kickoff: "ui",
    halftime: "ui",
    lastMinute: "ui",
    counterAttack: "fx",
    marketCrash: "fx",
    marketPump: "fx",
    clutchSave: "fx",
    bigCandleMovement: "fx",
    ballRecovery: "fx",
    highlightMoment: "fx",
    suddenReversal: "fx"
};

export const tvAudioPriority = {
    goal: 100,
    victory: 95,
    equalizer: 92,
    comeback: 88,
    clutchSave: 86,
    replay: 82,
    suddenReversal: 78,
    counterAttack: 76,
    momentum: 72,
    nearGoal: 68,
    pressure: 66,
    highlightMoment: 64,
    finalMinutes: 62,
    fearSpike: 60,
    fearCollapse: 58,
    bigCandleMovement: 56,
    marketCrash: 55,
    marketPump: 55,
    ballRecovery: 52,
    switchSide: 48,
    halftime: 45,
    kickoff: 40,
    whistle: 40,
    lastMinute: 38,
    crowdRise: 20
};

export const tvAudioCooldownDefaults = {
    goal: 6500,
    replay: 12000,
    victory: 12000,
    equalizer: 9000,
    comeback: 9000,
    clutchSave: 7000,
    suddenReversal: 6500,
    counterAttack: 6000,
    momentum: 5500,
    nearGoal: 4000,
    pressure: 4500,
    highlightMoment: 5500,
    finalMinutes: 8000,
    fearSpike: 6000,
    fearCollapse: 6000,
    bigCandleMovement: 6500,
    marketCrash: 6500,
    marketPump: 6500,
    ballRecovery: 4000,
    switchSide: 8000,
    halftime: 12000,
    kickoff: 12000,
    whistle: 12000,
    lastMinute: 5000,
    crowdRise: 3000
};

export const tvAudioMixProfiles = {
    goal: { minVolume: 0.88, boost: 1.2, duckAmbientTo: 0.42, duckMs: 1800 },
    nearGoal: { minVolume: 0.8, boost: 1.08, duckAmbientTo: 0.52, duckMs: 1200 },
    pressure: { minVolume: 0.78, boost: 1.06, duckAmbientTo: 0.58, duckMs: 1000 },
    comeback: { minVolume: 0.84, boost: 1.12, duckAmbientTo: 0.48, duckMs: 1500 },
    equalizer: { minVolume: 0.88, boost: 1.18, duckAmbientTo: 0.44, duckMs: 1700 },
    momentum: { minVolume: 0.78, boost: 1.04, duckAmbientTo: 0.6, duckMs: 900 },
    fearSpike: { minVolume: 0.82, boost: 1.08, duckAmbientTo: 0.54, duckMs: 1200 },
    fearCollapse: { minVolume: 0.82, boost: 1.08, duckAmbientTo: 0.54, duckMs: 1200 },
    finalMinutes: { minVolume: 0.8, boost: 1.08, duckAmbientTo: 0.56, duckMs: 1400 },
    victory: { minVolume: 0.9, boost: 1.2, duckAmbientTo: 0.4, duckMs: 2200 },
    replay: { minVolume: 0.82, boost: 1.08, duckAmbientTo: 0.56, duckMs: 1300 },
    switchSide: { minVolume: 0.74, boost: 1.02, duckAmbientTo: 0.62, duckMs: 900 },
    whistle: { minVolume: 0.76, boost: 1.06, duckAmbientTo: 0.6, duckMs: 850 },
    kickoff: { minVolume: 0.8, boost: 1.1, duckAmbientTo: 0.54, duckMs: 1300 },
    halftime: { minVolume: 0.78, boost: 1.05, duckAmbientTo: 0.6, duckMs: 1000 },
    lastMinute: { minVolume: 0.8, boost: 1.08, duckAmbientTo: 0.56, duckMs: 1200 },
    counterAttack: { minVolume: 0.8, boost: 1.08, duckAmbientTo: 0.52, duckMs: 1100 },
    marketCrash: { minVolume: 0.86, boost: 1.14, duckAmbientTo: 0.44, duckMs: 1800 },
    marketPump: { minVolume: 0.84, boost: 1.1, duckAmbientTo: 0.5, duckMs: 1500 },
    clutchSave: { minVolume: 0.84, boost: 1.14, duckAmbientTo: 0.48, duckMs: 1500 },
    bigCandleMovement: { minVolume: 0.8, boost: 1.08, duckAmbientTo: 0.54, duckMs: 1200 },
    ballRecovery: { minVolume: 0.76, boost: 1.04, duckAmbientTo: 0.6, duckMs: 900 },
    highlightMoment: { minVolume: 0.82, boost: 1.1, duckAmbientTo: 0.5, duckMs: 1400 },
    suddenReversal: { minVolume: 0.84, boost: 1.14, duckAmbientTo: 0.46, duckMs: 1600 }
};

export function isTvAudioDebugEnabled() {
    if (typeof window === "undefined" || !window.location) {
        return false;
    }

    const host = window.location.hostname || "";
    return host === "localhost"
        || host === "127.0.0.1"
        || host === "::1"
        || host.endsWith(".local")
        || Boolean(window.CRIPTOVERSUS_TV_DEBUG);
}

export function logAmbientDebug(message, payload) {
    if (!isTvAudioDebugEnabled()) {
        return;
    }

    console.log(`[TV_AMBIENT] ${message}`, payload);
}

export function normalizeAudioError(error) {
    if (!error) {
        return { message: "unknown error" };
    }

    return {
        name: error.name ?? "Error",
        message: error.message ?? String(error)
    };
}
