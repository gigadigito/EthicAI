import { defineConfig } from '@playwright/test';
const port = Number(process.env.WHALE_OCEAN_TEST_PORT ?? 4289);
export default defineConfig({
    testDir: './wwwroot/js/whale-ocean/tests', testMatch: 'visual.spec.mjs', workers: 1,
    use: { baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1400, height: 820 }, channel: 'msedge', headless: true, video: 'on' },
    webServer: { command: 'node tools/whale-ocean/serve-tests.mjs', url: `http://127.0.0.1:${port}/js/whale-ocean/tests/visual.html`, reuseExistingServer: true },
    outputDir: '../tmp/whale-ocean-visual-results',
    expect: { toHaveScreenshot: { maxDiffPixelRatio: .002, animations: 'disabled' } }
});
