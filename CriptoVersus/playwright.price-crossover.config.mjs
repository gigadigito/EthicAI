import { defineConfig } from '@playwright/test';
export default defineConfig({
    testDir: './tools/price-crossover/tests',
    testMatch: 'capture.spec.mjs',
    workers: 1,
    timeout: 90000,
    use: {
        baseURL: 'http://127.0.0.1:4288',
        viewport: { width: 1200, height: 900 },
        channel: 'msedge',
        headless: true
    },
    webServer: {
        command: 'node tools/price-crossover/serve.mjs',
        url: 'http://127.0.0.1:4288/healthz',
        reuseExistingServer: true
    },
    outputDir: '../tmp/price-crossover-social-results'
});
