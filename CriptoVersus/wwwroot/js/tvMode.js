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
    window.setTimeout(() => resizeTelemetryCharts(), 80);
    window.setTimeout(() => resizeTelemetryCharts(), 350);
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

        window.setTimeout(() => resizeTelemetryCharts(), 80);

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
        audio.play().catch(() => { });
    }
}

export function playAudioCue(elementId) {
    const audio = document.getElementById(elementId);

    if (!audio) {
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
