import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const url = '/js/whale-ocean/tests/visual.html';
const largeKinds = new Set(['tuna', 'swordfish', 'shark', 'whale']);
const territoryBounds = { INITUSDT: { min: -16.1, max: -1.1 }, ONEUSDT: { min: 1.1, max: 16.1 } };

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
        expect(label.background, `label "${label.text}" chip background`).toMatch(/^rgba?\(/);
        expect(label.background, `label "${label.text}" chip background`).not.toBe('rgba(0, 0, 0, 0)');
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

function assertBudget(rows, maxAnimals) {
    expect(rows.length).toBeLessThanOrEqual(maxAnimals);
    for (const symbol of Object.keys(territoryBounds)) {
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

    const before = new Set((await diagnostics(page)).map(row => row.id));
    await feed(page, 'INITUSDT', ++sequenceA, 1_600, 0);
    await feed(page, 'INITUSDT', ++sequenceA, 0, 1_600);

    const samples = new Map();
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
        for (const row of await diagnostics(page)) {
            if (before.has(row.id) || !row.id.startsWith('flow-') || row.symbol !== 'INITUSDT') continue;
            const list = samples.get(row.id) ?? [];
            list.push(row.worldPositionX);
            samples.set(row.id, list);
        }
        const complete = [...samples.values()].filter(xs => xs.length >= 25
            && Math.min(...xs) < territoryBounds.INITUSDT.min
            && Math.max(...xs) > territoryBounds.INITUSDT.max);
        const directions = new Set(complete.map(xs => xs[xs.length - 1] > xs[0] ? 'buy' : 'sell'));
        if (directions.has('buy') && directions.has('sell')) break;
        await page.waitForTimeout(250);
    }

    const traversals = [...samples.entries()].filter(([, xs]) => xs.length >= 25
        && Math.min(...xs) < territoryBounds.INITUSDT.min
        && Math.max(...xs) > territoryBounds.INITUSDT.max);
    expect(traversals.length, 'at least one full transit is observable').toBeGreaterThan(0);
    let sawBuy = false;
    let sawSell = false;
    for (const [id, xs] of traversals) {
        expect(Math.min(...xs), `${id} enters outside the territory bounds`).toBeLessThan(territoryBounds.INITUSDT.min);
        expect(Math.max(...xs), `${id} exits outside the territory bounds`).toBeGreaterThan(territoryBounds.INITUSDT.max);
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
    assertBudget(rows, 12);
    assertLabelLegibility(await visibleLabels(page));
    await page.screenshot({ path: testInfo.outputPath('whale-ocean-mobile.png') });
});
