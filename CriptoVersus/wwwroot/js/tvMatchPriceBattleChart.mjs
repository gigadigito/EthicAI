const charts = new Map();

export function updateMatchPriceBattleChart(payload) {
    const chartId = payload?.chartId;
    if (!chartId) {
        return;
    }

    const host = document.getElementById(chartId);
    if (!host) {
        return;
    }

    let state = charts.get(chartId);
    if (!state) {
        state = createState(host);
        charts.set(chartId, state);
    }

    state.payload = normalizePayload(payload);
    requestRender(state);
}

export function disposeMatchPriceBattleChart(chartId) {
    const state = charts.get(chartId);
    if (!state) {
        return;
    }

    state.resizeObserver?.disconnect();
    state.canvas?.remove();
    state.markerLayer?.remove();
    charts.delete(chartId);
}

function createState(host) {
    host.innerHTML = "";
    host.style.position = "absolute";
    host.style.inset = "0";
    host.style.width = "100%";
    host.style.height = "100%";
    host.style.minHeight = "100%";
    host.style.overflow = "hidden";

    const canvas = document.createElement("canvas");
    canvas.className = "tv-price-battle-canvas";
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.minHeight = "100%";
    canvas.style.display = "block";

    const markerLayer = document.createElement("div");
    markerLayer.className = "tv-price-battle-marker-layer";
    markerLayer.style.position = "absolute";
    markerLayer.style.inset = "0";
    markerLayer.style.width = "100%";
    markerLayer.style.height = "100%";
    markerLayer.style.minHeight = "100%";
    markerLayer.style.pointerEvents = "none";

    host.appendChild(canvas);
    host.appendChild(markerLayer);

    const state = {
        host,
        canvas,
        markerLayer,
        payload: null,
        resizeObserver: null,
        frameId: 0,
        lastWidth: 0,
        lastHeight: 0
    };

    state.resizeObserver = new ResizeObserver(() => requestRender(state));
    state.resizeObserver.observe(host);

    if (host.parentElement) {
        state.resizeObserver.observe(host.parentElement);
    }

    return state;
}

function requestRender(state) {
    if (!state || state.frameId) {
        return;
    }

    state.frameId = window.requestAnimationFrame(() => {
        state.frameId = 0;
        render(state);
    });
}

function normalizePayload(payload) {
    const left = normalizeSide(payload.left, "#ffd76e", "left");
    const right = normalizeSide(payload.right, "#53c8ff", "right");

    return {
        chartId: payload.chartId,
        left,
        right,
        options: payload.options ?? {}
    };
}

function normalizeSide(side, fallbackColor, fallbackSide) {
    const points = Array.isArray(side?.points)
        ? side.points
            .map((point, index) => ({
                index,
                time: point?.time ?? "",
                value: Number(point?.value)
            }))
            .filter(point => Number.isFinite(point.value) && point.value > 0)
        : [];

    const first = points.find(point => point.value > 0);
    const base = first?.value ?? 0;
    const normalized = base > 0
        ? points.map(point => ({
            ...point,
            normalizedValue: point.value / base
        }))
        : [];

    return {
        side: side?.side ?? fallbackSide,
        label: side?.label ?? "--",
        compactLabel: side?.compactLabel ?? side?.label ?? "--",
        logoUrl: side?.logoUrl ?? "",
        color: side?.color ?? fallbackColor,
        points: normalized
    };
}

function getRenderSize(state) {
    const hostRect = state.host.getBoundingClientRect();
    const parentRect = state.host.parentElement
        ? state.host.parentElement.getBoundingClientRect()
        : hostRect;

    const parentHeight = Math.floor(parentRect.height || 0);
    const hostHeight = Math.floor(hostRect.height || 0);
    const parentWidth = Math.floor(parentRect.width || 0);
    const hostWidth = Math.floor(hostRect.width || 0);

    const width = Math.max(320, hostWidth, parentWidth);
    const height = Math.max(360, hostHeight, parentHeight);

    return { width, height };
}

function render(state) {
    const payload = state.payload;
    if (!payload) {
        return;
    }

    const { width, height } = getRenderSize(state);
    const dpr = window.devicePixelRatio || 1;

    state.host.style.width = "100%";
    state.host.style.height = "100%";
    state.host.style.minHeight = `${height}px`;

    state.canvas.style.width = "100%";
    state.canvas.style.height = "100%";
    state.canvas.style.minHeight = `${height}px`;

    state.markerLayer.style.width = "100%";
    state.markerLayer.style.height = "100%";
    state.markerLayer.style.minHeight = `${height}px`;

    const canvasWidth = Math.floor(width * dpr);
    const canvasHeight = Math.floor(height * dpr);

    if (state.canvas.width !== canvasWidth || state.canvas.height !== canvasHeight) {
        state.canvas.width = canvasWidth;
        state.canvas.height = canvasHeight;
    }

    state.lastWidth = width;
    state.lastHeight = height;

    const ctx = state.canvas.getContext("2d");
    if (!ctx) {
        return;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    state.markerLayer.innerHTML = "";

    const left = payload.left.points;
    const right = payload.right.points;
    const count = Math.min(left.length, right.length);

    if (count < 2) {
        drawEmptyGrid(ctx, width, height);
        return;
    }

    const leftPoints = left.slice(0, count);
    const rightPoints = right.slice(0, count);

    const allValues = [...leftPoints, ...rightPoints].map(point => point.normalizedValue);
    const minValue = Math.min(...allValues);
    const maxValue = Math.max(...allValues);
    const padding = Math.max((maxValue - minValue) * 0.16, 0.018);
    const yMin = minValue - padding;
    const yMax = maxValue + padding;

    const chart = {
        left: 48,
        right: 76,
        top: 28,
        bottom: 50,
        width,
        height,
        yMin,
        yMax,
        count
    };

    chart.plotWidth = Math.max(1, width - chart.left - chart.right);
    chart.plotHeight = Math.max(1, height - chart.top - chart.bottom);

    drawGrid(ctx, chart);
    drawArea(ctx, chart, rightPoints, payload.right.color, 0.10);
    drawArea(ctx, chart, leftPoints, payload.left.color, 0.12);
    drawLine(ctx, chart, leftPoints, payload.left.color);
    drawLine(ctx, chart, rightPoints, payload.right.color);
    drawLastValue(ctx, chart, leftPoints.at(-1), payload.left.color);
    drawLastValue(ctx, chart, rightPoints.at(-1), payload.right.color);
    drawTimeAxis(ctx, chart, leftPoints);
    drawCrossovers(ctx, state.markerLayer, chart, payload, leftPoints, rightPoints);
}

function drawEmptyGrid(ctx, width, height) {
    const chart = {
        left: 48,
        right: 76,
        top: 28,
        bottom: 50,
        width,
        height,
        yMin: 0.98,
        yMax: 1.02,
        count: 2
    };

    chart.plotWidth = Math.max(1, width - chart.left - chart.right);
    chart.plotHeight = Math.max(1, height - chart.top - chart.bottom);
    drawGrid(ctx, chart);
}

function drawGrid(ctx, chart) {
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(120, 158, 190, 0.13)";
    ctx.fillStyle = "rgba(205, 216, 231, 0.66)";
    ctx.font = "700 11px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    for (let i = 0; i <= 4; i += 1) {
        const y = chart.top + (chart.plotHeight / 4) * i;

        ctx.beginPath();
        ctx.moveTo(chart.left, y);
        ctx.lineTo(chart.width - chart.right, y);
        ctx.stroke();

        const value = chart.yMax - ((chart.yMax - chart.yMin) / 4) * i;
        ctx.fillText(value.toFixed(2), chart.width - 16, y);
    }

    ctx.strokeStyle = "rgba(120, 158, 190, 0.09)";

    for (let i = 0; i <= 6; i += 1) {
        const x = chart.left + (chart.plotWidth / 6) * i;

        ctx.beginPath();
        ctx.moveTo(x, chart.top);
        ctx.lineTo(x, chart.height - chart.bottom);
        ctx.stroke();
    }

    ctx.restore();
}

function drawLine(ctx, chart, points, color) {
    if (!points || points.length < 2) {
        return;
    }

    ctx.save();
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.shadowBlur = 16;
    ctx.shadowColor = color;
    ctx.strokeStyle = color;

    ctx.beginPath();

    points.forEach((point, index) => {
        const x = xForIndex(chart, index);
        const y = yForValue(chart, point.normalizedValue);

        if (index === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });

    ctx.stroke();
    ctx.restore();
}

function drawArea(ctx, chart, points, color, alpha) {
    if (!points || points.length < 2) {
        return;
    }

    ctx.save();

    const gradient = ctx.createLinearGradient(0, chart.top, 0, chart.height - chart.bottom);
    gradient.addColorStop(0, hexToRgba(color, alpha));
    gradient.addColorStop(1, hexToRgba(color, 0));

    ctx.fillStyle = gradient;
    ctx.beginPath();

    points.forEach((point, index) => {
        const x = xForIndex(chart, index);
        const y = yForValue(chart, point.normalizedValue);

        if (index === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });

    ctx.lineTo(xForIndex(chart, points.length - 1), chart.height - chart.bottom);
    ctx.lineTo(xForIndex(chart, 0), chart.height - chart.bottom);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

function drawLastValue(ctx, chart, point, color) {
    if (!point) {
        return;
    }

    const x = chart.width - chart.right + 16;
    const y = clamp(
        yForValue(chart, point.normalizedValue),
        chart.top + 16,
        chart.height - chart.bottom - 16
    );

    const label = point.normalizedValue.toFixed(2);

    ctx.save();
    ctx.font = "900 13px system-ui, -apple-system, Segoe UI, sans-serif";

    const labelWidth = Math.max(46, ctx.measureText(label).width + 18);

    roundRect(ctx, x, y - 15, labelWidth, 30, 7);
    ctx.fillStyle = color;
    ctx.shadowBlur = 16;
    ctx.shadowColor = color;
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = "#04111d";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + labelWidth / 2, y);
    ctx.restore();
}

function drawTimeAxis(ctx, chart, points) {
    ctx.save();
    ctx.fillStyle = "rgba(205, 216, 231, 0.70)";
    ctx.font = "800 12px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.textBaseline = "middle";

    const labels = [0, Math.floor((points.length - 1) / 2), points.length - 1]
        .filter((value, index, array) => array.indexOf(value) === index);

    labels.forEach((index, labelIndex) => {
        const point = points[index];
        const x = xForIndex(chart, index);
        const y = chart.height - 22;

        ctx.textAlign = labelIndex === 0
            ? "left"
            : labelIndex === labels.length - 1
                ? "right"
                : "center";

        ctx.fillText(labelIndex === labels.length - 1 ? "AGORA" : formatTime(point.time), x, y);
    });

    ctx.restore();
}

function drawCrossovers(ctx, markerLayer, chart, payload, leftPoints, rightPoints) {
    for (let index = 1; index < chart.count; index += 1) {
        const previousDelta = leftPoints[index - 1].normalizedValue - rightPoints[index - 1].normalizedValue;
        const currentDelta = leftPoints[index].normalizedValue - rightPoints[index].normalizedValue;

        if (previousDelta <= 0 && currentDelta > 0) {
            const y = clamp(
                yForValue(chart, leftPoints[index].normalizedValue),
                chart.top + 28,
                chart.height - chart.bottom - 34
            );

            drawVerticalCrossLine(ctx, chart, index, payload.left.color, y);
            addMarker(markerLayer, chart, index, y, payload.left, payload.left.color);
        } else if (previousDelta >= 0 && currentDelta < 0) {
            const y = clamp(
                yForValue(chart, rightPoints[index].normalizedValue),
                chart.top + 28,
                chart.height - chart.bottom - 34
            );

            drawVerticalCrossLine(ctx, chart, index, payload.right.color, y);
            addMarker(markerLayer, chart, index, y, payload.right, payload.right.color);
        }
    }
}

function drawVerticalCrossLine(ctx, chart, index, color, y) {
    const x = xForIndex(chart, index);

    ctx.save();
    ctx.strokeStyle = hexToRgba(color, 0.45);
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 6]);

    ctx.beginPath();
    ctx.moveTo(x, y + 22);
    ctx.lineTo(x, chart.height - chart.bottom);
    ctx.stroke();

    ctx.restore();
}

function addMarker(markerLayer, chart, index, y, side, color) {
    const x = xForIndex(chart, index);

    const marker = document.createElement("span");
    marker.className = `tv-price-battle-chart-marker tv-price-battle-chart-marker--${side.side}`;
    marker.style.left = `${x}px`;
    marker.style.top = `${y}px`;
    marker.style.borderColor = color;
    marker.style.boxShadow = `0 0 0 2px ${hexToRgba(color, 0.26)}, 0 0 22px ${hexToRgba(color, 0.62)}`;

    if (side.logoUrl) {
        const img = document.createElement("img");
        img.src = side.logoUrl;
        img.alt = side.label;
        marker.appendChild(img);
    } else {
        marker.textContent = side.compactLabel || side.label || "↑";
    }

    const arrow = document.createElement("i");
    arrow.textContent = "↑";
    arrow.style.background = color;
    marker.appendChild(arrow);

    markerLayer.appendChild(marker);
}

function xForIndex(chart, index) {
    if (chart.count <= 1) {
        return chart.left;
    }

    return chart.left + (chart.plotWidth * index) / (chart.count - 1);
}

function yForValue(chart, value) {
    const ratio = (value - chart.yMin) / (chart.yMax - chart.yMin || 1);
    return chart.top + chart.plotHeight - ratio * chart.plotHeight;
}

function formatTime(value) {
    if (value === null || value === undefined || value === "") {
        return "--:--";
    }

    const numeric = Number(value);

    if (Number.isFinite(numeric) && numeric > 0) {
        const timestamp = numeric > 9_999_999_999 ? numeric : numeric * 1000;
        const date = new Date(timestamp);

        if (!Number.isNaN(date.getTime())) {
            return date.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit"
            });
        }
    }

    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
        return date.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
        });
    }

    const text = String(value).trim();
    return text.length <= 8 ? text : text.slice(-8);
}

function roundRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);

    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
}

function hexToRgba(color, alpha) {
    if (!color || !color.startsWith("#")) {
        return `rgba(83, 200, 255, ${alpha})`;
    }

    const hex = color.replace("#", "");
    const full = hex.length === 3
        ? hex.split("").map(char => char + char).join("")
        : hex;

    const value = Number.parseInt(full, 16);

    if (!Number.isFinite(value)) {
        return `rgba(83, 200, 255, ${alpha})`;
    }

    const red = (value >> 16) & 255;
    const green = (value >> 8) & 255;
    const blue = value & 255;

    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

const styleId = "tv-price-battle-chart-marker-style";

if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
        .tv-price-battle-chart-marker {
            position: absolute;
            z-index: 4;
            display: grid;
            place-items: center;
            width: 42px;
            height: 42px;
            transform: translate(-50%, -50%);
            border: 2px solid currentColor;
            border-radius: 50%;
            background: #07101c;
            color: #f8fbff;
            font: 950 10px system-ui, -apple-system, Segoe UI, sans-serif;
            letter-spacing: -.04em;
            text-align: center;
        }

        .tv-price-battle-chart-marker img {
            width: 100%;
            height: 100%;
            padding: 4px;
            object-fit: contain;
            border-radius: inherit;
        }

        .tv-price-battle-chart-marker i {
            position: absolute;
            right: -6px;
            bottom: -4px;
            display: grid;
            place-items: center;
            width: 18px;
            height: 18px;
            border-radius: 50%;
            color: #04111d;
            font: 950 13px system-ui, -apple-system, Segoe UI, sans-serif;
            font-style: normal;
            box-shadow: 0 0 10px rgba(0,0,0,.45);
        }
    `;

    document.head.appendChild(style);
}