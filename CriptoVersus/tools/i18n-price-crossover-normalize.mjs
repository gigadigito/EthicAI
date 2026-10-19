// Normaliza o bloco `social.priceCrossover` de cada i18n.<cultura>.json:
// - converte chaves PLANAS com ponto embutido ("chart.title") em objetos ANINHADOS
//   ({ "chart": { "title": ... } }), unico formato resolvivel por LocalizationService.GetNode;
// - aplica atualizacoes de texto e acrescenta chaves novas exigidas pelo card social.
// A troca e TEXTUAL (offset), preservando byte a byte o restante do arquivo.
// Idempotente: reexecutar nao altera mais nada.
import { readFileSync, writeFileSync } from "node:fs";

const updates = {
    "en-US": {
        "metrics.chartRoundPoints": "Chart points",
        "chart.baselineNote": "baseline",
        "summary.finalScore": "Final score",
        "summary.winnerBadge": "Winner",
        "metrics.percentagePointsShort": "pp",
        "metrics.totalCrossovers": "Detected crossovers",
        "footer.matchTag": "Match #{0}"
    },
    "pt-BR": {
        "chart.title": "Batalha de Preços",
        "metrics.relevantCrossovers": "Ultrapassagens relevantes",
        "metrics.chartRoundPoints": "Pontos no gráfico",
        "chart.baselineNote": "base",
        "summary.finalScore": "Placar final",
        "summary.winnerBadge": "Vencedor",
        "metrics.percentagePointsShort": "p.p.",
        "metrics.totalCrossovers": "Cruzamentos detectados",
        "footer.matchTag": "Partida #{0}"
    },
    "zh-CN": {
        "metrics.chartRoundPoints": "图表积分",
        "chart.baselineNote": "基准",
        "summary.finalScore": "最终比分",
        "summary.winnerBadge": "胜者",
        "metrics.percentagePointsShort": "个百分点",
        "metrics.totalCrossovers": "检测到的交叉",
        "footer.matchTag": "比赛 #{0}"
    },
    "es-ES": {
        "metrics.chartRoundPoints": "Puntos del gráfico",
        "chart.baselineNote": "base",
        "summary.finalScore": "Marcador final",
        "summary.winnerBadge": "Ganador",
        "metrics.percentagePointsShort": "p.p.",
        "metrics.totalCrossovers": "Cruces detectados",
        "footer.matchTag": "Partida #{0}"
    },
    "fr-FR": {
        "metrics.chartRoundPoints": "Points du graphique",
        "chart.baselineNote": "base",
        "summary.finalScore": "Score final",
        "summary.winnerBadge": "Vainqueur",
        "metrics.percentagePointsShort": "pt",
        "metrics.totalCrossovers": "Croisements détectés",
        "footer.matchTag": "Match #{0}"
    },
    "de-DE": {
        "metrics.chartRoundPoints": "Diagrammpunkte",
        "chart.baselineNote": "Basis",
        "summary.finalScore": "Endergebnis",
        "summary.winnerBadge": "Sieger",
        "metrics.percentagePointsShort": "pp",
        "metrics.totalCrossovers": "Erkannte Kreuzungen",
        "footer.matchTag": "Match #{0}"
    },
    "it-IT": {
        "metrics.chartRoundPoints": "Punti del grafico",
        "chart.baselineNote": "base",
        "summary.finalScore": "Punteggio finale",
        "summary.winnerBadge": "Vincitore",
        "metrics.percentagePointsShort": "p.p.",
        "metrics.totalCrossovers": "Incroci rilevati",
        "footer.matchTag": "Partita #{0}"
    },
    "ja-JP": {
        "metrics.chartRoundPoints": "チャートポイント",
        "chart.baselineNote": "基準",
        "summary.finalScore": "最終スコア",
        "summary.winnerBadge": "勝者",
        "metrics.percentagePointsShort": "ポイント",
        "metrics.totalCrossovers": "検出されたクロス",
        "footer.matchTag": "試合 #{0}"
    }
};

function findBlockRange(source, marker) {
    const markerAt = source.indexOf(marker);
    if (markerAt < 0) {
        return null;
    }

    const openBrace = source.indexOf("{", markerAt + marker.length - 1);
    if (openBrace < 0) {
        return null;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = openBrace; i < source.length; i += 1) {
        const ch = source[i];

        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (ch === "\\") {
                escaped = true;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }

        if (ch === '"') {
            inString = true;
        } else if (ch === "{") {
            depth += 1;
        } else if (ch === "}") {
            depth -= 1;
            if (depth === 0) {
                return { start: openBrace, end: i + 1, keyStart: markerAt };
            }
        }
    }

    return null;
}

function flatten(node, prefix, out) {
    if (node === null || typeof node !== "object" || Array.isArray(node)) {
        out[prefix] = node;
        return out;
    }

    for (const [key, value] of Object.entries(node)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (value !== null && typeof value === "object" && !Array.isArray(value)) {
            flatten(value, path, out);
        } else {
            out[path] = value;
        }
    }

    return out;
}

function nest(flat) {
    const root = {};
    for (const path of Object.keys(flat)) {
        const segments = path.split(".");
        let current = root;
        for (let i = 0; i < segments.length - 1; i += 1) {
            if (typeof current[segments[i]] !== "object" || current[segments[i]] === null) {
                current[segments[i]] = {};
            }
            current = current[segments[i]];
        }
        current[segments[segments.length - 1]] = flat[path];
    }
    return root;
}

function serialize(node, indent) {
    const pad = " ".repeat(indent);
    const padInner = " ".repeat(indent + 2);

    if (node === null || typeof node !== "object") {
        return JSON.stringify(node);
    }

    const entries = Object.entries(node);
    if (entries.length === 0) {
        return "{}";
    }

    const lines = entries.map(([key, value]) => {
        const rendered = (value !== null && typeof value === "object")
            ? serialize(value, indent + 2)
            : JSON.stringify(value);
        return `${padInner}${JSON.stringify(key)}: ${rendered}`;
    });

    return `{\n${lines.join(",\n")}\n${pad}}`;
}

for (const [culture, patch] of Object.entries(updates)) {
    const path = new URL(`../i18n.${culture}.json`, import.meta.url);
    const source = readFileSync(path, "utf8");

    const range = findBlockRange(source, '"priceCrossover":');
    if (!range) {
        throw new Error(`${culture}: bloco "priceCrossover" nao encontrado.`);
    }

    const flat = flatten(JSON.parse(source.slice(range.start, range.end)), "", {});
    const merged = { ...flat, ...patch };
    const nested = nest(merged);

    // Indentacao do proprio bloco (4 espacos em relacao a "priceCrossover").
    const lineStart = source.lastIndexOf("\n", range.keyStart) + 1;
    const keyIndent = source.slice(lineStart).match(/^\s*/)[0].length;

    const before = source.slice(0, range.start);
    const after = source.slice(range.end);
    const rendered = serialize(nested, keyIndent);

    const updated = before + rendered + after;
    writeFileSync(path, updated, "utf8");

    const changed = Object.keys(merged).length !== Object.keys(flat).length
        || Object.entries(patch).some(([key, value]) => flat[key] !== value);
    console.log(`${culture}: ${Object.keys(merged).length} chaves aninhadas${changed ? " (atualizado)" : " (sem alteracoes)"}.`);
}
