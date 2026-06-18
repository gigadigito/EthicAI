import {
    tvAudioChannelMap,
    tvAudioMap,
    tvAudioMixProfiles
} from "./tvAudioConfig.mjs";
import {
    getMediaCulture,
    resolveLocalizedAudioPath,
    setMediaCulture
} from "./mediaLocalization.mjs";

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

let tvAudioManagerState = null;

export function ensureTvAudioManager() {
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
            destroyed: false,
            debugStatus: "stopped",
            debugError: null,
            debugSelectedTrack: null
        },
        diagnostics: {
            loaded: [],
            queued: [],
            played: []
        },
        ambientDuckRestoreTimer: null,
        culture: getMediaCulture(),
        resolvedAudioUrls: new Map(),
        backgroundAudioConfig: null
    };

    return tvAudioManagerState;
}

export function resolveTvAudioChannel(key) {
    return tvAudioChannelMap[key] ?? "fx";
}

export function getTvAudioContext() {
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
        return context;
    } catch {
        return null;
    }
}

export function getChannelGain(channel) {
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

export function connectAudioElement(audio, channel) {
    const manager = ensureTvAudioManager();
    const context = getTvAudioContext();
    if (!context || context.state !== "running") {
        console.debug("[TV_AUDIO_CONNECT]", {
            reason: "context-not-running",
            channel,
            contextState: context?.state ?? null,
            src: audio?.currentSrc ?? audio?.src ?? null,
            crossOrigin: audio?.crossOrigin ?? null
        });
        return null;
    }

    if (manager.sourceNodes.has(audio)) {
        console.debug("[TV_AUDIO_CONNECT]", {
            reason: "existing-source-node",
            channel,
            src: audio?.currentSrc ?? audio?.src ?? null,
            crossOrigin: audio?.crossOrigin ?? null
        });
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
    } catch (error) {
        console.debug("[TV_AUDIO_CONNECT]", {
            reason: "create-media-element-source-failed",
            channel,
            src: audio?.currentSrc ?? audio?.src ?? null,
            crossOrigin: audio?.crossOrigin ?? null,
            readyState: audio?.readyState ?? null,
            networkState: audio?.networkState ?? null,
            errorName: error?.name ?? "Error",
            errorMessage: error?.message ?? String(error)
        });
        return null;
    }
}

export function fadeGainTo(gainNode, target, durationMs = 1200) {
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

export function fadeMediaVolume(audio, target, durationMs = 1200) {
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

export function cleanupManagedAudio(audio) {
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

    try {
        audio.pause();
    } catch {
    }

    try {
        audio.onended = null;
        audio.onpause = null;
        audio.onerror = null;
        audio.removeAttribute?.("src");
        audio.load?.();
    } catch {
    }

    manager.instanceGains.delete(audio);
    manager.sourceNodes.delete(audio);
}

export function setTvMediaCulture(culture) {
    const normalized = setMediaCulture(culture);
    const manager = ensureTvAudioManager();
    manager.culture = normalized;
    manager.resolvedAudioUrls.clear();
    return normalized;
}

export function getTvMediaCulture() {
    const manager = ensureTvAudioManager();
    return manager.culture ?? getMediaCulture();
}

export async function resolveTvAudioUrl(key) {
    const asset = tvAudioMap[key] ?? null;
    if (!asset) {
        return null;
    }

    if (typeof asset === "string") {
        return asset;
    }

    const culture = getTvMediaCulture();
    const manager = ensureTvAudioManager();
    const cacheKey = `${culture}|${asset.context}|${asset.fileName}|${asset.legacyPath}|${asset.version ?? ""}`;
    if (manager.resolvedAudioUrls.has(cacheKey)) {
        return manager.resolvedAudioUrls.get(cacheKey) ?? null;
    }

    const resolved = await resolveLocalizedAudioPath(asset.fileName, culture, asset.context, {
        legacyPath: asset.legacyPath,
        version: asset.version,
        logLabel: key
    });

    manager.resolvedAudioUrls.set(cacheKey, resolved ?? asset.legacyPath);
    return resolved ?? asset.legacyPath;
}

export function resolveTvCueVolume(key, channel, requestedVolume, manager) {
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
