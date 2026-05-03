window.tokenomicsCharts = (() => {
    const charts = new WeakMap();

    function buildOption(data) {
        const refund = Math.max(0, Number(data?.loserRefundRate ?? 0) * 100);
        const winners = Math.max(0, Number(data?.winnerPoolRate ?? 0) * 100);
        const house = Math.max(0, Number(data?.houseFeeRate ?? 0) * 100);

        return {
            backgroundColor: "transparent",
            animationDuration: 700,
            tooltip: {
                trigger: "item",
                backgroundColor: "rgba(10, 14, 20, 0.96)",
                borderColor: "rgba(148, 163, 184, 0.18)",
                textStyle: { color: "#f8fafc" },
                formatter: ({ name, value }) => `${name}: ${value.toFixed(0)}%`
            },
            legend: {
                bottom: 0,
                left: "center",
                itemWidth: 12,
                itemHeight: 12,
                textStyle: {
                    color: "#b9c6d5",
                    fontSize: 11,
                    fontWeight: 600
                },
                data: ["Retorno ao perdedor", "Pool dos vencedores", "Taxa da casa"]
            },
            graphic: [
                {
                    type: "text",
                    left: "center",
                    top: "41%",
                    style: {
                        text: "100%",
                        fill: "#f8fafc",
                        fontSize: 22,
                        fontWeight: 700,
                        textAlign: "center"
                    }
                },
                {
                    type: "text",
                    left: "center",
                    top: "53%",
                    style: {
                        text: "lado perdedor",
                        fill: "#8ea1b8",
                        fontSize: 11,
                        fontWeight: 600,
                        textAlign: "center",
                        textTransform: "uppercase"
                    }
                }
            ],
            series: [
                {
                    name: "Liquidacao",
                    type: "pie",
                    radius: ["56%", "76%"],
                    center: ["50%", "42%"],
                    avoidLabelOverlap: true,
                    padAngle: 1.4,
                    itemStyle: {
                        borderColor: "#101720",
                        borderWidth: 3,
                        shadowBlur: 24,
                        shadowColor: "rgba(0,0,0,0.35)"
                    },
                    label: {
                        color: "#f8fafc",
                        fontSize: 11,
                        fontWeight: 700,
                        formatter: ({ percent }) => `${Math.round(percent)}%`
                    },
                    labelLine: {
                        length: 14,
                        length2: 12,
                        lineStyle: {
                            color: "rgba(184, 198, 213, 0.55)"
                        }
                    },
                    data: [
                        {
                            value: refund,
                            name: "Retorno ao perdedor",
                            itemStyle: { color: "#5eead4" }
                        },
                        {
                            value: winners,
                            name: "Pool dos vencedores",
                            itemStyle: { color: "#93c5fd" }
                        },
                        {
                            value: house,
                            name: "Taxa da casa",
                            itemStyle: { color: "#f8fafc" }
                        }
                    ]
                }
            ]
        };
    }

    function ensureChart(element) {
        const existing = charts.get(element);
        if (existing) {
            return existing;
        }

        const chart = window.echarts.init(element, null, { renderer: "canvas" });
        const resize = () => chart.resize();
        window.addEventListener("resize", resize);

        const entry = { chart, resize };
        charts.set(element, entry);
        return entry;
    }

    function renderSettlementPie(element, data) {
        if (!element || !window.echarts) {
            return;
        }

        const entry = ensureChart(element);
        entry.chart.setOption(buildOption(data), true);
        entry.chart.resize();
    }

    return {
        renderSettlementPie
    };
})();
