import { expect, test } from '@playwright/test';

const fixture = '/js/whale-ocean/tests/layout-visual.html';

async function layout(page) {
    return page.evaluate(() => {
        const rect = selector => {
            const r = document.querySelector(selector).getBoundingClientRect();
            return { top: r.top, bottom: r.bottom, height: r.height };
        };
        const canvas = document.querySelector('.whale-ocean__canvas');
        return {
            ocean: rect('.whale-ocean'),
            stage: rect('.whale-ocean__stage'),
            footer: rect('.app-footer'),
            hud: rect('.whale-ocean__scoreboard'),
            canvasHeight: canvas.clientHeight,
            viewportHeight: window.innerHeight,
            viewportWidth: window.innerWidth,
            scrollHeight: document.documentElement.scrollHeight,
            scrollWidth: document.documentElement.scrollWidth
        };
    });
}

const closeTo = (actual, expected, tolerance = 1.5) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);

for (const viewport of [{ width: 1920, height: 1080 }, { width: 2560, height: 1440 }, { width: 3440, height: 1440 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    test(`ocean fills the useful viewport and the footer flows below ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
        await page.setViewportSize(viewport);
        await page.goto(fixture);
        await page.waitForFunction(() => window.woReady === true);

        const state = await layout(page);
        // The ocean spans from the chrome down to the bottom of the useful viewport.
        expect(state.ocean.top).toBeGreaterThan(0);
        closeTo(state.ocean.bottom, state.viewportHeight);
        // The footer stays in normal flow after the ocean, below the fold.
        expect(state.footer.top).toBeGreaterThanOrEqual(state.ocean.bottom - 1);
        expect(state.scrollHeight).toBeGreaterThan(state.viewportHeight);
        // No unexpected horizontal scrollbar.
        expect(state.scrollWidth).toBeLessThanOrEqual(state.viewportWidth);
        // The bottom HUD remains inside the ocean area and visible at the fold.
        expect(state.hud.bottom).toBeLessThanOrEqual(state.stage.bottom + 1);
        expect(state.hud.bottom).toBeLessThanOrEqual(state.viewportHeight);
        // The Babylon canvas tracks the stage size.
        closeTo(state.canvasHeight, state.stage.height);
        await page.screenshot({ path: testInfo.outputPath(`whale-ocean-layout-${viewport.width}x${viewport.height}.png`) });
    });
}

test('chrome growth re-fits the ocean and the Babylon engine', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(fixture);
    await page.waitForFunction(() => window.woReady === true);

    await page.evaluate(() => { document.querySelector('.app-topbar').style.minHeight = '18rem'; });
    await page.waitForFunction(() => Math.abs(document.querySelector('.whale-ocean').getBoundingClientRect().bottom - window.innerHeight) <= 1.5);

    const state = await layout(page);
    closeTo(state.ocean.bottom, state.viewportHeight);
    expect(state.footer.top).toBeGreaterThanOrEqual(state.ocean.bottom - 1);
    expect(state.hud.bottom).toBeLessThanOrEqual(state.viewportHeight);
    const geometry = await page.evaluate(() => window.wo.geometry());
    closeTo(geometry.viewportCss.height, state.stage.height);
});

test('window resize re-fits the ocean and keeps the footer below it', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(fixture);
    await page.waitForFunction(() => window.woReady === true);

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForFunction(() => Math.abs(document.querySelector('.whale-ocean').getBoundingClientRect().bottom - window.innerHeight) <= 1.5);

    const state = await layout(page);
    closeTo(state.ocean.bottom, state.viewportHeight);
    expect(state.footer.top).toBeGreaterThanOrEqual(state.ocean.bottom - 1);
    expect(state.scrollHeight).toBeGreaterThan(state.viewportHeight);
    expect(state.scrollWidth).toBeLessThanOrEqual(state.viewportWidth);
    closeTo(state.canvasHeight, state.stage.height);
});
