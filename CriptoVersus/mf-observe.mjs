import { chromium } from 'playwright';

const MATCH_ID = process.env.MATCH_ID || '43190';
const SLUG = process.env.SLUG || 'qntusdt-vs-bnbusdt';
const ROUTE = process.env.ROUTE || 'tv'; // 'tv' => /tv/candle/, 'v2' => /candle/
const OBSERVE_MS = Number(process.env.OBSERVE_MS || 60000);
const prefix = ROUTE === 'v2' ? '/en/candle/' : '/en/tv/candle/';
const URL = `https://criptoversus.com${prefix}${MATCH_ID}/${SLUG}`;

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  const batches = [];
  const consoles = [];
  const errors = [];
  page.on('console', (m) => { consoles.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('requestfailed', (r) => { const u = r.url(); if (/money|flow|\.js|hub|market/i.test(u)) errors.push('REQFAIL ' + u + ' ' + r.failure()?.errorText); });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('NAVIGATED', URL);
  await page.waitForTimeout(6000);

  await page.evaluate(() => {
    window.__mf = [];
    document.addEventListener('money-flow-batch', (e) => {
      window.__mf.push({ at: Date.now(), symbol: e.detail.symbol, sequence: e.detail.sequence,
        tradeCount: e.detail.tradeCount, netQuote: e.detail.netQuote, lastPrice: e.detail.lastPrice, isPartial: e.detail.isPartial });
    });
    window.__eng = [];
    // capture engine reference over time
    window.__cap = setInterval(() => {
      try {
        if (window.engine && window.engine.inspect) {
          const m = window.engine.inspect().moneyFlow;
          if (m) window.__eng.push({ at: Date.now(), ...m });
        }
      } catch (e) {}
    }, 1000);
  });

  const start = Date.now();
  while (Date.now() - start < OBSERVE_MS) {
    await page.waitForTimeout(6000);
    const state = await page.evaluate(async (mid) => {
      const out = { mfEvents: window.__mf ? window.__mf.length : 0, mf: window.__mf ? window.__mf.slice(-4) : [], engSamples: (window.__eng||[]).length };
      try {
        const eng = window.engine && window.engine.inspect ? window.engine.inspect() : null;
        out.engine = eng ? eng.moneyFlow : null;
      } catch (e) { out.inspectError = String(e); }
      out.canvas = !!document.querySelector('canvas');
      out.canvasCount = document.querySelectorAll('canvas').length;
      out.cbCanvas = !!document.querySelector('.candle-battles__canvas');
      out.shell = !!document.querySelector('[data-cb-shell]');
      out.ready = document.querySelector('[data-cb-shell]')?.dataset?.ready || document.querySelector('.candle-battles__canvas') ? 'y' : 'n';
      if (!out.engine) {
        try {
          const mf = await import('/js/dist/candle-battles/money-flow.20261030b.js');
          out.buffer = mf.inspectMoneyFlowBuffer(Number(mid));
        } catch (e) { out.bufferError = String(e); }
      }
      return out;
    }, MATCH_ID).catch((e) => ({ err: String(e) }));

    console.log('T+' + Math.round((Date.now() - start) / 1000) + 's',
      'mfEvents=', state.mfEvents, 'engineBags=', state?.engine?.bags, 'signs=', state?.engine?.signs,
      'bufCount=', state?.engine?.buffer?.count ?? state?.buffer?.count,
      'canvas=', state.canvas, state.canvasCount, 'cbCanvas=', state.cbCanvas,
      'leftE=', JSON.stringify(state?.engine?.left), 'rightE=', JSON.stringify(state?.engine?.right));
    if (state.mfEvents > 0 || (state?.engine?.bags ?? 0) > 0) {
      await page.screenshot({ path: `mf-live-${MATCH_ID}-${Date.now()}.png` }).catch(() => {});
    }
    if ((state?.engine?.bags ?? 0) > 0 && state.mfEvents > 2) { console.log('SUCCESS real batches + bags'); break; }
  }

  const fin = await page.evaluate(() => ({ mf: window.__mf || [], eng: (window.__eng || []).slice(-10) }));
  console.log('TOTAL_MF_EVENTS', fin.mf.length);
  console.log('SAMPLE_MF', JSON.stringify(fin.mf.slice(0, 8), null, 1));
  console.log('ENG_SAMPLES', JSON.stringify(fin.eng.slice(0, 4), null, 1));
  console.log('CONSOLE', JSON.stringify(consoles.filter(c => /money|flow|error|warn|hub|market|fail/i.test(c)).slice(0, 25), null, 1));
  console.log('ERRORS', JSON.stringify(errors.slice(0, 25), null, 1));
  await page.screenshot({ path: `mf-final-${MATCH_ID}-${ROUTE}.png` }).catch(() => {});
  await browser.close();
})();
