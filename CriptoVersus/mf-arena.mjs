import { chromium } from 'playwright';

const MATCH_ID = process.env.MATCH_ID || '43190';
const SLUG = process.env.SLUG || 'qntusdt-vs-bnbusdt';
const OBSERVE_MS = Number(process.env.OBSERVE_MS || 60000);
const URL = `https://criptoversus.com/en/tv/candle/${MATCH_ID}/${SLUG}`;

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
  const page = await ctx.newPage();
  const consoles = [];
  page.on('console', (m) => consoles.push(`[${m.type()}] ${m.text()}`));

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('NAVIGATED', URL);
  await page.waitForTimeout(5000);

  await page.evaluate((mid) => {
    window.__mf = [];
    document.addEventListener('money-flow-batch', (e) => window.__mf.push({ s: e.detail.symbol, seq: e.detail.sequence, nc: e.detail.netQuote, lp: e.detail.lastPrice }));
    window.__snap = [];
    window.__cap = setInterval(() => {
      try {
        let bags = null, buf = null, left = null, right = null;
        if (window.engine && window.engine.inspect) { const m = window.engine.inspect().moneyFlow; if (m) { bags = m.bags; buf = m.buffer; left = m.left; right = m.right; } }
        if (bags === null) {
          import('/js/dist/candle-battles/money-flow.20261030b.js').then(mf => {
            window.__buf = mf.inspectMoneyFlowBuffer(Number(mid));
          }).catch(() => {});
        }
        window.__snap.push({ at: Date.now(), bags, bufCount: buf ? buf.count : (window.__buf ? window.__buf.count : null), leftE: left ? left.positiveEnergy : null, rightE: right ? right.positiveEnergy : null });
      } catch (e) {}
    }, 500);
  }, MATCH_ID);

  const start = Date.now();
  let shot = 0;
  while (Date.now() - start < OBSERVE_MS) {
    await page.waitForTimeout(3000);
    const st = await page.evaluate(() => {
      const out = { mfEvents: (window.__mf||[]).length, last: (window.__mf||[]).slice(-2) };
      out.snaps = (window.__snap||[]).slice(-2);
      out.buf = window.__buf || null;
      out.hasEngine = !!(window.engine && window.engine.inspect);
      out.hasGame = !!(window.game || window.__phaserGame);
      out.canvas = document.querySelectorAll('canvas').length;
      out.cbCanvas = !!document.querySelector('.candle-battles__canvas');
      return out;
    });
    console.log('T+' + Math.round((Date.now()-start)/1000) + 's', 'mf=', st.mfEvents, 'buf=', JSON.stringify(st.buf), 'engine=', st.hasEngine, 'game=', st.hasGame, 'canvas=', st.canvas, 'cbCanvas=', st.cbCanvas, 'last=', JSON.stringify(st.last));
    if (st.mfEvents > 0 && shot < 3) {
      shot++;
      // scroll to arena
      await page.evaluate(() => { const c = document.querySelector('.candle-battles__canvas, canvas'); if (c) c.scrollIntoView({ block: 'center' }); });
      await page.waitForTimeout(300);
      await page.screenshot({ path: `mf-arena-${MATCH_ID}-${Date.now()}.png` }).catch(()=>{});
    }
    if ((st.buf && st.buf.count > 5) && st.mfEvents > 10 && shot >= 2) { /* keep observing for bags */ }
  }

  const fin = await page.evaluate(() => ({ mf: (window.__mf||[]).slice(-10), snaps: (window.__snap||[]).slice(-15), buf: window.__buf }));
  console.log('FINAL_MF_EVENTS', fin.mf.length);
  console.log('BUF', JSON.stringify(fin.buf));
  console.log('SNAPS', JSON.stringify(fin.snaps, null, 0));
  await page.evaluate(() => { const c = document.querySelector('.candle-battles__canvas, canvas'); if (c) c.scrollIntoView({ block: 'center' }); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `mf-arena-final-${MATCH_ID}.png` }).catch(()=>{});
  await browser.close();
})();
