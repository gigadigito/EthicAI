function coerceFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value)
        ? value
        : null;
}

function normalizeUnixNumber(value) {
    if (!Number.isFinite(value) || value < 0) {
        return null;
    }

    if (value >= 100000000000) {
        return Math.floor(value / 1000);
    }

    return Math.floor(value);
}

export function normalizeChartTime(input, options = {}) {
    const diagnostics = options?.diagnostics ?? null;

    if (input instanceof Date) {
        const millis = coerceFiniteNumber(input.getTime());
        const normalized = millis === null ? null : Math.floor(millis / 1000);
        if (normalized === null) {
            diagnostics?.warn?.("invalid chart time", { input });
        }
        return normalized;
    }

    if (typeof input === "string" && input.trim().length > 0) {
        const parsedMillis = Date.parse(input);
        const normalized = Number.isFinite(parsedMillis)
            ? Math.floor(parsedMillis / 1000)
            : null;

        if (normalized === null) {
            diagnostics?.warn?.("invalid chart time", { input });
        }

        return normalized;
    }

    const numeric = coerceFiniteNumber(input);
    if (numeric !== null) {
        const normalized = normalizeUnixNumber(numeric);
        if (normalized === null) {
            diagnostics?.warn?.("invalid chart time", { input });
        }
        return normalized;
    }

    diagnostics?.warn?.("invalid chart time", { input });
    return null;
}

export function buildChartPointDto(point, options = {}) {
    if (!point) {
        return null;
    }

    const diagnostics = options?.diagnostics ?? null;
    const time = normalizeChartTime(point.time, { diagnostics });
    const value = Number(point.value);

    if (!Number.isFinite(time) || !Number.isFinite(value)) {
        diagnostics?.warn?.("discarded chart point", { point });
        return null;
    }

    return {
        time,
        value,
        teamSymbol: typeof options?.teamSymbol === "string" ? options.teamSymbol : "",
        source: typeof options?.source === "string" ? options.source : "unknown",
        raw: point
    };
}

export function normalizeChartPoints(points, options = {}) {
    if (!Array.isArray(points)) {
        return [];
    }

    return points
        .map((point) => buildChartPointDto(point, options))
        .filter(Boolean)
        .sort((a, b) => a.time - b.time);
}
