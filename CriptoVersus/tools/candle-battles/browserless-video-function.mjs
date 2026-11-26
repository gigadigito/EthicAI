export const candleBattleBrowserlessFunction = String.raw`module.exports = async ({ page, context, startScreencast, stopScreencast }) => {
  const { targetUrl, captureKey, width, height, durationMs } = context;
  const expected = new URL(targetUrl);
  if (expected.protocol !== 'https:' || !/^\/(?:en|pt|zh|es|fr|de|it|ja|hi)\/tv\/candle-battle\/[1-9]\d*\/match$/.test(expected.pathname) || expected.search !== '?mode=videoCapture')
    throw new Error('Invalid Candle Battle capture target');
  let initialNavigationHandled = false;
  await page.setRequestInterception(true);
  page.on('request', request => {
    const headers = {...request.headers()};
    for (const key of Object.keys(headers)) if (key.toLowerCase() === 'x-arena-capture-key') delete headers[key];
    const main = request.isNavigationRequest() && request.frame() === page.mainFrame();
    if (main && !initialNavigationHandled && request.url() === targetUrl) { initialNavigationHandled = true; headers['X-Arena-Capture-Key'] = captureKey; return request.continue({headers}); }
    if (main) return request.abort('blockedbyclient');
    return request.continue({headers});
  });
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForFunction(() => window.__candleBattleCapture?.getState?.().state === 'ready', { timeout: 30000 });
  const initial = await page.evaluate(() => window.__candleBattleCapture.getState());
  if (!initial.isFinished || initial.historyPoints < 1 || initial.matchId !== context.matchId)
    throw new Error('Candle Battle is not eligible for historical capture');
  await page.evaluate(async()=>{if(document.fonts?.ready)await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
  let screencastStarted = false;
  let final;
  try {
    startScreencast(); screencastStarted = true;
    await page.evaluate(() => window.__candleBattleCapture.start());
    await new Promise(resolve => setTimeout(resolve, durationMs));
    final = await page.evaluate(() => window.__candleBattleCapture.getState());
  } finally {
    if (screencastStarted) stopScreencast();
  }
  if (final.state !== 'completed' || final.renderProgress !== 1)
    throw new Error('Historical replay did not complete inside the capture window');
  return { initial, final };
}`;
