import { defineConfig } from '@playwright/test';
const port=Number(process.env.CANDLE_BATTLE_TEST_PORT ?? 4287);
export default defineConfig({
 testDir:'./wwwroot/js/candle-battles/tests',testMatch:'visual.spec.mjs',workers:1,
 use:{baseURL:`http://127.0.0.1:${port}`,viewport:{width:1280,height:800},channel:'msedge',headless:true},
 webServer:{command:'node tools/candle-battles/serve-tests.mjs',url:`http://127.0.0.1:${port}/js/candle-battles/tests/visual.html`,reuseExistingServer:true},
 outputDir:'../tmp/candle-battles-visual-results',
 expect:{toHaveScreenshot:{maxDiffPixelRatio:.002,animations:'disabled'}}
});
