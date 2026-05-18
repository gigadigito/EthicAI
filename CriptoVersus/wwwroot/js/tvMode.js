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

function isReducedMotion() {
    return typeof window !== "undefined"
        && typeof window.matchMedia === "function"
        && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function shouldDisableCube(shell) {
    if (!shell) {
        return true;
    }

    if (isReducedMotion()) {
        return true;
    }

    const width = shell.getBoundingClientRect().width;
    return width <= 520 || window.innerWidth <= 1080;
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

function telemetryCubeLog(eventName, payload) {
    if (typeof payload === "undefined") {
        console.log(`[TV_CUBE] ${eventName}`);
        return;
    }

    console.log(`[TV_CUBE] ${eventName}`, payload);
}

function telemetryChartLog(eventName, payload) {
    if (typeof payload === "undefined") {
        console.log(`[TV_CHART] ${eventName}`);
        return;
    }

    console.log(`[TV_CHART] ${eventName}`, payload);
}

function setCubeFace(faceIndex, reason) {
    if (!telemetryCubeState?.cube) {
        return;
    }

    const normalized = ((faceIndex % 4) + 4) % 4;
    telemetryCubeState.faceIndex = normalized;
    telemetryCubeState.cube.classList.remove("is-face-0", "is-face-1", "is-face-2", "is-face-3");
    telemetryCubeState.cube.classList.add(`is-face-${normalized}`);
    telemetryCubeLog("face changed", { face: normalized, reason });
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

function pauseCubeRotation(reason) {
    if (!telemetryCubeState) {
        return;
    }

    if (telemetryCubeState.timerId) {
        window.clearInterval(telemetryCubeState.timerId);
        telemetryCubeState.timerId = null;
    }

    telemetryCubeState.shell?.classList.toggle("is-paused", telemetryCubeState.paused);
    telemetryCubeLog("paused", reason);
}

export function initTelemetryCube(shellId, intervalMs) {
    const shell = document.getElementById(shellId);
    if (!shell) {
        return;
    }

    const cube = shell.querySelector(".tv-telemetry-cube");
    if (!cube) {
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

    const disabled = shouldDisableCube(shell);
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
        return;
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
            borderVisible: false
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
        chart.applyOptions({ width: Math.max(1, Math.floor(rect.width)), height: Math.max(1, Math.floor(rect.height)) });
    });

    resizeObserver.observe(container);

    telemetryChartsState.charts.set(container.id, {
        ...existing,
        resizeObserver
    });
}

async function ensureLineChart(containerId, seriesColor) {
    telemetryChartsState = telemetryChartsState ?? { charts: new Map(), libPromise: null };
    const existing = telemetryChartsState.charts.get(containerId);
    if (existing?.chart && existing?.series) {
        return existing;
    }

    const container = document.getElementById(containerId);
    if (!container) {
        throw new Error(`missing container ${containerId}`);
    }

    const LightweightCharts = await ensureLightweightChartsLoaded();
    const rect = container.getBoundingClientRect();
    const chart = LightweightCharts.createChart(container, {
        width: Math.max(1, Math.floor(rect.width)),
        height: Math.max(1, Math.floor(rect.height))
    });
    applyChartTheme(LightweightCharts, chart);

    const series = chart.addLineSeries({
        color: seriesColor,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false
    });

    const state = { chart, series, resizeObserver: null };
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
        width: Math.max(1, Math.floor(rect.width)),
        height: Math.max(1, Math.floor(rect.height))
    });
    applyChartTheme(LightweightCharts, chart);

    const leftSeries = chart.addLineSeries({
        color: "rgba(127, 246, 223, 0.92)",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false
    });

    const rightSeries = chart.addLineSeries({
        color: "rgba(112, 255, 179, 0.85)",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false
    });

    const state = { chart, leftSeries, rightSeries, resizeObserver: null };
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
        .filter(Boolean);
}

export async function updateTelemetryCharts(payload) {
    try {
        const leftPoints = normalizePoints(payload?.left);
        const rightPoints = normalizePoints(payload?.right);

        const left = await ensureLineChart("tv-telemetry-chart-left", "rgba(127, 246, 223, 0.92)");
        left.series.setData(leftPoints);

        const right = await ensureLineChart("tv-telemetry-chart-right", "rgba(112, 255, 179, 0.85)");
        right.series.setData(rightPoints);

        const compare = await ensureCompareChart("tv-telemetry-chart-compare");
        compare.leftSeries.setData(leftPoints);
        compare.rightSeries.setData(rightPoints);

        telemetryChartLog("rendered", {
            left: leftPoints.length,
            right: rightPoints.length
        });
    } catch (err) {
        telemetryChartLog("error", err?.message ?? err);
        setCubeFace(0, "chart-error");
    }
}

export async function initBroadcastAudio(elementId, volume, muted) {
    const audio = document.getElementById(elementId);
    if (!audio) {
        return;
    }

    audio.loop = true;
    audio.volume = typeof volume === "number" ? volume : 0.1;
    audio.muted = Boolean(muted);

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
        return;
    }

    audio.volume = typeof volume === "number" ? volume : audio.volume;
    audio.muted = Boolean(muted);

    if (!audio.muted) {
        audio.play().catch(() => {});
    }
}

export function playAudioCue(elementId) {
    const audio = document.getElementById(elementId);
    if (!audio) {
        return;
    }

    try {
        // Always play cues as a one-shot, even if the element was previously modified by the browser.
        audio.loop = false;
        audio.pause();
        audio.currentTime = 0;
    } catch {
    }

    audio.play().catch(() => {});
}

if (typeof globalThis !== "undefined") {
    globalThis.initBroadcastAudio = initBroadcastAudio;
    globalThis.setBroadcastAudioMuted = setBroadcastAudioMuted;
    globalThis.playAudioCue = playAudioCue;
    globalThis.criptoVersusTvCharts = {
        initTelemetryCube,
        notifyTelemetryCubeEvent,
        updateTelemetryCharts
    };
}
