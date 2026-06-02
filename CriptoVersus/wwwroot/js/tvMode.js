export function log(prefixOrEventName, eventNameOrPayload, maybePayload) {
    const hasExplicitPrefix = typeof maybePayload !== "undefined";
    const prefix = hasExplicitPrefix ? prefixOrEventName : "TV_MODE";
    const eventName = hasExplicitPrefix ? eventNameOrPayload : prefixOrEventName;
    const payload = hasExplicitPrefix ? maybePayload : eventNameOrPayload;

    if (typeof payload === "undefined") {
        console.log(`[${prefix}] ${eventName}`);
        return;
    }

    console.log(`[${prefix}] ${eventName}`, payload);
}

let telemetryCubeState = null;
let telemetryChartsState = null;
let fieldFreedomState = null;

// Field freedom tuning (broadcast-friendly, no jitter)
const FIELD_FREEDOM = {
    FREEDOM_RADIUS_MULTIPLIER: 1.0,
    PLAYER_SPEED_MULTIPLIER: 1.08,
    SWAY_INTENSITY: 0.72, // px (scaled per-player + gait)
    SWAY_SPEED: 1.22,
    TARGET_PAUSE_MIN: 70,
    TARGET_PAUSE_MAX: 420,
    OVERSHOOT_STRENGTH: 0.12 // 0..0.25
};

function isReducedMotion() {
    return typeof window !== "undefined"
        && typeof window.matchMedia === "function"
        && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

async function ensureLightweightChartsLoaded() {
    if (typeof window === "undefined") {
        throw new Error("missing window");
    }

    if (window.LightweightCharts) {
        return window.LightweightCharts;
    }

    if (telemetryChartsState?.libPromise) {
        return telemetryChartsState.libPromise;
    }

    const libPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = `/js/vendor/lightweight-charts.standalone.production.js?v=20260518-1`;
        script.async = true;
        script.onload = () => {
            if (window.LightweightCharts) {
                resolve(window.LightweightCharts);
                return;
            }

            reject(new Error("LightweightCharts not found after load"));
        };
        script.onerror = () => reject(new Error("failed to load lightweight-charts"));
        document.head.appendChild(script);
    });

    telemetryChartsState = telemetryChartsState ?? { charts: new Map(), libPromise: null };
    telemetryChartsState.libPromise = libPromise;
    return libPromise;
}

const tvLogState = {
    last: new Map()
};

function throttleKey(prefix, key, minIntervalMs) {
    const mapKey = `${prefix}:${key}`;
    const now = Date.now();
    const last = tvLogState.last.get(mapKey) ?? 0;

    if (now - last < minIntervalMs) {
        return false;
    }

    tvLogState.last.set(mapKey, now);
    return true;
}

function telemetryCubeLog(message, payload) {
    if (typeof payload === "undefined") {
        console.log(`[TV_CUBE] ${message}`);
        return;
    }

    console.log(`[TV_CUBE] ${message}`, payload);
}

function telemetryChartLog(message, payload) {
    if (typeof payload === "undefined") {
        console.log(`[TV_CHART] ${message}`);
        return;
    }

    console.log(`[TV_CHART] ${message}`, payload);
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

const tvAudioMap = {
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

const ambientTracks = [
    {
        // Keep the broadcast on the clean stadium bed. Some alternate loops carry
        // intrusive SFX that read like event cues in the background.
        src: "/audio/tv/stadium-crowd-loop.mp3?v=20260521-1",
        mood: "standard",
        intensity: 0.56,
        tags: ["stadium", "crowd", "base", "clean"]
    }
];

const tvAudioChannelMap = {
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

const tvAudioPriority = {
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

const tvAudioCooldownDefaults = {
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

const tvAudioMixProfiles = {
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

let tvAudioManagerState = null;

function logTvAudio(message, payload) {
    if (!isTvAudioDebugEnabled()) {
        return;
    }

    if (typeof payload === "undefined") {
        console.log(`[TV_AUDIO] ${message}`);
        return;
    }

    console.log(`[TV_AUDIO] ${message}`, payload);
}

function consoleAudio(label, payload) {
    if (!isTvAudioDebugEnabled()) {
        return;
    }

    if (typeof payload === "undefined") {
        console.log(label);
        return;
    }

    console.log(label, payload);
}

function normalizeAudioError(error) {
    if (!error) {
        return { message: "unknown error" };
    }

    return {
        name: error.name ?? "Error",
        message: error.message ?? String(error)
    };
}

function ensureTvAudioManager() {
    if (tvAudioManagerState) {
        return tvAudioManagerState;
    }

    tvAudioManagerState = {
        volume: 0.22,
        muted: false,
        ambientElementId: null,
        ambientTargetVolume: 0.22,
        context: null,
        masterGain: null,
        channelGains: new Map(),
        sourceNodes: new WeakMap(),
        instanceGains: new WeakMap(),
        fadeTimers: new Map(),
        activeKey: null,
        activePriority: -1,
        preload: new Map(),
        lastPlayedAt: new Map(),
        unlocked: false,
        autoplayBlocked: false,
        unlockListenersAttached: false,
        initCount: 0,
        ambientStarted: false,
        lastError: null,
        lastUnlockSource: null,
        ambient: {
            hostElementId: null,
            currentAudio: null,
            currentTrack: null,
            currentIndex: -1,
            nextAudio: null,
            nextTrack: null,
            nextIndex: -1,
            lastTrackSrc: null,
            transitionMs: 1800,
            isTransitioning: false,
            visibilityListenersAttached: false,
            pausedForHiddenTab: false,
            destroyed: false
        },
        diagnostics: {
            loaded: [],
            queued: [],
            played: []
        },
        ambientDuckRestoreTimer: null
    };

    return tvAudioManagerState;
}

function resolveTvAudioChannel(key) {
    return tvAudioChannelMap[key] ?? "fx";
}

function getTvAudioContext() {
    const manager = ensureTvAudioManager();

    if (typeof window === "undefined") {
        return null;
    }

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
        return null;
    }

    if (manager.context && manager.context.state !== "closed") {
        return manager.context;
    }

    try {
        const context = new AudioContextCtor();
        const masterGain = context.createGain();
        masterGain.gain.value = 1;
        masterGain.connect(context.destination);

        manager.context = context;
        manager.masterGain = masterGain;
        manager.channelGains = new Map();
        consoleAudio("AUDIO_INIT", { contextState: context.state });
        return context;
    } catch {
        return null;
    }
}

function getChannelGain(channel) {
    const manager = ensureTvAudioManager();
    const context = getTvAudioContext();
    if (!context || !manager.masterGain) {
        return null;
    }

    if (manager.channelGains.has(channel)) {
        return manager.channelGains.get(channel);
    }

    const gain = context.createGain();
    const defaults = {
        ambient: 1,
        fx: 0.92,
        ui: 0.82
    };

    gain.gain.value = defaults[channel] ?? 0.9;
    gain.connect(manager.masterGain);
    manager.channelGains.set(channel, gain);
    return gain;
}

function connectAudioElement(audio, channel) {
    const manager = ensureTvAudioManager();
    const context = getTvAudioContext();
    if (!context || context.state !== "running") {
        return null;
    }

    if (manager.sourceNodes.has(audio)) {
        return manager.sourceNodes.get(audio);
    }

    try {
        const source = context.createMediaElementSource(audio);
        const instanceGain = context.createGain();
        const channelGain = getChannelGain(channel);

        if (!channelGain) {
            source.connect(context.destination);
        } else {
            instanceGain.connect(channelGain);
            source.connect(instanceGain);
        }

        manager.sourceNodes.set(audio, source);
        manager.instanceGains.set(audio, instanceGain);
        return source;
    } catch {
        return null;
    }
}

function fadeGainTo(gainNode, target, durationMs = 1200) {
    if (!gainNode || typeof window === "undefined") {
        return;
    }

    const manager = ensureTvAudioManager();
    const key = gainNode;
    const previous = manager.fadeTimers.get(key);
    if (previous) {
        window.cancelAnimationFrame(previous);
    }

    const start = typeof performance !== "undefined" ? performance.now() : Date.now();
    const initial = typeof gainNode.gain?.value === "number" ? gainNode.gain.value : 0;
    const safeTarget = clamp(Number(target) || 0, 0, 1);
    const safeDuration = Math.max(0, durationMs);

    if (safeDuration === 0) {
        gainNode.gain.value = safeTarget;
        return;
    }

    const tick = (now) => {
        const elapsed = Math.max(0, now - start);
        const progress = Math.min(1, elapsed / safeDuration);
        const eased = 1 - Math.pow(1 - progress, 3);
        gainNode.gain.value = initial + ((safeTarget - initial) * eased);

        if (progress < 1) {
            const rafId = window.requestAnimationFrame(tick);
            manager.fadeTimers.set(key, rafId);
        } else {
            manager.fadeTimers.delete(key);
            gainNode.gain.value = safeTarget;
        }
    };

    const rafId = window.requestAnimationFrame(tick);
    manager.fadeTimers.set(key, rafId);
}

function createPlaybackAudio(url, channel, volume, muted) {
    const audio = new Audio(url);
    audio.preload = "auto";
    audio.loop = false;
    audio.volume = 1;
    audio.muted = Boolean(muted);
    connectAudioElement(audio, channel);

    const manager = ensureTvAudioManager();
    const instanceGain = manager.instanceGains.get(audio);
    if (instanceGain) {
        instanceGain.gain.value = clamp(Number(volume) || manager.volume, 0, 1);
        if (muted) {
            instanceGain.gain.value = 0;
        }
    }

    audio.addEventListener("ended", () => {
        cleanupManagedAudio(audio);
    }, { once: true });

    return audio;
}

function resolveTvAudioUrl(key) {
    return tvAudioMap[key] ?? null;
}

function resolveTvCueVolume(key, channel, requestedVolume, manager) {
    const profile = tvAudioMixProfiles[key] ?? null;
    const numericRequested = Number(requestedVolume);
    const baseVolume = Number.isFinite(numericRequested)
        ? numericRequested
        : (channel === "fx"
            ? Math.max(manager.volume, 0.74)
            : channel === "ui"
                ? Math.max(manager.volume, 0.68)
                : manager.volume);
    const boosted = baseVolume * (profile?.boost ?? 1);
    const floor = profile?.minVolume
        ?? (channel === "fx" ? 0.74 : channel === "ui" ? 0.66 : 0.22);
    return clamp(Math.max(floor, boosted), 0, 1);
}

function duckAmbientForCue(key, manager) {
    if (manager.muted) {
        return;
    }

    const profile = tvAudioMixProfiles[key] ?? null;
    const currentAudio = manager.ambient.currentAudio;
    if (!currentAudio || !profile) {
        return;
    }

    const duckTarget = clamp(Number(profile.duckAmbientTo ?? manager.ambientTargetVolume), 0, 1);
    const duckMs = Math.max(500, Number(profile.duckMs ?? 1100));
    const currentGain = manager.instanceGains.get(currentAudio);

    if (currentGain) {
        fadeGainTo(currentGain, Math.min(manager.ambientTargetVolume, duckTarget), 180);
    } else {
        fadeMediaVolume(currentAudio, Math.min(manager.ambientTargetVolume, duckTarget), 180);
    }

    if (manager.ambientDuckRestoreTimer) {
        window.clearTimeout(manager.ambientDuckRestoreTimer);
    }

    manager.ambientDuckRestoreTimer = window.setTimeout(() => {
        const latestManager = ensureTvAudioManager();
        const latestAudio = latestManager.ambient.currentAudio;
        if (!latestAudio || latestManager.muted) {
            latestManager.ambientDuckRestoreTimer = null;
            return;
        }

        const latestGain = latestManager.instanceGains.get(latestAudio);
        if (latestGain) {
            fadeGainTo(latestGain, latestManager.ambientTargetVolume, 700);
        } else {
            fadeMediaVolume(latestAudio, latestManager.ambientTargetVolume, 700);
        }

        latestManager.ambientDuckRestoreTimer = null;
    }, duckMs);
}

function preloadTvAudio(key) {
    const manager = ensureTvAudioManager();
    const url = resolveTvAudioUrl(key);
    if (!url) {
        return null;
    }

    if (manager.preload.has(key)) {
        return manager.preload.get(key);
    }

    const audio = new Audio(url);
    audio.preload = "auto";
    audio.loop = false;
    audio.volume = 1;
    audio.muted = manager.muted;
    try {
        audio.load();
    } catch {
    }

    manager.preload.set(key, audio);
    if (!manager.diagnostics.loaded.includes(key)) {
        manager.diagnostics.loaded.push(key);
    }
    logTvAudio("preloaded", { key, url });
    return audio;
}

function preloadAllTvAudio() {
    Object.keys(tvAudioMap).forEach((key) => preloadTvAudio(key));
}

function playTvAudio(key, options = {}) {
    const manager = ensureTvAudioManager();
    const url = resolveTvAudioUrl(key);
    if (!url) {
        logTvAudio("missing asset", key);
        return false;
    }

    const priority = Number.isFinite(options.priority) ? options.priority : (tvAudioPriority[key] ?? 10);
    const cooldownMs = Number.isFinite(options.cooldownMs) ? options.cooldownMs : (tvAudioCooldownDefaults[key] ?? 2500);
    const now = Date.now();
    const lastPlayed = manager.lastPlayedAt.get(key) ?? 0;
    if (now - lastPlayed < cooldownMs) {
        return false;
    }

    if (priority < manager.activePriority && manager.activeKey && now - (manager.lastPlayedAt.get(manager.activeKey) ?? 0) < 900) {
        return false;
    }

    const channel = options.channel ?? resolveTvAudioChannel(key);
    const resolvedVolume = resolveTvCueVolume(key, channel, options.volume, manager);
    const audio = createPlaybackAudio(url, channel, resolvedVolume, Boolean(options.muted ?? manager.muted));
    audio.muted = Boolean(options.muted ?? manager.muted);
    audio.loop = Boolean(options.loop);
    consoleAudio("AUDIO_EVENT_TRIGGERED", { key, channel, priority, loop: audio.loop, resolvedVolume });

    try {
        if (!audio.loop) {
            audio.pause();
            audio.currentTime = 0;
        }
    } catch {
    }

    if (channel === "ambient" && audio.loop) {
        audio.volume = 1;
        const ambientGain = ensureTvAudioManager().instanceGains.get(audio);
        if (ambientGain) {
            ambientGain.gain.value = 0;
        }
    } else {
        duckAmbientForCue(key, manager);
    }

    consoleAudio("AUDIO_PLAY_REQUEST", { key, channel, loop: audio.loop, muted: audio.muted });
    const playback = audio.play();
    manager.lastPlayedAt.set(key, now);
    manager.activeKey = key;
    manager.activePriority = priority;
    manager.diagnostics.queued.push({ key, at: now, priority });

    if (playback && typeof playback.catch === "function") {
        playback
            .then(() => {
                manager.unlocked = true;
                manager.autoplayBlocked = false;
                manager.diagnostics.played.push({ key, at: Date.now(), priority });
                consoleAudio("AUDIO_PLAY_OK", { key, channel, loop: audio.loop });
                logTvAudio("played", { key, priority, volume: audio.volume, muted: audio.muted });
                if (channel === "ambient" && audio.loop) {
                    manager.ambientStarted = true;
                    consoleAudio("AUDIO_BACKGROUND_LOOP_STARTED", { key });
                }
            })
            .catch((error) => {
                const normalized = normalizeAudioError(error);
                manager.lastError = normalized;
                manager.autoplayBlocked = normalized.name === "NotAllowedError" || /allow|gesture|interact/i.test(normalized.message);
                consoleAudio("AUDIO_PLAY_FAIL", { key, channel, ...normalized });
                logTvAudio("play failed", { key, error: error?.message ?? String(error) });
            });
    } else {
        manager.unlocked = true;
        manager.autoplayBlocked = false;
        manager.diagnostics.played.push({ key, at: Date.now(), priority });
        consoleAudio("AUDIO_PLAY_OK", { key, channel, loop: audio.loop });
        logTvAudio("played", { key, priority, volume: audio.volume, muted: audio.muted });
        if (channel === "ambient" && audio.loop) {
            manager.ambientStarted = true;
            consoleAudio("AUDIO_BACKGROUND_LOOP_STARTED", { key });
        }
    }

    if (!audio.loop) {
        const timer = window.setTimeout(() => {
            if (manager.activeKey === key) {
                manager.activeKey = null;
                manager.activePriority = -1;
            }
        }, 1200);
        manager.diagnostics.cleanupTimer = timer;
    }

    return true;
}

async function unlockTvAudioContext(source = "manual") {
    const manager = ensureTvAudioManager();
    const context = getTvAudioContext();

    if (!context) {
        return false;
    }

    try {
        if (context.state === "suspended") {
            await context.resume();
        }

        manager.unlocked = context.state === "running";
        manager.autoplayBlocked = false;
        manager.lastUnlockSource = source;
        consoleAudio("AUDIO_UNLOCKED", { source, contextState: context.state });
        return manager.unlocked;
    } catch (error) {
        const normalized = normalizeAudioError(error);
        manager.lastError = normalized;
        consoleAudio("AUDIO_PLAY_FAIL", { key: "context-resume", source, ...normalized });
        return false;
    }
}

function ensureAudioUnlockListeners() {
    const manager = ensureTvAudioManager();
    if (typeof document === "undefined" || manager.unlockListenersAttached) {
        return;
    }

    const resume = async (event) => {
        const source = event?.type ?? "interaction";
        await unlockTvAudioContext(source);

        if (manager.ambientElementId && !manager.muted) {
            await initBroadcastAudio(manager.ambientElementId, manager.ambientTargetVolume, manager.muted);
        }
    };

    manager.unlockListenersAttached = true;
    document.addEventListener("pointerdown", resume, { passive: true });
    document.addEventListener("keydown", resume, { passive: true });
    document.addEventListener("touchstart", resume, { passive: true });
}

function getTvAudioState() {
    const manager = ensureTvAudioManager();
    const context = getTvAudioContext();
    return {
        unlocked: Boolean(manager.unlocked),
        autoplayBlocked: Boolean(manager.autoplayBlocked),
        ambientStarted: Boolean(manager.ambientStarted),
        muted: Boolean(manager.muted),
        contextState: context?.state ?? "none",
        initCount: manager.initCount,
        ambientElementId: manager.ambientElementId,
        lastError: manager.lastError?.message ?? null
    };
}

function setTvAudioSettings(volume, muted) {
    const manager = ensureTvAudioManager();
    manager.volume = Math.min(1, Math.max(0, Number(volume) || manager.volume));
    manager.muted = Boolean(muted);
    manager.preload.forEach((audio) => {
        audio.volume = 1;
        audio.muted = manager.muted;
    });

    if (manager.masterGain) {
        manager.masterGain.gain.value = manager.muted ? 0 : 1;
    }

    [manager.ambient.currentAudio, manager.ambient.nextAudio].forEach((audio) => {
        if (!audio) {
            return;
        }

        audio.muted = manager.muted;
    });

    const currentGain = manager.ambient.currentAudio ? manager.instanceGains.get(manager.ambient.currentAudio) : null;
    if (currentGain) {
        fadeGainTo(currentGain, manager.muted ? 0 : manager.ambientTargetVolume, 700);
    } else if (manager.ambient.currentAudio) {
        fadeMediaVolume(manager.ambient.currentAudio, manager.muted ? 0 : manager.ambientTargetVolume, 700);
    }
}

function fadeMediaVolume(audio, target, durationMs = 1200) {
    if (!audio || typeof window === "undefined") {
        return;
    }

    const manager = ensureTvAudioManager();
    const key = audio;
    const previous = manager.fadeTimers.get(key);
    if (previous) {
        window.cancelAnimationFrame(previous);
    }

    const start = typeof performance !== "undefined" ? performance.now() : Date.now();
    const initial = clamp(Number(audio.volume) || 0, 0, 1);
    const safeTarget = clamp(Number(target) || 0, 0, 1);
    const safeDuration = Math.max(0, durationMs);

    if (safeDuration === 0) {
        audio.volume = safeTarget;
        return;
    }

    const tick = (now) => {
        const elapsed = Math.max(0, now - start);
        const progress = Math.min(1, elapsed / safeDuration);
        const eased = 1 - Math.pow(1 - progress, 3);
        audio.volume = initial + ((safeTarget - initial) * eased);

        if (progress < 1) {
            const rafId = window.requestAnimationFrame(tick);
            manager.fadeTimers.set(key, rafId);
        } else {
            manager.fadeTimers.delete(key);
            audio.volume = safeTarget;
        }
    };

    const rafId = window.requestAnimationFrame(tick);
    manager.fadeTimers.set(key, rafId);
}

function getAmbientPlaylist() {
    return ambientTracks.filter((track) => typeof track?.src === "string" && track.src.trim().length > 0);
}

function prepareAmbientHostElement(audio) {
    if (!audio) {
        return;
    }

    try {
        audio.preload = "none";
        audio.loop = false;
        audio.muted = true;
    } catch {
    }
}

function attachAmbientLifecycleListeners() {
    const manager = ensureTvAudioManager();
    const ambient = manager.ambient;
    if (typeof document === "undefined" || ambient.visibilityListenersAttached) {
        return;
    }

    ambient.visibilityListenersAttached = true;
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            handleAmbientHiddenTab();
            return;
        }

        handleAmbientVisibleTab();
    });
}

function handleAmbientHiddenTab() {
    const manager = ensureTvAudioManager();
    const ambient = manager.ambient;
    if (!ambient.currentAudio) {
        return;
    }

    ambient.pausedForHiddenTab = true;
    const currentGain = manager.instanceGains.get(ambient.currentAudio);
    if (currentGain) {
        fadeGainTo(currentGain, 0, 900);
    }

    const pausedAudio = ambient.currentAudio;
    window.setTimeout(() => {
        if (!ambient.pausedForHiddenTab || ambient.currentAudio !== pausedAudio) {
            return;
        }

        try {
            pausedAudio.pause();
        } catch {
        }
    }, 950);

    logAmbientDebug("hidden-tab pause", {
        track: ambient.currentTrack?.src ?? null
    });
}

function handleAmbientVisibleTab() {
    const manager = ensureTvAudioManager();
    const ambient = manager.ambient;
    if (!ambient.pausedForHiddenTab) {
        return;
    }

    ambient.pausedForHiddenTab = false;
    if (manager.muted) {
        return;
    }

    resumeAmbientPlayback("visibility-resume").catch(() => { });
}

function createAmbientAudio(track) {
    const manager = ensureTvAudioManager();
    const audio = new Audio(track.src);
    audio.preload = "auto";
    audio.loop = false;
    audio.volume = 1;
    audio.muted = manager.muted;
    audio.playsInline = true;
    connectAudioElement(audio, "ambient");

    const instanceGain = manager.instanceGains.get(audio);
    if (instanceGain) {
        instanceGain.gain.value = 0;
    }

    audio.addEventListener("error", () => {
        markAmbientTrackFailed(track, "media-error");
    }, { once: true });

    return audio;
}

function prepareInitialAmbientAudio(hostAudio) {
    const manager = ensureTvAudioManager();
    const ambient = manager.ambient;
    const selection = chooseNextAmbientTrack(ambient.lastTrackSrc);
    if (!selection) {
        return false;
    }

    prepareAmbientHostElement(hostAudio);
    hostAudio.preload = "auto";
    hostAudio.playsInline = true;
    hostAudio.muted = manager.muted;
    if (hostAudio.getAttribute("src") !== selection.track.src) {
        hostAudio.setAttribute("src", selection.track.src);
        try {
            hostAudio.load();
        } catch {
        }
    }

    connectAudioElement(hostAudio, "ambient");
    const gain = manager.instanceGains.get(hostAudio);
    if (gain) {
        gain.gain.value = 0;
    } else {
        hostAudio.volume = 0;
    }

    ambient.currentAudio = hostAudio;
    ambient.currentTrack = selection.track;
    ambient.currentIndex = selection.index;
    ambient.lastTrackSrc = selection.track.src;
    hostAudio.onended = () => {
        if (ensureTvAudioManager().ambient.currentAudio !== hostAudio) {
            return;
        }

        transitionAmbientTrack("ended").catch(() => { });
    };

    ensureAmbientPreloaded(selection.track.src);
    logAmbientDebug("prepared initial", {
        src: selection.track.src,
        mood: selection.track.mood,
        intensity: selection.track.intensity
    });
    return true;
}

function markAmbientTrackFailed(track, reason) {
    const manager = ensureTvAudioManager();
    if (!track?.src) {
        return;
    }

    manager.lastError = { name: "AmbientError", message: `${track.src} :: ${reason}` };

    if (throttleKey("TV_AMBIENT", `fail:${track.src}:${reason}`, 5000)) {
        logAmbientDebug("track failed", { src: track.src, reason });
    }
}

function chooseNextAmbientTrack(excludeSrc = null) {
    const playlist = getAmbientPlaylist();
    if (playlist.length === 0) {
        return null;
    }

    const ambient = ensureTvAudioManager().ambient;
    const safeExclude = excludeSrc ?? ambient.lastTrackSrc;
    for (let step = 1; step <= playlist.length; step += 1) {
        const candidateIndex = (Math.max(ambient.currentIndex, -1) + step) % playlist.length;
        const candidate = playlist[candidateIndex];
        if (!candidate) {
            continue;
        }

        if (playlist.length > 1 && candidate.src === safeExclude) {
            continue;
        }

        return { track: candidate, index: candidateIndex };
    }

    return { track: playlist[0], index: 0 };
}

function ensureAmbientPreloaded(excludeSrc = null) {
    const manager = ensureTvAudioManager();
    const ambient = manager.ambient;
    const selection = chooseNextAmbientTrack(excludeSrc);
    if (!selection) {
        ambient.nextAudio = null;
        ambient.nextTrack = null;
        ambient.nextIndex = -1;
        return null;
    }

    if (ambient.nextTrack?.src === selection.track.src && ambient.nextAudio) {
        return { audio: ambient.nextAudio, track: ambient.nextTrack, index: ambient.nextIndex };
    }

    if (ambient.nextAudio) {
        cleanupManagedAudio(ambient.nextAudio);
    }

    const nextAudio = createAmbientAudio(selection.track);
    try {
        nextAudio.load();
    } catch {
    }

    ambient.nextAudio = nextAudio;
    ambient.nextTrack = selection.track;
    ambient.nextIndex = selection.index;

    logAmbientDebug("preloaded next", {
        src: selection.track.src,
        mood: selection.track.mood,
        intensity: selection.track.intensity
    });

    return { audio: nextAudio, track: selection.track, index: selection.index };
}

async function startAmbientAudioInstance(audio, track, reason) {
    const manager = ensureTvAudioManager();
    if (audio && !audio.paused && !audio.ended && audio.currentSrc) {
        manager.unlocked = true;
        manager.autoplayBlocked = false;
        logAmbientDebug("already playing", { src: track.src, reason });
        return true;
    }

    try {
        await audio.play();
        manager.unlocked = true;
        manager.autoplayBlocked = false;
        logAmbientDebug("play ok", { src: track.src, reason });
        return true;
    } catch (error) {
        const normalized = normalizeAudioError(error);
        manager.lastError = normalized;
        manager.autoplayBlocked = normalized.name === "NotAllowedError" || /allow|gesture|interact/i.test(normalized.message);
        markAmbientTrackFailed(track, normalized.message);
        return false;
    }
}

async function transitionAmbientTrack(reason = "rotation") {
    const manager = ensureTvAudioManager();
    const ambient = manager.ambient;
    if (ambient.isTransitioning || manager.muted || ambient.destroyed) {
        return false;
    }

    ambient.isTransitioning = true;
    try {
        const prepared = ensureAmbientPreloaded(ambient.currentTrack?.src ?? ambient.lastTrackSrc);
        if (!prepared) {
            return false;
        }

        const previousAudio = ambient.currentAudio;
        const previousTrack = ambient.currentTrack;
        const nextAudio = prepared.audio;
        const nextTrack = prepared.track;
        const nextIndex = prepared.index;
        const nextGain = manager.instanceGains.get(nextAudio);
        if (nextGain) {
            nextGain.gain.value = 0;
        }

        const started = await startAmbientAudioInstance(nextAudio, nextTrack, reason);
        if (!started) {
            if (ambient.nextAudio === nextAudio) {
                ambient.nextAudio = null;
                ambient.nextTrack = null;
                ambient.nextIndex = -1;
            }
            cleanupManagedAudio(nextAudio);
            return false;
        }

        ambient.currentAudio = nextAudio;
        ambient.currentTrack = nextTrack;
        ambient.currentIndex = nextIndex;
        ambient.lastTrackSrc = nextTrack.src;
        ambient.nextAudio = null;
        ambient.nextTrack = null;
        ambient.nextIndex = -1;
        manager.ambientStarted = true;

        if (nextGain) {
            fadeGainTo(nextGain, manager.muted ? 0 : manager.ambientTargetVolume, ambient.transitionMs);
        } else {
            fadeMediaVolume(nextAudio, manager.muted ? 0 : manager.ambientTargetVolume, ambient.transitionMs);
        }

        nextAudio.onended = () => {
            if (ensureTvAudioManager().ambient.currentAudio !== nextAudio) {
                return;
            }

            transitionAmbientTrack("ended").catch(() => { });
        };

        if (previousAudio && previousAudio !== nextAudio) {
            const previousGain = manager.instanceGains.get(previousAudio);
            if (previousGain) {
                fadeGainTo(previousGain, 0, ambient.transitionMs);
            } else {
                fadeMediaVolume(previousAudio, 0, ambient.transitionMs);
            }

            window.setTimeout(() => {
                if (ensureTvAudioManager().ambient.currentAudio === previousAudio) {
                    return;
                }

                cleanupManagedAudio(previousAudio);
            }, ambient.transitionMs + 180);
        }

        ensureAmbientPreloaded(nextTrack.src);
        logAmbientDebug("transition", {
            reason,
            from: previousTrack?.src ?? null,
            to: nextTrack.src
        });
        return true;
    } finally {
        ambient.isTransitioning = false;
    }
}

async function resumeAmbientPlayback(reason = "resume") {
    const manager = ensureTvAudioManager();
    const ambient = manager.ambient;
    if (ambient.destroyed || manager.muted) {
        return false;
    }

    if (typeof document !== "undefined" && document.hidden) {
        ambient.pausedForHiddenTab = true;
        return false;
    }

    if (ambient.currentAudio) {
        const currentGain = manager.instanceGains.get(ambient.currentAudio);
        const started = await startAmbientAudioInstance(ambient.currentAudio, ambient.currentTrack ?? { src: "unknown" }, reason);
        if (started) {
            if (currentGain) {
                fadeGainTo(currentGain, manager.ambientTargetVolume, 1200);
            } else {
                fadeMediaVolume(ambient.currentAudio, manager.ambientTargetVolume, 1200);
            }

            ensureAmbientPreloaded(ambient.currentTrack?.src ?? ambient.lastTrackSrc);
            manager.ambientStarted = true;
            return true;
        }
    }

    if (ambient.hostElementId && typeof document !== "undefined") {
        const hostAudio = document.getElementById(ambient.hostElementId);
        if (hostAudio instanceof HTMLAudioElement && prepareInitialAmbientAudio(hostAudio)) {
            const hostGain = manager.instanceGains.get(hostAudio);
            const started = await startAmbientAudioInstance(hostAudio, ambient.currentTrack ?? { src: "unknown" }, `${reason}-host-fallback`);
            if (started) {
                if (hostGain) {
                    fadeGainTo(hostGain, manager.ambientTargetVolume, 1200);
                } else {
                    fadeMediaVolume(hostAudio, manager.ambientTargetVolume, 1200);
                }

                manager.ambientStarted = true;
                return true;
            }
        }
    }

    return transitionAmbientTrack(reason);
}

function stopAmbientPlayback() {
    const manager = ensureTvAudioManager();
    const ambient = manager.ambient;
    ambient.destroyed = true;
    ambient.pausedForHiddenTab = false;
    ambient.isTransitioning = false;

    [ambient.currentAudio, ambient.nextAudio].forEach((audio) => cleanupManagedAudio(audio));
    ambient.currentAudio = null;
    ambient.currentTrack = null;
    ambient.currentIndex = -1;
    ambient.nextAudio = null;
    ambient.nextTrack = null;
    ambient.nextIndex = -1;
    ambient.lastTrackSrc = null;
    manager.ambientStarted = false;
}

function diagnoseTvAudio() {
    const manager = ensureTvAudioManager();
    const state = {
        volume: manager.volume,
        muted: manager.muted,
        loaded: [...manager.diagnostics.loaded],
        queued: manager.diagnostics.queued.slice(-20),
        played: manager.diagnostics.played.slice(-20),
        activeKey: manager.activeKey,
        activePriority: manager.activePriority,
        ambientTrack: manager.ambient.currentTrack?.src ?? null,
        ambientNextTrack: manager.ambient.nextTrack?.src ?? null
    };
    console.log("[TV_AUDIO]", state);
    return state;
}

const FIELD_MOVEMENT_DEFAULTS = {
    movementEnabled: true,
    tacticalMovementEnabled: true,
    freedomRadiusMultiplier: 1,
    collisionRadiusMultiplier: 1,
    collisionStrength: 1,
    separationStrength: 1,
    wanderStrength: 0.9,
    momentumPushStrength: 1,
    defensiveCompactness: 1,
    animationSpeed: 1,
    debug: false
};

const TACTICAL_STATES = {
    Idle: "Idle",
    SupportAttack: "SupportAttack",
    PressBall: "PressBall",
    DefendZone: "DefendZone",
    MarkOpponent: "MarkOpponent",
    RunIntoSpace: "RunIntoSpace",
    ReturnToFormation: "ReturnToFormation",
    Press: "Press",
    Track: "Track",
    Intercept: "Intercept",
    Cover: "Cover",
    Hold: "Hold",
    Fallback: "Fallback"
};

function normalizeFieldMovementOptions(options) {
    return {
        movementEnabled: options?.movementEnabled !== false,
        tacticalMovementEnabled: options?.tacticalMovementEnabled !== false,
        freedomRadiusMultiplier: clamp(Number(options?.freedomRadiusMultiplier) || 1, 0.4, 2.8),
        collisionRadiusMultiplier: clamp(Number(options?.collisionRadiusMultiplier) || 1, 0.5, 2),
        collisionStrength: clamp(Number(options?.collisionStrength) || 1, 0.1, 3),
        separationStrength: clamp(Number(options?.separationStrength) || 1, 0.1, 3),
        wanderStrength: clamp(Number(options?.wanderStrength) || 0.9, 0, 3),
        momentumPushStrength: clamp(Number(options?.momentumPushStrength) || 1, 0.1, 3),
        defensiveCompactness: clamp(Number(options?.defensiveCompactness) || 1, 0.2, 3),
        animationSpeed: clamp(Number(options?.animationSpeed) || 1, 0.3, 2.5),
        debug: Boolean(options?.debug)
    };
}

function readFieldMovementContext(root) {
    const teamA = root.dataset?.teamA || "";
    const teamB = root.dataset?.teamB || "";
    const ballCarrier = root.querySelector(".tv-field__player.has-ball");

    return {
        teamA,
        teamB,
        possessionA: clamp(Number(root.dataset?.possessionA) || 50, 0, 100),
        possessionB: clamp(Number(root.dataset?.possessionB) || 50, 0, 100),
        pressureA: clamp(Number(root.dataset?.pressureA) || 0, -4, 4),
        pressureB: clamp(Number(root.dataset?.pressureB) || 0, -4, 4),
        momentumOwner: root.dataset?.momentumOwner || "",
        leader: root.dataset?.leader || "",
        ballOwner: ballCarrier?.dataset?.teamSymbol || ""
    };
}

function stringEquals(a, b) {
    return String(a || "").toLowerCase() === String(b || "").toLowerCase();
}

function addVector(a, b) {
    return { x: a.x + b.x, y: a.y + b.y };
}

function subtractVector(a, b) {
    return { x: a.x - b.x, y: a.y - b.y };
}

function scaleVector(vector, scalar) {
    return { x: vector.x * scalar, y: vector.y * scalar };
}

function vectorMagnitude(vector) {
    return Math.hypot(vector.x, vector.y);
}

function normalizeVector(vector) {
    const length = vectorMagnitude(vector);
    if (length <= 0.00001) {
        return { x: 0, y: 0 };
    }

    return { x: vector.x / length, y: vector.y / length };
}

function limitVectorMagnitude(vector, max) {
    const length = vectorMagnitude(vector);
    if (length <= max || length <= 0.00001) {
        return vector;
    }

    const factor = max / length;
    vector.x *= factor;
    vector.y *= factor;
    return vector;
}

export function destroyFieldSway(rootId = "tv-crypto-field") {
    if (!fieldFreedomState) {
        return;
    }

    if (rootId && fieldFreedomState.rootId && fieldFreedomState.rootId !== rootId) {
        return;
    }

    if (fieldFreedomState.rafId) {
        cancelAnimationFrame(fieldFreedomState.rafId);
    }

    for (const player of fieldFreedomState.players ?? []) {
        if (!player?.node?.isConnected) {
            continue;
        }

        player.node.classList.remove("is-free-walking");
        player.node.style.setProperty("--tv-free-x", "0px");
        player.node.style.setProperty("--tv-free-y", "0px");
        player.node.style.removeProperty("--tv-debug-target-x");
        player.node.style.removeProperty("--tv-debug-target-y");
        player.node.style.removeProperty("--tv-debug-vel-x");
        player.node.style.removeProperty("--tv-debug-vel-y");
    }

    fieldFreedomState.root?.classList.remove("tv-field--movement-debug");
    fieldFreedomState = null;
}

export function initFieldSway(rootId = "tv-crypto-field", options = {}) {
    const root = document.getElementById(rootId);
    if (!root) {
        return;
    }

    const overlay = root.querySelector(".tv-field__overlay");
    if (!overlay) {
        return;
    }

    if (isReducedMotion()) {
        destroyFieldSway(rootId);
        return;
    }

    const normalizedOptions = normalizeFieldMovementOptions(options);
    root.classList.toggle("tv-field--movement-debug", normalizedOptions.debug);

    if (!normalizedOptions.movementEnabled) {
        destroyFieldSway(rootId);
        return;
    }

    if (fieldFreedomState?.root === root) {
        fieldFreedomState.rootId = rootId;
        fieldFreedomState.options = normalizedOptions;
        fieldFreedomState.context = readFieldMovementContext(root);
        fieldFreedomState.players = collectTacticalPlayers(root, fieldFreedomState);
        return;
    }

    destroyFieldSway(rootId);

    fieldFreedomState = {
        rootId,
        root,
        overlay,
        options: normalizedOptions,
        context: readFieldMovementContext(root),
        players: [],
        startedAt: performance.now(),
        lastNow: 0,
        rafId: 0,
        refreshAt: 0
    };

    fieldFreedomState.players = collectTacticalPlayers(root, fieldFreedomState);

    const tick = (now) => {
        if (!fieldFreedomState || fieldFreedomState.root !== root) {
            return;
        }

        if (!fieldFreedomState.refreshAt || now - fieldFreedomState.refreshAt > 700) {
            fieldFreedomState.context = readFieldMovementContext(root);
            fieldFreedomState.players = collectTacticalPlayers(root, fieldFreedomState);
            fieldFreedomState.refreshAt = now;
        }

        applyTacticalFieldMotion(fieldFreedomState, now);
        fieldFreedomState.rafId = requestAnimationFrame(tick);
    };

    fieldFreedomState.rafId = requestAnimationFrame(tick);
}

function collectTacticalPlayers(root, state) {
    const previousPlayers = state?.players ?? [];
    const prevByKey = new Map(previousPlayers.map((player) => [player.key, player]));
    const players = [];

    for (const node of Array.from(root.querySelectorAll(".tv-field__player"))) {
        const seed = Number(node.dataset?.swaySeed);
        const stableSeed = Number.isFinite(seed) ? seed : Math.floor(Math.random() * 10000);
        const playerIndex = Number(node.dataset?.playerIndex);
        const side = node.dataset?.side || (node.classList.contains("is-left") ? "left" : "right");
        const key = `${side}:${Number.isFinite(playerIndex) ? playerIndex : -1}:${stableSeed}`;
        const baseXPercent = Number(node.dataset?.baseX);
        const baseYPercent = Number(node.dataset?.baseY);
        const role = resolveFieldRole(node, playerIndex);
        const existing = prevByKey.get(key);

        if (existing) {
            existing.node = node;
            existing.teamSymbol = node.dataset?.teamSymbol || existing.teamSymbol;
            existing.side = side;
            existing.role = role;
            existing.baseXPercent = Number.isFinite(baseXPercent) ? baseXPercent : existing.baseXPercent;
            existing.baseYPercent = Number.isFinite(baseYPercent) ? baseYPercent : existing.baseYPercent;
            hydratePlayerFlags(existing);
            node.classList.add("is-free-walking");
            players.push(primeTacticalPlayer(existing, state));
            continue;
        }

        const player = {
            key,
            node,
            seed: stableSeed,
            playerIndex,
            teamSymbol: node.dataset?.teamSymbol || "",
            side,
            role,
            baseXPercent: Number.isFinite(baseXPercent) ? baseXPercent : 50,
            baseYPercent: Number.isFinite(baseYPercent) ? baseYPercent : 50,
            position: { x: 0, y: 0 },
            velocity: { x: 0, y: 0 },
            acceleration: { x: 0, y: 0 },
            target: { x: 0, y: 0 },
            tacticalState: TACTICAL_STATES.Idle,
            tacticalDecision: null,
            freedomRadius: 0,
            maxSpeed: 0,
            maxForce: 0,
            wanderAngle: randomFloat01(stableSeed + 11) * Math.PI * 2,
            phase: randomFloat01(stableSeed + 17) * Math.PI * 2,
            stride: 0.84 + randomFloat01(stableSeed + 23) * 0.54,
            sway: 0.82 + randomFloat01(stableSeed + 29) * 0.44,
            reactionDelayMs: 100 + Math.floor(randomFloat01(stableSeed + 53) * 700),
            nextDecisionAt: 0,
            targetCooldownUntil: 0,
            targetEnemyKey: "",
            targetThreatScore: 0,
            lastDecisionReason: "",
            tacticalRadiusMultiplier: 1,
            tacticalSpeedMultiplier: 1,
            tacticalForceMultiplier: 1
        };

        hydratePlayerFlags(player);
        node.classList.add("is-free-walking");
        players.push(primeTacticalPlayer(player, state));
    }

    return players;
}

function hydratePlayerFlags(player) {
    player.hasBall = player.node.classList.contains("has-ball");
    player.isAttacking = player.node.classList.contains("is-attacking");
    player.isDefending = player.node.classList.contains("is-defending");
    player.hasMomentum = player.node.classList.contains("has-momentum");
    return player;
}

function primeTacticalPlayer(player, state) {
    player.freedomRadius = resolveTacticalFreedomRadiusPx(player, state);
    player.collisionRadius = resolveTacticalCollisionRadiusPx(player, state);
    player.maxSpeed = resolveTacticalMaxSpeed(player);
    player.maxForce = resolveTacticalMaxForce(player);
    return player;
}

function resolveFieldRole(node, playerIndex) {
    if (node.dataset?.role) {
        return node.dataset.role;
    }

    if (playerIndex === 0) return "goalkeeper";
    if (playerIndex <= 2) return "defender";
    if (playerIndex === 3) return "midfielder";
    return "attacker";
}

function resolveTacticalFreedomRadiusPx(player, state) {
    const options = state?.options ?? FIELD_MOVEMENT_DEFAULTS;
    let base = player.role === "goalkeeper"
        ? 12
        : player.role === "defender"
            ? 22
            : player.role === "midfielder"
                ? 32
                : 40;

    if (player.hasBall) base += 12;
    if (player.isAttacking) base += 6;
    if (player.isDefending) base -= 4;
    if (player.hasMomentum) base += 4;

    return clamp(base * options.freedomRadiusMultiplier, player.role === "goalkeeper" ? 8 : 14, 72);
}

function resolveTacticalCollisionRadiusPx(player, state) {
    const options = state?.options ?? FIELD_MOVEMENT_DEFAULTS;
    const rect = player.node?.getBoundingClientRect?.();
    const visualRadius = rect ? Math.max(rect.width, rect.height) * 0.38 : 14;
    const roleBias = player.role === "goalkeeper"
        ? 0.92
        : player.role === "defender"
            ? 1.04
            : player.role === "midfielder"
                ? 1.0
                : 0.98;

    return clamp(visualRadius * roleBias * options.collisionRadiusMultiplier, 10, 26);
}

function resolveTacticalMaxSpeed(player) {
    const base = player.role === "goalkeeper"
        ? 18
        : player.role === "defender"
            ? 30
            : player.role === "midfielder"
                ? 36
                : 42;
    return base * (0.9 + randomFloat01(player.seed + 41) * 0.28);
}

function resolveTacticalMaxForce(player) {
    const base = player.role === "goalkeeper"
        ? 30
        : player.role === "defender"
            ? 42
            : player.role === "midfielder"
                ? 50
                : 56;
    return base * (0.92 + randomFloat01(player.seed + 47) * 0.24);
}

function collectFreedomPlayers(root, previousPlayers = []) {
    const prevByKey = new Map(previousPlayers.map((p) => [p.key, p]));
    const nodes = Array.from(root.querySelectorAll(".tv-field__player"));
    const players = [];

    const ensureTuning = (player) => {
        // Per-player rhythm (stable across refreshes)
        if (!Number.isFinite(player.phase)) {
            player.phase = randomFloat01(player.seed + 19) * Math.PI * 2;
        }

        if (!Number.isFinite(player.speedMultiplier)) {
            // Slight spread in walking speed
            player.speedMultiplier = 0.82 + randomFloat01(player.seed + 23) * 0.52; // 0.82..1.34
        }

        if (!Number.isFinite(player.swayIntensity)) {
            player.swayIntensity = 0.85 + randomFloat01(player.seed + 29) * 0.55; // 0.85..1.40
        }

        if (!Number.isFinite(player.swaySpeed)) {
            player.swaySpeed = 0.78 + randomFloat01(player.seed + 31) * 0.74; // 0.78..1.52
        }

        if (!Number.isFinite(player.pauseMultiplier)) {
            // Some players "scan" more, others keep moving
            player.pauseMultiplier = 0.72 + randomFloat01(player.seed + 37) * 0.78; // 0.72..1.50
        }

        return player;
    };

    for (const node of nodes) {
        const seed = Number(node.dataset?.swaySeed);
        const stableSeed = Number.isFinite(seed) ? seed : Math.floor(Math.random() * 10000);
        const playerIndex = Number(node.dataset?.playerIndex);
        const key = `${stableSeed}:${Number.isFinite(playerIndex) ? playerIndex : -1}:${node.classList.contains("is-left") ? "L" : "R"}`;

        const existing = prevByKey.get(key);
        if (existing) {
            existing.node = node;
            existing.seed = stableSeed;
            ensureTuning(existing);
            node.classList.add("is-free-walking");
            players.push(existing);
            continue;
        }

        const radius = resolveFreedomRadiusPx(node, playerIndex);
        const initial = randomPointInCircle(radius, stableSeed);
        const target = randomPointInCircle(radius, stableSeed + 31);

        node.classList.add("is-free-walking");
        node.style.setProperty("--tv-free-x", `${initial.x.toFixed(2)}px`);
        node.style.setProperty("--tv-free-y", `${initial.y.toFixed(2)}px`);

        players.push(ensureTuning({
            key,
            node,
            seed: stableSeed,
            playerIndex,
            radius,
            ox: initial.x,
            oy: initial.y,
            tx: target.x,
            ty: target.y,
            vx: 0,
            vy: 0,
            waitUntil: performance.now() + randomRangeMs(
                FIELD_FREEDOM.TARGET_PAUSE_MIN,
                FIELD_FREEDOM.TARGET_PAUSE_MAX,
                stableSeed + 7
            )
        }));
    }

    return players;
}

function resolveFreedomRadiusPx(node, playerIndex) {
    // Role approximation by index: 0 GK; 1-2 defenders; 3 mid; 4-6 attackers
    let base = 2.2;
    if (playerIndex === 0) base = 0.65;
    else if (playerIndex <= 2) base = 1.6;
    else if (playerIndex === 3) base = 2.2;
    else if (playerIndex <= 5) base = 3.0;
    else base = 2.6;

    // Dynamic: slightly larger for attacking situations, smaller for deep defending.
    if (node.classList.contains("has-ball")) base += 0.7;
    if (node.classList.contains("is-attacking")) base += 0.35;
    if (node.classList.contains("is-defending")) base -= 0.2;
    if (node.classList.contains("has-momentum")) base += 0.25;

    // Requested scaling
    let multiplier = 1.0;
    if (playerIndex === 0) multiplier = 1.0;
    else if (playerIndex <= 2) multiplier = 1.15;
    else if (playerIndex === 3) multiplier = 1.25;
    else multiplier = 1.30;
    if (node.classList.contains("has-ball")) multiplier *= 1.35;

    const scaled = base * multiplier * FIELD_FREEDOM.FREEDOM_RADIUS_MULTIPLIER;
    return Math.max(0.5, Math.min(6.2, scaled));
}

function randomRangeMs(min, max, seed) {
    const t = Math.sin(seed * 999) * 10000;
    const frac = t - Math.floor(t);
    return min + (max - min) * frac;
}

function randomFloat01(seed) {
    const t = Math.sin(seed * 12.9898) * 43758.5453;
    const frac = t - Math.floor(t);
    return frac < 0 ? frac + 1 : frac;
}

function randomPointInCircle(radius, seed) {
    const a = (Math.sin(seed * 12.9898) * 43758.5453) % (Math.PI * 2);
    const r = Math.sqrt(Math.abs(Math.sin(seed * 78.233))) * radius;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

function clampOffsetToField(player, overlayRect, playerRect) {
    // Keep the transformed player fully inside the overlay.
    const halfW = playerRect.width / 2;
    const halfH = playerRect.height / 2;
    const centerX = playerRect.left - overlayRect.left + halfW;
    const centerY = playerRect.top - overlayRect.top + halfH;

    const minX = halfW;
    const maxX = overlayRect.width - halfW;
    const minY = halfH;
    const maxY = overlayRect.height - halfH;

    let ox = player.ox;
    let oy = player.oy;

    if (centerX < minX) ox += (minX - centerX);
    if (centerX > maxX) ox -= (centerX - maxX);
    if (centerY < minY) oy += (minY - centerY);
    if (centerY > maxY) oy -= (centerY - maxY);

    player.ox = ox;
    player.oy = oy;
}

function applyTacticalFieldMotion(state, now) {
    const dt = Math.min(0.05, state.lastNow ? (now - state.lastNow) / 1000 : 1 / 60);
    state.lastNow = now;

    if (!state.options.movementEnabled || dt <= 0) {
        return;
    }

    const overlayRect = state.overlay.getBoundingClientRect();
    const ballInfo = resolveTacticalBallInfo(state, overlayRect);
    const tacticalSnapshot = buildTacticalSnapshot(state, ballInfo, overlayRect, now);

    for (const player of state.players) {
        if (!player?.node?.isConnected) {
            continue;
        }

        primeTacticalPlayer(player, state);
        player.tacticalDecision = resolveTacticalDecision(player, state, ballInfo, tacticalSnapshot, overlayRect, now);
        player.tacticalState = player.tacticalDecision?.state ?? TACTICAL_STATES.Idle;
        hydrateTacticalMotionProfile(player);
        player.target = resolveTacticalTarget(player, state, ballInfo, tacticalSnapshot, overlayRect, now);
        player.acceleration = { x: 0, y: 0 };

        applySteeringForce(player, arriveSteeringForce(player, player.target), isHighUrgencyTacticalState(player.tacticalState) ? 1.85 : 1.15);
        applySteeringForce(player, separationSteeringForce(player, state.players, overlayRect, state.options.separationStrength), 1.2);
        applySteeringForce(player, avoidCrowdingForce(player, state.players, overlayRect), 0.9);
        applySteeringForce(player, returnToFormationForce(player), isActiveTacticalState(player.tacticalState) ? 0.22 : 0.85);

        if (state.options.tacticalMovementEnabled) {
            applySteeringForce(player, wanderSteeringForce(player, dt, state.options.wanderStrength), isActiveTacticalState(player.tacticalState) ? 0.12 : 0.55);
        }

        player.velocity.x += player.acceleration.x * dt;
        player.velocity.y += player.acceleration.y * dt;
        limitVectorMagnitude(player.velocity, Math.max(12, player.maxSpeed * player.tacticalSpeedMultiplier * state.options.animationSpeed));

        player.position.x += player.velocity.x * dt;
        player.position.y += player.velocity.y * dt;
    }

    resolvePlayerCollisions(state.players, overlayRect, state.options.collisionStrength);

    for (const player of state.players) {
        if (!player?.node?.isConnected) {
            continue;
        }

        clampPlayerToFreedomRadius(player);
        clampPlayerToOverlay(player, overlayRect);

        const visual = resolveTacticalVisualOffset(player, now);
        player.node.style.setProperty("--tv-free-x", `${visual.x.toFixed(2)}px`);
        player.node.style.setProperty("--tv-free-y", `${visual.y.toFixed(2)}px`);

        if (state.options.debug) {
            player.node.style.setProperty("--tv-debug-target-x", `${(player.target.x - player.position.x).toFixed(2)}px`);
            player.node.style.setProperty("--tv-debug-target-y", `${(player.target.y - player.position.y).toFixed(2)}px`);
            player.node.style.setProperty("--tv-debug-vel-x", `${player.velocity.x.toFixed(2)}px`);
            player.node.style.setProperty("--tv-debug-vel-y", `${player.velocity.y.toFixed(2)}px`);
            player.node.dataset.tacticalState = player.tacticalState || "";
            player.node.dataset.tacticalEnemy = player.targetEnemyKey || "";
            player.node.dataset.tacticalDestination = `${player.target.x.toFixed(1)},${player.target.y.toFixed(1)}`;
            player.node.title = `${player.tacticalState || "Idle"} | enemy=${player.targetEnemyKey || "-"} | target=${player.target.x.toFixed(1)},${player.target.y.toFixed(1)} | reason=${player.lastDecisionReason || "-"}`;
        }
    }
}

function cleanupManagedAudio(audio) {
    if (!audio) {
        return;
    }

    const manager = ensureTvAudioManager();
    const gain = manager.instanceGains.get(audio);
    if (gain) {
        try {
            gain.disconnect();
        } catch {
        }
    }

    const source = manager.sourceNodes.get(audio);
    if (source) {
        try {
            source.disconnect();
        } catch {
        }
    }

    manager.instanceGains.delete(audio);
    manager.sourceNodes.delete(audio);

    try {
        audio.pause();
    } catch {
    }

    try {
        audio.removeAttribute("src");
        audio.load();
    } catch {
    }
}

function hydrateTacticalMotionProfile(player) {
    switch (player.tacticalState) {
        case TACTICAL_STATES.Press:
            player.tacticalRadiusMultiplier = 2.3;
            player.tacticalSpeedMultiplier = 1.42;
            player.tacticalForceMultiplier = 1.7;
            break;
        case TACTICAL_STATES.Track:
            player.tacticalRadiusMultiplier = 2.1;
            player.tacticalSpeedMultiplier = 1.34;
            player.tacticalForceMultiplier = 1.52;
            break;
        case TACTICAL_STATES.Intercept:
            player.tacticalRadiusMultiplier = 2.2;
            player.tacticalSpeedMultiplier = 1.38;
            player.tacticalForceMultiplier = 1.62;
            break;
        case TACTICAL_STATES.Cover:
        case TACTICAL_STATES.Fallback:
            player.tacticalRadiusMultiplier = 1.8;
            player.tacticalSpeedMultiplier = 1.2;
            player.tacticalForceMultiplier = 1.32;
            break;
        case TACTICAL_STATES.Hold:
            player.tacticalRadiusMultiplier = 1.35;
            player.tacticalSpeedMultiplier = 1.04;
            player.tacticalForceMultiplier = 1.08;
            break;
        default:
            player.tacticalRadiusMultiplier = 1;
            player.tacticalSpeedMultiplier = 1;
            player.tacticalForceMultiplier = 1;
            break;
    }
}

function isActiveTacticalState(state) {
    return state === TACTICAL_STATES.Press
        || state === TACTICAL_STATES.Track
        || state === TACTICAL_STATES.Intercept
        || state === TACTICAL_STATES.Cover
        || state === TACTICAL_STATES.Fallback;
}

function isHighUrgencyTacticalState(state) {
    return state === TACTICAL_STATES.Press
        || state === TACTICAL_STATES.Track
        || state === TACTICAL_STATES.Intercept;
}

function resolveTacticalBallInfo(state, overlayRect) {
    const carrier = state.players.find((player) => player.hasBall) ?? null;

    if (!carrier) {
        return {
            carrier: null,
            x: overlayRect.width / 2,
            y: overlayRect.height / 2,
            owner: state.context.ballOwner || state.context.momentumOwner || state.context.leader || state.context.teamA
        };
    }

    const world = toTacticalWorldPoint(carrier, overlayRect);
    return {
        carrier,
        x: world.x,
        y: world.y,
        owner: carrier.teamSymbol
    };
}

function buildTacticalSnapshot(state, ballInfo, overlayRect, now) {
    const players = state.players.filter((player) => player?.node?.isConnected);
    const context = state.context;
    const teamAPlayers = players.filter((player) => stringEquals(player.teamSymbol, context.teamA));
    const teamBPlayers = players.filter((player) => stringEquals(player.teamSymbol, context.teamB));
    const ownerTeam = ballInfo.owner || context.ballOwner || context.momentumOwner || context.teamA;
    const ballSideY = overlayRect.height <= 0 ? 0.5 : clamp(ballInfo.y / overlayRect.height, 0, 1);
    const defendingTeam = stringEquals(ownerTeam, context.teamA) ? context.teamB : context.teamA;

    const teamInfo = new Map([
        [context.teamA, { players: teamAPlayers, goalX: 0, defendDir: -1, attackDir: 1 }],
        [context.teamB, { players: teamBPlayers, goalX: overlayRect.width, defendDir: 1, attackDir: -1 }]
    ]);

    const threatTable = new Map();
    for (const [teamSymbol, info] of teamInfo.entries()) {
        const opponents = players.filter((player) => !stringEquals(player.teamSymbol, teamSymbol));
        const defenders = info.players;

        for (const enemy of opponents) {
            const enemyWorld = toTacticalWorldPoint(enemy, overlayRect);
            const predicted = predictPlayerWorldPosition(enemy, overlayRect, 0.45);
            const threat = evaluateThreat(enemy, enemyWorld, predicted, defenders, info.goalX, ballInfo, overlayRect, now);
            threatTable.set(`${teamSymbol}|${enemy.key}`, threat);

            if (threat.recentDangerous) {
                state.threatMemory = state.threatMemory ?? new Map();
                state.threatMemory.set(enemy.key, now + 2400);
            }
        }
    }

    if (state.threatMemory instanceof Map) {
        for (const [key, expiresAt] of state.threatMemory.entries()) {
            if (expiresAt <= now) {
                state.threatMemory.delete(key);
            }
        }
    }

    return {
        players,
        now,
        ownerTeam,
        defendingTeam,
        ballSideY,
        teamInfo,
        threatTable
    };
}

function isTvAudioDebugEnabled() {
    if (typeof window === "undefined" || !window.location) {
        return false;
    }

    const host = window.location.hostname || "";
    return host === "localhost"
        || host === "127.0.0.1"
        || host === "::1"
        || host.endsWith(".local");
}

function logAmbientDebug(message, payload) {
    if (!isTvAudioDebugEnabled()) {
        return;
    }

    if (typeof payload === "undefined") {
        console.log(`[TV_AMBIENT] ${message}`);
        return;
    }

    console.log(`[TV_AMBIENT] ${message}`, payload);
}

function evaluateThreat(enemy, enemyWorld, predictedWorld, defenders, ownGoalX, ballInfo, overlayRect, now) {
    const goalDistance = Math.max(1, Math.abs(predictedWorld.x - ownGoalX));
    const goalCloseness = clamp(1 - (goalDistance / Math.max(1, overlayRect.width * 0.78)), 0, 1);
    const ballDistance = Math.max(1, Math.hypot(predictedWorld.x - ballInfo.x, predictedWorld.y - ballInfo.y));
    const ballCloseness = clamp(1 - (ballDistance / Math.max(1, overlayRect.width * 0.42)), 0, 1);
    const velocity = enemy.velocity ?? { x: 0, y: 0 };
    const towardGoalDir = ownGoalX < enemyWorld.x ? -1 : 1;
    const goalRun = clamp((velocity.x * towardGoalDir) / Math.max(1, enemy.maxSpeed || 1), -1, 1);
    const nearestDefenderDistance = defenders.length === 0
        ? overlayRect.width
        : Math.min(...defenders.map((defender) => {
            const defenderWorld = toTacticalWorldPoint(defender, overlayRect);
            return Math.hypot(predictedWorld.x - defenderWorld.x, predictedWorld.y - defenderWorld.y);
        }));
    const isFree = clamp((nearestDefenderDistance - 26) / 120, 0, 1);
    const passLane = evaluatePassLaneOpen(ballInfo, predictedWorld, defenders, overlayRect);
    const recentDangerous = enemy.hasBall
        || goalCloseness > 0.72
        || (ballCloseness > 0.64 && passLane > 0.55)
        || (goalRun > 0.32 && isFree > 0.45);

    const score =
        (goalCloseness * 34)
        + (ballCloseness * 22)
        + (Math.max(0, goalRun) * 14)
        + (isFree * 12)
        + (passLane * 10)
        + (recentDangerous ? 8 : 0)
        + (enemy.hasBall ? 12 : 0);

    return {
        score,
        predictedWorld,
        ballDistance,
        goalDistance,
        goalCloseness,
        isFree,
        passLane,
        goalRun,
        recentDangerous
    };
}

function evaluatePassLaneOpen(ballInfo, targetWorld, defenders, overlayRect) {
    if (!ballInfo?.carrier || defenders.length === 0) {
        return 0.5;
    }

    const carrierWorld = { x: ballInfo.x, y: ballInfo.y };
    const laneLength = Math.max(1, Math.hypot(targetWorld.x - carrierWorld.x, targetWorld.y - carrierWorld.y));
    let bestBlock = 0;

    for (const defender of defenders) {
        const defenderWorld = toTacticalWorldPoint(defender, overlayRect);
        const lanePoint = nearestPointOnSegment(defenderWorld, carrierWorld, targetWorld);
        const laneDistance = Math.hypot(defenderWorld.x - lanePoint.x, defenderWorld.y - lanePoint.y);
        const alongLane = Math.hypot(lanePoint.x - carrierWorld.x, lanePoint.y - carrierWorld.y) / laneLength;
        const blockScore = clamp(1 - (laneDistance / 42), 0, 1) * clamp(1 - Math.abs(alongLane - 0.55) * 1.5, 0.2, 1);
        if (blockScore > bestBlock) {
            bestBlock = blockScore;
        }
    }

    return clamp(1 - bestBlock, 0, 1);
}

function resolveTacticalDecision(player, state, ballInfo, snapshot, overlayRect, now) {
    if (player.role === "goalkeeper" || !state.options.tacticalMovementEnabled) {
        return {
            state: TACTICAL_STATES.Idle,
            targetEnemyKey: "",
            threatScore: 0,
            reason: "idle"
        };
    }

    if (player.nextDecisionAt > now && player.tacticalDecision) {
        return player.tacticalDecision;
    }

    const inPossession = stringEquals(player.teamSymbol, snapshot.ownerTeam);
    let decision;

    if (inPossession) {
        decision = resolveOffensiveDecision(player, state, ballInfo, snapshot, overlayRect);
    } else {
        decision = resolveDefensiveDecision(player, state, ballInfo, snapshot, overlayRect, now);
    }

    const previousTarget = player.targetEnemyKey || "";
    const nextTarget = decision.targetEnemyKey || "";
    if (previousTarget && nextTarget && previousTarget !== nextTarget && player.targetCooldownUntil > now) {
        decision = {
            ...decision,
            targetEnemyKey: previousTarget,
            targetEnemy: decision.targetEnemyFallback ?? decision.targetEnemy ?? null,
            reason: `${decision.reason}|cooldown-hold`
        };
    } else if (previousTarget !== nextTarget) {
        player.targetCooldownUntil = now + 650;
    }

    player.targetEnemyKey = decision.targetEnemyKey || "";
    player.targetThreatScore = decision.threatScore || 0;
    player.lastDecisionReason = decision.reason || "";
    player.nextDecisionAt = now + Math.max(110, Math.min(180, player.reactionDelayMs));
    player.tacticalDecision = decision;

    if (state.options.debug && throttleKey("TV_TACTIC", `${player.key}:${decision.state}:${player.targetEnemyKey || "none"}`, 1800)) {
        console.log("[TV_TACTIC]", {
            playerId: player.key,
            defensiveState: decision.state,
            targetEnemyId: player.targetEnemyKey || null,
            threatScore: Number((decision.threatScore || 0).toFixed(2)),
            reason: decision.reason
        });
    }

    return decision;
}

function resolveOffensiveDecision(player, state, ballInfo, snapshot, overlayRect) {
    if (player.hasBall || player.role === "attacker") {
        return { state: TACTICAL_STATES.RunIntoSpace, targetEnemyKey: "", threatScore: 0, reason: "attack-run" };
    }

    if (player.role === "midfielder" || player.isAttacking) {
        return { state: TACTICAL_STATES.SupportAttack, targetEnemyKey: "", threatScore: 0, reason: "support-attack" };
    }

    return { state: TACTICAL_STATES.Hold, targetEnemyKey: "", threatScore: 0, reason: "offensive-hold" };
}

function resolveDefensiveDecision(player, state, ballInfo, snapshot, overlayRect, now) {
    const enemyPlayers = snapshot.players.filter((candidate) => !stringEquals(candidate.teamSymbol, player.teamSymbol));
    const pressPlayers = ballInfo.carrier ? resolvePressPlayers(player.teamSymbol, ballInfo.carrier, snapshot.players, overlayRect) : [];
    if (pressPlayers.some((candidate) => candidate.key === player.key)) {
        return {
            state: TACTICAL_STATES.Press,
            targetEnemyKey: ballInfo.carrier.key,
            targetEnemy: ballInfo.carrier,
            threatScore: 100,
            reason: pressPlayers[0]?.key === player.key ? "primary-press" : "secondary-press"
        };
    }

    const threats = enemyPlayers
        .map((enemy) => ({ enemy, threat: snapshot.threatTable.get(`${player.teamSymbol}|${enemy.key}`) }))
        .filter((item) => item.threat)
        .sort((a, b) => b.threat.score - a.threat.score);

    const ownWorld = toTacticalWorldPoint(player, overlayRect);
    let chosen = null;
    let bestScore = -Infinity;
    for (const item of threats) {
        const targetWorld = item.threat.predictedWorld;
        const distancePenalty = Math.hypot(targetWorld.x - ownWorld.x, targetWorld.y - ownWorld.y) * 0.18;
        const roleBias = player.role === "defender" ? 7 : player.role === "midfielder" ? 4 : -6;
        const score = item.threat.score - distancePenalty + roleBias;
        if (score > bestScore) {
            bestScore = score;
            chosen = item;
        }
    }

    const pressure = stringEquals(player.teamSymbol, state.context.teamA) ? state.context.pressureA : state.context.pressureB;
    const fallbackBias = pressure < -1.15 || player.role === "defender";

    if (chosen) {
        const laneCarrier = ballInfo.carrier && !stringEquals(ballInfo.carrier.key, chosen.enemy.key);
        if (laneCarrier && chosen.threat.passLane > 0.55 && player.role !== "attacker") {
            return {
                state: TACTICAL_STATES.Intercept,
                targetEnemyKey: chosen.enemy.key,
                targetEnemy: chosen.enemy,
                threatScore: chosen.threat.score,
                reason: "open-pass-lane"
            };
        }

        if (chosen.threat.score >= 38 || chosen.threat.recentDangerous) {
            return {
                state: TACTICAL_STATES.Track,
                targetEnemyKey: chosen.enemy.key,
                targetEnemy: chosen.enemy,
                threatScore: chosen.threat.score,
                reason: "high-threat-runner"
            };
        }
    }

    if (fallbackBias) {
        return { state: TACTICAL_STATES.Fallback, targetEnemyKey: "", threatScore: 0, reason: "defensive-recovery" };
    }

    if (player.role === "midfielder" || player.role === "defender") {
        return { state: TACTICAL_STATES.Cover, targetEnemyKey: chosen?.enemy?.key || "", targetEnemy: chosen?.enemy || null, threatScore: chosen?.threat?.score || 0, reason: "cover-space" };
    }

    return { state: TACTICAL_STATES.Hold, targetEnemyKey: "", threatScore: 0, reason: "hold-shape" };
}

function resolvePressPlayers(teamSymbol, ballCarrier, players, overlayRect) {
    const defenders = players.filter((candidate) => stringEquals(candidate.teamSymbol, teamSymbol) && !candidate.hasBall && candidate.role !== "goalkeeper");
    if (defenders.length === 0) {
        return [];
    }

    const carrierWorld = toTacticalWorldPoint(ballCarrier, overlayRect);
    const ranked = defenders
        .map((candidate) => ({
            candidate,
            distance: Math.hypot(
                toTacticalWorldPoint(candidate, overlayRect).x - carrierWorld.x,
                toTacticalWorldPoint(candidate, overlayRect).y - carrierWorld.y),
            supportBias: candidate.role === "midfielder" ? -10 : candidate.role === "defender" ? -4 : 4
        }))
        .sort((a, b) => (a.distance + a.supportBias) - (b.distance + b.supportBias));

    const primary = ranked[0]?.candidate;
    const secondary = ranked[1];
    if (!primary) {
        return [];
    }

    const active = [primary];
    if (secondary && secondary.distance <= ranked[0].distance + 38 && secondary.candidate.role !== "attacker") {
        active.push(secondary.candidate);
    }

    return active;
}

function resolveTacticalTarget(player, state, ballInfo, snapshot, overlayRect, now) {
    const context = state.context;
    const dir = player.side === "left" ? 1 : -1;
    const possession = stringEquals(player.teamSymbol, context.teamA) ? context.possessionA : context.possessionB;
    const pressure = stringEquals(player.teamSymbol, context.teamA) ? context.pressureA : context.pressureB;
    const inPossession = stringEquals(player.teamSymbol, ballInfo.owner);
    const momentumBoost = stringEquals(player.teamSymbol, context.momentumOwner) ? 1 : 0;
    const radius = player.freedomRadius;
    const compactness = state.options.defensiveCompactness;
    const momentumPush = state.options.momentumPushStrength;
    const shapeBias = clamp((possession - 50) / 50, -1, 1);
    const wanderSeed = player.seed + Math.floor(now / 520);
    const wander = randomPointInCircle(radius * (0.22 + state.options.wanderStrength * 0.16), wanderSeed);
    const decision = player.tacticalDecision ?? null;
    const ownGoalX = player.side === "left" ? 0 : overlayRect.width;
    const ballSlideY = ((ballInfo.y / Math.max(1, overlayRect.height)) - 0.5) * radius * 0.52;
    let target = { x: 0, y: 0 };

    switch (decision?.state ?? player.tacticalState) {
        case TACTICAL_STATES.Press: {
            const enemy = decision?.targetEnemy ?? ballInfo.carrier;
            const future = enemy ? predictPlayerWorldPosition(enemy, overlayRect, 0.2) : { x: ballInfo.x, y: ballInfo.y };
            target = worldTargetToLocal(player, overlayRect, {
                x: future.x + (dir * -10),
                y: future.y
            });
            break;
        }
        case TACTICAL_STATES.Track: {
            const enemy = decision?.targetEnemy;
            if (enemy) {
                const future = predictPlayerWorldPosition(enemy, overlayRect, 0.4);
                const markDistance = player.role === "defender" ? 12 : 16;
                const goalSide = ownGoalX < future.x ? 1 : -1;
                target = worldTargetToLocal(player, overlayRect, {
                    x: future.x + (goalSide * markDistance),
                    y: future.y
                });
            }
            break;
        }
        case TACTICAL_STATES.Intercept: {
            const enemy = decision?.targetEnemy;
            const carrier = ballInfo.carrier;
            if (enemy && carrier) {
                const futureEnemy = predictPlayerWorldPosition(enemy, overlayRect, 0.45);
                const futureCarrier = predictPlayerWorldPosition(carrier, overlayRect, 0.18);
                const ownWorld = toTacticalWorldPoint(player, overlayRect);
                const lanePoint = nearestPointOnSegment(ownWorld, futureCarrier, futureEnemy);
                target = worldTargetToLocal(player, overlayRect, {
                    x: lanePoint.x + ((ownGoalX < lanePoint.x ? -1 : 1) * 4),
                    y: lanePoint.y
                });
            }
            break;
        }
        case TACTICAL_STATES.Cover: {
            const compactY = ballSlideY * 0.9;
            const coverDepth = player.role === "defender" ? -dir * radius * (0.18 + compactness * 0.18) : -dir * radius * 0.06;
            target = {
                x: coverDepth,
                y: clamp(compactY - player.position.y * 0.12, -radius * 0.44, radius * 0.44)
            };
            break;
        }
        case TACTICAL_STATES.Hold:
            target = {
                x: inPossession ? dir * radius * 0.04 : -dir * radius * 0.1 * compactness,
                y: clamp(ballSlideY * 0.62 - player.position.y * 0.14, -radius * 0.34, radius * 0.34)
            };
            break;
        case TACTICAL_STATES.Fallback:
            target = {
                x: -dir * radius * (0.28 + compactness * 0.18),
                y: clamp(ballSlideY * 0.82 - player.position.y * 0.16, -radius * 0.4, radius * 0.4)
            };
            break;
        case TACTICAL_STATES.PressBall:
            target = {
                x: dir * radius * (0.34 + shapeBias * 0.18),
                y: clamp(((ballInfo.y / overlayRect.height) - 0.5) * radius * 0.6, -radius * 0.45, radius * 0.45)
            };
            break;
        case TACTICAL_STATES.DefendZone:
            target = {
                x: -dir * radius * (0.24 + compactness * 0.1),
                y: clamp(-player.position.y * 0.24, -radius * 0.32, radius * 0.32)
            };
            break;
        case TACTICAL_STATES.MarkOpponent:
            target = {
                x: -dir * radius * 0.08,
                y: clamp(((ballInfo.y / overlayRect.height) - 0.5) * radius * 0.72, -radius * 0.42, radius * 0.42)
            };
            break;
        case TACTICAL_STATES.SupportAttack:
            target = {
                x: dir * radius * (0.24 + (shapeBias * 0.18) + (momentumBoost * 0.08 * momentumPush)),
                y: wander.y * 0.7
            };
            break;
        case TACTICAL_STATES.RunIntoSpace:
            target = {
                x: dir * radius * (0.42 + (shapeBias * 0.12) + (Math.max(0, pressure) * 0.06 * momentumPush)),
                y: clamp(wander.y + Math.sin((now / 900) + player.phase) * radius * 0.16, -radius * 0.5, radius * 0.5)
            };
            break;
        case TACTICAL_STATES.ReturnToFormation:
            target = {
                x: inPossession ? dir * radius * 0.06 : -dir * radius * 0.06 * compactness,
                y: -player.position.y * 0.18
            };
            break;
        default:
            target = { x: wander.x * 0.55, y: wander.y * 0.55 };
            break;
    }

    if (player.role === "goalkeeper") {
        target.x = clamp(target.x, -dir * radius * 0.12, dir * radius * 0.12);
        target.y = clamp(((ballInfo.y / overlayRect.height) - 0.5) * radius * 0.28, -radius * 0.2, radius * 0.2);
    }

    if (!inPossession) {
        target.x += -dir * radius * 0.08 * compactness;
    }

    if (player.role === "attacker" && inPossession) {
        target.x += dir * radius * 0.08 * momentumPush;
    }

    const targetRadius = radius * Math.max(1, player.tacticalRadiusMultiplier || 1);
    return clampTacticalTarget(target, targetRadius);
}

function getPlayerBaseWorldPoint(player, overlayRect) {
    return {
        x: (player.baseXPercent / 100) * overlayRect.width,
        y: (player.baseYPercent / 100) * overlayRect.height
    };
}

function worldTargetToLocal(player, overlayRect, worldTarget) {
    const base = getPlayerBaseWorldPoint(player, overlayRect);
    return {
        x: worldTarget.x - base.x,
        y: worldTarget.y - base.y
    };
}

function predictPlayerWorldPosition(player, overlayRect, predictionTime = 0.35) {
    const world = toTacticalWorldPoint(player, overlayRect);
    return {
        x: world.x + ((player.velocity?.x || 0) * predictionTime),
        y: world.y + ((player.velocity?.y || 0) * predictionTime)
    };
}

function nearestPointOnSegment(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSq = (dx * dx) + (dy * dy);
    if (lengthSq <= 0.0001) {
        return { x: start.x, y: start.y };
    }

    const t = clamp((((point.x - start.x) * dx) + ((point.y - start.y) * dy)) / lengthSq, 0, 1);
    return {
        x: start.x + (dx * t),
        y: start.y + (dy * t)
    };
}

function arriveSteeringForce(player, target) {
    const desired = subtractVector(target, player.position);
    const distance = vectorMagnitude(desired);
    if (distance <= 0.001) {
        return { x: 0, y: 0 };
    }

    const slowingRadius = Math.max(18, player.freedomRadius * 0.75);
    let speed = player.maxSpeed;
    if (distance < slowingRadius) {
        speed *= distance / slowingRadius;
    }

    const steer = scaleVector(normalizeVector(desired), speed);
    steer.x -= player.velocity.x;
    steer.y -= player.velocity.y;
    return limitVectorMagnitude(steer, player.maxForce * (player.tacticalForceMultiplier || 1));
}

function wanderSteeringForce(player, dt, strength) {
    player.wanderAngle += ((randomFloat01(player.seed + performance.now() * 0.001) - 0.5) * 2) * dt * 2.2;
    const circleDistance = player.freedomRadius * 0.24;
    const circleRadius = player.freedomRadius * 0.16 * strength;
    const heading = vectorMagnitude(player.velocity) > 0.001 ? normalizeVector(player.velocity) : { x: player.side === "left" ? 1 : -1, y: 0 };
    const circleCenter = scaleVector(heading, circleDistance);
    const displacement = {
        x: Math.cos(player.wanderAngle) * circleRadius,
        y: Math.sin(player.wanderAngle) * circleRadius
    };

    return limitVectorMagnitude(addVector(circleCenter, displacement), player.maxForce * 0.42);
}

function separationSteeringForce(player, players, overlayRect, strength) {
    const desiredSeparation = player.role === "goalkeeper" ? 18 : 28;
    let steer = { x: 0, y: 0 };
    let count = 0;
    const ownPos = toTacticalWorldPoint(player, overlayRect);

    for (const other of players) {
        if (other === player || !stringEquals(other.teamSymbol, player.teamSymbol)) {
            continue;
        }

        const otherPos = toTacticalWorldPoint(other, overlayRect);
        const dx = ownPos.x - otherPos.x;
        const dy = ownPos.y - otherPos.y;
        const distance = Math.hypot(dx, dy);
        if (distance <= 0.001 || distance >= desiredSeparation) {
            continue;
        }

        steer.x += dx / distance;
        steer.y += dy / distance;
        count += 1;
    }

    if (count <= 0) {
        return steer;
    }

    steer.x /= count;
    steer.y /= count;
    steer = scaleVector(normalizeVector(steer), player.maxSpeed);
    steer.x -= player.velocity.x;
    steer.y -= player.velocity.y;
    return limitVectorMagnitude(scaleVector(steer, strength), player.maxForce * (player.tacticalForceMultiplier || 1) * 1.1);
}

function avoidCrowdingForce(player, players, overlayRect) {
    let steer = { x: 0, y: 0 };
    const ownPos = toTacticalWorldPoint(player, overlayRect);

    for (const other of players) {
        if (other === player) {
            continue;
        }

        const otherPos = toTacticalWorldPoint(other, overlayRect);
        const dx = ownPos.x - otherPos.x;
        const dy = ownPos.y - otherPos.y;
        const distance = Math.hypot(dx, dy);
        if (distance <= 0.001 || distance > 22) {
            continue;
        }

        steer.x += dx / distance;
        steer.y += dy / distance;
    }

    return limitVectorMagnitude(steer, player.maxForce * (player.tacticalForceMultiplier || 1) * 0.6);
}

function returnToFormationForce(player) {
    const distance = vectorMagnitude(player.position);
    if (distance < player.freedomRadius * 0.65) {
        return { x: 0, y: 0 };
    }

    const desired = scaleVector(normalizeVector(scaleVector(player.position, -1)), player.maxSpeed * 0.55);
    desired.x -= player.velocity.x;
    desired.y -= player.velocity.y;
    return limitVectorMagnitude(desired, player.maxForce * (player.tacticalForceMultiplier || 1) * 0.7);
}

function applySteeringForce(player, force, weight = 1) {
    if (!force) {
        return;
    }

    player.acceleration.x += force.x * weight;
    player.acceleration.y += force.y * weight;
}

function resolvePlayerCollisions(players, overlayRect, strength) {
    const activePlayers = players.filter((player) => player?.node?.isConnected);
    const count = activePlayers.length;

    for (let i = 0; i < count; i += 1) {
        const a = activePlayers[i];
        const aWorld = toTacticalWorldPoint(a, overlayRect);

        for (let j = i + 1; j < count; j += 1) {
            const b = activePlayers[j];
            const bWorld = toTacticalWorldPoint(b, overlayRect);
            let dx = bWorld.x - aWorld.x;
            let dy = bWorld.y - aWorld.y;
            let distance = Math.hypot(dx, dy);
            const minDistance = (a.collisionRadius ?? 14) + (b.collisionRadius ?? 14);

            if (distance >= minDistance) {
                continue;
            }

            if (distance <= 0.0001) {
                const angle = randomFloat01((a.seed + 1) * (b.seed + 1)) * Math.PI * 2;
                dx = Math.cos(angle);
                dy = Math.sin(angle);
                distance = 1;
            }

            const nx = dx / distance;
            const ny = dy / distance;
            const overlap = (minDistance - distance) * 0.5 * strength;
            const aWeight = a.role === "goalkeeper" ? 0.32 : a.role === "defender" ? 0.46 : 0.5;
            const bWeight = b.role === "goalkeeper" ? 0.32 : b.role === "defender" ? 0.46 : 0.5;

            a.position.x -= nx * overlap * aWeight;
            a.position.y -= ny * overlap * aWeight;
            b.position.x += nx * overlap * bWeight;
            b.position.y += ny * overlap * bWeight;

            a.velocity.x -= nx * overlap * 0.26;
            a.velocity.y -= ny * overlap * 0.26;
            b.velocity.x += nx * overlap * 0.26;
            b.velocity.y += ny * overlap * 0.26;

            limitVectorMagnitude(a.velocity, a.maxSpeed);
            limitVectorMagnitude(b.velocity, b.maxSpeed);
        }
    }
}

function resolveTacticalVisualOffset(player, now) {
    const speed = vectorMagnitude(player.velocity);
    const gait = Math.min(1, speed / Math.max(1, player.maxSpeed));
    const swayPhase = (now / 1000) * (FIELD_FREEDOM.SWAY_SPEED * player.stride) + player.phase;
    const lateral = Math.sin(swayPhase) * FIELD_FREEDOM.SWAY_INTENSITY * player.sway * (0.4 + gait * 0.95);
    const heading = speed > 0.001 ? normalizeVector(player.velocity) : { x: 0, y: 1 };
    const perpendicular = { x: -heading.y, y: heading.x };

    return {
        x: player.position.x + perpendicular.x * lateral,
        y: player.position.y + perpendicular.y * lateral * 0.82
    };
}

function clampPlayerToFreedomRadius(player) {
    const distance = vectorMagnitude(player.position);
    const activeRadius = player.freedomRadius * Math.max(1, player.tacticalRadiusMultiplier || 1);
    if (distance <= activeRadius) {
        return;
    }

    const normalized = normalizeVector(player.position);
    player.position.x = normalized.x * activeRadius;
    player.position.y = normalized.y * activeRadius;
    player.velocity.x *= 0.78;
    player.velocity.y *= 0.78;
}

function clampPlayerToOverlay(player, overlayRect) {
    const rect = player.node.getBoundingClientRect();
    const halfW = rect.width / 2;
    const halfH = rect.height / 2;
    const baseX = (player.baseXPercent / 100) * overlayRect.width;
    const baseY = (player.baseYPercent / 100) * overlayRect.height;
    const worldX = baseX + player.position.x;
    const worldY = baseY + player.position.y;
    const clampedX = clamp(worldX, halfW, overlayRect.width - halfW);
    const clampedY = clamp(worldY, halfH, overlayRect.height - halfH);

    player.position.x += clampedX - worldX;
    player.position.y += clampedY - worldY;
}

function tacticalDistanceToBall(player, ballInfo, overlayRect) {
    const world = toTacticalWorldPoint(player, overlayRect);
    return Math.hypot(world.x - ballInfo.x, world.y - ballInfo.y);
}

function toTacticalWorldPoint(player, overlayRect) {
    return {
        x: (player.baseXPercent / 100) * overlayRect.width + player.position.x,
        y: (player.baseYPercent / 100) * overlayRect.height + player.position.y
    };
}

function clampTacticalTarget(target, radius) {
    const distance = vectorMagnitude(target);
    if (distance <= radius) {
        return target;
    }

    const normalized = normalizeVector(target);
    return {
        x: normalized.x * radius,
        y: normalized.y * radius
    };
}

function applyFreedomMotion(state, now) {
    const dt = Math.min(0.05, state.lastNow ? (now - state.lastNow) / 1000 : 1 / 60);
    state.lastNow = now;

    const overlayRect = state.overlay.getBoundingClientRect();

    // Step 1: move each player towards its current target (offsets only)
    for (const player of state.players) {
        const node = player.node;
        if (!node?.isConnected) {
            continue;
        }

        // Update radius dynamically (role + game state)
        player.radius = resolveFreedomRadiusPx(node, player.playerIndex);

        // Pick a new target when "arrived" and after a small pause.
        const dxT = player.tx - player.ox;
        const dyT = player.ty - player.oy;
        const distT = Math.hypot(dxT, dyT);

        if (now >= player.waitUntil && distT < 0.60) {
            // Tactical bias: slight forward/back shift based on context.
            const isLeft = node.classList.contains("is-left");
            const dir = isLeft ? 1 : -1;
            let biasX = 0;
            let biasY = 0;

            if (node.classList.contains("has-ball")) biasX += dir * player.radius * 0.55;
            else if (node.classList.contains("is-attacking")) biasX += dir * player.radius * 0.25;
            else if (node.classList.contains("is-defending")) biasX -= dir * player.radius * 0.18;

            // Keep lanes: small tendency towards central lanes.
            biasY += (Math.sin((now / 1000) + player.seed) * 0.08) * player.radius;

            const rnd = randomPointInCircle(player.radius, player.seed + Math.floor(now / 650));
            player.tx = rnd.x + biasX;
            player.ty = rnd.y + biasY;
            const pauseMult = Number.isFinite(player.pauseMultiplier) ? player.pauseMultiplier : 1.0;
            player.waitUntil = now + randomRangeMs(
                FIELD_FREEDOM.TARGET_PAUSE_MIN * pauseMult,
                FIELD_FREEDOM.TARGET_PAUSE_MAX * pauseMult,
                player.seed + Math.floor(now / 1000)
            );
        }

        // Inertia smoothing towards target offset (no jitter).
        // Slightly "looser" spring for elastic walk (with controlled overshoot).
        const playerSpeed = (player.speedMultiplier ?? 1.0) * FIELD_FREEDOM.PLAYER_SPEED_MULTIPLIER;
        const stiffness = 8.9 * playerSpeed;
        const damping = 6.3 * playerSpeed;
        const maxSpeed = 22 * playerSpeed;

        // Overshoot: push slightly past target, then correct naturally.
        const oxTarget = player.tx + player.vx * FIELD_FREEDOM.OVERSHOOT_STRENGTH;
        const oyTarget = player.ty + player.vy * FIELD_FREEDOM.OVERSHOOT_STRENGTH;

        player.vx += (oxTarget - player.ox) * stiffness * dt;
        player.vy += (oyTarget - player.oy) * stiffness * dt;
        player.vx *= Math.exp(-damping * dt);
        player.vy *= Math.exp(-damping * dt);

        const speed = Math.hypot(player.vx, player.vy);
        if (speed > maxSpeed) {
            const s = maxSpeed / speed;
            player.vx *= s;
            player.vy *= s;
        }

        player.ox += player.vx * dt;
        player.oy += player.vy * dt;

        // Lateral walking sway (zig-zag) based on movement direction & speed.
        const gait = Math.min(1, speed / 14);
        const swayAmp = (player.swayIntensity ?? 1.0) * FIELD_FREEDOM.SWAY_INTENSITY * (0.45 + 0.85 * gait);
        const phase = Number.isFinite(player.phase) ? player.phase : 0;
        const swayPhase = (now / 1000) * (FIELD_FREEDOM.SWAY_SPEED * (player.swaySpeed ?? 1.0)) + phase;
        // Perpendicular vector to current velocity to simulate footwork zig-zag
        const vx = player.vx;
        const vy = player.vy;
        const vmag = Math.hypot(vx, vy) || 1;
        const px = -vy / vmag;
        const py = vx / vmag;
        const lateral = Math.sin(swayPhase) * swayAmp;

        const visualX = player.ox + px * lateral;
        const visualY = player.oy + py * lateral * 0.85;

        node.style.setProperty("--tv-free-x", `${visualX.toFixed(2)}px`);
        node.style.setProperty("--tv-free-y", `${visualY.toFixed(2)}px`);
    }

    // Step 2: separation to avoid coins sticking together (soft repulsion).
    // Uses current DOM rects (includes transform).
    const rects = state.players.map((p) => ({ p, rect: p.node?.getBoundingClientRect?.() })).filter((x) => x.rect);
    const minDist = 26;
    for (let i = 0; i < rects.length; i++) {
        const a = rects[i];
        const ax = a.rect.left + a.rect.width / 2;
        const ay = a.rect.top + a.rect.height / 2;

        for (let j = i + 1; j < rects.length; j++) {
            const b = rects[j];
            const bx = b.rect.left + b.rect.width / 2;
            const by = b.rect.top + b.rect.height / 2;

            const dx = bx - ax;
            const dy = by - ay;
            const d = Math.hypot(dx, dy);
            if (d <= 0.001 || d >= minDist) continue;

            const push = (minDist - d) / minDist;
            const nx = dx / d;
            const ny = dy / d;

            // Apply tiny opposing impulses (offset space)
            a.p.ox -= nx * push * 0.35;
            a.p.oy -= ny * push * 0.35;
            b.p.ox += nx * push * 0.35;
            b.p.oy += ny * push * 0.35;

            a.p.node.style.setProperty("--tv-free-x", `${a.p.ox.toFixed(2)}px`);
            a.p.node.style.setProperty("--tv-free-y", `${a.p.oy.toFixed(2)}px`);
            b.p.node.style.setProperty("--tv-free-x", `${b.p.ox.toFixed(2)}px`);
            b.p.node.style.setProperty("--tv-free-y", `${b.p.oy.toFixed(2)}px`);
        }
    }

    // Step 3: clamp to field bounds
    for (const entry of rects) {
        clampOffsetToField(entry.p, overlayRect, entry.rect);
        entry.p.node.style.setProperty("--tv-free-x", `${entry.p.ox.toFixed(2)}px`);
        entry.p.node.style.setProperty("--tv-free-y", `${entry.p.oy.toFixed(2)}px`);
    }
}

function setCubeFace(faceIndex, reason) {
    try {
        if (!telemetryCubeState?.cube) {
            return;
        }

        const faceCount = telemetryCubeState.faceCount || 7;
        const normalized = ((faceIndex % faceCount) + faceCount) % faceCount;
        telemetryCubeState.faceIndex = normalized;
        telemetryCubeState.cube.classList.remove("is-face-0", "is-face-1", "is-face-2", "is-face-3", "is-face-4", "is-face-5", "is-face-6");
        telemetryCubeState.cube.classList.add(`is-face-${normalized}`);

        telemetryCubeLog(`face changed ${normalized}`, reason ? { reason } : undefined);

        // 3D transforms can cause LightweightCharts to miss a resize; force-fit after the face is applied.
        window.setTimeout(() => resizeTelemetryCharts(), 0);
        window.setTimeout(() => resizeTelemetryCharts(), 80);
        window.setTimeout(() => resizeTelemetryCharts(), 350);
        window.setTimeout(() => resizeTelemetryCharts(), 1100);

        if (telemetryChartsState?.lastPayload) {
            window.setTimeout(() => {
                try {
                    updateTelemetryCharts(telemetryChartsState.lastPayload);

                    if (throttleKey("TV_CHART", `refresh:face-${normalized}`, 2000)) {
                        telemetryChartLog("refresh from state", { reason: `face-${normalized}` });
                    }
                } catch (error) {
                    telemetryCubeLog("chart refresh failed", error?.message || String(error));
                }
            }, 120);
        }
    } catch (error) {
        telemetryCubeLog("setCubeFace failed", error?.message || String(error));
    }
}

function resumeCubeRotation() {
    if (!telemetryCubeState) {
        return;
    }

    if (telemetryCubeState.disabled || telemetryCubeState.paused) {
        return;
    }

    if (telemetryCubeState.timerId) {
        return;
    }

    telemetryCubeState.timerId = window.setInterval(() => {
        try {
            setCubeFace(telemetryCubeState.faceIndex + 1, "interval");
        } catch (error) {
            telemetryCubeLog("interval failed", error?.message || String(error));
        }
    }, telemetryCubeState.intervalMs);
}

function resizeTelemetryCharts() {
    if (!telemetryChartsState?.charts) {
        return;
    }

    telemetryChartsState.charts.forEach((entry, id) => {
        const container = document.getElementById(id);
        if (!container) {
            return;
        }

        const rect = container.getBoundingClientRect();
        const width = Math.floor(rect.width);
        const height = Math.floor(rect.height);

        if (width <= 0 || height <= 0) {
            return;
        }

        const chart = entry?.chart;
        if (!chart) {
            return;
        }

        try {
            chart.applyOptions({ width, height });
            chart.timeScale().fitContent();
        } catch {
        }

        if (throttleKey("TV_CHART", `resize:${id}:${width}x${height}`, 1200)) {
            telemetryChartLog("resize", { id, width, height });
        }
    });
}

function pauseCubeRotation(reason) {
    if (!telemetryCubeState) {
        return;
    }

    if (telemetryCubeState.timerId) {
        window.clearInterval(telemetryCubeState.timerId);
        telemetryCubeState.timerId = null;
    }

    telemetryCubeState.shell?.classList.toggle("is-paused", telemetryCubeState.paused);

    if (throttleKey("TV_CUBE", `paused:${reason ?? "unknown"}`, 2000)) {
        telemetryCubeLog("paused", reason);
    }
}

function hasChartContainers() {
    return Boolean(
        document.getElementById("tv-telemetry-chart-left")
        && document.getElementById("tv-telemetry-chart-right")
        && document.getElementById("tv-telemetry-chart-compare")
    );
}

function scheduleContainerRetry(reason) {
    telemetryChartsState = telemetryChartsState ?? { charts: new Map(), libPromise: null };

    if (telemetryChartsState.containerRetryId) {
        return;
    }

    telemetryChartsState.containerRetryId = window.setTimeout(() => {
        telemetryChartsState.containerRetryId = null;

        if (hasChartContainers()) {
            telemetryChartLog("containers ready");

            if (telemetryChartsState.lastPayload) {
                updateTelemetryCharts(telemetryChartsState.lastPayload);
            }

            return;
        }

        if (throttleKey("TV_CHART", "waiting containers", 1500)) {
            telemetryChartLog("waiting containers", reason);
        }

        scheduleContainerRetry(reason);
    }, 450);
}

export function initTelemetryCube(shellId, intervalMs) {
    const tryInit = (attempt) => {
        const shell = document.getElementById(shellId);
        const cube = shell?.querySelector?.(".tv-telemetry-cube");

        if (!shell || !cube) {
            if (attempt < 10) {
                window.setTimeout(() => tryInit(attempt + 1), 300);
            }

            return;
        }

        const resolvedIntervalMs = typeof intervalMs === "number" && intervalMs >= 3000
            ? intervalMs
            : Math.max(3000, (Number(shell.dataset.intervalSeconds) || 12) * 1000);

        if (telemetryCubeState?.shell === shell && telemetryCubeState?.cube === cube) {
            telemetryCubeState.intervalMs = resolvedIntervalMs;
            telemetryCubeState.disabled = isReducedMotion()
                || (typeof window !== "undefined" && window.innerWidth <= 720);
            return;
        }

        pauseCubeRotation("reinit");

        telemetryCubeState = {
            shell,
            cube,
            intervalMs: resolvedIntervalMs,
            timerId: null,
            faceIndex: 0,
            faceCount: 7,
            paused: false,
            disabled: false,
            holdUntil: 0
        };

        const disabled = isReducedMotion()
            || (typeof window !== "undefined" && window.innerWidth <= 720);

        telemetryCubeState.disabled = disabled;

        if (disabled) {
            setCubeFace(0, "disabled");
            telemetryCubeLog("initialized (disabled)");
            return;
        }

        if (!shell.dataset.tvCubeBound) {
            shell.dataset.tvCubeBound = "1";

            shell.addEventListener("mouseenter", () => {
                telemetryCubeState.paused = true;
                pauseCubeRotation("hover");
            });

            shell.addEventListener("mouseleave", () => {
                telemetryCubeState.paused = false;
                resumeCubeRotation();
            });
        }

        if (!window.__tvTelemetryCubeVisibilityBound) {
            window.__tvTelemetryCubeVisibilityBound = true;

            window.addEventListener("visibilitychange", () => {
                if (document.hidden) {
                    pauseCubeRotation("hidden");
                    return;
                }

                if (telemetryCubeState) {
                    telemetryCubeState.paused = false;
                }

                resumeCubeRotation();
            });
        }

        setCubeFace(0, "init");
        telemetryCubeLog("initialized", { intervalMs: resolvedIntervalMs });
        resumeCubeRotation();

        if (hasChartContainers()) {
            telemetryChartLog("containers ready");
        } else {
            telemetryChartsState = telemetryChartsState ?? { charts: new Map(), libPromise: null };
            scheduleContainerRetry("initTelemetryCube");
        }
    };

    tryInit(0);
}

export function notifyTelemetryCubeEvent(eventKey) {
    if (!telemetryCubeState || telemetryCubeState.disabled) {
        return;
    }

    const key = String(eventKey || "").toLowerCase();

    if (!key) {
        return;
    }

    if (key.includes("goal")) {
        setCubeFace(5, "goal");

        const now = Date.now();
        telemetryCubeState.holdUntil = now + 7000;

        pauseCubeRotation("goal-hold");

        window.setTimeout(() => {
            if (!telemetryCubeState) {
                return;
            }

            if (Date.now() < telemetryCubeState.holdUntil) {
                return;
            }

            telemetryCubeState.paused = false;
            resumeCubeRotation();
        }, 7200);

        return;
    }

    if (key.includes("fear")) {
        setCubeFace(6, "fear");

        const now = Date.now();
        telemetryCubeState.holdUntil = now + 7000;

        pauseCubeRotation("fear-hold");

        window.setTimeout(() => {
            if (!telemetryCubeState) {
                return;
            }

            if (Date.now() < telemetryCubeState.holdUntil) {
                return;
            }

            telemetryCubeState.paused = false;
            resumeCubeRotation();
        }, 7200);

        return;
    }

    if (key.includes("momentum") || key.includes("reversal") || key.includes("fear")) {
        setCubeFace(2, "momentum-shift");
    }
}

function applyChartTheme(LightweightCharts, chart) {
    const solidType = LightweightCharts?.ColorType?.Solid ?? 0;

    chart.applyOptions({
        layout: {
            background: { type: solidType, color: "transparent" },
            textColor: "rgba(219, 232, 247, 0.72)",
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif"
        },
        grid: {
            vertLines: { color: "rgba(255,255,255,0.04)" },
            horzLines: { color: "rgba(255,255,255,0.035)" }
        },
        rightPriceScale: {
            visible: false,
            borderVisible: false
        },
        leftPriceScale: {
            visible: false,
            borderVisible: false
        },
        timeScale: {
            visible: false,
            borderVisible: false,
            barSpacing: 22
        },
        crosshair: {
            vertLine: { visible: false },
            horzLine: { visible: false }
        },
        handleScroll: {
            mouseWheel: false,
            pressedMouseMove: false,
            horzTouchDrag: false,
            vertTouchDrag: false
        },
        handleScale: {
            axisPressedMouseMove: { time: false, price: false },
            mouseWheel: false,
            pinch: false
        }
    });
}

function ensureResizeObserver(container, chart) {
    if (!telemetryChartsState) {
        return;
    }

    const existing = telemetryChartsState.charts.get(container.id);

    if (existing?.resizeObserver) {
        return;
    }

    const resizeObserver = new ResizeObserver(() => {
        const rect = container.getBoundingClientRect();

        chart.applyOptions({
            width: Math.max(1, Math.floor(rect.width)),
            height: Math.max(1, Math.floor(rect.height))
        });

        try {
            chart.timeScale().fitContent();
        } catch {
        }

        const latest = telemetryChartsState?.charts?.get(container.id);
        if (latest?.kind === "compare") {
            positionCompareScoreEventMarkers(latest);
            refreshCompareCrossoverMarker(latest);
        }
    });

    resizeObserver.observe(container);

    telemetryChartsState.charts.set(container.id, {
        ...existing,
        container,
        resizeObserver
    });
}

function disposeChartEntry(entry) {
    if (!entry) {
        return;
    }

    try {
        if (entry.markerFadeTimer) {
            window.clearTimeout(entry.markerFadeTimer);
        }
    } catch {
    }

    try {
        entry.overlayRoot?.remove?.();
    } catch {
    }

    try {
        clearCompareScoreEventMarkers(entry);
    } catch {
    }

    try {
        entry.resizeObserver?.disconnect?.();
    } catch {
    }

    try {
        entry.chart?.remove?.();
    } catch {
    }
}

function addLineSeriesCompat(LightweightCharts, chart, options) {
    if (typeof chart.addLineSeries === "function") {
        return chart.addLineSeries(options);
    }

    if (typeof chart.addSeries === "function" && LightweightCharts?.LineSeries) {
        return chart.addSeries(LightweightCharts.LineSeries, options);
    }

    throw new Error("no supported LineSeries API");
}

function addCandlestickSeriesCompat(LightweightCharts, chart, options) {
    if (typeof chart.addCandlestickSeries === "function") {
        return chart.addCandlestickSeries(options);
    }

    if (typeof chart.addSeries === "function" && LightweightCharts?.CandlestickSeries) {
        return chart.addSeries(LightweightCharts.CandlestickSeries, options);
    }

    throw new Error("no supported CandlestickSeries API");
}

function ensureCompareCrossoverStyles() {
    if (typeof document === "undefined" || document.getElementById("tv-chart-crossover-styles")) {
        return;
    }

    const style = document.createElement("style");
    style.id = "tv-chart-crossover-styles";
    style.textContent = `
.tv-chart-crossover-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 4;
    overflow: hidden;
}

.tv-chart-crossover-marker {
    position: absolute;
    width: 0;
    top: 0;
    bottom: 0;
    opacity: 0;
    transition: opacity 180ms ease;
}

.tv-chart-crossover-marker.is-visible {
    opacity: 1;
}

.tv-chart-crossover-marker__beam {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 2px;
    transform: translateX(-50%);
    background: linear-gradient(180deg, transparent 0%, color-mix(in srgb, var(--battle-accent, #53c8ff) 82%, white 8%) 24%, color-mix(in srgb, var(--battle-accent, #53c8ff) 92%, transparent) 55%, transparent 100%);
    box-shadow: 0 0 16px color-mix(in srgb, var(--battle-accent, #53c8ff) 42%, transparent);
    opacity: 0.72;
}

.tv-chart-crossover-marker__beam::after {
    content: "";
    position: absolute;
    left: 50%;
    top: 50%;
    width: 10px;
    height: 44px;
    transform: translate(-50%, -50%);
    background: radial-gradient(circle, color-mix(in srgb, var(--battle-accent, #53c8ff) 42%, transparent) 0%, transparent 70%);
    filter: blur(4px);
    opacity: 0.8;
}

.tv-chart-crossover-marker__badge {
    position: absolute;
    left: 0;
    top: var(--battle-y, 50%);
    width: 36px;
    height: 36px;
    transform: translate(-50%, -50%);
    border-radius: 999px;
    display: grid;
    place-items: center;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--battle-accent, #53c8ff) 82%, white 14%);
    background:
        radial-gradient(circle at 30% 30%, rgba(255,255,255,.24), transparent 42%),
        linear-gradient(180deg, rgba(255,255,255,.12), rgba(255,255,255,0) 38%),
        linear-gradient(135deg, color-mix(in srgb, var(--battle-accent, #53c8ff) 30%, rgba(4, 10, 20, 0.94)), rgba(5, 12, 24, 0.96));
    box-shadow:
        0 0 0 1px color-mix(in srgb, var(--battle-accent, #53c8ff) 28%, transparent),
        0 0 22px color-mix(in srgb, var(--battle-accent, #53c8ff) 42%, transparent),
        0 10px 24px rgba(0,0,0,.32);
    animation: tvChartCrossoverPop 520ms cubic-bezier(.19,1,.22,1);
}

.tv-chart-crossover-marker.is-resting .tv-chart-crossover-marker__badge {
    animation: none;
}

.tv-chart-crossover-marker__badge img {
    width: 76%;
    height: 76%;
    object-fit: contain;
    filter: drop-shadow(0 0 8px rgba(255,255,255,.16));
}

.tv-chart-crossover-marker__fallback {
    font-size: 0.72rem;
    font-weight: 900;
    letter-spacing: 0.08em;
    color: #f4fbff;
    text-transform: uppercase;
    text-shadow: 0 1px 0 rgba(0,0,0,.36);
}

.tv-chart-score-marker {
    position: absolute;
    width: 0;
    top: 0;
    bottom: 0;
    opacity: 0;
    transition: opacity 180ms ease;
    pointer-events: none;
}

.tv-chart-score-marker.is-visible {
    opacity: 1;
}

.tv-chart-score-marker__beam {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 1px;
    transform: translateX(-50%);
    background: linear-gradient(180deg, transparent 0%, color-mix(in srgb, var(--battle-accent, #53c8ff) 76%, white 8%) 24%, color-mix(in srgb, var(--battle-accent, #53c8ff) 88%, transparent) 58%, transparent 100%);
    box-shadow: 0 0 14px color-mix(in srgb, var(--battle-accent, #53c8ff) 34%, transparent);
    opacity: 0.52;
}

.tv-chart-score-marker__badge {
    position: absolute;
    left: 0;
    top: var(--battle-y, 50%);
    width: 30px;
    height: 30px;
    transform: translate(-50%, -50%);
    border-radius: 999px;
    display: grid;
    place-items: center;
    overflow: visible;
    pointer-events: auto;
}

.tv-chart-score-marker__badge-shell {
    width: 100%;
    height: 100%;
    border-radius: 999px;
    display: grid;
    place-items: center;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--battle-accent, #53c8ff) 82%, white 14%);
    background:
        radial-gradient(circle at 30% 30%, rgba(255,255,255,.24), transparent 42%),
        linear-gradient(180deg, rgba(255,255,255,.12), rgba(255,255,255,0) 38%),
        linear-gradient(135deg, color-mix(in srgb, var(--battle-accent, #53c8ff) 30%, rgba(4, 10, 20, 0.94)), rgba(5, 12, 24, 0.96));
    box-shadow:
        0 0 0 1px color-mix(in srgb, var(--battle-accent, #53c8ff) 22%, transparent),
        0 0 18px color-mix(in srgb, var(--battle-accent, #53c8ff) 38%, transparent),
        0 10px 24px rgba(0,0,0,.28);
    animation: tvChartCrossoverPop 460ms cubic-bezier(.19,1,.22,1);
}

.tv-chart-score-marker__badge img {
    width: 76%;
    height: 76%;
    object-fit: contain;
    filter: drop-shadow(0 0 8px rgba(255,255,255,.16));
}

.tv-chart-score-marker__fallback {
    font-size: 0.68rem;
    font-weight: 900;
    letter-spacing: 0.08em;
    color: #f4fbff;
    text-transform: uppercase;
    text-shadow: 0 1px 0 rgba(0,0,0,.36);
}

.tv-chart-score-marker__tooltip {
    position: absolute;
    left: 50%;
    top: calc(100% + 10px);
    min-width: 158px;
    max-width: 220px;
    padding: 9px 10px;
    border-radius: 12px;
    background: linear-gradient(180deg, rgba(7, 15, 28, 0.96), rgba(4, 10, 22, 0.98));
    border: 1px solid color-mix(in srgb, var(--battle-accent, #53c8ff) 42%, rgba(255,255,255,.12));
    box-shadow: 0 14px 30px rgba(0,0,0,.34), 0 0 18px color-mix(in srgb, var(--battle-accent, #53c8ff) 16%, transparent);
    transform: translate(-50%, 4px);
    opacity: 0;
    pointer-events: none;
    transition: opacity 140ms ease, transform 140ms ease;
}

.tv-chart-score-marker__tooltip::before {
    content: "";
    position: absolute;
    left: 50%;
    top: -5px;
    width: 10px;
    height: 10px;
    background: inherit;
    border-left: 1px solid color-mix(in srgb, var(--battle-accent, #53c8ff) 42%, rgba(255,255,255,.12));
    border-top: 1px solid color-mix(in srgb, var(--battle-accent, #53c8ff) 42%, rgba(255,255,255,.12));
    transform: translateX(-50%) rotate(45deg);
}

.tv-chart-score-marker__badge:hover .tv-chart-score-marker__tooltip,
.tv-chart-score-marker__badge:focus-within .tv-chart-score-marker__tooltip {
    opacity: 1;
    transform: translate(-50%, 0);
}

.tv-chart-score-marker__tooltip-time {
    display: block;
    margin-bottom: 4px;
    font-size: 0.68rem;
    font-weight: 900;
    letter-spacing: 0.12em;
    color: rgba(207, 232, 255, 0.78);
    text-transform: uppercase;
}

.tv-chart-score-marker__tooltip-title {
    display: block;
    font-size: 0.82rem;
    font-weight: 900;
    color: #f7fcff;
}

.tv-chart-score-marker__tooltip-reason {
    display: block;
    margin-top: 4px;
    font-size: 0.72rem;
    line-height: 1.35;
    color: rgba(216, 230, 245, 0.82);
}

@keyframes tvChartCrossoverPop {
    0% { opacity: 0; transform: translate(-50%, -50%) scale(0.6); }
    68% { opacity: 1; transform: translate(-50%, -50%) scale(1.1); }
    100% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}
`;

    document.head.appendChild(style);
}

function normalizeSeriesMeta(meta, fallbackColor) {
    const symbol = typeof meta?.symbol === "string" ? meta.symbol.trim() : "";
    const logoUrl = typeof meta?.logoUrl === "string" ? meta.logoUrl.trim() : "";
    const accentColor = typeof meta?.accentColor === "string" && meta.accentColor.trim().length > 0
        ? meta.accentColor.trim()
        : fallbackColor;

    return {
        symbol,
        logoUrl,
        accentColor
    };
}

function getBattleFallbackLabel(symbol) {
    if (typeof symbol !== "string" || symbol.trim().length === 0) {
        return "?";
    }

    const compact = symbol.trim().replace(/[^a-z0-9]/gi, "");
    return compact.slice(0, compact.length >= 4 ? 3 : 2).toUpperCase() || "?";
}

function ensureCompareOverlayRoot(state) {
    ensureCompareCrossoverStyles();

    if (state.overlayRoot?.isConnected) {
        return state.overlayRoot;
    }

    const overlayRoot = document.createElement("div");
    overlayRoot.className = "tv-chart-crossover-layer";
    state.container.appendChild(overlayRoot);
    state.overlayRoot = overlayRoot;
    return overlayRoot;
}

function interpolateSeriesValue(points, time) {
    if (!Array.isArray(points) || points.length === 0) {
        return null;
    }

    if (time < points[0].time || time > points[points.length - 1].time) {
        return null;
    }

    for (let index = 0; index < points.length - 1; index += 1) {
        const start = points[index];
        const end = points[index + 1];

        if (time < start.time || time > end.time) {
            continue;
        }

        const span = end.time - start.time;
        if (span === 0) {
            return end.value;
        }

        const ratio = clamp((time - start.time) / span, 0, 1);
        return start.value + ((end.value - start.value) * ratio);
    }

    return points[points.length - 1].value;
}

function buildBattleSamples(leftPoints, rightPoints) {
    if (!Array.isArray(leftPoints) || !Array.isArray(rightPoints) || leftPoints.length < 2 || rightPoints.length < 2) {
        return [];
    }

    const overlapStart = Math.max(leftPoints[0].time, rightPoints[0].time);
    const overlapEnd = Math.min(leftPoints[leftPoints.length - 1].time, rightPoints[rightPoints.length - 1].time);

    if (!Number.isFinite(overlapStart) || !Number.isFinite(overlapEnd) || overlapEnd <= overlapStart) {
        return [];
    }

    const timeline = new Set([overlapStart, overlapEnd]);

    leftPoints.forEach((point) => {
        if (point.time >= overlapStart && point.time <= overlapEnd) {
            timeline.add(point.time);
        }
    });

    rightPoints.forEach((point) => {
        if (point.time >= overlapStart && point.time <= overlapEnd) {
            timeline.add(point.time);
        }
    });

    return Array.from(timeline)
        .sort((a, b) => a - b)
        .map((time) => {
            const leftValue = interpolateSeriesValue(leftPoints, time);
            const rightValue = interpolateSeriesValue(rightPoints, time);

            if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) {
                return null;
            }

            return {
                time,
                leftValue,
                rightValue,
                diff: leftValue - rightValue
            };
        })
        .filter(Boolean);
}

function findLatestBattleCrossover(leftPoints, rightPoints) {
    const samples = buildBattleSamples(leftPoints, rightPoints);
    if (samples.length < 2) {
        return null;
    }

    const candidates = [];

    for (let index = 1; index < samples.length; index += 1) {
        const previous = samples[index - 1];
        const current = samples[index];

        if (!previous || !current || current.time <= previous.time) {
            continue;
        }

        const yellowTakesLead = previous.diff < 0 && current.diff > 0;
        const blueTakesLead = previous.diff > 0 && current.diff < 0;

        if (!blueTakesLead && !yellowTakesLead) {
            continue;
        }

        const denominator = previous.diff - current.diff;
        const ratio = denominator === 0 ? 0.5 : clamp(previous.diff / denominator, 0, 1);
        const crossTime = previous.time + ((current.time - previous.time) * ratio);
        const leftCrossValue = previous.leftValue + ((current.leftValue - previous.leftValue) * ratio);
        const rightCrossValue = previous.rightValue + ((current.rightValue - previous.rightValue) * ratio);
        const winner = yellowTakesLead ? "left" : "right";
        const winnerValue = winner === "left" ? leftCrossValue : rightCrossValue;
        const strength = Math.abs(current.diff - previous.diff);

        if (!Number.isFinite(crossTime)
            || !Number.isFinite(leftCrossValue)
            || !Number.isFinite(rightCrossValue)
            || !Number.isFinite(winnerValue)
            || strength <= 0.000001) {
            continue;
        }

        candidates.push({
            winner,
            crossTime,
            crossValue: (leftCrossValue + rightCrossValue) / 2,
            winnerValue,
            ratio,
            previousTime: previous.time,
            currentTime: current.time,
            signature: `${winner}:${Math.round(crossTime * 10)}`,
            strength
        });
    }

    if (candidates.length === 0) {
        return null;
    }

    return candidates[candidates.length - 1];
}

function clearCompareMarkerFadeTimer(state) {
    if (state?.markerFadeTimer) {
        window.clearTimeout(state.markerFadeTimer);
        state.markerFadeTimer = null;
    }
}

function clearCompareCrossoverMarker(state) {
    if (!state) {
        return;
    }

    clearCompareMarkerFadeTimer(state);

    try {
        state.markerNode?.remove?.();
    } catch {
    }

    state.markerNode = null;
    state.currentCrossover = null;
}

function clearCompareScoreEventMarkers(state) {
    if (!state) {
        return;
    }

    if (Array.isArray(state.scoreEventMarkerNodes)) {
        for (const markerNode of state.scoreEventMarkerNodes) {
            try {
                markerNode?.remove?.();
            } catch {
            }
        }
    }

    state.scoreEventMarkerNodes = [];
    state.scoreEventMarkers = [];
}

function buildCompareMarkerNode(meta) {
    const marker = document.createElement("div");
    marker.className = "tv-chart-crossover-marker";
    marker.style.setProperty("--battle-accent", meta.accentColor);

    const beam = document.createElement("div");
    beam.className = "tv-chart-crossover-marker__beam";

    const badge = document.createElement("div");
    badge.className = "tv-chart-crossover-marker__badge";

    const fallback = document.createElement("span");
    fallback.className = "tv-chart-crossover-marker__fallback";
    fallback.textContent = getBattleFallbackLabel(meta.symbol);
    badge.appendChild(fallback);

    if (meta.logoUrl) {
        const image = document.createElement("img");
        image.alt = "";
        image.src = meta.logoUrl;
        image.addEventListener("load", () => {
            fallback.style.display = "none";
        }, { once: true });
        image.addEventListener("error", () => {
            image.remove();
            fallback.style.display = "grid";
        }, { once: true });
        badge.appendChild(image);
    }

    marker.appendChild(beam);
    marker.appendChild(badge);
    return marker;
}

function buildScoreEventMarkerNode(markerModel) {
    const marker = document.createElement("div");
    marker.className = "tv-chart-score-marker";
    marker.style.setProperty("--battle-accent", markerModel.accentColor);

    const beam = document.createElement("div");
    beam.className = "tv-chart-score-marker__beam";

    const badge = document.createElement("div");
    badge.className = "tv-chart-score-marker__badge";

    const badgeShell = document.createElement("div");
    badgeShell.className = "tv-chart-score-marker__badge-shell";

    const fallback = document.createElement("span");
    fallback.className = "tv-chart-score-marker__fallback";
    fallback.textContent = getBattleFallbackLabel(markerModel.teamSymbol);
    badgeShell.appendChild(fallback);

    if (markerModel.logoUrl) {
        const image = document.createElement("img");
        image.alt = "";
        image.src = markerModel.logoUrl;
        image.addEventListener("load", () => {
            fallback.style.display = "none";
        }, { once: true });
        image.addEventListener("error", () => {
            image.remove();
            fallback.style.display = "grid";
        }, { once: true });
        badgeShell.appendChild(image);
    }

    const tooltip = document.createElement("div");
    tooltip.className = "tv-chart-score-marker__tooltip";

    const tooltipTime = document.createElement("span");
    tooltipTime.className = "tv-chart-score-marker__tooltip-time";
    tooltipTime.textContent = markerModel.minuteLabel;

    const tooltipTitle = document.createElement("span");
    tooltipTitle.className = "tv-chart-score-marker__tooltip-title";
    tooltipTitle.textContent = `${markerModel.teamSymbol} +${markerModel.points}`;

    const tooltipReason = document.createElement("span");
    tooltipReason.className = "tv-chart-score-marker__tooltip-reason";
    tooltipReason.textContent = markerModel.reason;

    tooltip.appendChild(tooltipTime);
    tooltip.appendChild(tooltipTitle);
    tooltip.appendChild(tooltipReason);

    badge.appendChild(badgeShell);
    badge.appendChild(tooltip);
    badge.title = `${markerModel.minuteLabel}\n${markerModel.teamSymbol} +${markerModel.points}\n${markerModel.reason}`;

    marker.appendChild(beam);
    marker.appendChild(badge);
    return marker;
}

function positionCompareCrossoverMarker(state) {
    const marker = state?.currentCrossover;
    const markerNode = state?.markerNode;
    if (!marker || !markerNode || !state.chart || !state.chart.timeScale) {
        return;
    }

    const timeScale = state.chart.timeScale();
    const winnerSeries = marker.winner === "right" ? state.rightSeries : state.leftSeries;
    if (!winnerSeries?.priceToCoordinate) {
        return;
    }

    const previousX = timeScale.timeToCoordinate(marker.previousTime);
    const currentX = timeScale.timeToCoordinate(marker.currentTime);
    const winnerY = winnerSeries.priceToCoordinate(marker.crossValue);

    if (!Number.isFinite(previousX) || !Number.isFinite(currentX) || !Number.isFinite(winnerY)) {
        markerNode.classList.remove("is-visible");
        return;
    }

    const rect = state.container.getBoundingClientRect();
    const x = clamp(previousX + ((currentX - previousX) * marker.ratio), 18, Math.max(18, rect.width - 18));
    const y = clamp(winnerY, 18, Math.max(18, rect.height - 18));

    markerNode.style.left = `${x}px`;
    markerNode.style.setProperty("--battle-y", `${y}px`);
    markerNode.classList.add("is-visible");
}

function refreshCompareCrossoverMarker(state) {
    if (!state?.currentCrossover || !state?.markerNode) {
        return;
    }

    positionCompareCrossoverMarker(state);
}

function positionCompareScoreEventMarkers(state) {
    if (!state?.chart || !state?.scoreEventMarkerNodes?.length) {
        return;
    }

    const timeScale = state.chart.timeScale?.();
    if (!timeScale) {
        return;
    }

    const rect = state.container.getBoundingClientRect();

    state.scoreEventMarkerNodes.forEach((entry) => {
        const series = entry.model.side === "right" ? state.rightSeries : state.leftSeries;
        const x = timeScale.timeToCoordinate(entry.model.time);
        const yBase = series?.priceToCoordinate?.(entry.model.value);
        const coordinate = Number.isFinite(x) ? x : null;

        console.log("[TV_CHART] score marker time", {
            rawTime: entry.model.rawTime,
            normalizedTime: entry.model.normalizedTime ?? entry.model.time,
            firstSeriesTime: entry.model.firstSeriesTime,
            lastSeriesTime: entry.model.lastSeriesTime,
            coordinate,
            status: entry.model.visibilityReason ?? "ok"
        });

        if (!Number.isFinite(x) || !Number.isFinite(yBase)) {
            entry.node.classList.remove("is-visible");
            return;
        }

        const y = clamp(
            yBase + (Number(entry.model.stackOffsetPx) || 0),
            18,
            Math.max(18, rect.height - 18));
        entry.node.style.left = `${x}px`;
        entry.node.style.setProperty("--battle-y", `${y}px`);
        entry.node.classList.add("is-visible");
    });
}

function renderCompareScoreEventMarkers(state, markerModels) {
    clearCompareScoreEventMarkers(state);

    if (!Array.isArray(markerModels) || markerModels.length === 0) {
        return;
    }

    const overlayRoot = ensureCompareOverlayRoot(state);
    state.scoreEventMarkers = markerModels;
    state.scoreEventMarkerNodes = markerModels.map((markerModel) => {
        const node = buildScoreEventMarkerNode(markerModel);
        overlayRoot.appendChild(node);
        return { model: markerModel, node };
    });

    positionCompareScoreEventMarkers(state);
}

function maybeRenderCompareCrossover(state, leftPoints, rightPoints, leftMeta, rightMeta) {
    const nextMarker = findLatestBattleCrossover(leftPoints, rightPoints);
    if (!nextMarker) {
        clearCompareCrossoverMarker(state);
        return;
    }

    const currentMarker = state.currentCrossover;
    const sameSignature = currentMarker && currentMarker.signature === nextMarker.signature;
    if (sameSignature) {
        state.currentCrossover = {
            ...currentMarker,
            ...nextMarker
        };
        refreshCompareCrossoverMarker(state);
        return;
    }

    if (currentMarker) {
        const secondsSinceCross = nextMarker.crossTime - currentMarker.crossTime;
        const changedWinner = nextMarker.winner !== currentMarker.winner;
        if (secondsSinceCross < (changedWinner ? 6 : 14)) {
            return;
        }
    }

    const winnerMeta = nextMarker.winner === "right" ? rightMeta : leftMeta;
    const overlayRoot = ensureCompareOverlayRoot(state);

    clearCompareCrossoverMarker(state);

    const markerNode = buildCompareMarkerNode(winnerMeta);
    overlayRoot.appendChild(markerNode);

    state.markerNode = markerNode;
    state.currentCrossover = {
        ...nextMarker,
        renderedAt: Date.now(),
        winnerMeta
    };

    window.requestAnimationFrame(() => {
        positionCompareCrossoverMarker(state);
    });

    state.markerFadeTimer = window.setTimeout(() => {
        state.markerNode?.classList.add("is-resting");
    }, 2600);
}

function maybeRenderCompareScoreEvents(state, payload, leftPoints, rightPoints, leftMeta, rightMeta) {
    const markerModels = buildScoreEventMarkersModel({
        leftPoints,
        rightPoints,
        scoreEvents: payload?.scoreEvents,
        leftMeta,
        rightMeta,
        leftTeamId: payload?.leftTeamId,
        rightTeamId: payload?.rightTeamId,
        matchStartTimeUtc: payload?.matchStartTimeUtc
    });

    if (markerModels.length > 0) {
        clearCompareCrossoverMarker(state);
        renderCompareScoreEventMarkers(state, markerModels);
        return true;
    }

    clearCompareScoreEventMarkers(state);
    return false;
}

async function ensureCandlestickChart(containerId) {
    telemetryChartsState = telemetryChartsState ?? { charts: new Map(), libPromise: null };

    const existing = telemetryChartsState.charts.get(containerId);
    const container = document.getElementById(containerId);

    if (!container) {
        throw new Error(`missing container ${containerId}`);
    }

    if (existing?.container && existing.container !== container) {
        disposeChartEntry(existing);
        telemetryChartsState.charts.delete(containerId);
    }

    const active = telemetryChartsState.charts.get(containerId);

    if (active?.chart && active?.series && active.kind === "candlestick") {
        ensureResizeObserver(container, active.chart);
        return active;
    }

    if (!container.isConnected) {
        throw new Error(`detached container ${containerId}`);
    }

    const LightweightCharts = await ensureLightweightChartsLoaded();
    const rect = container.getBoundingClientRect();

    const chart = LightweightCharts.createChart(container, {
        autoSize: true,
        width: Math.max(1, Math.floor(rect.width)),
        height: Math.max(1, Math.floor(rect.height))
    });

    applyChartTheme(LightweightCharts, chart);

    // Make candles feel like a broadcast terminal: thicker bars and more vertical breathing room.
    try {
        chart.applyOptions({
            timeScale: {
                barSpacing: 22
            },
            rightPriceScale: {
                scaleMargins: { top: 0.15, bottom: 0.15 }
            },
            leftPriceScale: {
                scaleMargins: { top: 0.15, bottom: 0.15 }
            }
        });
    } catch {
    }

    const series = addCandlestickSeriesCompat(LightweightCharts, chart, {
        upColor: "#70ffb3",
        downColor: "#ff4f7b",
        borderUpColor: "#70ffb3",
        borderDownColor: "#ff4f7b",
        wickUpColor: "rgba(112, 255, 179, 0.95)",
        wickDownColor: "rgba(255, 79, 123, 0.95)",
        wickVisible: true,
        borderVisible: true,
        priceLineVisible: false,
        lastValueVisible: false
    });

    const state = {
        kind: "candlestick",
        container,
        chart,
        series,
        resizeObserver: null
    };

    telemetryChartsState.charts.set(containerId, state);
    ensureResizeObserver(container, chart);

    return state;
}

async function ensureCompareChart(containerId) {
    telemetryChartsState = telemetryChartsState ?? { charts: new Map(), libPromise: null };

    const existing = telemetryChartsState.charts.get(containerId);
    const container = document.getElementById(containerId);

    if (!container) {
        throw new Error(`missing container ${containerId}`);
    }

    if (existing?.container && existing.container !== container) {
        disposeChartEntry(existing);
        telemetryChartsState.charts.delete(containerId);
    }

    const active = telemetryChartsState.charts.get(containerId);

    if (active?.chart && active?.leftSeries && active?.rightSeries) {
        ensureResizeObserver(container, active.chart);
        return active;
    }

    if (!container.isConnected) {
        throw new Error(`detached container ${containerId}`);
    }

    const LightweightCharts = await ensureLightweightChartsLoaded();
    const rect = container.getBoundingClientRect();

    const chart = LightweightCharts.createChart(container, {
        autoSize: true,
        width: Math.max(1, Math.floor(rect.width)),
        height: Math.max(1, Math.floor(rect.height))
    });

    applyChartTheme(LightweightCharts, chart);

    const leftSeries = addLineSeriesCompat(LightweightCharts, chart, {
        color: "rgba(255, 215, 110, 0.96)",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false
    });

    const rightSeries = addLineSeriesCompat(LightweightCharts, chart, {
        color: "rgba(134, 201, 255, 0.92)",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false
    });

    const state = {
        kind: "compare",
        container,
        chart,
        leftSeries,
        rightSeries,
        resizeObserver: null,
        overlayRoot: null,
        markerNode: null,
        currentCrossover: null,
        markerFadeTimer: null,
        scoreEventMarkers: [],
        scoreEventMarkerNodes: [],
        leftMeta: null,
        rightMeta: null
    };

    telemetryChartsState.charts.set(containerId, state);
    ensureResizeObserver(container, chart);

    return state;
}

function normalizePoints(points) {
    if (!Array.isArray(points)) {
        return [];
    }

    return points
        .map((p) => {
            if (!p) {
                return null;
            }

            const time = normalizeChartTime(p.time);
            const value = Number(p.value);

            if (!Number.isFinite(time) || !Number.isFinite(value)) {
                return null;
            }

            return { time, value };
        })
        .filter(Boolean)
        .sort((a, b) => a.time - b.time);
}

function normalizeChartTime(value) {
    if (typeof value === "string" && value.trim().length > 0) {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) {
            return Math.floor(parsed / 1000);
        }
    }

    if (value instanceof Date) {
        return Math.floor(value.getTime() / 1000);
    }

    if (typeof value === "number" && Number.isFinite(value)) {
        if (value > 100000000000) {
            return Math.floor(value / 1000);
        }

        if (value > 1000000000) {
            return Math.floor(value);
        }

        if (value >= 0) {
            return Math.floor(value);
        }
    }

    return null;
}

function normalizeScoreEventSymbol(symbol) {
    if (typeof symbol !== "string" || symbol.trim().length === 0) {
        return "";
    }

    const compact = symbol
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
    const quoteSuffixes = ["USDT", "USDC", "FDUSD", "BUSD", "TUSD", "USDP", "USD"];

    for (const suffix of quoteSuffixes) {
        if (compact.endsWith(suffix) && compact.length > suffix.length) {
            return compact.slice(0, compact.length - suffix.length);
        }
    }

    return compact;
}

function toUnixSeconds(value) {
    return normalizeChartTime(value);
}

function buildGameMinuteLabel(matchStartTimeUtc, eventTime) {
    const startUnix = toUnixSeconds(matchStartTimeUtc);
    if (!Number.isFinite(startUnix)) {
        const date = new Date(eventTime * 1000);
        return `${date.getUTCHours().toString().padStart(2, "0")}:${date.getUTCMinutes().toString().padStart(2, "0")}`;
    }

    const elapsedSeconds = Math.max(0, Math.round(eventTime - startUnix));
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function resolveScoreEventSeriesSide(scoreEvent, leftMeta, rightMeta, leftTeamId, rightTeamId) {
    const eventSymbol = normalizeScoreEventSymbol(scoreEvent?.teamSymbol);
    const leftSymbol = normalizeScoreEventSymbol(leftMeta?.symbol);
    const rightSymbol = normalizeScoreEventSymbol(rightMeta?.symbol);
    if (eventSymbol) {
        if (eventSymbol === leftSymbol) {
            return "left";
        }

        if (eventSymbol === rightSymbol) {
            return "right";
        }

        return null;
    }

    const numericTeamId = Number(scoreEvent?.teamId);
    if (Number.isFinite(numericTeamId)) {
        if (Number.isFinite(Number(leftTeamId)) && numericTeamId === Number(leftTeamId)) {
            return "left";
        }

        if (Number.isFinite(Number(rightTeamId)) && numericTeamId === Number(rightTeamId)) {
            return "right";
        }
    }

    return null;
}

function buildScoreEventStackOffset(stackIndex) {
    if (stackIndex <= 0) {
        return 0;
    }

    const level = Math.ceil(stackIndex / 2);
    const direction = stackIndex % 2 === 1 ? -1 : 1;
    return direction * level * 18;
}

function isCrossoverScoreEvent(scoreEvent) {
    const parts = [
        scoreEvent?.ruleType,
        scoreEvent?.eventType,
        scoreEvent?.reasonCode,
        scoreEvent?.description,
        scoreEvent?.reason
    ]
        .filter((part) => typeof part === "string" && part.trim().length > 0)
        .join(" ")
        .toUpperCase();

    return parts.includes("CROSSOVER");
}

function buildBattleCrossovers(leftPoints, rightPoints) {
    const samples = buildBattleSamples(leftPoints, rightPoints);
    if (samples.length < 2) {
        return [];
    }

    const crossovers = [];

    for (let index = 1; index < samples.length; index += 1) {
        const previous = samples[index - 1];
        const current = samples[index];

        if (!previous || !current || current.time <= previous.time) {
            continue;
        }

        const previousDiff = previous.rightValue - previous.leftValue;
        const currentDiff = current.rightValue - current.leftValue;
        const rightCrossedUp = previousDiff < 0 && currentDiff > 0;
        const leftCrossedUp = previousDiff > 0 && currentDiff < 0;

        if (!rightCrossedUp && !leftCrossedUp) {
            continue;
        }

        const denominator = Math.abs(previousDiff) + Math.abs(currentDiff);
        const t = denominator <= 0 ? 0.5 : clamp(Math.abs(previousDiff) / denominator, 0, 1);
        const crossTime = previous.time + ((current.time - previous.time) * t);
        const crossValue = previous.leftValue + ((current.leftValue - previous.leftValue) * t);

        if (!Number.isFinite(crossTime) || !Number.isFinite(crossValue)) {
            continue;
        }

        crossovers.push({
            side: leftCrossedUp ? "left" : "right",
            crossTime,
            crossValue,
            previousTime: previous.time,
            currentTime: current.time
        });
    }

    return crossovers;
}

function resolveScoreEventPlotPoint(scoreEvent, side, leftPoints, rightPoints, crossoverMatches) {
    if (isCrossoverScoreEvent(scoreEvent)) {
        const eventTime = scoreEvent.eventTime;
        const matchingCrossovers = crossoverMatches
            .map((crossover, index) => ({ crossover, index }))
            .filter((entry) => {
                if (entry.crossover.side !== side || entry.crossover.used) {
                    return false;
                }

                const windowStart = Math.min(entry.crossover.previousTime, entry.crossover.currentTime);
                const windowEnd = Math.max(entry.crossover.previousTime, entry.crossover.currentTime);
                return eventTime >= windowStart && eventTime <= windowEnd;
            });

        if (matchingCrossovers.length === 0) {
            const seriesPoints = side === "left" ? leftPoints : rightPoints;
            const value = interpolateSeriesValue(seriesPoints, eventTime);
            return Number.isFinite(value)
                ? { time: eventTime, value }
                : null;
        }

        matchingCrossovers.sort((a, b) => {
            const deltaA = Math.abs(a.crossover.currentTime - eventTime);
            const deltaB = Math.abs(b.crossover.currentTime - eventTime);
            if (deltaA !== deltaB) {
                return deltaA - deltaB;
            }

            return a.crossover.crossTime - b.crossover.crossTime;
        });

        const winner = matchingCrossovers[0];
        crossoverMatches[winner.index].used = true;

        return {
            time: winner.crossover.crossTime,
            value: winner.crossover.crossValue
        };
    }

    const seriesPoints = side === "left" ? leftPoints : rightPoints;
    const value = interpolateSeriesValue(seriesPoints, scoreEvent.eventTime);
    if (!Number.isFinite(value)) {
        return null;
    }

    return {
        time: scoreEvent.eventTime,
        value
    };
}

function buildScoreEventMarkersModel(payload) {
    const normalizedLeftPoints = normalizePoints(payload?.leftPoints);
    const normalizedRightPoints = normalizePoints(payload?.rightPoints);
    const firstSeriesTime = Math.max(
        normalizedLeftPoints[0]?.time ?? Number.NaN,
        normalizedRightPoints[0]?.time ?? Number.NaN);
    const lastSeriesTime = Math.min(
        normalizedLeftPoints[normalizedLeftPoints.length - 1]?.time ?? Number.NaN,
        normalizedRightPoints[normalizedRightPoints.length - 1]?.time ?? Number.NaN);
    const normalizedScoreEvents = Array.isArray(payload?.scoreEvents)
        ? payload.scoreEvents
            .map((scoreEvent) => {
                const rawTime =
                    scoreEvent?.eventTimeUtc
                    ?? scoreEvent?.occurredAtUtc
                    ?? scoreEvent?.createdAtUtc
                    ?? scoreEvent?.capturedAtUtc
                    ?? scoreEvent?.time
                    ?? scoreEvent?.eventTime;
                const eventTime = normalizeChartTime(rawTime);
                const points = Number(scoreEvent?.points ?? 0);
                const matchScoreEventId = Number(scoreEvent?.matchScoreEventId ?? 0);

                if (!Number.isFinite(eventTime) || !Number.isFinite(points) || points <= 0) {
                    return null;
                }

                return {
                    matchScoreEventId,
                    rawTime,
                    eventTime,
                    points,
                    teamId: scoreEvent?.teamId ?? null,
                    teamSymbol: typeof scoreEvent?.teamSymbol === "string" ? scoreEvent.teamSymbol : "",
                    ruleType: typeof scoreEvent?.ruleType === "string" ? scoreEvent.ruleType : "",
                    eventType: typeof scoreEvent?.eventType === "string" ? scoreEvent.eventType : "",
                    reasonCode: typeof scoreEvent?.reasonCode === "string" ? scoreEvent.reasonCode : "",
                    description: typeof scoreEvent?.description === "string" ? scoreEvent.description : "",
                    reason: typeof scoreEvent?.description === "string" && scoreEvent.description.length > 0
                        ? scoreEvent.description
                        : typeof scoreEvent?.reasonCode === "string" && scoreEvent.reasonCode.length > 0
                            ? scoreEvent.reasonCode
                            : typeof scoreEvent?.eventType === "string" && scoreEvent.eventType.length > 0
                                ? scoreEvent.eventType
                                : "Score event",
                    visibilityReason: "ok"
                };
            })
            .filter(Boolean)
            .sort((a, b) => a.eventTime === b.eventTime ? a.matchScoreEventId - b.matchScoreEventId : a.eventTime - b.eventTime)
        : [];

    if (normalizedLeftPoints.length === 0 || normalizedRightPoints.length === 0 || normalizedScoreEvents.length === 0) {
        return [];
    }

    const overlapStart = firstSeriesTime;
    const overlapEnd = lastSeriesTime;

    if (!Number.isFinite(overlapStart) || !Number.isFinite(overlapEnd) || overlapEnd < overlapStart) {
        return [];
    }

    const stackState = new Map();
    const crossoverMatches = buildBattleCrossovers(normalizedLeftPoints, normalizedRightPoints)
        .map((crossover) => ({ ...crossover, used: false }));
    const nearEndClampWindowSeconds = 120;

    return normalizedScoreEvents
        .map((scoreEvent) => {
            const side = resolveScoreEventSeriesSide(
                scoreEvent,
                payload?.leftMeta,
                payload?.rightMeta,
                payload?.leftTeamId,
                payload?.rightTeamId);
            if (!side) {
                return null;
            }

            let normalizedEventTime = scoreEvent.eventTime;
            let visibilityReason = "ok";

            if (normalizedEventTime < overlapStart || normalizedEventTime > overlapEnd) {
                if (normalizedEventTime > overlapEnd && normalizedEventTime - overlapEnd <= nearEndClampWindowSeconds) {
                    normalizedEventTime = overlapEnd;
                    visibilityReason = "clamped-near-end";
                } else {
                    console.log("[TV_CHART] score marker time", {
                        rawTime: scoreEvent.rawTime,
                        normalizedTime: scoreEvent.eventTime,
                        firstSeriesTime,
                        lastSeriesTime,
                        coordinate: null,
                        status: "event-out-of-range"
                    });
                    return null;
                }
            }

            const plotPoint = resolveScoreEventPlotPoint(
                {
                    ...scoreEvent,
                    eventTime: normalizedEventTime
                },
                side,
                normalizedLeftPoints,
                normalizedRightPoints,
                crossoverMatches);
            if (!plotPoint || !Number.isFinite(plotPoint.time) || !Number.isFinite(plotPoint.value)) {
                return null;
            }

            const meta = side === "left" ? payload?.leftMeta : payload?.rightMeta;
            const minuteBucket = Math.floor(plotPoint.time / 60);
            const stackKey = `${side}:${minuteBucket}`;
            const stackIndex = stackState.get(stackKey) ?? 0;
            stackState.set(stackKey, stackIndex + 1);

            return {
                key: `score:${scoreEvent.matchScoreEventId || `${side}:${scoreEvent.eventTime}:${stackIndex}`}`,
                side,
                time: plotPoint.time,
                value: plotPoint.value,
                rawTime: scoreEvent.rawTime,
                normalizedTime: normalizedEventTime,
                firstSeriesTime,
                lastSeriesTime,
                visibilityReason,
                stackIndex,
                stackOffsetPx: buildScoreEventStackOffset(stackIndex),
                teamSymbol: scoreEvent.teamSymbol || meta?.symbol || "",
                logoUrl: typeof meta?.logoUrl === "string" ? meta.logoUrl : "",
                accentColor: typeof meta?.accentColor === "string" ? meta.accentColor : "",
                points: scoreEvent.points,
                reason: scoreEvent.reason,
                minuteLabel: buildGameMinuteLabel(payload?.matchStartTimeUtc, scoreEvent.eventTime)
            };
        })
        .filter(Boolean);
}

function normalizeCompareLine(points) {
    return normalizePoints(points)
        .map((point) => ({
            time: point.time,
            value: point.value
        }));
}

function buildSyntheticCandles(points, bucketSeconds = 30) {
    const normalized = normalizePoints(points);
    const buckets = new Map();

    for (const point of normalized) {
        const bucketTime = Math.floor(point.time / bucketSeconds) * bucketSeconds;

        if (!buckets.has(bucketTime)) {
            buckets.set(bucketTime, []);
        }

        buckets.get(bucketTime).push(point);
    }

    let previousClose = null;

    let candles = Array.from(buckets.entries())
        .sort(([a], [b]) => a - b)
        .map(([time, bucket]) => {
            bucket.sort((a, b) => a.time - b.time);

            const current = bucket[bucket.length - 1].value;
            const open = previousClose ?? bucket[0].value;
            const close = current;
            previousClose = close;

            let high = Math.max(...bucket.map((x) => x.value));
            let low = Math.min(...bucket.map((x) => x.value));

            const delta = close - open;
            const baseRange = high - low;

            // Cinematic synthetic volatility: ensures visible bodies/wicks even when pct changes are small.
            let volatility = Math.max(Math.abs(delta) * 0.45, Math.abs(baseRange) * 0.35, 0.12);
            volatility = Math.min(volatility, 1.8);

            high = Math.max(high, open, close) + volatility;
            low = Math.min(low, open, close) - volatility;

            return {
                time,
                open,
                high,
                low,
                close
            };
        });

    if (candles.length === 1) {
        const only = candles[0];
        const previousTime = only.time - bucketSeconds;
        const padding = Math.max(Math.abs(only.close) * 0.006, 0.05);

        candles = [
            {
                time: previousTime,
                open: only.open - padding,
                high: only.high,
                low: only.low - padding,
                close: only.open
            },
            only
        ];
    }

    return candles;
}

function setChartEmptyState(containerId, isEmpty, message = "coletando candles") {
    const container = document.getElementById(containerId);

    if (!container) {
        return;
    }

    let badge = container.querySelector(".tv-chart-empty-state");

    if (!isEmpty) {
        badge?.remove();
        return;
    }

    if (!badge) {
        badge = document.createElement("div");
        badge.className = "tv-chart-empty-state";
        badge.style.position = "absolute";
        badge.style.inset = "0";
        badge.style.display = "grid";
        badge.style.placeItems = "center";
        badge.style.color = "rgba(219, 232, 247, 0.60)";
        badge.style.fontSize = "0.76rem";
        badge.style.fontWeight = "900";
        badge.style.letterSpacing = "0.12em";
        badge.style.textTransform = "uppercase";
        badge.style.pointerEvents = "none";
        badge.style.zIndex = "2";
        container.appendChild(badge);
    }

    badge.textContent = message;
}

function fitChart(chart) {
    try {
        chart.timeScale().fitContent();
    } catch {
    }
}

export async function updateTelemetryCharts(payload) {
    telemetryChartsState = telemetryChartsState ?? { charts: new Map(), libPromise: null };
    telemetryChartsState.lastPayload = payload;

    if (!hasChartContainers()) {
        if (throttleKey("TV_CHART", "waiting containers", 1500)) {
            telemetryChartLog("waiting containers");
        }

        scheduleContainerRetry("updateTelemetryCharts");
        return;
    }

    try {
        const leftPoints = normalizePoints(payload?.left);
        const rightPoints = normalizePoints(payload?.right);
        const leftMeta = normalizeSeriesMeta(payload?.leftMeta, "rgba(255, 215, 110, 0.96)");
        const rightMeta = normalizeSeriesMeta(payload?.rightMeta, "rgba(134, 201, 255, 0.92)");

        const leftCandles = buildSyntheticCandles(leftPoints, 30);
        const rightCandles = buildSyntheticCandles(rightPoints, 30);

        const left = await ensureCandlestickChart("tv-telemetry-chart-left");
        const right = await ensureCandlestickChart("tv-telemetry-chart-right");
        const compare = await ensureCompareChart("tv-telemetry-chart-compare");

        left.series.setData(leftCandles);
        right.series.setData(rightCandles);

        // Split charts live inside a "virtual face"; render them only if containers exist.
        let splitLeft = null;
        let splitRight = null;
        if (document.getElementById("tv-telemetry-chart-split-left")) {
            splitLeft = await ensureCandlestickChart("tv-telemetry-chart-split-left");
            splitLeft.series.setData(leftCandles);
        }
        if (document.getElementById("tv-telemetry-chart-split-right")) {
            splitRight = await ensureCandlestickChart("tv-telemetry-chart-split-right");
            splitRight.series.setData(rightCandles);
        }

        compare.leftSeries.setData(normalizeCompareLine(leftPoints));
        compare.rightSeries.setData(normalizeCompareLine(rightPoints));
        compare.leftMeta = leftMeta;
        compare.rightMeta = rightMeta;

        setChartEmptyState("tv-telemetry-chart-left", leftCandles.length < 2);
        setChartEmptyState("tv-telemetry-chart-right", rightCandles.length < 2);
        setChartEmptyState("tv-telemetry-chart-compare", leftPoints.length < 2 && rightPoints.length < 2, "coletando fluxo");
        if (splitLeft) {
            setChartEmptyState("tv-telemetry-chart-split-left", leftCandles.length < 2);
        }
        if (splitRight) {
            setChartEmptyState("tv-telemetry-chart-split-right", rightCandles.length < 2);
        }

        fitChart(left.chart);
        fitChart(right.chart);
        fitChart(compare.chart);
        const renderedOfficialScoreEvents = maybeRenderCompareScoreEvents(compare, payload, leftPoints, rightPoints, leftMeta, rightMeta);
        if (!renderedOfficialScoreEvents) {
            maybeRenderCompareCrossover(compare, leftPoints, rightPoints, leftMeta, rightMeta);
        }
        if (splitLeft) {
            fitChart(splitLeft.chart);
        }
        if (splitRight) {
            fitChart(splitRight.chart);
        }

        window.requestAnimationFrame(() => resizeTelemetryCharts());
        window.setTimeout(() => resizeTelemetryCharts(), 80);
        window.setTimeout(() => resizeTelemetryCharts(), 350);

        telemetryChartLog("rendered candles left/right + compare", {
            leftCandles: leftCandles.length,
            rightCandles: rightCandles.length,
            leftPoints: leftPoints.length,
            rightPoints: rightPoints.length,
            scoreEvents: Array.isArray(payload?.scoreEvents) ? payload.scoreEvents.length : 0,
            officialMarkers: compare.scoreEventMarkers?.length ?? 0
        });

        if (splitLeft || splitRight) {
            telemetryChartLog("rendered split variation", {
                leftPoints: leftPoints.length,
                rightPoints: rightPoints.length,
                leftCandles: leftCandles.length,
                rightCandles: rightCandles.length
            });
        }
    } catch (err) {
        const message = err?.message ?? String(err);

        if (throttleKey("TV_CHART", `error:${message}`, 4000)) {
            telemetryChartLog("error", message);
        }

        setCubeFace(0, "chart-error");
    }
}

export async function initBroadcastAudio(elementId, volume, muted) {
    const audio = document.getElementById(elementId);
    const manager = ensureTvAudioManager();
    const safeVolume = clamp(Number(volume) || manager.volume, 0, 1);
    const context = getTvAudioContext();
    manager.initCount += 1;
    consoleAudio("AUDIO_INIT", {
        initCount: manager.initCount,
        elementId,
        hasElement: Boolean(audio),
        contextState: context?.state ?? "none",
        muted: Boolean(muted),
        volume: safeVolume
    });

    if (!audio) {
        manager.ambientElementId = elementId;
        manager.ambientTargetVolume = safeVolume;
        manager.ambient.hostElementId = elementId;
        setTvAudioSettings(safeVolume, muted);
        return getTvAudioState();
    }

    ensureAudioUnlockListeners();
    attachAmbientLifecycleListeners();
    await unlockTvAudioContext("initBroadcastAudio");

    manager.ambientElementId = elementId;
    manager.ambientTargetVolume = safeVolume;
    manager.ambient.hostElementId = elementId;
    manager.ambient.destroyed = false;
    if (!manager.ambient.currentAudio) {
        prepareInitialAmbientAudio(audio);
    } else {
        prepareAmbientHostElement(audio);
    }
    setTvAudioSettings(safeVolume, muted);

    if (!Boolean(muted)) {
        await resumeAmbientPlayback("init");
    }

    return getTvAudioState();
}

export function setBroadcastAudioMuted(elementId, muted, volume) {
    const manager = ensureTvAudioManager();
    const safeVolume = clamp(Number(volume) || manager.ambientTargetVolume || manager.volume, 0, 1);

    manager.ambientElementId = elementId;
    manager.ambient.hostElementId = elementId;
    manager.ambientTargetVolume = safeVolume;
    setTvAudioSettings(safeVolume, muted);

    if (Boolean(muted)) {
        logAmbientDebug("muted", { volume: safeVolume });
        return;
    }

    resumeAmbientPlayback("setBroadcastAudioMuted").catch(() => { });
}

export function playAudioCue(elementId) {
    if (typeof elementId === "string" && Object.prototype.hasOwnProperty.call(tvAudioMap, elementId)) {
        playTvAudio(elementId);
        return;
    }

    const audio = document.getElementById(elementId);

    if (!audio) {
        playTvAudio("goal");
        return;
    }

    try {
        audio.loop = false;
    } catch {
    }

    audio.play().catch(() => { });
}

export function initTvAudioManager(volume, muted) {
    const manager = ensureTvAudioManager();
    if (typeof volume === "number") {
        manager.volume = Math.min(1, Math.max(0, volume));
    }
    manager.muted = Boolean(muted);
    ensureAudioUnlockListeners();
    attachAmbientLifecycleListeners();
    preloadAllTvAudio();
    consoleAudio("AUDIO_INIT", {
        volume: manager.volume,
        muted: manager.muted,
        preloadCount: Object.keys(tvAudioMap).length
    });
    return diagnoseTvAudio();
}

export function playTvAudioCue(key, options) {
    const context = getTvAudioContext();
    if (context && context.state === "suspended") {
        unlockTvAudioContext(`playTvAudioCue:${key}`).catch(() => { });
    }
    return playTvAudio(key, options);
}

export async function unlockBroadcastAudio(elementId, volume, muted) {
    const unlocked = await unlockTvAudioContext("manual-button");
    if (elementId) {
        await initBroadcastAudio(elementId, volume, muted);
    }

    const state = getTvAudioState();
    state.unlocked = Boolean(state.unlocked || unlocked);
    return state;
}

export function stopTvAudioCue(key) {
    const manager = ensureTvAudioManager();
    const audio = manager.preload.get(key);
    if (!audio) {
        return;
    }

    try {
        audio.pause();
        audio.currentTime = 0;
    } catch {
    }
}

export function destroyBroadcastAudio(elementId) {
    const manager = ensureTvAudioManager();
    if (!elementId || manager.ambient.hostElementId === elementId || manager.ambientElementId === elementId) {
        stopAmbientPlayback();
        manager.ambient.hostElementId = null;
        manager.ambientElementId = null;
    }
}

if (typeof globalThis !== "undefined") {
    globalThis.initBroadcastAudio = initBroadcastAudio;
    globalThis.setBroadcastAudioMuted = setBroadcastAudioMuted;
    globalThis.playAudioCue = playAudioCue;
    globalThis.initTvAudioManager = initTvAudioManager;
    globalThis.playTvAudioCue = playTvAudioCue;
    globalThis.stopTvAudioCue = stopTvAudioCue;
    globalThis.unlockBroadcastAudio = unlockBroadcastAudio;
    globalThis.destroyBroadcastAudio = destroyBroadcastAudio;
    globalThis.getTvAudioState = getTvAudioState;
    globalThis.tvAudioMap = tvAudioMap;
    globalThis.criptoVersusTvAudioManager = {
        init: initTvAudioManager,
        play: playTvAudioCue,
        stop: stopTvAudioCue,
        setSettings: setTvAudioSettings,
        diagnose: diagnoseTvAudio,
        unlock: unlockBroadcastAudio,
        destroy: destroyBroadcastAudio,
        state: getTvAudioState
    };
    globalThis.criptoVersusTvCharts = {
        initTelemetryCube,
        notifyTelemetryCubeEvent,
        updateTelemetryCharts,
        initFieldSway,
        destroyFieldSway
    };
}
