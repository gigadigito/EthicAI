import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const url = '/js/whale-ocean/tests/visual.html';
const largeKinds = new Set(['tuna', 'swordfish', 'shark', 'whale']);
const symbols = ['INITUSDT', 'ONEUSDT'];

const batch = (symbol, sequence, buy, sell) => ({
    matchId: 7,
    symbol,
    sequence,
    eventTimeUtc: new Date().toISOString(),
    tradeCount: 4,
    takerBuyQuote: String(buy),
    takerSellQuote: String(sell),
    lastPrice: '1.234',
    isPartial: false,
    isReplay: false
});

const feed = async (page, symbol, sequence, buy, sell) =>
    page.evaluate(payload => window.wo.receive(payload), batch(symbol, sequence, buy, sell));

const diagnostics = page => page.evaluate(() => window.wo.diagnostics());

async function visibleLabels(page) {
    return page.$$eval('.whale-ocean__volume-label', elements => elements.map(element => {
        const style = getComputedStyle(element);
        return {
            text: element.textContent ?? '',
            fontSize: parseFloat(style.fontSize),
            color: style.color,
            borderColor: style.borderColor,
            borderWidth: style.borderWidth,
            background: style.backgroundColor,
            opacity: Number(style.opacity),
            display: style.display,
            transform: style.transform
        };
    }).filter(label => label.display !== 'none'));
}

function assertLabelLegibility(labels) {
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
        expect(label.fontSize, `label "${label.text}" font size`).toBeGreaterThanOrEqual(14);
        expect(label.fontSize, `label "${label.text}" font size`).toBeLessThanOrEqual(16);
        expect(label.background, `label "${label.text}" background`).toBe('rgba(0, 0, 0, 0)');
        expect(label.borderWidth, `label "${label.text}" keeps its semantic border`).toBe('1px');
        expect(label.borderColor, `label "${label.text}" border remains visible`).not.toBe('rgba(0, 0, 0, 0)');
        expect(label.color, `label "${label.text}" keeps white text`).toBe('rgb(245, 255, 255)');
        expect(label.opacity, `label "${label.text}" opacity`).toBeGreaterThanOrEqual(0.85);
        expect(label.text, 'volume label keeps real volume and quote currency').toMatch(/\d/);
        expect(label.text).toContain('USDT');
        expect(label.transform).not.toBe('none');
    }
}

function assertSizeBands(rows) {
    const checked = rows.filter(row => row.visible && row.inViewport && row.opacity >= 0.55 && row.projectedBodyCssWidth > 0);
    expect(checked.length).toBeGreaterThan(0);
    for (const row of checked) {
        expect(row.projectedBodyCssWidth, `${row.id} (${row.kind}) minimum body width`)
            .toBeGreaterThanOrEqual(row.minBodyCssWidth);
        expect(row.projectedBodyCssWidth, `${row.id} (${row.kind}) maximum body width`)
            .toBeLessThanOrEqual(row.maxBodyCssWidth * 1.3);
    }
    return checked;
}

function assertDepthBands(rows, geometry, label) {
    expect(geometry.depthBands, `${label}: five depth bands`).toHaveLength(5);
    for (let index = 1; index < geometry.depthBands.length; index++)
        expect(geometry.depthBands[index].screen.top, `${label}: bands are contiguous`).toBeCloseTo(geometry.depthBands[index - 1].screen.bottom, 3);

    for (const row of rows.filter(row => row.visible && row.inViewport && row.opacity >= 0.55 && row.projectedCssY >= 0)) {
        const band = geometry.depthBands.find(candidate => candidate.name === row.depthBand);
        expect(band, `${label}: ${row.kind} has a mapped depth band`).toBeTruthy();
        expect(row.projectedCssY, `${label}: ${row.kind} stays below its band top`).toBeGreaterThanOrEqual(band.screen.top - 1);
        expect(row.projectedCssY, `${label}: ${row.kind} stays above its band bottom`).toBeLessThanOrEqual(band.screen.bottom + 1);
    }
}

function assertBudget(rows, maxAnimals) {
    expect(rows.length).toBeLessThanOrEqual(maxAnimals);
    for (const symbol of symbols) {
        const large = rows.filter(row => row.symbol === symbol && largeKinds.has(row.kind));
        expect(large.length, `${symbol} keeps at most two large animals`).toBeLessThanOrEqual(2);
    }
}

test('bundle version on the published page matches the built runtime', async () => {
    const runtimePath = fileURLToPath(new URL('../../dist/whale-ocean/whale-ocean-runtime.js', import.meta.url));
    const runtime = await readFile(runtimePath, 'utf8');
    const version = runtime.match(/SPRITE_ASSET_VERSION = "([^"]+)"/)?.[1];
    expect(version).toBeTruthy();
    for (const page of ['WhaleOceanPage.razor', 'WhaleOceanDiagnosticsPage.razor']) {
        const source = await readFile(fileURLToPath(new URL(`../../../../Components/Pages/Internet/${page}`, import.meta.url)), 'utf8');
        expect(source, `${page} imports the built bundle version`).toContain(`whale-ocean-bootstrap.js?v=${version}`);
    }
});

const dividerMetrics = page => page.evaluate(() => {
    const divider = document.querySelector('[data-whale-ocean="territory-divider"]');
    const canvas = document.querySelector('.whale-ocean__canvas');
    const style = getComputedStyle(divider);
    const dRect = divider.getBoundingClientRect();
    const cRect = canvas.getBoundingClientRect();
    return {
        centerDelta: Math.abs((dRect.left + dRect.width / 2) - (cRect.left + cRect.width / 2)),
        width: dRect.width,
        topGap: dRect.top - cRect.top,
        bottomGap: cRect.bottom - dRect.bottom,
        pointerEvents: style.pointerEvents,
        background: style.backgroundImage,
        zIndex: Number(style.zIndex)
    };
});

const geometryMetrics = page => page.evaluate(() => window.wo.geometry());

function assertGeometry(geometry, label) {
    expect(Number.isFinite(geometry.visibleWorld.center), `${label}: frustum center is finite`).toBe(true);
    expect(geometry.territories.left.screen.minX).toBe(0);
    expect(geometry.territories.left.screen.maxX).toBeCloseTo(geometry.viewportCss.width / 2, 3);
    expect(geometry.territories.right.screen.minX).toBeCloseTo(geometry.viewportCss.width / 2, 3);
    expect(geometry.territories.right.screen.maxX).toBeCloseTo(geometry.viewportCss.width, 3);
    expect(geometry.territories.left.world.maxX).toBeCloseTo(geometry.visibleWorld.center, 2);
    expect(geometry.territories.right.world.minX).toBeCloseTo(geometry.visibleWorld.center, 2);
}

function assertDivider(metrics, label) {
    expect(metrics.centerDelta, `${label}: divider centered on the canvas area`).toBeLessThanOrEqual(1.5);
    expect(metrics.width, `${label}: divider width`).toBeGreaterThanOrEqual(1);
    expect(metrics.width, `${label}: divider width`).toBeLessThanOrEqual(3);
    expect(metrics.topGap, `${label}: divider starts at the top of the ocean`).toBeGreaterThanOrEqual(-1);
    expect(metrics.bottomGap, `${label}: divider reaches the bottom of the ocean`).toBeGreaterThanOrEqual(-1);
    expect(metrics.pointerEvents, `${label}: divider never intercepts pointer events`).toBe('none');
    expect(metrics.background, `${label}: divider keeps its dashed gradient`).toContain('repeating-linear-gradient');
    expect(metrics.zIndex, `${label}: divider stays below the HUD cards`).toBeLessThan(3);
}

test('territory divider stays centered and coin logos stay in their cards', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const browserErrors = [];
    page.on('pageerror', error => browserErrors.push(String(error)));
    page.on('console', message => {
        if (message.type() === 'error') browserErrors.push(message.text());
    });
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 3440, height: 1440 }, { width: 5120, height: 1440 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        await page.goto(url);
        await page.waitForFunction(() => window.woReady === true);
        await assertDivider(await dividerMetrics(page), `${viewport.width}x${viewport.height}`);
        assertGeometry(await geometryMetrics(page), `${viewport.width}x${viewport.height}`);
        await page.screenshot({ path: testInfo.outputPath(`whale-ocean-divider-${viewport.width}x${viewport.height}.png`) });
    }

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(250);
    assertDivider(await dividerMetrics(page), 'after window resize');
    await page.setViewportSize({ width: 3440, height: 1440 });
    await page.waitForTimeout(250);
    assertDivider(await dividerMetrics(page), 'after ultrawide resize');
    assertGeometry(await geometryMetrics(page), 'after ultrawide resize');

    const readLogos = () => page.$$eval('.whale-ocean__territory .whale-ocean__coin', coins => coins.map(coin => {
        const image = coin.querySelector('.whale-ocean__coin-logo');
        const fallback = coin.querySelector('.whale-ocean__coin-fallback');
        const imageStyle = image ? getComputedStyle(image) : null;
        return {
            hasImage: Boolean(image),
            imageDisplay: imageStyle?.display ?? 'none',
            objectFit: imageStyle?.objectFit ?? '',
            width: image?.getBoundingClientRect().width ?? 0,
            fallbackDisplay: fallback ? getComputedStyle(fallback).display : 'missing',
            symbol: coin.querySelector('strong')?.textContent ?? ''
        };
    }));
    const assertLogos = (logos, maximumWidth, label) => {
        expect(logos.length, `${label}: two coin cards`).toBe(2);
        for (const logo of logos) {
        expect(logo.hasImage, `logo image for ${logo.symbol}`).toBe(true);
        expect(logo.imageDisplay, `logo image visible for ${logo.symbol}`).not.toBe('none');
        expect(logo.objectFit, `logo aspect ratio preserved for ${logo.symbol}`).toBe('contain');
        expect(logo.width, `logo size for ${logo.symbol}`).toBeGreaterThan(16);
        expect(logo.width, `logo size for ${logo.symbol}`).toBeLessThanOrEqual(maximumWidth);
        expect(logo.symbol, 'coin row keeps the asset symbol').toMatch(/USDT$/);
        }
    };
    assertLogos(await readLogos(), 64, 'desktop');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    assertLogos(await readLogos(), 40, 'mobile');

    await page.setViewportSize({ width: 3440, height: 1440 });
    await page.waitForTimeout(250);
    for (const logo of await readLogos()) {
        expect(logo.width, `ultrawide logo size for ${logo.symbol}`).toBeLessThanOrEqual(64);
    }
    expect(browserErrors, 'no browser console errors while rendering the ocean, the divider and the coin logos').toEqual([]);
});

test('desktop: readable animals, legible volumes and full traversals', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1400, height: 820 });
    await page.goto(url);
    await page.waitForFunction(() => window.woReady === true);

    let sequenceA = 0;
    let sequenceB = 0;
    for (let index = 0; index < 14; index++) {
        await feed(page, 'INITUSDT', ++sequenceA, 900, 300);
        await feed(page, 'ONEUSDT', ++sequenceB, 300, 900);
        await page.waitForTimeout(120);
    }
    await expect.poll(async () => (await diagnostics(page)).length, { timeout: 15_000 }).toBeGreaterThan(2);

    await expect.poll(async () => (await geometryMetrics(page)).verticalOccupancy.coveragePercent, { timeout: 15_000 }).toBeGreaterThanOrEqual(85);

    const directions = await page.$$eval('.whale-ocean__direction', elements => elements.map(element => element.textContent ?? ''));
    for (const text of directions) {
        expect(text).toContain('← SELL');
        expect(text).toContain('BUY →');
    }

    const seenCategories = new Set();
    const recordCategories = async () => {
        for (const row of await diagnostics(page))
            if (row.visible && row.inViewport && row.opacity >= 0.55) seenCategories.add(row.category);
    };

    const geometry = await geometryMetrics(page);
    assertDepthBands(await diagnostics(page), geometry, 'desktop');
    const leftTerritory = geometry.territories.left.screen;
    const before = new Set((await diagnostics(page)).map(row => row.id));
    await feed(page, 'INITUSDT', ++sequenceA, 1_600, 0);
    await feed(page, 'INITUSDT', ++sequenceA, 0, 1_600);

    const samples = new Map();
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
        for (const row of await diagnostics(page)) {
            if (before.has(row.id) || !row.id.startsWith('flow-') || row.symbol !== 'INITUSDT') continue;
            const list = samples.get(row.id) ?? [];
            list.push(row.projectedCssX);
            samples.set(row.id, list);
        }
        const complete = [...samples.values()].filter(xs => xs.length >= 25
            && Math.min(...xs) < leftTerritory.minX
            && Math.max(...xs) > leftTerritory.minX + (leftTerritory.maxX - leftTerritory.minX) * 0.75);
        const directions = new Set(complete.map(xs => xs[xs.length - 1] > xs[0] ? 'buy' : 'sell'));
        if (directions.has('buy') && directions.has('sell')) break;
        await page.waitForTimeout(250);
    }

    const traversals = [...samples.entries()].filter(([, xs]) => xs.length >= 25
        && Math.min(...xs) < leftTerritory.minX
        && Math.max(...xs) > leftTerritory.minX + (leftTerritory.maxX - leftTerritory.minX) * 0.75);
    expect(traversals.length, 'at least one full transit is observable').toBeGreaterThan(0);
    let sawBuy = false;
    let sawSell = false;
    for (const [id, xs] of traversals) {
        expect(Math.min(...xs), `${id} enters outside the territory bounds`).toBeLessThan(leftTerritory.minX);
        expect(Math.max(...xs), `${id} reaches the final quarter of its territory`).toBeGreaterThan(leftTerritory.minX + (leftTerritory.maxX - leftTerritory.minX) * 0.75);
        const increasing = xs[xs.length - 1] > xs[0];
        for (let index = 1; index < xs.length; index++) {
            if (increasing)
                expect(xs[index], `${id} buy transit moves continuously left to right`).toBeGreaterThanOrEqual(xs[index - 1]);
            else
                expect(xs[index], `${id} sell transit moves continuously right to left`).toBeLessThanOrEqual(xs[index - 1]);
        }
        if (increasing) sawBuy = true; else sawSell = true;
    }
    expect(sawBuy, 'a buy traversal crosses the territory from left to right').toBe(true);
    expect(sawSell, 'a sell traversal crosses the territory from right to left').toBe(true);
    await recordCategories();

    await feed(page, 'INITUSDT', ++sequenceA, 4_200, 0);
    await expect.poll(async () => {
        const rows = await diagnostics(page);
        return rows.some(row => row.kind === 'swordfish' && row.visible);
    }, { timeout: 25_000 }).toBe(true);
    await recordCategories();

    await page.screenshot({ path: testInfo.outputPath('whale-ocean-desktop.png') });

    const recordCategory = category => expect.poll(async () => {
        for (const row of await diagnostics(page))
            if (row.category === category && row.visible && row.inViewport && row.opacity >= 0.55) {
                seenCategories.add(category);
                return true;
            }
        return false;
    }, { timeout: 35_000 }).toBe(true);

    await feed(page, 'ONEUSDT', ++sequenceB, 0, 6_000);
    await recordCategory('shark');

    await feed(page, 'INITUSDT', ++sequenceA, 13_000, 0);
    await recordCategory('whale');

    const rows = await diagnostics(page);
    const checked = assertSizeBands(rows);
    assertBudget(rows, 24);
    const categories = new Set([...seenCategories, ...checked.map(row => row.category)]);
    for (const category of ['small', 'medium', 'large', 'shark', 'whale'])
        expect(categories, `category ${category} is readable on screen`).toContain(category);

    assertLabelLegibility(await visibleLabels(page));
    const occupancy = (await geometryMetrics(page)).verticalOccupancy;
    if (occupancy.animalCount >= 5) {
        expect(occupancy.bandCounts.filter(count => count > 0).length).toBeGreaterThanOrEqual(4);
        expect(occupancy.coveragePercent).toBeGreaterThanOrEqual(85);
    }
    await page.screenshot({ path: testInfo.outputPath('whale-ocean-desktop-events.png') });
});

test('mobile: readable animals, legible volumes and the 12-animal cap', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url);
    await page.waitForFunction(() => window.woReady === true);

    let sequenceA = 0;
    let sequenceB = 0;
    for (let index = 0; index < 12; index++) {
        await feed(page, 'INITUSDT', ++sequenceA, 900, 300);
        await feed(page, 'ONEUSDT', ++sequenceB, 300, 900);
        await page.waitForTimeout(120);
    }
    await feed(page, 'INITUSDT', ++sequenceA, 1_600, 0);
    await expect.poll(async () => (await diagnostics(page)).length, { timeout: 15_000 }).toBeGreaterThan(1);

    await page.waitForTimeout(1_500);
    const rows = await diagnostics(page);
    assertSizeBands(rows);
    assertDepthBands(rows, await geometryMetrics(page), 'mobile');
    const mobileOccupancy = (await geometryMetrics(page)).verticalOccupancy;
    if (mobileOccupancy.animalCount >= 5)
        expect(mobileOccupancy.coveragePercent).toBeGreaterThanOrEqual(85);
    assertBudget(rows, 12);
    assertLabelLegibility(await visibleLabels(page));
    await page.screenshot({ path: testInfo.outputPath('whale-ocean-mobile.png') });
});
