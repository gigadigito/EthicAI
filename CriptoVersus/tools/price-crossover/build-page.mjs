// Gera a pagina de captura do card social Price Crossover para testes de imagem.
//
// A pagina gerada reutiliza TRES fontes reais do produto:
//  1. o <style> extraido de Components/Pages/Internet/PriceCrossoverSocial.razor;
//  2. os recursos i18n.<cultura>.json resolvidos com a mesma semantica de
//     CriptoVersus/Services/LocalizationService.cs (aninhamento + fallback en-US);
//  3. o modulo /js/priceCrossoverSocialCard.mjs usado na captura Browserless.
//
// O mapeamento de serie/marcadores espelha PriceCrossoverSocialCardModelBuilder.BuildChart,
// que e a fonte de verdade (coberta por EthicAI.test/PriceCrossoverSocialCardTests.cs).
//
// Uso: node tools/price-crossover/build-page.mjs [--culture pt-BR] [--preset 4x3]
//      [--variant base|long-symbols|many-crossovers|missing-metrics|not-publishable] [--fixture <json>]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "../..");
const repoRoot = resolve(webRoot, "..");

const args = parseArgs(process.argv.slice(2));
const culture = args.culture ?? "pt-BR";
const preset = args.preset ?? "4x3";
const variant = args.variant ?? "base";
const fixturePath = args.fixture ?? resolve(here, "fixtures/match-41212.json");
const outDir = args.out ?? resolve(here, "out");

const moduleVersion = "20261018-price-crossover-social-2";

const response = JSON.parse(readFileSync(fixturePath, "utf8"));
applyVariant(response, variant);

const razor = readFileSync(resolve(webRoot, "Components/Pages/Internet/PriceCrossoverSocial.razor"), "utf8");
const styleBlock = extractStyle(razor);

const t = createTranslator(culture);
const texts = buildTexts(response, culture, t);
const payload = buildChartPayload(response);
const state = resolveState(response, payload);

const html = renderPage({ styleBlock, texts, payload, state, response, culture, preset, t });

mkdirSync(outDir, { recursive: true });
const outFile = resolve(outDir, `capture-${culture}-${preset}-${variant}.html`);
writeFileSync(outFile, html, "utf8");
console.log(`gerado: ${outFile}`);

function parseArgs(argv) {
    const result = {};
    for (let i = 0; i < argv.length; i += 1) {
        if (!argv[i].startsWith("--")) continue;
        const key = argv[i].slice(2);
        const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
        result[key] = value;
    }
    return result;
}

function extractStyle(razorSource) {
    const match = razorSource.match(/<style>([\s\S]*?)<\/style>/);
    if (!match) {
        throw new Error("bloco <style> nao encontrado em PriceCrossoverSocial.razor.");
    }
    // Razor escapa "@" como "@@"; o runtime devolve "@media" etc.
    return match[1].replace(/@@/g, "@");
}

function loadBlock(cultureName) {
    const root = JSON.parse(readFileSync(resolve(webRoot, `i18n.${cultureName}.json`), "utf8"));
    return root?.social?.priceCrossover ?? null;
}

function createTranslator(cultureName) {
    const primary = loadBlock(cultureName);
    const fallback = loadBlock("en-US");

    const lookup = (block, key) => {
        let current = block;
        for (const segment of key.split(".")) {
            if (current === null || typeof current !== "object") return null;
            current = current[segment];
        }
        return typeof current === "string" ? current : null;
    };

    return (key, ...args) => {
        const template = lookup(primary, key) ?? lookup(fallback, key);
        if (template === null) {
            throw new Error(`chave nao resolvida: social.priceCrossover.${key} (${cultureName})`);
        }
        return args.length === 0 ? template : formatTemplate(template, args);
    };
}

function formatTemplate(template, args) {
    return template.replace(/\{(\d+)\}/g, (match, index) => {
        const value = args[Number(index)];
        return value === undefined ? match : String(value);
    });
}

function normalizeCulture(cultureName) {
    const map = { en: "en-US", pt: "pt-BR", zh: "zh-CN", es: "es-ES", fr: "fr-FR", de: "de-DE", it: "it-IT", ja: "ja-JP" };
    return map[cultureName] ?? cultureName;
}

function formatSignedPercent(value, locale) {
    if (value === null || value === undefined) return "--";
    const sign = value > 0 ? "+" : "";
    const formatted = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
    return `${sign}${formatted}%`;
}

function formatPercentPoints(value, locale) {
    if (value === null || value === undefined) return null;
    return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(value));
}

function formatMatchDate(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
    return `${stamp} UTC`;
}

function toUnixSeconds(iso) {
    return Math.floor(Date.parse(iso) / 1000);
}

function displaySymbol(asset) {
    return asset.baseAsset || asset.symbol || "--";
}

function pairLabel(asset) {
    return asset.quoteAsset ? `${asset.baseAsset} / ${asset.quoteAsset}` : asset.symbol;
}

function initials(symbol) {
    const letters = String(symbol ?? "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 3).toUpperCase();
    return letters || "--";
}

function buildTexts(responseData, cultureName, translate) {
    const locale = normalizeCulture(cultureName);
    const winnerIsA = responseData.official.winnerTeamId === responseData.assetA.teamId;
    const winnerLabel = responseData.official.winnerTeamId
        ? displaySymbol(winnerIsA ? responseData.assetA : responseData.assetB)
        : "";

    return {
        locale,
        pageTitle: translate("seo.titleWithMatch", displaySymbol(responseData.assetA), displaySymbol(responseData.assetB)),
        chartTitle: translate("chart.title"),
        versus: translate("chart.versus"),
        chartAria: translate("chart.ariaLabel"),
        chartEmpty: translate("chart.empty"),
        baselineNote: translate("chart.baselineNote"),
        dateLabel: formatMatchDate(responseData.endTimeUtc ?? responseData.startTimeUtc),
        utcNote: translate("hero.utcNote"),
        summaryAria: translate("summary.ariaLabel"),
        finalScoreLabel: translate("summary.finalScore"),
        officialScoreText: `${responseData.official.scoreA} - ${responseData.official.scoreB}`,
        officialScoreCaption: translate("summary.officialScore"),
        officialWinnerLabel: translate("summary.officialWinner"),
        winnerBadge: translate("summary.winnerBadge"),
        drawLabel: translate("summary.draw"),
        winnerText: winnerLabel || translate("summary.draw"),
        metricsAria: translate("metrics.ariaLabel"),
        performanceDifferenceLabel: translate("metrics.performanceDifference"),
        performanceDifferenceValue: formatPercentPoints(responseData.comparative.performanceDifferencePercent, locale),
        percentagePointsShort: translate("metrics.percentagePointsShort"),
        relevantCrossoversLabel: translate("metrics.relevantCrossovers"),
        relevantCrossoversValue: String(responseData.comparative.relevantCrossovers ?? 0),
        totalCrossoversLabel: translate("metrics.totalCrossovers"),
        totalCrossoversValue: String(responseData.comparative.totalCrossovers ?? 0),
        comebackLabel: translate("metrics.comeback"),
        comebackValue: translate("metrics.comebackValue"),
        chartRoundPointsLabel: translate("metrics.chartRoundPoints"),
        chartRoundPointsValue: `${responseData.assetA.chartRoundPoints} - ${responseData.assetB.chartRoundPoints}`,
        hasComeback: Boolean(responseData.comparative.hasComeback),
        footerSite: "criptoversus.com",
        footerMatchTag: translate("footer.matchTag", responseData.matchId),
        footerDisclaimer: translate("footer.disclaimer"),
        assetA: {
            pair: pairLabel(responseData.assetA),
            display: displaySymbol(responseData.assetA),
            perf: formatSignedPercent(responseData.assetA.performancePercent, locale),
            isWinner: Boolean(responseData.official.winnerTeamId) && winnerIsA,
            initials: initials(responseData.assetA.symbol),
            logoUrl: `https://api.criptoversus.com/api/icons/binance/${encodeURIComponent(responseData.assetA.symbol)}`
        },
        assetB: {
            pair: pairLabel(responseData.assetB),
            display: displaySymbol(responseData.assetB),
            perf: formatSignedPercent(responseData.assetB.performancePercent, locale),
            isWinner: Boolean(responseData.official.winnerTeamId) && !winnerIsA && responseData.official.winnerTeamId === responseData.assetB.teamId,
            initials: initials(responseData.assetB.symbol),
            logoUrl: `https://api.criptoversus.com/api/icons/binance/${encodeURIComponent(responseData.assetB.symbol)}`
        }
    };
}

/**
 * Espelha PriceCrossoverSocialCardModelBuilder.BuildChart:
 * somente pontos completos entram; o marcador usa TimestampUtc do evento com
 * InterpolatedNormalizedValue como valor Y. Nada e interpolado aqui.
 */
function buildChartPayload(responseData) {
    const points = [];
    for (const point of responseData.series) {
        if (!point.isComplete
            || point.assetA?.normalizedValue === null || point.assetA?.normalizedValue === undefined
            || point.assetB?.normalizedValue === null || point.assetB?.normalizedValue === undefined) {
            continue;
        }

        points.push({
            timeUnixSeconds: toUnixSeconds(point.timestampUtc),
            normalizedValueA: Number(point.assetA.normalizedValue),
            normalizedValueB: Number(point.assetB.normalizedValue)
        });
    }

    let min = points.length === 0 ? 1 : Number.POSITIVE_INFINITY;
    let max = points.length === 0 ? 1 : Number.NEGATIVE_INFINITY;
    for (const point of points) {
        min = Math.min(min, point.normalizedValueA, point.normalizedValueB);
        max = Math.max(max, point.normalizedValueA, point.normalizedValueB);
    }

    const markers = (responseData.crossoverEvents ?? []).map((event) => {
        const value = event.interpolatedNormalizedValue ?? 1;
        min = Math.min(min, Number(value));
        max = Math.max(max, Number(value));
        return {
            timeUnixSeconds: toUnixSeconds(event.timestampUtc),
            normalizedValue: Number(value),
            direction: event.direction,
            isRelevant: Boolean(event.isRelevant),
            winnerSymbol: event.winnerSymbol ?? "",
            winnerTeamId: event.winnerTeamId ?? 0
        };
    });

    return { points, markers, minNormalizedValue: min, maxNormalizedValue: max };
}

/**
 * Espelha PriceCrossoverSocialCardModelBuilder (IsDataComplete / IsSocialReady /
 * ResolveCaptureMatchStatus), que e a fonte de verdade do contrato de captura.
 */
function resolveState(responseData, payload) {
    const rawStatus = String(responseData.status ?? "").toLowerCase();
    const isFinished = rawStatus === "completed";
    const dataQuality = responseData.dataQuality ?? {};
    const dataComplete = payload.points.length >= 2
        && Boolean(responseData.assetA?.symbol)
        && Boolean(responseData.assetB?.symbol)
        && dataQuality.isSufficient !== false
        && dataQuality.canReconstructChart !== false;
    const canPost = Boolean(responseData.canPost) && isFinished && dataComplete;
    return {
        captureState: canPost ? "ready" : "not_publishable",
        csReady: canPost,
        dataComplete,
        captureMatchStatus: isFinished
            ? "finished"
            : (rawStatus === "pending" || rawStatus === "ongoing" ? "in_progress" : "unknown"),
        apiStatus: String(responseData.status ?? ""),
        totalCrossovers: responseData.comparative.totalCrossovers ?? 0,
        relevantCrossovers: responseData.comparative.relevantCrossovers ?? 0
    };
}

function applyVariant(responseData, variantName) {
    if (variantName === "not-publishable") {
        // Partida em andamento e sem permissao de publicacao: o contrato de captura
        // nunca pode declarar a pagina pronta (testes negativos do seletor).
        responseData.status = "Ongoing";
        responseData.canPost = false;
        responseData.skipReason = "match_not_completed";
        return;
    }

    if (variantName === "long-symbols") {
        responseData.assetA = { ...responseData.assetA, symbol: "1000PEPEUSDT", baseAsset: "1000PEPE", quoteAsset: "USDT" };
        responseData.assetB = { ...responseData.assetB, symbol: "SHIBUSDT", baseAsset: "SHIB", quoteAsset: "USDT" };
        return;
    }

    if (variantName === "many-crossovers") {
        const events = [];
        const start = Date.parse(responseData.series[0].timestampUtc);
        const end = Date.parse(responseData.series[responseData.series.length - 1].timestampUtc);
        for (let i = 0; i < 30; i += 1) {
            const ratio = i / 29;
            events.push({
                index: i,
                timestampUtc: new Date(start + (end - start) * ratio).toISOString(),
                direction: i % 2 === 0 ? "up" : "down",
                isRelevant: i % 7 === 0,
                interpolatedNormalizedValue: 1 + Math.sin(ratio * Math.PI * 4) * 0.004,
                winnerSymbol: i % 2 === 0 ? responseData.assetA.symbol : responseData.assetB.symbol,
                winnerTeamId: i % 2 === 0 ? responseData.assetA.teamId : responseData.assetB.teamId
            });
        }
        responseData.crossoverEvents = events;
        responseData.comparative = { ...responseData.comparative, totalCrossovers: 30, relevantCrossovers: 5 };
        return;
    }

    if (variantName === "missing-metrics") {
        responseData.assetA = { ...responseData.assetA, performancePercent: null };
        responseData.assetB = { ...responseData.assetB, performancePercent: null };
        responseData.comparative = {
            ...responseData.comparative,
            performanceDifferencePercent: null,
            hasComeback: false
        };
    }
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function renderPage({ styleBlock, texts, payload, state, response, culture, preset, t }) {
    const assetCard = (asset, side) => `
                <article class="price-crossover-social__asset price-crossover-social__asset--${side} ${asset.isWinner ? "is-winner" : ""}">
                    <div class="price-crossover-social__asset-logo">
                        <img src="${escapeHtml(asset.logoUrl)}"
                             alt="${escapeHtml(asset.display)}"
                             width="52" height="52" loading="eager" decoding="sync"
                             onerror="this.remove(); this.nextElementSibling?.classList.add('is-visible');" />
                        <span class="price-crossover-social__asset-fallback">${escapeHtml(asset.initials)}</span>
                    </div>
                    <div class="price-crossover-social__asset-copy">
                        <strong class="price-crossover-social__asset-symbol">${escapeHtml(asset.pair)}</strong>
                        <span class="price-crossover-social__asset-perf">${escapeHtml(asset.perf)}</span>
                        ${asset.isWinner ? `<span class="price-crossover-social__asset-winner">${escapeHtml(texts.winnerBadge)}</span>` : ""}
                    </div>
                </article>`;

    const metrics = [];
    if (texts.performanceDifferenceValue !== null) {
        metrics.push(`
                <div class="price-crossover-social__metric">
                    <span>${escapeHtml(texts.performanceDifferenceLabel)}</span>
                    <strong>${escapeHtml(texts.performanceDifferenceValue)} ${escapeHtml(texts.percentagePointsShort)}</strong>
                </div>`);
    }
    metrics.push(`
                <div class="price-crossover-social__metric">
                    <span>${escapeHtml(texts.relevantCrossoversLabel)}</span>
                    <strong>${escapeHtml(texts.relevantCrossoversValue)}</strong>
                </div>`);
    metrics.push(`
                <div class="price-crossover-social__metric">
                    <span>${escapeHtml(texts.totalCrossoversLabel)}</span>
                    <strong>${escapeHtml(texts.totalCrossoversValue)}</strong>
                </div>`);
    if (texts.hasComeback) {
        metrics.push(`
                <div class="price-crossover-social__metric price-crossover-social__metric--accent">
                    <span>${escapeHtml(texts.comebackLabel)}</span>
                    <strong>${escapeHtml(texts.comebackValue)}</strong>
                </div>`);
    } else {
        metrics.push(`
                <div class="price-crossover-social__metric">
                    <span>${escapeHtml(texts.chartRoundPointsLabel)}</span>
                    <strong>${escapeHtml(texts.chartRoundPointsValue)}</strong>
                </div>`);
    }

    return `<!DOCTYPE html>
<html lang="${escapeHtml(normalizeCulture(culture))}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(texts.pageTitle)}</title>
<style>${styleBlock}</style>
</head>
<body>
<div class="price-crossover-social__stage">
    <section id="price-crossover-social-card"
             class="price-crossover-social tv-price-battle"
             data-preset="${escapeHtml(preset)}"
             data-capture-state="${escapeHtml(state.captureState)}"
             data-cs-ready="${state.csReady}"
             data-data-complete="${state.dataComplete}"
             data-render-complete="false"
             data-fonts-ready="false"
             data-images-ready="false"
             data-i18n-ok="false"
             data-can-post="${state.captureState === "ready"}"
             data-match-id="${response.matchId}"
             data-match-status="${escapeHtml(state.captureMatchStatus)}"
             data-api-status="${escapeHtml(state.apiStatus)}"
             data-total-crossovers="${state.totalCrossovers}"
             data-relevant-crossovers="${state.relevantCrossovers}"
             aria-label="${escapeHtml(texts.pageTitle)}">

            <header class="price-crossover-social__header">
                <div class="price-crossover-social__brand">
                    <span class="price-crossover-social__brand-crypto">Cripto</span><span class="price-crossover-social__brand-versus">Versus</span>
                </div>

                <div class="price-crossover-social__title-block">
                    <h1>${escapeHtml(texts.chartTitle)}</h1>
                    <p class="price-crossover-social__match-line">
                        <span class="price-crossover-social__tag price-crossover-social__tag--a">${escapeHtml(texts.assetA.display)}</span>
                        <span class="price-crossover-social__vs">${escapeHtml(texts.versus)}</span>
                        <span class="price-crossover-social__tag price-crossover-social__tag--b">${escapeHtml(texts.assetB.display)}</span>
                    </p>
                </div>

                <div class="price-crossover-social__meta">
                    <span class="price-crossover-social__date">${escapeHtml(texts.dateLabel)}</span>
                    <span class="price-crossover-social__utc-note">${escapeHtml(texts.utcNote)}</span>
                </div>
            </header>

            <section class="price-crossover-social__chart-shell" aria-label="${escapeHtml(texts.chartAria)}">
                <canvas id="price-crossover-social-canvas"
                        class="price-crossover-social__canvas"
                        aria-label="${escapeHtml(texts.chartAria)}"></canvas>
                <div id="price-crossover-social-markers"
                     class="price-crossover-social__marker-layer"
                     aria-hidden="true"></div>
            </section>

            <section class="price-crossover-social__summary" aria-label="${escapeHtml(texts.summaryAria)}">
${assetCard(texts.assetA, "a")}

                <div class="price-crossover-social__result">
                    <span class="price-crossover-social__result-label">${escapeHtml(texts.finalScoreLabel)}</span>
                    <strong class="price-crossover-social__result-score">${escapeHtml(texts.officialScoreText)}</strong>
                    <span class="price-crossover-social__result-caption">${escapeHtml(texts.officialScoreCaption)}</span>
                    <span class="price-crossover-social__result-winner">${escapeHtml(texts.officialWinnerLabel)} · ${escapeHtml(texts.winnerText)}</span>
                </div>

${assetCard(texts.assetB, "b")}
            </section>

            <section class="price-crossover-social__metrics" aria-label="${escapeHtml(texts.metricsAria)}">${metrics.join("")}
            </section>

            <footer class="price-crossover-social__footer">
                <span class="price-crossover-social__site">${escapeHtml(texts.footerSite)}</span>
                <span class="price-crossover-social__match-tag">${escapeHtml(texts.footerMatchTag)}</span>
                <span class="price-crossover-social__disclaimer">${escapeHtml(texts.footerDisclaimer)}</span>
            </footer>
    </section>
</div>

<script type="module">
import {
    renderPriceCrossoverSocialCard,
    waitForImages,
    syncPriceCrossoverSocialReadiness
} from "/js/priceCrossoverSocialCard.mjs?v=${moduleVersion}";

const payload = ${JSON.stringify({
        canvasId: "price-crossover-social-canvas",
        markerLayerId: "price-crossover-social-markers",
        series: payload,
        options: {
            leftColor: "#B8FF00",
            rightColor: "#00D5DF",
            leftLabel: texts.assetA.display,
            rightLabel: texts.assetB.display,
            minNormalizedValue: payload.minNormalizedValue,
            maxNormalizedValue: payload.maxNormalizedValue,
            locale: texts.locale,
            valueDecimals: 3,
            baselineNote: texts.baselineNote,
            matchStartUnixSeconds: toUnixSeconds(response.startTimeUtc),
            matchEndUnixSeconds: toUnixSeconds(response.endTimeUtc)
        }
    })};

const result = await renderPriceCrossoverSocialCard(payload);
await waitForImages("price-crossover-social-card");
syncPriceCrossoverSocialReadiness("price-crossover-social-card", {
    renderComplete: result.ok === true,
    fontsReady: true,
    imagesReady: true
});
window.__captureResult = result;
</script>
</body>
</html>`;
}
