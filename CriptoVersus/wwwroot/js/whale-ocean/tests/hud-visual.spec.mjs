import { expect, test } from '@playwright/test';

const fixture = '/js/whale-ocean/tests/hud-visual.html';

async function bounds(page, selector) {
    return page.locator(selector).evaluate(element => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height, background: style.backgroundColor, borderTop: style.borderTopWidth, backdrop: style.backdropFilter };
    });
}

for (const viewport of [{ width: 1920, height: 1080 }, { width: 2560, height: 1080 }]) {
    test(`HUD desktop cutout ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
        await page.setViewportSize(viewport);
        await page.goto(fixture);

        const stage = await bounds(page, '.whale-ocean__stage');
        const root = await bounds(page, '.whale-ocean__scoreboard');
        const left = await bounds(page, '.whale-ocean__scoreboard-topcard--left');
        const center = await bounds(page, '.whale-ocean__score-control');
        const right = await bounds(page, '.whale-ocean__scoreboard-topcard--right');
        const band = await bounds(page, '.whale-ocean__scoreboard-band');
        const direction = await bounds(page, '.whale-ocean__direction');

        expect(root.background).toBe('rgba(0, 0, 0, 0)');
        expect(root.borderTop).toBe('0px');
        expect(root.backdrop).toBe('none');
        expect(left.right).toBeLessThan(right.right);
        expect(band.left).toBeLessThanOrEqual(left.left);
        expect(band.right).toBeGreaterThanOrEqual(right.right);
        expect(band.top).toBeGreaterThan(left.top);
        expect(stage.bottom - root.bottom).toBeCloseTo(12.8, 0);
        expect(root.top).toBeGreaterThanOrEqual(stage.top);
        expect(center.top).toBeGreaterThan(direction.bottom);
        expect(center.top - direction.bottom).toBeLessThanOrEqual(18);
        expect(center.bottom).toBeLessThan(band.top);
        expect(await page.locator('.whale-ocean__score-species-team--left .whale-ocean__species-grid > span').count()).toBe(5);
        expect(await page.locator('.whale-ocean__score-species-team--right .whale-ocean__species-grid > span').count()).toBe(5);
        await page.screenshot({ path: testInfo.outputPath(`whale-ocean-hud-${viewport.width}x${viewport.height}.png`) });
    });
}

test('HUD keeps the compact mobile presentation', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(fixture);
    const stage = await bounds(page, '.whale-ocean__stage');
    const root = await bounds(page, '.whale-ocean__scoreboard');
    const center = await bounds(page, '.whale-ocean__score-control');
    const direction = await bounds(page, '.whale-ocean__direction');
    expect(stage.bottom - root.bottom).toBeCloseTo(7.2, 0);
    expect(center.top).toBeGreaterThan(direction.bottom);
    expect(center.bottom).toBeLessThan(root.top);
    expect(await page.locator('.whale-ocean__species-compare').evaluate(element => getComputedStyle(element).display)).toBe('grid');
    expect(await page.locator('.whale-ocean__score-species-team--left').evaluate(element => getComputedStyle(element).display)).toBe('none');
    expect(await page.locator('.whale-ocean__scoreboard-topcard--left').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    await page.screenshot({ path: testInfo.outputPath('whale-ocean-hud-mobile-390x844.png') });
});
