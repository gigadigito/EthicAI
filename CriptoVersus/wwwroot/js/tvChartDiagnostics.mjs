function resolveWindowObject() {
    return typeof window !== "undefined" ? window : null;
}

export function isTvChartDebugEnabled() {
    const win = resolveWindowObject();
    return Boolean(win?.CRIPTOVERSUS_TV_DEBUG);
}

export function createTvChartDiagnostics(scope = "TV_CHART") {
    const counters = {
        discardedEvents: 0,
        positionedEvents: 0
    };

    function emit(level, message, payload) {
        if (!isTvChartDebugEnabled()) {
            return;
        }

        const prefix = `[${scope}] ${message}`;
        if (typeof payload === "undefined") {
            console[level](prefix);
            return;
        }

        console[level](prefix, payload);
    }

    return {
        counters,
        debugEnabled: isTvChartDebugEnabled,
        info(message, payload) {
            emit("log", message, payload);
        },
        warn(message, payload) {
            emit("warn", message, payload);
        },
        recordDiscardedEvent(reason, event) {
            counters.discardedEvents += 1;
            emit("warn", "discarded score event", {
                reason,
                event
            });
        },
        recordPositionedEvent(marker) {
            counters.positionedEvents += 1;
            emit("log", "positioned score event", marker);
        }
    };
}

export function resolveTelemetryDataOrigin(payload) {
    const explicitOrigin = typeof payload?.dataOrigin === "string" && payload.dataOrigin.trim().length > 0
        ? payload.dataOrigin.trim()
        : typeof payload?.source === "string" && payload.source.trim().length > 0
            ? payload.source.trim()
            : "";

    if (explicitOrigin) {
        return explicitOrigin;
    }

    const hasSeriesPoints = Array.isArray(payload?.left) && payload.left.length > 0
        || Array.isArray(payload?.right) && payload.right.length > 0;
    if (hasSeriesPoints) {
        return "raw snapshots";
    }

    if (Array.isArray(payload?.scoreEvents) && payload.scoreEvents.length > 0) {
        return "score events oficiais";
    }

    return "payload vazio";
}

export function logTelemetryChartSummary(diagnostics, payload, summary) {
    diagnostics?.info?.("render summary", {
        leftPoints: summary?.leftPoints ?? 0,
        rightPoints: summary?.rightPoints ?? 0,
        leftCandles: summary?.leftCandles ?? 0,
        rightCandles: summary?.rightCandles ?? 0,
        scoreEvents: Array.isArray(payload?.scoreEvents) ? payload.scoreEvents.length : 0,
        officialMarkers: summary?.officialMarkers ?? 0,
        minTime: summary?.minTime ?? null,
        maxTime: summary?.maxTime ?? null,
        discardedEvents: diagnostics?.counters?.discardedEvents ?? 0,
        positionedEvents: diagnostics?.counters?.positionedEvents ?? 0,
        dataOrigin: resolveTelemetryDataOrigin(payload)
    });
}
