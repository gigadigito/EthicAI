// Validacao automatizada do bloco `social.priceCrossover` antes de qualquer publicacao.
// Detecta chaves de traducao nao resolvidas em QUALQUER cultura suportada e impede que
// uma chave literal apareca na imagem social.
//
// Uso: node tools/i18n-price-crossover-validate.mjs
// Saida: processo sai com codigo != 0 quando ha problema.
import { readFileSync } from "node:fs";

const cultures = ["en-US", "pt-BR", "zh-CN", "es-ES", "fr-FR", "de-DE", "it-IT", "ja-JP"];
const fallbackCulture = "en-US";

// Chaves consumidas por Components/Pages/Internet/PriceCrossoverSocial.razor
// (prefixo social.priceCrossover.) e por priceCrossoverSocialCard.mjs (chart.baselineNote).
const requiredKeys = [
    "seo.title",
    "seo.titleWithMatch",
    "seo.description",
    "hero.utcNote",
    "chart.title",
    "chart.versus",
    "chart.ariaLabel",
    "chart.empty",
    "chart.baselineNote",
    "summary.ariaLabel",
    "summary.finalScore",
    "summary.officialScore",
    "summary.officialWinner",
    "summary.winnerBadge",
    "summary.draw",
    "metrics.ariaLabel",
    "metrics.performanceDifference",
    "metrics.percentagePointsShort",
    "metrics.relevantCrossovers",
    "metrics.totalCrossovers",
    "metrics.chartRoundPoints",
    "metrics.comeback",
    "metrics.comebackValue",
    "states.loadingTitle",
    "states.loadingBody",
    "states.errorTitle",
    "states.errorBody",
    "states.notFoundBody",
    "states.notPublishableTitle",
    "states.notPublishableGeneric",
    "states.notPublishableNotFinished",
    "states.notPublishableAlreadyPublished",
    "states.notPublishableReserved",
    "states.notPublishableReconciliation",
    "states.notPublishableDataQuality",
    "states.notPublishableNoChart",
    "states.notPublishableNoBaseline",
    "footer.disclaimer",
    "footer.matchTag"
];

function loadBlock(culture) {
    const path = new URL(`../i18n.${culture}.json`, import.meta.url);
    const root = JSON.parse(readFileSync(path, "utf8"));
    const block = root?.social?.priceCrossover;
    if (!block || typeof block !== "object") {
        throw new Error(`${culture}: social.priceCrossover ausente.`);
    }
    return block;
}

function getNode(block, key) {
    let current = block;
    for (const segment of key.split(".")) {
        if (current === null || typeof current !== "object") {
            return null;
        }
        current = current[segment];
    }
    return typeof current === "string" ? current : null;
}

function collectLeafPaths(node, prefix, out) {
    for (const [key, value] of Object.entries(node)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (value !== null && typeof value === "object") {
            collectLeafPaths(value, path, out);
        } else {
            out.push(path);
        }
    }
    return out;
}

const problems = [];
const blocks = {};
const leafSets = {};

for (const culture of cultures) {
    const block = loadBlock(culture);
    blocks[culture] = block;

    // 1. Nenhuma chave plana com ponto embutido no primeiro nivel.
    for (const key of Object.keys(block)) {
        if (key.includes(".")) {
            problems.push(`${culture}: chave plana invalida "social.priceCrossover.${key}" (use aninhamento).`);
        }
    }

    const leaves = collectLeafPaths(block, "", []);
    leafSets[culture] = new Set(leaves);

    // 2. Toda chave obrigatória resolve para texto real (com fallback en-US).
    for (const key of requiredKeys) {
        const value = getNode(block, key) ?? getNode(blocks[fallbackCulture] ?? block, key);
        if (value === null || value.trim() === "") {
            problems.push(`${culture}: chave nao resolvida "social.priceCrossover.${key}".`);
        }
    }
}

// 3. Paridade de chaves entre culturas (alem do fallback para en-US).
const reference = leafSets[fallbackCulture];
for (const culture of cultures) {
    for (const key of reference) {
        if (!leafSets[culture].has(key)) {
            problems.push(`${culture}: falta a chave "social.priceCrossover.${key}" (existente em ${fallbackCulture}).`);
        }
    }
    for (const key of leafSets[culture]) {
        if (!reference.has(key)) {
            problems.push(`${fallbackCulture}: falta a chave "social.priceCrossover.${key}" (existente em ${culture}).`);
        }
    }
}

if (problems.length > 0) {
    console.error("i18n social.priceCrossover INVALIDO:");
    for (const problem of problems) {
        console.error(` - ${problem}`);
    }
    process.exit(1);
}

console.log(`i18n social.priceCrossover OK: ${requiredKeys.length} chaves x ${cultures.length} culturas, sem chaves nao resolvidas.`);
