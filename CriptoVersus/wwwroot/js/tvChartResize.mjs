export function fitChart(chart) {
    try {
        chart.timeScale().fitContent();
    } catch {
    }
}

export function ensureChartResizeObserver(args) {
    const {
        chartsState,
        container,
        chart,
        chartId,
        onCompareRefresh,
        diagnostics,
        ResizeObserverCtor = typeof ResizeObserver === "function" ? ResizeObserver : null
    } = args;

    if (!chartsState || !container || !chart || !ResizeObserverCtor) {
        return null;
    }

    const existing = chartsState.charts.get(chartId);
    if (existing?.resizeObserver) {
        return existing.resizeObserver;
    }

    const resizeObserver = new ResizeObserverCtor(() => {
        const rect = container.getBoundingClientRect();

        chart.applyOptions({
            width: Math.max(1, Math.floor(rect.width)),
            height: Math.max(1, Math.floor(rect.height))
        });

        fitChart(chart);

        const latest = chartsState?.charts?.get(chartId);
        if (latest?.kind === "compare") {
            onCompareRefresh?.(latest);
        }

        diagnostics?.info?.("resize", {
            id: chartId,
            width: Math.max(1, Math.floor(rect.width)),
            height: Math.max(1, Math.floor(rect.height))
        });
    });

    resizeObserver.observe(container);

    chartsState.charts.set(chartId, {
        ...existing,
        container,
        resizeObserver
    });

    return resizeObserver;
}

export function disposeChartEntry(entry, options = {}) {
    if (!entry) {
        return;
    }

    const clearTimer = options?.clearTimer ?? ((timerId) => window.clearTimeout(timerId));

    try {
        if (entry.markerFadeTimer) {
            clearTimer(entry.markerFadeTimer);
        }
    } catch {
    }

    try {
        entry.overlayRoot?.remove?.();
    } catch {
    }

    try {
        if (Array.isArray(entry.scoreEventMarkerNodes)) {
            entry.scoreEventMarkerNodes.forEach((markerEntry) => markerEntry?.node?.remove?.());
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
}
