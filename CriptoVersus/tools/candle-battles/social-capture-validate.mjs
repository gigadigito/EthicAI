// Real-browser validation of the Candle Battle compact social capture.
// Requires: a running CriptoVersus.Web pointed at social-capture-stub-api.mjs.
//   node tools/candle-battles/social-capture-validate.mjs [baseUrl]
// Verifies the ten acceptance checkpoints on /pt/social/candle-battle/{id}?mode=socialCompact
// and writes the exported poster PNGs next to the script output folder.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const base = (process.argv[2] ?? process.env.BASE_URL ?? 'http://localhost:5287').replace(/\/$/, '');
const output = fileURLToPath(new URL('../../tmp/social-capture-validation/', import.meta.url));
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
let failures = 0;

async function validate(label, { matchId, finished, score, tiles, viewport }) {
  const page = await browser.newPage({ viewport });
  const startedAt = Date.now();
  const logoRequests = [];
  page.on('response', response => {
    if (response.url().includes('/futurebol/team-logo/')) logoRequests.push(response.status());
  });
  await page.goto(`${base}/pt/social/candle-battle/${matchId}?mode=socialCompact`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#candle-battle-social-capture', { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('#candle-battle-social-capture')?.dataset.socialReady === 'true', null, { timeout: 60000 });
  const readyMs = Date.now() - startedAt;

  const state = await page.evaluate(() => {
    const root = document.querySelector('#candle-battle-social-capture');
    const box = element => {
      const r = element.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const rootRect = box(root);
    const arena = document.querySelector('.cbs-capture__arena');
    const canvasHost = arena.querySelector('.candle-battles__canvas');
    const canvas = canvasHost.querySelector('canvas');
    const arenaRect = box(arena);
    const canvasRect = box(canvas ?? canvasHost);
    const scoreRect = box(document.querySelector('.cbs-capture__score'));
    const bubbles = [...root.querySelectorAll('[data-cb-capture-bubble]')].map(element => ({ text: element.textContent.trim(), rect: box(element) }));
    const tileClasses = [...root.querySelectorAll('[data-cb-capture-rounds] i')].map(element => element.className);
    const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const overflow = [...root.querySelectorAll('*')]
      .map(element => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ element, rect }) => rect.width > 0 && !element.hidden
        && (rect.left < rootRect.left - 1 || rect.right > rootRect.right + 1 || rect.top < rootRect.top - 1 || rect.bottom > rootRect.bottom + 1))
      .slice(0, 6).map(({ element }) => element.className || element.tagName);
    return {
      poster: rootRect,
      regions: {
        header: box(root.querySelector('.cbs-capture__header')).height,
        stage: box(root.querySelector('.cbs-capture__stage')).height,
        footer: box(root.querySelector('.cbs-capture__footer')).height
      },
      operationalDom: root.querySelectorAll('.candle-battles__toolbar, .candle-battles__audio, .candle-battles__dashboard, .candle-battles__bottom, .candle-battles__final, .candle-battles__footer, .candle-battles__arena-status, .candle-battles__force, .candle-battles__controls').length,
      visibleControls: [...root.querySelectorAll('button, select, input')].filter(element => !element.hidden && element.offsetParent !== null).length,
      canvasInsideArena: canvasRect.left >= arenaRect.left - 1 && canvasRect.right <= arenaRect.right + 1
        && canvasRect.top >= arenaRect.top - 1 && canvasRect.bottom <= arenaRect.bottom + 1,
      bubbles: {
        count: bubbles.length,
        texts: bubbles.map(bubble => bubble.text),
        clearScore: bubbles.every(bubble => bubble.rect.bottom <= scoreRect.top + 1),
        separate: bubbles.length < 2 || !overlap(bubbles[0].rect, bubbles[1].rect)
      },
      score: document.querySelector('.cbs-capture__points').textContent.replace(/\s+/g, ' ').trim(),
      stateLine: document.querySelector('.cbs-capture__state-line').textContent.trim(),
      tiles: {
        total: tileClasses.length,
        left: tileClasses.filter(name => name === 'is-left').length,
        right: tileClasses.filter(name => name === 'is-right').length,
        draw: tileClasses.filter(name => name === 'is-draw').length,
        pending: tileClasses.filter(name => name === 'is-pending').length
      },
      matchStatus: root.dataset.matchStatus,
      captureFrame: root.dataset.captureFrame,
      arenaFrame: canvasHost.dataset.captureFrame,
      replayReady: root.dataset.replayReady,
      overflow
    };
  });

  const png = await page.locator('#candle-battle-social-capture').screenshot({ path: `${output}candle-battle-social-${label}.png` });
  const size = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  await page.close();

  const checks = [
    ['1. contêiner 1200x675', state.poster.width === 1200 && state.poster.height === 675, `${state.poster.width}x${state.poster.height}`],
    ['1b. regiões 80/515/80', Math.abs(state.regions.header - 80) < 2 && Math.abs(state.regions.stage - 515) < 2 && Math.abs(state.regions.footer - 80) < 2, JSON.stringify(state.regions)],
    ['2. nenhum controle operacional', state.operationalDom === 0 && state.visibleControls === 0, `dom=${state.operationalDom} controls=${state.visibleControls}`],
    ['3. canvas dentro da arena', state.canvasInsideArena, String(state.canvasInsideArena)],
    ['5. balões HQ presentes', state.bubbles.count === 2 && state.bubbles.texts.every(text => text.length > 0) && state.bubbles.clearScore && state.bubbles.separate, state.bubbles.texts.join(' | ')],
    ['6. placar correto', state.score.replace(/\s/g, '').includes(score.replace(/\s/g, '')), state.score],
    ['6b. quadradinhos das rodadas', state.tiles.total === 18 && state.tiles.left === tiles.left && state.tiles.right === tiles.right && state.tiles.pending === tiles.pending, JSON.stringify(state.tiles)],
    ['7. sem elementos cortados', state.overflow.length === 0, JSON.stringify(state.overflow)],
    ['8. logos carregados', logoRequests.length >= 2 && logoRequests.every(status => status === 200), logoRequests.join(',') || 'nenhum'],
    ['9. frame congelado', state.captureFrame === 'frozen' && state.arenaFrame === 'frozen', `${state.captureFrame}/${state.arenaFrame}`],
    ['9b. prontidão rápida sem replay', readyMs < 8000, `${readyMs}ms`],
    ['10. screenshot 1200x675', size.width === 1200 && size.height === 675, `${size.width}x${size.height}`],
    [`status ${finished ? 'finalizada' : 'em andamento'}`, state.matchStatus === (finished ? 'finished' : 'in_progress') && state.replayReady === 'true', `${state.matchStatus}/${state.replayReady}`]
  ];
  console.log(`\n=== ${label} ===`);
  for (const [name, ok, detail] of checks) {
    if (!ok) failures++;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} (${detail})`);
  }
  console.log(`state line: ${state.stateLine}`);
}

await validate('ongoing-desktop', { matchId: 90, finished: false, score: '10 × 4', tiles: { left: 10, right: 4, pending: 4 }, viewport: { width: 1440, height: 900 } });
await validate('finished-desktop', { matchId: 91, finished: true, score: '12 × 6', tiles: { left: 12, right: 6, pending: 0 }, viewport: { width: 1440, height: 900 } });
await validate('ongoing-mobile', { matchId: 90, finished: false, score: '10 × 4', tiles: { left: 10, right: 4, pending: 4 }, viewport: { width: 390, height: 844 } });

await browser.close();
console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`);
process.exit(failures === 0 ? 0 : 1);
