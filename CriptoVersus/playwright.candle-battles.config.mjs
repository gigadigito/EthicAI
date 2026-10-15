import { defineConfig } from '@playwright/test';
export default defineConfig({
 testDir:'./wwwroot/js/candle-battles/tests',testMatch:'visual.spec.mjs',workers:1,
 use:{baseURL:'http://127.0.0.1:4187',viewport:{width:1280,height:800},channel:'msedge',headless:true},
 webServer:{command:'node tools/candle-battles/serve-tests.mjs',url:'http://127.0.0.1:4187/js/candle-battles/tests/visual.html',reuseExistingServer:false},
 outputDir:'../tmp/candle-battles-visual-results',
 expect:{toHaveScreenshot:{maxDiffPixelRatio:.002,animations:'disabled'}}
});
