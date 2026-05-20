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
    lastMinute: "/audio/tv/last-minute.mp3",
    counterAttack: "/audio/tv/counter-attack.mp3",
    marketCrash: "/audio/tv/market-crash.mp3",
    marketPump: "/audio/tv/market-pump.mp3",
    clutchSave: "/audio/tv/clutch-save.mp3",
    bigCandleMovement: "/audio/tv/big-candle-movement.mp3",
    ballRecovery: "/audio/tv/ball-recovery.mp3",
    highlightMoment: "/audio/tv/highlight-moment.mp3",
    suddenReversal: "/audio/tv/sudden-reversal.mp3"
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

let tvAudioManagerState = null;

function logTvAudio(message, payload) {
    if (typeof payload === "undefined") {
        console.log(`[TV_AUDIO] ${message}`);
        return;
    }

    console.log(`[TV_AUDIO] ${message}`, payload);
}

function ensureTvAudioManager() {
    if (tvAudioManagerState) {
        return tvAudioManagerState;
    }

    tvAudioManagerState = {
        volume: 0.22,
        muted: false,
        activeKey: null,
        activePriority: -1,
        preload: new Map(),
        lastPlayedAt: new Map(),
        diagnostics: {
            loaded: [],
            queued: [],
            played: []
        }
    };

    return tvAudioManagerState;
}

function resolveTvAudioUrl(key) {
    return tvAudioMap[key] ?? null;
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
    audio.volume = manager.volume;
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

    const audio = preloadTvAudio(key) ?? new Audio(url);
    audio.volume = Math.min(1, Math.max(0, typeof options.volume === "number" ? options.volume : manager.volume));
    audio.muted = Boolean(options.muted ?? manager.muted);
    audio.loop = Boolean(options.loop);

    try {
        if (!audio.loop) {
            audio.pause();
            audio.currentTime = 0;
        }
    } catch {
    }

    const playback = audio.play();
    manager.lastPlayedAt.set(key, now);
    manager.activeKey = key;
    manager.activePriority = priority;
    manager.diagnostics.queued.push({ key, at: now, priority });

    if (playback && typeof playback.catch === "function") {
        playback
            .then(() => {
                manager.diagnostics.played.push({ key, at: Date.now(), priority });
                logTvAudio("played", { key, priority, volume: audio.volume, muted: audio.muted });
            })
            .catch((error) => {
                logTvAudio("play failed", { key, error: error?.message ?? String(error) });
            });
    } else {
        manager.diagnostics.played.push({ key, at: Date.now(), priority });
        logTvAudio("played", { key, priority, volume: audio.volume, muted: audio.muted });
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

function setTvAudioSettings(volume, muted) {
    const manager = ensureTvAudioManager();
    manager.volume = Math.min(1, Math.max(0, Number(volume) || manager.volume));
    manager.muted = Boolean(muted);
    manager.preload.forEach((audio) => {
        audio.volume = manager.volume;
        audio.muted = manager.muted;
    });
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
        activePriority: manager.activePriority
    };
    console.log("[TV_AUDIO]", state);
    return state;
}

export function initFieldSway(rootId = "tv-crypto-field") {
    const root = document.getElementById(rootId);
    if (!root) {
        return;
    }

    if (isReducedMotion()) {
        return;
    }

    const overlay = root.querySelector(".tv-field__overlay");
    if (!overlay) {
        return;
    }

    if (fieldFreedomState?.root === root) {
        return;
    }

    if (fieldFreedomState?.rafId) {
        cancelAnimationFrame(fieldFreedomState.rafId);
    }

    fieldFreedomState = {
        root,
        overlay,
        players: collectFreedomPlayers(root),
        startedAt: performance.now(),
        lastNow: 0,
        rafId: 0
    };

    const tick = (now) => {
        if (!fieldFreedomState || fieldFreedomState.root !== root) {
            return;
        }

        // Refresh nodes occasionally (Blazor updates) without heavy work.
        if (!fieldFreedomState._lastRefreshAt || now - fieldFreedomState._lastRefreshAt > 900) {
            fieldFreedomState.players = collectFreedomPlayers(root, fieldFreedomState.players);
            fieldFreedomState._lastRefreshAt = now;
        }

        applyFreedomMotion(fieldFreedomState, now);
        fieldFreedomState.rafId = requestAnimationFrame(tick);
    };

    fieldFreedomState.rafId = requestAnimationFrame(tick);
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
    if (!telemetryCubeState?.cube) {
        return;
    }

    const normalized = ((faceIndex % 5) + 5) % 5;
    telemetryCubeState.faceIndex = normalized;
    telemetryCubeState.cube.classList.remove("is-face-0", "is-face-1", "is-face-2", "is-face-3", "is-face-4");
    telemetryCubeState.cube.classList.add(`is-face-${normalized}`);

    telemetryCubeLog(`face changed ${normalized}`, reason ? { reason } : undefined);

    // 3D transforms can cause LightweightCharts to miss a resize; force-fit after the face is applied.
    window.setTimeout(() => resizeTelemetryCharts(), 0);
    window.setTimeout(() => resizeTelemetryCharts(), 80);
    window.setTimeout(() => resizeTelemetryCharts(), 350);
    window.setTimeout(() => resizeTelemetryCharts(), 1100);
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
        setCubeFace(telemetryCubeState.faceIndex + 1, "interval");
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

        telemetryCubeState = {
            shell,
            cube,
            intervalMs: resolvedIntervalMs,
            timerId: null,
            faceIndex: 0,
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

        shell.addEventListener("mouseenter", () => {
            telemetryCubeState.paused = true;
            pauseCubeRotation("hover");
        });

        shell.addEventListener("mouseleave", () => {
            telemetryCubeState.paused = false;
            resumeCubeRotation();
        });

        window.addEventListener("visibilitychange", () => {
            if (document.hidden) {
                pauseCubeRotation("hidden");
                return;
            }

            resumeCubeRotation();
        });

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
        setCubeFace(0, "goal");

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
    });

    resizeObserver.observe(container);

    telemetryChartsState.charts.set(container.id, {
        ...existing,
        resizeObserver
    });
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

async function ensureCandlestickChart(containerId) {
    telemetryChartsState = telemetryChartsState ?? { charts: new Map(), libPromise: null };

    const existing = telemetryChartsState.charts.get(containerId);

    if (existing?.chart && existing?.series && existing.kind === "candlestick") {
        return existing;
    }

    const container = document.getElementById(containerId);

    if (!container) {
        throw new Error(`missing container ${containerId}`);
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

    if (existing?.chart && existing?.leftSeries && existing?.rightSeries) {
        return existing;
    }

    const container = document.getElementById(containerId);

    if (!container) {
        throw new Error(`missing container ${containerId}`);
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
        chart,
        leftSeries,
        rightSeries,
        resizeObserver: null
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

            const time = Number(p.time);
            const value = Number(p.value);

            if (!Number.isFinite(time) || !Number.isFinite(value)) {
                return null;
            }

            return { time, value };
        })
        .filter(Boolean)
        .sort((a, b) => a.time - b.time);
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
            rightPoints: rightPoints.length
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

    if (!audio) {
        setTvAudioSettings(volume, muted);
        return;
    }

    audio.loop = true;
    audio.volume = typeof volume === "number" ? volume : 0.1;
    audio.muted = Boolean(muted);
    setTvAudioSettings(volume, muted);

    try {
        await audio.play();
    } catch {
        const resume = async () => {
            try {
                await audio.play();
            } catch {
            }

            document.removeEventListener("pointerdown", resume);
            document.removeEventListener("keydown", resume);
        };

        document.addEventListener("pointerdown", resume, { once: true });
        document.addEventListener("keydown", resume, { once: true });
    }
}

export function setBroadcastAudioMuted(elementId, muted, volume) {
    const audio = document.getElementById(elementId);

    if (!audio) {
        setTvAudioSettings(volume, muted);
        return;
    }

    audio.volume = typeof volume === "number" ? volume : audio.volume;
    audio.muted = Boolean(muted);
    setTvAudioSettings(volume, muted);

    if (!audio.muted) {
        audio.play().catch(() => { });
    }
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
        audio.pause();
        audio.currentTime = 0;
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
    preloadAllTvAudio();
    return diagnoseTvAudio();
}

export function playTvAudioCue(key, options) {
    return playTvAudio(key, options);
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

if (typeof globalThis !== "undefined") {
    globalThis.initBroadcastAudio = initBroadcastAudio;
    globalThis.setBroadcastAudioMuted = setBroadcastAudioMuted;
    globalThis.playAudioCue = playAudioCue;
    globalThis.initTvAudioManager = initTvAudioManager;
    globalThis.playTvAudioCue = playTvAudioCue;
    globalThis.stopTvAudioCue = stopTvAudioCue;
    globalThis.tvAudioMap = tvAudioMap;
    globalThis.criptoVersusTvAudioManager = {
        init: initTvAudioManager,
        play: playTvAudioCue,
        stop: stopTvAudioCue,
        setSettings: setTvAudioSettings,
        diagnose: diagnoseTvAudio
    };
    globalThis.criptoVersusTvCharts = {
        initTelemetryCube,
        notifyTelemetryCubeEvent,
        updateTelemetryCharts,
        initFieldSway
    };
}
