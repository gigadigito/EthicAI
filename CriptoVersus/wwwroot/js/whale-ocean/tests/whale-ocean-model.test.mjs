import assert from "node:assert/strict";
import test from "node:test";
import {
    clampVisualEntityCount,
    animalKindForFinancialVolume,
    animalKindForEvent,
    animalKindForVisualTier,
    computePressure,
    DEFAULT_WHALE_OCEAN_VISUAL_BUDGET,
    WHALE_OCEAN_SIZE_CATEGORIES,
    WHALE_OCEAN_SPECIES,
    depthBandForKind,
    sizeCategoryForKind,
    formatCompactVolume,
    quoteCurrencyForSymbol,
    quoteNotional,
    swimDirectionForSide,
    takerSideFromBuyerIsMaker,
    visualDensity,
    visualProfile,
    VolumeEventDetector
} from "../../dist/whale-ocean/whale-ocean-model.js";

test("maps every financial animal to a supplied atlas species", () => {
    assert.equal(animalKindForVisualTier("small"), "mackerel");
    assert.equal(animalKindForVisualTier("medium"), "grouper");
    assert.equal(animalKindForVisualTier("large"), "tuna");
    assert.equal(animalKindForVisualTier("whale"), "swordfish");
    assert.equal(animalKindForEvent("shark"), "shark");
    assert.equal(animalKindForEvent("whale"), "whale");
});

test("maps financial species to five virtual depth bands without changing classification", () => {
    assert.equal(depthBandForKind("sardine"), "surface");
    assert.equal(depthBandForKind("mackerel"), "surface");
    assert.equal(depthBandForKind("snook"), "high");
    assert.equal(depthBandForKind("barracuda"), "high");
    assert.equal(depthBandForKind("tuna"), "central");
    assert.equal(depthBandForKind("swordfish"), "central");
    assert.equal(depthBandForKind("shark"), "deep");
    assert.equal(depthBandForKind("whale"), "bottom");
});

test("classifies normal aggregate volume across the eight financial species", () => {
    assert.equal(animalKindForFinancialVolume(20, 100), "sardine");
    assert.equal(animalKindForFinancialVolume(45, 100), "bluefish");
    assert.equal(animalKindForFinancialVolume(65, 100), "mackerel");
    assert.equal(animalKindForFinancialVolume(95, 100), "snook");
    assert.equal(animalKindForFinancialVolume(125, 100), "grouper");
    assert.equal(animalKindForFinancialVolume(170, 100), "barracuda");
    assert.equal(animalKindForFinancialVolume(240, 100), "tuna");
    assert.equal(animalKindForFinancialVolume(400, 100), "swordfish");
    assert.equal(animalKindForFinancialVolume(1.1, 1, "snook"), "snook", "hysteresis avoids boundary flicker");
});

test("uses Binance m semantics for aggressor side", () => {
    assert.equal(takerSideFromBuyerIsMaker(false), "buy");
    assert.equal(takerSideFromBuyerIsMaker(true), "sell");
});

test("keeps swim direction semantic across both territories", () => {
    assert.equal(swimDirectionForSide("buy"), "right");
    assert.equal(swimDirectionForSide("sell"), "left");
});

test("derives only conservative quote currencies from symbols", () => {
    assert.equal(quoteCurrencyForSymbol("BTCUSDT"), "USDT");
    assert.equal(quoteCurrencyForSymbol("ETHBTC"), "BTC");
    assert.equal(quoteCurrencyForSymbol("UNKNOWN"), null);
});

test("calculates quote notional", () => {
    assert.equal(quoteNotional(25, 4), 100);
    assert.equal(quoteNotional(-1, 4), 0);
});

test("returns no pressure when a window has no trades", () => {
    assert.deepEqual(computePressure(0, 0), { buy: null, sell: null, totalQuote: 0 });
    assert.deepEqual(computePressure(75, 25), { buy: 0.75, sell: 0.25, totalQuote: 100 });
});

test("keeps visual entity counts within the quality budget", () => {
    assert.equal(clampVisualEntityCount(999, "Low"), 12);
    assert.equal(clampVisualEntityCount(999, "Medium"), 18);
    assert.equal(clampVisualEntityCount(9_999, "High"), 24);
});

test("uses a shared, configurable visual budget", () => {
    assert.equal(DEFAULT_WHALE_OCEAN_VISUAL_BUDGET.maxVisibleAnimals, 24);
    assert.equal(DEFAULT_WHALE_OCEAN_VISUAL_BUDGET.maxLargeHighlightsPerTerritory, 2);
    assert.equal(DEFAULT_WHALE_OCEAN_VISUAL_BUDGET.windowMs, 30_000);
});

test("keeps every species body inside its CSS-pixel size band", () => {
    assert.deepEqual(WHALE_OCEAN_SIZE_CATEGORIES, {
        small: { minPx: 45, maxPx: 65 },
        medium: { minPx: 70, maxPx: 95 },
        large: { minPx: 100, maxPx: 135 },
        shark: { minPx: 145, maxPx: 185 },
        whale: { minPx: 190, maxPx: 240 }
    });
    assert.equal(sizeCategoryForKind("sardine"), "small");
    assert.equal(sizeCategoryForKind("mackerel"), "small");
    assert.equal(sizeCategoryForKind("snook"), "medium");
    assert.equal(sizeCategoryForKind("barracuda"), "medium");
    assert.equal(sizeCategoryForKind("tuna"), "large");
    assert.equal(sizeCategoryForKind("swordfish"), "large");
    assert.equal(sizeCategoryForKind("shark"), "shark");
    assert.equal(sizeCategoryForKind("whale"), "whale");

    for (const species of Object.values(WHALE_OCEAN_SPECIES)) {
        const band = WHALE_OCEAN_SIZE_CATEGORIES[sizeCategoryForKind(species.kind)];
        assert.ok(species.bodyLengthPx >= band.minPx && species.bodyLengthPx <= band.maxPx,
            `${species.kind} body ${species.bodyLengthPx}px must stay within [${band.minPx}, ${band.maxPx}]`);
    }
    const levels = Object.values(WHALE_OCEAN_SPECIES).sort((a, b) => a.financialLevel - b.financialLevel);
    for (let index = 1; index < levels.length; index++)
        assert.ok(levels[index].bodyLengthPx > levels[index - 1].bodyLengthPx, "bigger volume tiers keep bigger bodies");
});

test("density follows volume and does not create fish for an empty side", () => {
    assert.equal(visualDensity(0, 100, 0.5, "Medium"), 0);
    assert.ok(visualDensity(800, 100, 0.8, "Medium") > visualDensity(120, 100, 0.5, "Medium"));
    assert.ok(visualDensity(800, 100, 0.8, "High") <= 12);
});

test("profiles readable flow fish by relative volume", () => {
    assert.equal(visualProfile(100, 100).tier, "micro");
    assert.equal(visualProfile(180, 100).tier, "medium");
    assert.equal(visualProfile(300, 100).tier, "large");
    assert.equal(visualProfile(700, 100).tier, "whale");
    assert.equal(visualProfile(180, 100).showLabel, true);
    assert.ok(visualProfile(700, 100).durationMs > visualProfile(180, 100).durationMs);
});

test("formats compact transaction labels", () => {
    assert.equal(formatCompactVolume(5_000), "5K");
    assert.equal(formatCompactVolume(2_400_000), "2.4M");
    assert.equal(formatCompactVolume(1_250_000_000), "1.25B");
});

function batch(sequence, quote, side = "buy", isReplay = false) {
    return {
        matchId: 7,
        symbol: "BTCUSDT",
        sequence,
        eventTimeUtc: new Date(sequence * 1_000).toISOString(),
        tradeCount: 1,
        takerBuyQuote: String(side === "buy" ? quote : 0),
        takerSellQuote: String(side === "sell" ? quote : 0),
        lastPrice: "100",
        isPartial: false,
        isReplay
    };
}

test("detects symbol-relative shark and whale events", () => {
    const detector = new VolumeEventDetector({ minimumSamples: 4, cooldownMs: 1_000 });
    for (let index = 1; index <= 6; index++)
        assert.equal(detector.ingest(batch(index, 100)), null);

    const shark = detector.ingest(batch(7, 500));
    assert.equal(shark?.kind, "shark");
    assert.equal(shark?.side, "buy");

    const whale = detector.ingest(batch(9, 1_600), 9_000);
    assert.equal(whale?.kind, "whale");
});

test("suppresses replay, duplicates, and cooldown repeats", () => {
    const detector = new VolumeEventDetector({ minimumSamples: 4, cooldownMs: 10_000 });
    for (let index = 1; index <= 6; index++) detector.ingest(batch(index, 100));
    assert.equal(detector.ingest(batch(7, 900, "buy", true)), null);
    assert.equal(detector.ingest(batch(7, 900), 7_000)?.kind, "whale");
    assert.equal(detector.ingest(batch(7, 900), 7_500), null);
    assert.equal(detector.ingest(batch(9, 900), 9_000), null);
});

test("does not classify partial data as a whale and isolates symbols", () => {
    const detector = new VolumeEventDetector({ minimumSamples: 4, cooldownMs: 1_000 });
    for (let index = 1; index <= 6; index++) {
        detector.ingest(batch(index, 100));
        detector.ingest({ ...batch(index, 50), symbol: "ETHUSDT" });
    }
    assert.equal(detector.ingest({ ...batch(7, 2_000), isPartial: true }), null);
    assert.equal(detector.ingest({ ...batch(7, 70), symbol: "ETHUSDT" }), null);
    assert.equal(detector.ingest(batch(8, 1_500), 8_000)?.symbol, "BTCUSDT");
});
