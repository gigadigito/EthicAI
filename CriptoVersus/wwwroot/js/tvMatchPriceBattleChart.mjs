import { normalizeChartPoints } from "./tvChartTime.mjs";
import { addLineSeriesCompat } from "./tvChartSeries.mjs";
import { fitChart } from "./tvChartResize.mjs";

const chartsState = {
    charts: new Map(),
    libPromise: null
};

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function getContainer(chartId) {
    return typeof document === "undefined" ? null : document.getElementById(chartId);
}

function loadLightweightCharts() {
    if (typeof window !== "undefined" && window.LightweightCharts) {
        return Promise.resolve(window.LightweightCharts);
    }

    if (chartsState.libPromise) {
        return chartsState.libPromise;
    }

    chartsState.libPromise = new Promise((resolve, reject) => {
        const existingScript = typeof document !== "undefined"
            ? document.querySelector('script[data-tv-price-battle-lightweight-charts="1"]')
            : null;

        if (existingScript && typeof window !== "undefined" && window.LightweightCharts) {
            resolve(window.LightweightCharts);
            return;
        }

        const script = document.createElement("script");
        script.src = "/js/vendor/lightweight-charts.standalone.production.js?v=20260518-1";
        script.async = true;
        script.dataset.tvPriceBattleLightweightCharts = "1";
        script.onload = () => resolve(window.LightweightCharts);
        script.onerror = () => reject(new Error("failed to load lightweight-charts"));
        document.head.appendChild(script);
    });

    return chartsState.libPromise;
}

function buildChartOptions(width, height) {
    return {
        width,
        height,
        layout: {
            background: { type: 0, color: "transparent" },
            textColor: "rgba(225, 238, 255, 0.74)",
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif"
        },
        grid: {
            vertLines: { color: "rgba(255,255,255,0.05)" },
            horzLines: { color: "rgba(255,255,255,0.035)" }
        },
        leftPriceScale: {
            visible: true,
            borderVisible: false,
            scaleMargins: { top: 0.18, bottom: 0.18 }
        },
        rightPriceScale: {
            visible: true,
            borderVisible: false,
            scaleMargins: { top: 0.18, bottom: 0.18 }
        },
        timeScale: {
            visible: true,
            borderVisible: false,
            secondsVisible: true,
            timeVisible: true,
            barSpacing: 22
        },
        crosshair: {
            vertLine: { visible: true, color: "rgba(255,255,255,0.20)", labelVisible: false },
            horzLine: { visible: true, color: "rgba(255,255,255,0.18)", labelVisible: false }
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
    };
}

function createSeriesOptions(color, priceScaleId) {
    return {
        color,
        priceScaleId,
        lineWidth: 2,
        crosshairMarkerVisible: true,
        lastValueVisible: true,
        priceLineVisible: false
    };
}

function createSeriesStyleOptions(color) {
    return {
        color,
        lineWidth: 2,
        crosshairMarkerVisible: true,
        lastValueVisible: true,
        priceLineVisible: false
    };
}

function normalizeSeriesPoints(points) {
    return normalizeChartPoints(points ?? [])
        .map((point) => ({
            time: point.time,
            value: Number(point.value)
        }))
        .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value));
}

function ensureResizeObserver(chartId, entry) {
    if (entry.resizeObserver || typeof ResizeObserver !== "function") {
        return;
    }

    entry.resizeObserver = new ResizeObserver(() => {
        resizeMatchPriceBattleChart(chartId);
    });

    entry.resizeObserver.observe(entry.container);
}

async function ensureChart(chartId) {
    const existing = chartsState.charts.get(chartId);
    if (existing?.chart && existing?.container) {
        return existing;
    }

    const container = getContainer(chartId);
    if (!container) {
        return null;
    }

    const LightweightCharts = await loadLightweightCharts();
    const rect = container.getBoundingClientRect();
    const width = clamp(Math.floor(rect.width), 1, 99999);
    const height = clamp(Math.floor(rect.height), 1, 99999);

    const chart = LightweightCharts.createChart(container, buildChartOptions(width, height));
    const leftSeries = addLineSeriesCompat(LightweightCharts, chart, createSeriesOptions("#ff9100", "left"));
    const rightSeries = addLineSeriesCompat(LightweightCharts, chart, createSeriesOptions("#18d8d2", "right"));

    const entry = {
        chart,
        container,
        leftSeries,
        rightSeries,
        resizeObserver: null
    };

    chartsState.charts.set(chartId, entry);
    ensureResizeObserver(chartId, entry);
    fitChart(chart);
    return entry;
}

function applySeriesData(entry, payload) {
    const leftColor = typeof payload?.leftColor === "string" && payload.leftColor.trim().length > 0
        ? payload.leftColor.trim()
        : "#ff9100";
    const rightColor = typeof payload?.rightColor === "string" && payload.rightColor.trim().length > 0
        ? payload.rightColor.trim()
        : "#18d8d2";

    entry.leftSeries.applyOptions(createSeriesStyleOptions(leftColor));
    entry.rightSeries.applyOptions(createSeriesStyleOptions(rightColor));

    const leftPoints = normalizeSeriesPoints(payload?.leftPoints);
    const rightPoints = normalizeSeriesPoints(payload?.rightPoints);

    entry.leftSeries.setData(leftPoints);
    entry.rightSeries.setData(rightPoints);
    entry.lastPayload = {
        leftPoints: leftPoints.length,
        rightPoints: rightPoints.length,
        leftColor,
        rightColor
    };

    fitChart(entry.chart);
}

export async function initMatchPriceBattleChart(chartId, payload) {
    const entry = await ensureChart(chartId);
    if (!entry) {
        return null;
    }

    applySeriesData(entry, payload);
    return entry;
}

export async function updateMatchPriceBattleChart(chartId, payload) {
    const entry = await ensureChart(chartId);
    if (!entry) {
        return null;
    }

    applySeriesData(entry, payload);
    return entry;
}

export function resizeMatchPriceBattleChart(chartId) {
    const entry = chartsState.charts.get(chartId);
    if (!entry?.chart || !entry.container) {
        return;
    }

    const rect = entry.container.getBoundingClientRect();
    const width = clamp(Math.floor(rect.width), 1, 99999);
    const height = clamp(Math.floor(rect.height), 1, 99999);

    try {
        entry.chart.applyOptions({ width, height });
        fitChart(entry.chart);
    } catch {
    }
}

export function disposeMatchPriceBattleChart(chartId) {
    const entry = chartsState.charts.get(chartId);
    if (!entry) {
        return;
    }

    try {
        entry.resizeObserver?.disconnect?.();
    } catch {
    }

    try {
        entry.chart?.remove?.();
    } catch {
    }

    chartsState.charts.delete(chartId);
}
