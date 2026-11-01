import { chromium } from 'playwright';

const MATCH_ID = process.env.MATCH_ID || '43190';
const SLUG = process.env.SLUG || 'qntusdt-vs-bnbusdt';
const OBSERVE_MS = Number(process.env.OBSERVE_MS || 60000);
const URL = `https://criptoversus.com/en/tv/candle/${MATCH_ID}/${SLUG}`;

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  await page.evaluate(() => {
    window.__mf = 0;
    document.addEventListener('money-flow-batch', () => { window.__mf++; });
  });

  const start = Date.now();
  let n = 0;
  while (Date.now() - start < OBSERVE_MS) {
    await page.waitForTimeout(700);
    n++;
    // scroll canvas into view and screenshot just the arena canvas element
    const box = await page.evaluate(() => {
      const c = document.querySelector('.candle-battles__canvas');
      if (c) { c.scrollIntoView({ block: 'center' }); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }
      return null;
    });
    const mf = await page.evaluate(() => window.__mf);
    if (box && n % 2 === 0 && mf > 0) {
      // clip the arena canvas region
      await page.screenshot({ path: `bag-${MATCH_ID}-${n}.png`, clip: { x: Math.max(0,box.x), y: Math.max(0,box.y), width: Math.min(1280,box.w), height: Math.min(1000,box.h) } }).catch(()=>{});
    }
    if (n % 8 === 0) console.log('T+' + Math.round((Date.now()-start)/1000) + 's mfEvents=', mf);
  }
  console.log('DONE mfEvents=', await page.evaluate(() => window.__mf));
  await browser.close();
})();
