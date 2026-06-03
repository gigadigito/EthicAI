import { normalizeChartPoints } from "./tvChartTime.mjs";

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

export function applyChartTheme(LightweightCharts, chart) {
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

export function addLineSeriesCompat(LightweightCharts, chart, options) {
    if (typeof chart.addLineSeries === "function") {
        return chart.addLineSeries(options);
    }

    if (typeof chart.addSeries === "function" && LightweightCharts?.LineSeries) {
        return chart.addSeries(LightweightCharts.LineSeries, options);
    }

    throw new Error("no supported LineSeries API");
}

export function addCandlestickSeriesCompat(LightweightCharts, chart, options) {
    if (typeof chart.addCandlestickSeries === "function") {
        return chart.addCandlestickSeries(options);
    }

    if (typeof chart.addSeries === "function" && LightweightCharts?.CandlestickSeries) {
        return chart.addSeries(LightweightCharts.CandlestickSeries, options);
    }

    throw new Error("no supported CandlestickSeries API");
}

export function normalizeSeriesMeta(meta, fallbackColor) {
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

export function normalizeCompareLine(points, options = {}) {
    return normalizeChartPoints(points, options)
        .map((point) => ({
            time: point.time,
            value: point.value
        }));
}

export function buildSyntheticCandles(points, bucketSeconds = 30, options = {}) {
    const normalized = normalizeChartPoints(points, options);
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

            let high = Math.max(...bucket.map((item) => item.value));
            let low = Math.min(...bucket.map((item) => item.value));

            const delta = close - open;
            const baseRange = high - low;
            let volatility = Math.max(Math.abs(delta) * 0.45, Math.abs(baseRange) * 0.35, 0.12);
            volatility = clamp(volatility, 0.12, 1.8);

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

export function setChartEmptyState(containerId, isEmpty, message = "coletando candles") {
    const container = typeof document !== "undefined"
        ? document.getElementById(containerId)
        : null;

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
