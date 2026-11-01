import { chromium } from 'playwright';

const MATCH_ID = process.env.MATCH_ID || '43190';
const SLUG = process.env.SLUG || 'qntusdt-vs-bnbusdt';
const OBSERVE_MS = Number(process.env.OBSERVE_MS || 45000);
const URL = `https://criptoversus.com/en/tv/candle/${MATCH_ID}/${SLUG}`;

// Money bag gold colors (from money-flow-visual.ts drawBag): 0xd9b356, 0xb98f4a, 0xffe9a8
function goldScore(data) {
  let gold = 0, sign = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i+1], b = data[i+2];
    // gold: high R, mid G, low B, warm
    if (r > 150 && g > 110 && g < 210 && b < 130 && r > b + 40 && g > b + 20) gold++;
    // bright rim 0xffe9a8
    if (r > 230 && g > 210 && b > 140 && b < 210) gold++;
    // green '+' sign 0xb9ff69
    if (g > 200 && r > 130 && r < 210 && b < 140) sign++;
    // red '-' sign 0xff7777
    if (r > 220 && g < 150 && b < 150 && g > 60) sign++;
  }
  return { gold, sign };
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  await page.evaluate(() => { window.__mf = 0; document.addEventListener('money-flow-batch', () => { window.__mf++; }); });

  // Use a canvas readback loop inside the page for speed: sample the Phaser canvas pixels
  const start = Date.now();
  let best = { gold: 0 }, n = 0;
  while (Date.now() - start < OBSERVE_MS) {
    await page.waitForTimeout(250);
    n++;
    const res = await page.evaluate(() => {
      const c = document.querySelector('.candle-battles__canvas canvas') || document.querySelector('canvas');
      if (!c) return null;
      try {
        const off = document.createElement('canvas');
        off.width = c.width; off.height = c.height;
        const g = off.getContext('2d');
        g.drawImage(c, 0, 0);
        const d = g.getImageData(0, 0, off.width, off.height).data;
        let gold = 0, sign = 0;
        for (let i = 0; i < d.length; i += 16) { // sample every 4th pixel
          const r = d[i], gg = d[i+1], b = d[i+2];
          if (r > 150 && gg > 110 && gg < 210 && b < 130 && r > b + 40 && gg > b + 20) gold++;
          if (r > 230 && gg > 210 && b > 140 && b < 210) gold++;
          if (gg > 200 && r > 130 && r < 210 && b < 140) sign++;
          if (r > 220 && gg < 150 && b < 150 && gg > 60) sign++;
        }
        return { gold, sign, w: off.width, h: off.height };
      } catch (e) { return { err: String(e) }; }
    });
    const mf = await page.evaluate(() => window.__mf);
    if (res && res.gold > best.gold) best = res;
    if (n % 12 === 0) console.log('T+' + Math.round((Date.now()-start)/1000) + 's mf=', mf, 'gold=', res && res.gold, 'sign=', res && res.sign, 'bestGold=', best.gold);
    // save frame when gold pixels (money bags) detected
    if (res && res.gold > 200) {
      await page.screenshot({ path: `goldbag-${MATCH_ID}-${n}.png` }).catch(()=>{});
    }
  }
  console.log('DONE mf=', await page.evaluate(() => window.__mf), 'bestGold=', best.gold, 'bestSign=', best.sign);
  await browser.close();
})();
