import { normalizeChartPoints } from "./tvChartTime.mjs";
import { fitChart } from "./tvChartResize.mjs";

const chartsState = {
    charts: new Map(),
    libPromise: null
};

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function hexToRgba(color, alpha) {
    const hex = typeof color === "string" ? color.trim() : "";
    const match = /^#?([a-f\d]{6})$/i.exec(hex);
    if (!match) {
        return color;
    }

    const numeric = Number.parseInt(match[1], 16);
    const r = (numeric >> 16) & 255;
    const g = (numeric >> 8) & 255;
    const b = numeric & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function nextFrame() {
    return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function getContainer(chartId) {
    return typeof document === "undefined" ? null : document.getElementById(chartId);
}

function normalizeSeriesPoints(points) {
    return normalizeChartPoints(points ?? [])
        .map((point) => ({
            time: point.time,
            value: Number(point.value)
        }))
        .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value));
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
            textColor: "rgba(225, 238, 247, 0.72)",
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif"
        },
        grid: {
            vertLines: { color: "rgba(255,255,255,0.04)" },
            horzLines: { color: "rgba(255,255,255,0.035)" }
        },
        rightPriceScale: {
            visible: true,
            borderVisible: false,
            scaleMargins: { top: 0.18, bottom: 0.18 }
        },
        leftPriceScale: {
            visible: false,
            borderVisible: false
        },
        timeScale: {
            visible: false,
            borderVisible: false,
            secondsVisible: false,
            timeVisible: false
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
    };
}

function addAreaSeriesCompat(LightweightCharts, chart, options) {
    if (typeof chart.addAreaSeries === "function") {
        return chart.addAreaSeries(options);
    }

    if (typeof chart.addSeries === "function" && LightweightCharts?.AreaSeries) {
        return chart.addSeries(LightweightCharts.AreaSeries, options);
    }

    return null;
}

function addLineSeriesCompat(LightweightCharts, chart, options) {
    if (typeof chart.addLineSeries === "function") {
        return chart.addLineSeries(options);
    }

    if (typeof chart.addSeries === "function" && LightweightCharts?.LineSeries) {
        return chart.addSeries(LightweightCharts.LineSeries, options);
    }

    throw new Error("no supported series API");
}

function createSeries(LightweightCharts, chart, color) {
    const baseOptions = {
        color,
        lineWidth: 2,
        crosshairMarkerVisible: true,
        lastValueVisible: true,
        priceLineVisible: false,
        priceScaleId: "right"
    };

    const area = addAreaSeriesCompat(LightweightCharts, chart, {
        ...baseOptions,
        topColor: hexToRgba(color, 0.34),
        bottomColor: "rgba(0,0,0,0)"
    });

    if (area) {
        return area;
    }

    return addLineSeriesCompat(LightweightCharts, chart, baseOptions);
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

async function createOrResizeChart(chartId, sidePayload) {
    const existing = chartsState.charts.get(chartId);
    const container = existing?.container ?? getContainer(chartId);

    if (!container) {
        return null;
    }

    const rect = container.getBoundingClientRect();
    const width = clamp(Math.floor(rect.width), 1, 99999);
    const height = clamp(Math.floor(rect.height), 1, 99999);

    if (width <= 1 || height <= 1) {
        if (existing?.retryFrame) {
            return null;
        }

        const entry = existing ?? { chart: null, container, series: null, resizeObserver: null, retryFrame: null, lastSignature: "" };
        entry.container = container;
        chartsState.charts.set(chartId, entry);
        entry.retryFrame = window.requestAnimationFrame(() => {
            entry.retryFrame = null;
            updateMatchPriceBattleChart(chartId, sidePayload);
        });
        return null;
    }

    const LightweightCharts = await loadLightweightCharts();
    let entry = existing;

    if (!entry?.chart) {
        const chart = LightweightCharts.createChart(container, buildChartOptions(width, height));
        const series = createSeries(LightweightCharts, chart, sidePayload?.color ?? "#ff9100");

        entry = {
            chart,
            container,
            series,
            resizeObserver: null,
            retryFrame: null,
            lastSignature: ""
        };

        chartsState.charts.set(chartId, entry);
        ensureResizeObserver(chartId, entry);
    } else {
        entry.container = container;
        entry.chart.applyOptions({ width, height });
    }

    applySeriesData(entry, sidePayload);
    fitChart(entry.chart);
    return entry;
}

function applySeriesData(entry, sidePayload) {
    if (!entry?.series) {
        return;
    }

    const normalizedPoints = normalizeSeriesPoints(sidePayload?.points);
    const color = typeof sidePayload?.color === "string" && sidePayload.color.trim().length > 0
        ? sidePayload.color.trim()
        : "#ff9100";

    try {
        entry.series.applyOptions({
            color,
            lineColor: color,
            topColor: hexToRgba(color, 0.34),
            bottomColor: "rgba(0,0,0,0)"
        });
    } catch {
    }

    entry.series.setData(normalizedPoints);
    entry.lastPayload = {
        points: normalizedPoints.length,
        color
    };

    console.debug("[TV_PRICE_BATTLE] init", {
        id: sidePayload?.chartId,
        width: entry.container?.clientWidth ?? 0,
        height: entry.container?.clientHeight ?? 0,
        points: normalizedPoints.length
    });
}

function buildSignature(sidePayload) {
    const points = normalizeSeriesPoints(sidePayload?.points);
    const tail = points.length === 0
        ? "0"
        : `${points.length}:${points[points.length - 1].time}:${points[points.length - 1].value.toFixed(8)}`;

    return [
        sidePayload?.chartId ?? "",
        sidePayload?.side ?? "",
        sidePayload?.label ?? "",
        sidePayload?.color ?? "",
        tail
    ].join("|");
}

async function updateSide(chartId, sidePayload) {
    const signature = buildSignature(sidePayload);
    const existing = chartsState.charts.get(chartId);
    if (existing?.chart && existing.lastSignature === signature) {
        return existing;
    }

    const entry = await createOrResizeChart(chartId, sidePayload);
    if (!entry) {
        return null;
    }

    entry.lastSignature = signature;
    return entry;
}

export async function initMatchPriceBattleChart(payload) {
    return updateMatchPriceBattleChart(payload);
}

export async function updateMatchPriceBattleChart(payload) {
    const left = payload?.left ?? null;
    const right = payload?.right ?? null;

    const tasks = [];
    if (left?.chartId) {
        tasks.push(updateSide(left.chartId, left));
    }
    if (right?.chartId) {
        tasks.push(updateSide(right.chartId, right));
    }

    await Promise.all(tasks);
    return true;
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
        if (entry.retryFrame) {
            window.cancelAnimationFrame(entry.retryFrame);
        }
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

    chartsState.charts.delete(chartId);
}
