const PROCEDURAL_VOLUME_KEY = "criptoversus.tv.audioDebug.volume";
const BACKGROUND_VOLUME_KEY = "criptoversus.tv.backgroundAudio.volume";
const BACKGROUND_URL_KEY = "criptoversus.tv.backgroundAudio.url";
const BACKGROUND_LABEL_KEY = "criptoversus.tv.backgroundAudio.label";
const BACKGROUND_KEY_KEY = "criptoversus.tv.backgroundAudio.key";
const MAX_EVENTS = 50;
const MAX_LOGS = 100;
const DEBUG_PREFIX = "[CriptoVersusAudioDebug]";

let backgroundController = null;

function hasWindow() {
    return typeof window !== "undefined";
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function readStorageNumber(key, fallbackValue) {
    if (!hasWindow() || !window.localStorage) {
        return fallbackValue;
    }

    const raw = window.localStorage.getItem(key);
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? clamp(parsed, 0, 1) : fallbackValue;
}

function readStorageString(key, fallbackValue = "") {
    if (!hasWindow() || !window.localStorage) {
        return fallbackValue;
    }

    const raw = window.localStorage.getItem(key);
    return typeof raw === "string" ? raw : fallbackValue;
}

function writeStorage(key, value) {
    if (!hasWindow() || !window.localStorage) {
        return;
    }

    if (value === null || typeof value === "undefined" || value === "") {
        window.localStorage.removeItem(key);
        return;
    }

    window.localStorage.setItem(key, String(value));
}

function createStats() {
    return {
        found: 0,
        queued: 0,
        missing: 0,
        playing: 0,
        played: 0,
        failed: 0,
        fallback: 0,
        skipped: 0
    };
}

const telemetryState = {
    enabled: false,
    volume: readStorageNumber(PROCEDURAL_VOLUME_KEY, 0.8),
    lastEvent: null,
    events: [],
    logs: [],
    stats: createStats(),
    background: {
        activeLabel: "Default",
        activeUrl: "",
        selectedLabel: readStorageString(BACKGROUND_LABEL_KEY, "Default"),
        selectedUrl: readStorageString(BACKGROUND_URL_KEY),
        selectedKey: readStorageString(BACKGROUND_KEY_KEY, "default"),
        status: "stopped",
        volume: readStorageNumber(BACKGROUND_VOLUME_KEY, 0.42),
        error: null,
        tracks: []
    }
};

function emit(name, detail) {
    if (!hasWindow() || typeof window.dispatchEvent !== "function") {
        return;
    }

    window.dispatchEvent(new CustomEvent(name, { detail }));
}

function debugConsole(kind, payload) {
    if (!telemetryState.enabled || !hasWindow() || !window.console) {
        return;
    }

    if (typeof payload === "undefined") {
        console.log(`${DEBUG_PREFIX} ${kind}`);
        return;
    }

    console.log(`${DEBUG_PREFIX} ${kind}`, payload);
}

function snapshotState() {
    return {
        enabled: telemetryState.enabled,
        volume: telemetryState.volume,
        lastEvent: telemetryState.lastEvent ? { ...telemetryState.lastEvent } : null,
        events: telemetryState.events.map((item) => ({ ...item })),
        logs: telemetryState.logs.map((item) => ({ ...item })),
        stats: { ...telemetryState.stats },
        background: {
            ...telemetryState.background,
            tracks: telemetryState.background.tracks.map((item) => ({ ...item }))
        }
    };
}

function incrementStat(status) {
    if (!status) {
        return;
    }

    if (Object.prototype.hasOwnProperty.call(telemetryState.stats, status)) {
        telemetryState.stats[status] += 1;
    }
}

function normalizeEvent(status, event = {}) {
    const normalized = {
        timestamp: event.timestamp ?? new Date().toISOString(),
        source: event.source ?? "tv",
        eventType: event.eventType ?? null,
        rawEventType: event.rawEventType ?? event.eventType ?? null,
        mappedEventType: event.mappedEventType ?? event.eventType ?? null,
        teamSymbol: event.teamSymbol ?? null,
        normalizedSymbol: event.normalizedSymbol ?? null,
        language: event.language ?? null,
        audioUrl: event.audioUrl ?? null,
        audioAssetId: event.audioAssetId ?? null,
        normalizedText: event.normalizedText ?? null,
        textHash: event.textHash ?? null,
        audioFallbackUsed: Boolean(event.audioFallbackUsed),
        audioContextKey: event.audioContextKey ?? null,
        audioIntensity: event.audioIntensity ?? null,
        audioVoiceKey: event.audioVoiceKey ?? null,
        playbackPriority: event.playbackPriority ?? null,
        status: status ?? event.status ?? "skipped",
        message: event.message ?? null,
        error: event.error ?? null
    };

    return normalized;
}

function pushEventInternal(status, event) {
    const normalized = normalizeEvent(status, event);
    telemetryState.events.unshift(normalized);
    telemetryState.events = telemetryState.events.slice(0, MAX_EVENTS);
    telemetryState.lastEvent = normalized;
    incrementStat(normalized.status);
    emit("criptoversus:tv-audio-telemetry:event", normalized);
    emit("criptoversus:tv-audio-telemetry:state", snapshotState());
    debugConsole(`event:${normalized.status}`, normalized);
    return normalized;
}

function pushLogInternal(message, level = "info", data = null) {
    const entry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        data
    };

    telemetryState.logs.unshift(entry);
    telemetryState.logs = telemetryState.logs.slice(0, MAX_LOGS);
    emit("criptoversus:tv-audio-telemetry:log", entry);
    emit("criptoversus:tv-audio-telemetry:state", snapshotState());
    debugConsole(`log:${level}`, entry);
    return entry;
}

function maybeTrackFallback(event) {
    if (event?.audioFallbackUsed) {
        incrementStat("fallback");
    }
}

function setBackgroundStateInternal(patch = {}) {
    telemetryState.background = {
        ...telemetryState.background,
        ...patch,
        tracks: Array.isArray(patch.tracks)
            ? patch.tracks.map((item) => ({ ...item }))
            : telemetryState.background.tracks
    };

    writeStorage(BACKGROUND_VOLUME_KEY, telemetryState.background.volume);
    writeStorage(BACKGROUND_URL_KEY, telemetryState.background.selectedUrl);
    writeStorage(BACKGROUND_LABEL_KEY, telemetryState.background.selectedLabel);
    writeStorage(BACKGROUND_KEY_KEY, telemetryState.background.selectedKey);
    emit("criptoversus:tv-audio-telemetry:background", {
        ...telemetryState.background,
        tracks: telemetryState.background.tracks.map((item) => ({ ...item }))
    });
    emit("criptoversus:tv-audio-telemetry:state", snapshotState());
    return telemetryState.background;
}

function ensureGlobalApis() {
    if (!hasWindow()) {
        return;
    }

    window.tvAudioTelemetry = {
        pushEvent(event) {
            if (!telemetryState.enabled) {
                return null;
            }

            maybeTrackFallback(event);
            return pushEventInternal(event?.status ?? "skipped", event);
        },
        pushLog(message, level, data) {
            if (!telemetryState.enabled) {
                return null;
            }

            return pushLogInternal(message, level, data);
        },
        notifyQueued(data) {
            if (!telemetryState.enabled) {
                return null;
            }

            return pushEventInternal("queued", data);
        },
        notifyFound(data) {
            if (!telemetryState.enabled) {
                return null;
            }

            maybeTrackFallback(data);
            return pushEventInternal("found", data);
        },
        notifyMissing(data) {
            if (!telemetryState.enabled) {
                return null;
            }

            return pushEventInternal("missing", data);
        },
        notifyPlaying(data) {
            if (!telemetryState.enabled) {
                return null;
            }

            return pushEventInternal("playing", data);
        },
        notifyPlayed(data) {
            if (!telemetryState.enabled) {
                return null;
            }

            return pushEventInternal("played", data);
        },
        notifyFailed(data) {
            if (!telemetryState.enabled) {
                return null;
            }

            return pushEventInternal("failed", data);
        },
        notifyFallback(data) {
            if (!telemetryState.enabled) {
                return null;
            }

            return pushEventInternal("fallback", data);
        },
        setVolume(volume) {
            telemetryState.volume = clamp(Number(volume) || telemetryState.volume, 0, 1);
            writeStorage(PROCEDURAL_VOLUME_KEY, telemetryState.volume);
            emit("criptoversus:tv-audio-telemetry:state", snapshotState());
            return telemetryState.volume;
        },
        getVolume() {
            return telemetryState.volume;
        },
        setEnabled(enabled) {
            telemetryState.enabled = Boolean(enabled);
            emit("criptoversus:tv-audio-telemetry:state", snapshotState());
            return telemetryState.enabled;
        },
        getState() {
            return snapshotState();
        },
        clear() {
            telemetryState.events = [];
            telemetryState.logs = [];
            telemetryState.lastEvent = null;
            telemetryState.stats = createStats();
            emit("criptoversus:tv-audio-telemetry:state", snapshotState());
            return snapshotState();
        }
    };

    window.tvBackgroundAudioDebug = {
        getState() {
            return {
                ...telemetryState.background,
                tracks: telemetryState.background.tracks.map((item) => ({ ...item }))
            };
        },
        setVolume(volume) {
            const nextVolume = clamp(Number(volume) || telemetryState.background.volume, 0, 1);
            setBackgroundStateInternal({ volume: nextVolume });
            return backgroundController?.setVolume?.(nextVolume) ?? nextVolume;
        },
        getVolume() {
            return telemetryState.background.volume;
        },
        setTrack(url, label, key) {
            setBackgroundStateInternal({
                selectedUrl: url ?? "",
                selectedLabel: label ?? "Custom",
                selectedKey: key ?? "custom"
            });
            return backgroundController?.setTrack?.(url ?? "", label ?? "Custom", key ?? "custom") ?? telemetryState.background;
        },
        play() {
            return backgroundController?.play?.() ?? false;
        },
        pause() {
            return backgroundController?.pause?.() ?? false;
        },
        stop() {
            return backgroundController?.stop?.() ?? false;
        },
        reset() {
            setBackgroundStateInternal({
                selectedUrl: "",
                selectedLabel: "Default",
                selectedKey: "default"
            });
            return backgroundController?.reset?.() ?? false;
        },
        listTracks() {
            if (typeof backgroundController?.listTracks === "function") {
                const tracks = backgroundController.listTracks() ?? [];
                setBackgroundStateInternal({ tracks });
                return tracks;
            }

            return telemetryState.background.tracks.map((item) => ({ ...item }));
        }
    };
}

export function ensureTvAudioTelemetry() {
    ensureGlobalApis();
    return hasWindow() ? window.tvAudioTelemetry : null;
}

export function setTvAudioTelemetryEnabled(enabled) {
    ensureGlobalApis();
    if (!hasWindow()) {
        return false;
    }

    window.tvAudioTelemetry.setEnabled(enabled);
    return telemetryState.enabled;
}

export function setTvBackgroundAudioController(controller) {
    backgroundController = controller ?? null;
    ensureGlobalApis();

    if (typeof backgroundController?.listTracks === "function") {
        setBackgroundStateInternal({
            tracks: backgroundController.listTracks() ?? []
        });
    }

    return getTvAudioTelemetryState();
}

export function updateTvBackgroundAudioState(patch = {}) {
    return setBackgroundStateInternal(patch);
}

export function getTvAudioTelemetryState() {
    ensureGlobalApis();
    return snapshotState();
}

ensureGlobalApis();
