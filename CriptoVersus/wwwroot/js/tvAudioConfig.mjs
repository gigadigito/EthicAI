function buildTvAudioAsset(fileName, version = null) {
    const basePath = `/audio/tv/${fileName}`;
    return {
        fileName,
        context: "tv",
        legacyPath: basePath,
        version
    };
}

export const tvAudioMap = {
    goal: buildTvAudioAsset("goal-sting.mp3"),
    nearGoal: buildTvAudioAsset("near-goal.mp3"),
    pressure: buildTvAudioAsset("pressure-rise.mp3"),
    comeback: buildTvAudioAsset("comeback.mp3"),
    equalizer: buildTvAudioAsset("equalizer.mp3"),
    momentum: buildTvAudioAsset("momentum-swing.mp3"),
    fearSpike: buildTvAudioAsset("fear-spike.mp3"),
    fearCollapse: buildTvAudioAsset("fear-collapse.mp3"),
    finalMinutes: buildTvAudioAsset("final-minutes.mp3"),
    victory: buildTvAudioAsset("victory.mp3"),
    replay: buildTvAudioAsset("replay-vinyl.mp3"),
    switchSide: buildTvAudioAsset("switch-side.mp3"),
    crowdRise: buildTvAudioAsset("stadium-crowd-loop.mp3"),
    whistle: buildTvAudioAsset("whistle.mp3"),
    kickoff: buildTvAudioAsset("kickoff.mp3"),
    halftime: buildTvAudioAsset("halftime.mp3"),
    lastMinute: buildTvAudioAsset("final-minutes.mp3"),
    counterAttack: buildTvAudioAsset("counter-attack.mp3"),
    marketCrash: buildTvAudioAsset("market-crash.mp3"),
    marketPump: buildTvAudioAsset("market-pump.mp3"),
    clutchSave: buildTvAudioAsset("clutch-save.mp3"),
    bigCandleMovement: buildTvAudioAsset("big-candle-movement.mp3"),
    ballRecovery: buildTvAudioAsset("ball-recovery.mp3"),
    highlightMoment: buildTvAudioAsset("highlight-moment.mp3"),
    suddenReversal: buildTvAudioAsset("sudden-reversal.mp3")
};

export const ambientTracks = [
    {
        ...buildTvAudioAsset("stadium-crowd-loop.mp3", "20260521-1"),
        src: "/audio/tv/stadium-crowd-loop.mp3?v=20260521-1",
        mood: "standard",
        intensity: 0.56,
        tags: ["stadium", "crowd", "base", "clean"]
    }
];

export const defaultBackgroundAudioConfig = {
    enabled: true,
    crowdEnabled: true,
    volume: 0.42,
    shuffle: false,
    rotateOnEnded: true,
    avoidImmediateRepeat: true,
    fallbackLocale: "en-US",
    tracks: []
};

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function toTrackLabel(rawPath, fallbackLabel) {
    if (typeof rawPath !== "string" || rawPath.trim().length === 0) {
        return fallbackLabel;
    }

    const normalized = rawPath.replace(/\\/g, "/").split("/").filter(Boolean);
    return normalized[normalized.length - 1] ?? fallbackLabel;
}

export function normalizeBackgroundAudioConfig(config = {}) {
    const rawTracks = Array.isArray(config?.tracks)
        ? config.tracks
        : Array.isArray(config?.crowdTracks)
            ? config.crowdTracks
            : [];

    const tracks = rawTracks
        .map((track, index) => {
            if (typeof track === "string") {
                const trimmed = track.trim();
                if (trimmed.length === 0) {
                    return null;
                }

                return {
                    key: `configured-${index}`,
                    label: toTrackLabel(trimmed, `Track ${index + 1}`),
                    rawPath: trimmed,
                    src: null,
                    sourceType: "configured"
                };
            }

            if (track && typeof track === "object") {
                const rawPath = typeof track.rawPath === "string" && track.rawPath.trim().length > 0
                    ? track.rawPath.trim()
                    : typeof track.src === "string" && track.src.trim().length > 0
                        ? track.src.trim()
                        : null;
                if (!rawPath) {
                    return null;
                }

                return {
                    ...track,
                    key: track.key ?? `configured-${index}`,
                    label: track.label ?? toTrackLabel(rawPath, `Track ${index + 1}`),
                    rawPath,
                    src: track.src ?? null,
                    sourceType: track.sourceType ?? "configured"
                };
            }

            return null;
        })
        .filter(Boolean);

    return {
        enabled: config?.enabled ?? defaultBackgroundAudioConfig.enabled,
        crowdEnabled: config?.crowdEnabled ?? defaultBackgroundAudioConfig.crowdEnabled,
        volume: clamp(Number(config?.volume ?? defaultBackgroundAudioConfig.volume) || defaultBackgroundAudioConfig.volume, 0, 1),
        shuffle: config?.shuffle ?? defaultBackgroundAudioConfig.shuffle,
        rotateOnEnded: config?.rotateOnEnded ?? defaultBackgroundAudioConfig.rotateOnEnded,
        avoidImmediateRepeat: config?.avoidImmediateRepeat ?? defaultBackgroundAudioConfig.avoidImmediateRepeat,
        fallbackLocale: typeof config?.fallbackLocale === "string" && config.fallbackLocale.trim().length > 0
            ? config.fallbackLocale.trim()
            : defaultBackgroundAudioConfig.fallbackLocale,
        tracks
    };
}

export function getBackgroundTrackIdentity(track) {
    if (!track) {
        return "";
    }

    return String(track.resolvedSrc ?? track.src ?? track.rawPath ?? track.fileName ?? track.key ?? "")
        .trim()
        .toLowerCase();
}

export function chooseNextBackgroundTrack(tracks, options = {}) {
    const playlist = Array.isArray(tracks) ? tracks.filter(Boolean) : [];
    if (playlist.length === 0) {
        return null;
    }

    if (playlist.length === 1) {
        return { track: playlist[0], index: 0 };
    }

    const currentIndex = Number.isInteger(options.currentIndex) ? options.currentIndex : -1;
    const safeExclude = String(options.excludeSrc ?? options.lastTrackSrc ?? "").trim().toLowerCase();
    const avoidImmediateRepeat = options.avoidImmediateRepeat !== false;
    const shuffle = options.shuffle === true;
    const random = typeof options.random === "function" ? options.random : Math.random;

    if (shuffle) {
        const pool = avoidImmediateRepeat && safeExclude
            ? playlist
                .map((track, index) => ({ track, index }))
                .filter((entry) => getBackgroundTrackIdentity(entry.track) !== safeExclude)
            : playlist.map((track, index) => ({ track, index }));

        const effectivePool = pool.length > 0 ? pool : playlist.map((track, index) => ({ track, index }));
        const rawPick = Number(random());
        const normalizedPick = Number.isFinite(rawPick) ? rawPick : 0;
        const selectedIndex = Math.min(
            effectivePool.length - 1,
            Math.max(0, Math.floor(normalizedPick * effectivePool.length)));
        return effectivePool[selectedIndex];
    }

    for (let step = 1; step <= playlist.length; step += 1) {
        const candidateIndex = (Math.max(currentIndex, -1) + step) % playlist.length;
        const candidate = playlist[candidateIndex];
        if (!candidate) {
            continue;
        }

        if (avoidImmediateRepeat && getBackgroundTrackIdentity(candidate) === safeExclude) {
            continue;
        }

        return { track: candidate, index: candidateIndex };
    }

    return { track: playlist[0], index: 0 };
}

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
