import { chromium } from 'playwright';
import { readdirSync, unlinkSync } from 'fs';

const MATCH_ID = process.env.MATCH_ID || '43190';
const SLUG = process.env.SLUG || 'qntusdt-vs-bnbusdt';
const URL = `https://criptoversus.com/en/tv/candle/${MATCH_ID}/${SLUG}`;
const PER_MS = Number(process.env.PER_MS || 40000);
const ROUNDS = Number(process.env.ROUNDS || 3);

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  let maxSeq = 0, maxCount = 0, symCount = 0, shotN = 0;

  for (let round = 1; round <= ROUNDS; round++) {
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(6000);
    const start = Date.now();
    while (Date.now() - start < PER_MS) {
      await page.waitForTimeout(1500);
      const buf = await page.evaluate(async (mid) => {
        try {
          const mf = await import('/js/dist/candle-battles/money-flow.20261030b.js');
          const b = mf.inspectMoneyFlowBuffer(Number(mid));
          return b;
        } catch (e) { return { err: String(e) }; }
      }, MATCH_ID);
      if (buf && buf.latestSequence) {
        maxSeq = Math.max(maxSeq, buf.latestSequence);
        maxCount = Math.max(maxCount, buf.count);
        symCount = Math.max(symCount, buf.symbolCount);
      }
      shotN++;
      await page.screenshot({ path: `sc-${MATCH_ID}-${round}-${shotN}.png` }).catch(()=>{});
      if (shotN % 8 === 0) console.log(`r${round} T+${Math.round((Date.now()-start)/1000)}s buf=`, JSON.stringify(buf));
    }
    console.log(`ROUND ${round} maxSeq=${maxSeq} maxCount=${maxCount} symCount=${symCount}`);
    await page.close();
    if (maxSeq > 50 && symCount >= 2) break;
  }
  console.log('SUMMARY maxSeq=', maxSeq, 'maxBufCount=', maxCount, 'symbolCount=', symCount);
  await browser.close();
})();
