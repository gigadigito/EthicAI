window.criptoVersusStatsCharts = (() => {
    const charts = new Map();
    const assetSuffixes = ["USDT", "USDC", "BUSD", "FDUSD", "BTC", "ETH"];

    function getElement(elementId) {
        if (!elementId) {
            return null;
        }

        return document.getElementById(elementId);
    }

    function ensureChart(elementId) {
        const element = getElement(elementId);
        if (!element || !window.echarts) {
            return null;
        }

        const existing = charts.get(elementId);
        if (existing && existing.element === element) {
            return existing;
        }

        if (existing) {
            dispose(elementId);
        }

        const chart = window.echarts.init(element, null, { renderer: "canvas" });
        const resize = () => chart.resize();
        window.addEventListener("resize", resize);

        const entry = { chart, resize, element };
        charts.set(elementId, entry);
        return entry;
    }

    function cleanAssetSymbol(symbol) {
        if (!symbol) {
            return "-";
        }

        const normalized = String(symbol).trim().toUpperCase();
        for (const suffix of assetSuffixes) {
            if (normalized.length > suffix.length + 1 && normalized.endsWith(suffix)) {
                return normalized.slice(0, -suffix.length);
            }
        }

        return normalized;
    }

    function buildDenseActivity(rows) {
        if (!Array.isArray(rows) || rows.length === 0) {
            return [];
        }

        const parsed = rows
            .map(item => ({
                date: item?.date || "",
                matches: Number(item?.matches ?? 0)
            }))
            .filter(item => item.date);

        if (parsed.length === 0) {
            return [];
        }

        const start = new Date(`${parsed[0].date}T00:00:00Z`);
        const end = new Date(`${parsed[parsed.length - 1].date}T00:00:00Z`);
        const map = new Map(parsed.map(item => [item.date, item.matches]));
        const dense = [];

        for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
            const iso = cursor.toISOString().slice(0, 10);
            dense.push({
                date: iso,
                matches: map.get(iso) ?? 0
            });
        }

        return dense;
    }

    function buildWinRateOption(data) {
        const rows = Array.isArray(data) ? data : [];
        const categories = rows.map(item => cleanAssetSymbol(item.symbol || item.displayName || "-"));
        const values = rows.map(item => Number(item.winRate ?? 0));
        const empty = rows.length === 0;

        return {
            backgroundColor: "transparent",
            animationDuration: 650,
            grid: { left: 28, right: 24, top: 40, bottom: 24, containLabel: true },
            tooltip: {
                trigger: "axis",
                axisPointer: { type: "shadow" },
                backgroundColor: "#171C26",
                borderColor: "rgba(24, 89, 87, 0.9)",
                textStyle: { color: "#F1F5F9" },
                formatter: params => {
                    if (!params || !params.length) {
                        return "No data";
                    }

                    const point = params[0];
                    const source = rows[point.dataIndex];
                    const fullSymbol = source?.symbol || source?.displayName || point.name;
                    return `${point.name}<br/><span style="color:#94A3B8">${fullSymbol}</span><br/>${Number(point.value ?? 0).toFixed(2)}%`;
                }
            },
            xAxis: {
                type: "value",
                min: 0,
                max: 100,
                axisLabel: { color: "#94A3B8", formatter: value => `${value}%` },
                splitLine: { lineStyle: { color: "rgba(24, 89, 87, 0.45)" } }
            },
            yAxis: {
                type: "category",
                inverse: true,
                data: empty ? ["No data yet"] : categories,
                axisTick: { show: false },
                axisLine: { show: false },
                axisLabel: { color: "#F1F5F9", fontWeight: 700 }
            },
            series: [
                {
                    type: "bar",
                    data: empty ? [0] : values,
                    barWidth: 18,
                    itemStyle: {
                        borderRadius: [0, 10, 10, 0],
                        color: "#C1F20F"
                    },
                    label: {
                        show: true,
                        position: "right",
                        color: "#F1F5F9",
                        formatter: ({ value }) => `${Number(value ?? 0).toFixed(1)}%`
                    }
                }
            ]
        };
    }

    function buildMatchActivityOption(data) {
        const rows = buildDenseActivity(Array.isArray(data) ? data : []);
        const dates = rows.map(item => item.date || "-");
        const values = rows.map(item => Number(item.matches ?? 0));
        const empty = rows.length === 0;

        return {
            backgroundColor: "transparent",
            animationDuration: 650,
            grid: { left: 24, right: 18, top: 40, bottom: 34, containLabel: true },
            tooltip: {
                trigger: "axis",
                backgroundColor: "#171C26",
                borderColor: "rgba(24, 89, 87, 0.9)",
                textStyle: { color: "#F1F5F9" }
            },
            xAxis: {
                type: "category",
                boundaryGap: false,
                data: empty ? ["No data yet"] : dates,
                axisLabel: {
                    color: "#94A3B8",
                    formatter: value => {
                        if (!value || value.length < 10) {
                            return value;
                        }

                        return `${value.slice(5, 7)}/${value.slice(8, 10)}`;
                    }
                },
                axisLine: { lineStyle: { color: "rgba(24, 89, 87, 0.45)" } }
            },
            yAxis: {
                type: "value",
                minInterval: 1,
                axisLabel: { color: "#94A3B8" },
                splitLine: { lineStyle: { color: "rgba(24, 89, 87, 0.45)" } }
            },
            series: [
                {
                    type: "line",
                    smooth: 0.22,
                    symbol: "circle",
                    symbolSize: empty ? 7 : 6,
                    data: empty ? [0] : values,
                    lineStyle: { width: 3, color: "#C1F20F" },
                    itemStyle: {
                        color: "#C1F20F",
                        borderColor: "#185957",
                        borderWidth: 2
                    },
                    emphasis: {
                        focus: "series"
                    },
                    areaStyle: { color: "rgba(24, 89, 87, 0.34)" }
                }
            ]
        };
    }

    function renderWinRateChart(elementId, data) {
        const entry = ensureChart(elementId);
        if (!entry) {
            return;
        }

        entry.chart.setOption(buildWinRateOption(data), true);
        entry.chart.resize();
    }

    function renderMatchActivityChart(elementId, data) {
        const entry = ensureChart(elementId);
        if (!entry) {
            return;
        }

        entry.chart.setOption(buildMatchActivityOption(data), true);
        entry.chart.resize();
    }

    function dispose(elementId) {
        const entry = charts.get(elementId);
        if (!entry) {
            return;
        }

        window.removeEventListener("resize", entry.resize);
        entry.chart.dispose();
        charts.delete(elementId);
    }

    return {
        renderWinRateChart,
        renderMatchActivityChart,
        dispose
    };
})();
