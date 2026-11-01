import { chromium } from 'playwright';

const MATCH_ID = process.env.MATCH_ID || '43197';
const SLUG = process.env.SLUG || 'stxusdt-vs-opusdt';
const URL = `https://criptoversus.com/en/tv/candle/${MATCH_ID}/${SLUG}`;
const ROUNDS = Number(process.env.ROUNDS || 4);
const PER_ROUND_MS = Number(process.env.PER_ROUND_MS || 30000);

async function analyzeFrame(page) {
  return await page.evaluate(() => {
    const c = document.querySelector('.candle-battles__canvas canvas') || document.querySelector('canvas');
    if (!c) return null;
    const off = document.createElement('canvas');
    off.width = c.width; off.height = c.height;
    const g = off.getContext('2d', { willReadFrequently: true });
    g.drawImage(c, 0, 0);
    const d = g.getImageData(0, 0, off.width, off.height).data;
    let gold = 0, green = 0, red = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], gg = d[i+1], b = d[i+2];
      if (r > 150 && gg > 110 && gg < 215 && b < 130 && r > b + 45 && gg > b + 25) gold++;
      if (r > 230 && gg > 205 && b > 135 && b < 215) gold++;
      if (gg > 195 && r > 125 && r < 215 && b < 145) green++;
      if (r > 215 && gg < 155 && b < 155 && gg > 55) red++;
    }
    return { gold, green, red };
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  let totalMf = 0, bestGold = 0, goldFrames = 0, samples = 0;

  for (let round = 1; round <= ROUNDS; round++) {
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);
    await page.evaluate(() => { window.__mf = 0; document.addEventListener('money-flow-batch', () => { window.__mf++; }); });
    const start = Date.now();
    while (Date.now() - start < PER_ROUND_MS) {
      await page.waitForTimeout(400);
      const mf = await page.evaluate(() => window.__mf);
      totalMf = Math.max(totalMf, mf);
      const a = await analyzeFrame(page);
      samples++;
      if (a) {
        if (a.gold > bestGold) bestGold = a.gold;
        if (a.gold > 250) {
          goldFrames++;
          await page.screenshot({ path: `gold-${MATCH_ID}-r${round}-${samples}.png` }).catch(()=>{});
        }
      }
      if (samples % 15 === 0) console.log(`r${round} T+${Math.round((Date.now()-start)/1000)}s mf=${mf} gold=${a&&a.gold} green=${a&&a.green} red=${a&&a.red} bestGold=${bestGold}`);
    }
    const mf = await page.evaluate(() => window.__mf);
    console.log(`ROUND ${round} done: mfEvents=${mf}`);
    await page.screenshot({ path: `shot-${MATCH_ID}-r${round}.png` }).catch(()=>{});
    await page.close();
    if (mf > 5 && goldFrames > 0) { console.log('SUCCESS: real money-flow batches + gold bag frames'); break; }
  }
  console.log('TOTAL maxMf=', totalMf, 'bestGold=', bestGold, 'goldFrames=', goldFrames, 'samples=', samples);
  await browser.close();
})();
