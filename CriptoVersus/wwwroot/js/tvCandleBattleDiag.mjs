// tvCandleBattleDiag.mjs — diagnóstico probatório 2026-08-30-v3
// NÃO altera layout/CSS. Apenas lê DOM para comparar /partida vs /tv/match
// Uso no console do browser:
//   import('/js/tvCandleBattleDiag.mjs').then(m=>m.runDiag())
// ou copie a função runDiag para console

export function runDiag(limit = 5) {
  const root = document.querySelector('[data-candle-render-version]');
  if (!root) { console.error('[DIAG] Root not found'); return; }
  const version = root?.getAttribute('data-candle-render-version') ?? 'MISSING';
  const allVersions = [...document.querySelectorAll('[data-candle-render-version]')].map(e=>e.getAttribute('data-candle-render-version'));
  const uniqueVersions = [...new Set(allVersions)];

  const svg = root.querySelector('.tv-candle-battle__svg');
  const plotShell = root.querySelector('.tv-candle-battle-card__plot-shell');
  if (!svg) { console.error('[DIAG] SVG not found'); return; }
  if (!plotShell) { console.error('[DIAG] plot-shell not found'); return; }

  function measure(el, label) {
    if (!el) return { label, missing: true };
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      label,
      boundingClientRect: { width: r.width, height: r.height, top: r.top, bottom: r.bottom },
      computedStyle: {
        display: cs.display,
        gridTemplateRows: cs.gridTemplateRows,
        height: cs.height,
        minHeight: cs.minHeight,
        maxHeight: cs.maxHeight,
        overflow: cs.overflow,
        padding: cs.padding,
        gap: cs.gap,
        containerType: cs.containerType,
      },
    };
  }

  const svgRect = svg.getBoundingClientRect();
  const svgCS = getComputedStyle(svg);

  const compact = root.querySelector('.tv-candle-battle__compact');
  const card = root.querySelector('.tv-candle-battle-card');
  const battleHead = root.querySelector('.tv-candle-battle-card__battle-head');
  const chartCaption = root.querySelector('.tv-candle-battle__chart-caption');

  const header = {
    url: location.href,
    version,
    uniqueVersions,
    measuredWidth: root.getAttribute('data-measured-width'),
    measuredHeight: root.getAttribute('data-measured-height'),
    logicalHeight: root.getAttribute('data-logical-height'),
    dynamicChartBottom: root.getAttribute('data-dynamic-chart-bottom'),
    chain: {
      root: measure(root, 'tv-candle-battle'),
      compact: measure(compact, '__compact'),
      card: measure(card, 'card'),
      battleHead: measure(battleHead, 'battle-head'),
      plotShell: measure(plotShell, 'plot-shell'),
      svg: {
        viewBox: svg.getAttribute('viewBox'),
        boundingClientRect: { width: svgRect.width, height: svgRect.height },
        computedStyle: { width: svgCS.width, height: svgCS.height, display: svgCS.display },
      },
      chartCaption: measure(chartCaption, 'chart-caption'),
    },
    ratios: (() => {
      const r = {};
      const chain = ['root', 'compact', 'card', 'plotShell', 'svg'];
      const els = [root, compact, card, plotShell, svg];
      for (let i = 1; i < chain.length; i++) {
        const parent = els[i-1]?.getBoundingClientRect();
        const child = els[i]?.getBoundingClientRect();
        if (parent && child) {
          r[`${chain[i]}.height / ${chain[i-1]}.height`] = (child.height / parent.height).toFixed(4);
        }
      }
      return r;
    })(),
  };

  console.log('[DIAG] HEADER', JSON.stringify(header, null, 2));

  // Captura candles
  const groups = [...root.querySelectorAll('g[data-ts]')];
  console.log(`[DIAG] Found ${groups.length} candle groups`);

  const candles = groups.slice(0, limit).map((g, idx) => {
    const ts = g.getAttribute('data-ts');
    const rects = [...g.querySelectorAll('rect.tv-candle-battle__body')];
    const leftRect = rects[0];
    const rightRect = rects[1];
    const wicks = [...g.querySelectorAll('line.tv-candle-battle__wick')];
    const leftWick = wicks[0];
    const rightWick = wicks[1];
    const leftDoji = g.querySelector('line.tv-candle-battle__doji--left');
    const rightDoji = g.querySelector('line.tv-candle-battle__doji--right');

    function rectInfo(el, label) {
      if (!el) return { label, missing: true };
      const r = el.getBoundingClientRect();
      return {
        label,
        x: el.getAttribute('x'),
        y: el.getAttribute('y'),
        width: el.getAttribute('width'),
        height: el.getAttribute('height'),
        boundingClientRect: { width: r.width, height: r.height, x: r.x, y: r.y },
      };
    }
    function wickInfo(el, dojiEl, label) {
      const target = el || dojiEl;
      if (!target) return { label, missing: true, isDoji: !!dojiEl };
      const r = target.getBoundingClientRect();
      return {
        label,
        isDoji: !!dojiEl,
        x1: target.getAttribute('x1'),
        y1: target.getAttribute('y1'),
        x2: target.getAttribute('x2'),
        y2: target.getAttribute('y2'),
        boundingClientRect: { width: r.width, height: r.height, x: r.x, y: r.y },
      };
    }

    return {
      index: g.getAttribute('data-index') ?? String(idx),
      ts,
      left: {
        rect: rectInfo(leftRect, 'left-body'),
        wick: wickInfo(leftWick, leftDoji, 'left-wick'),
      },
      right: {
        rect: rectInfo(rightRect, 'right-body'),
        wick: wickInfo(rightWick, rightDoji, 'right-wick'),
      },
    };
  });

  console.log('[DIAG] CANDLES', JSON.stringify(candles, null, 2));

  console.table(candles.map(c => ({
    ts: c.ts,
    leftY: c.left.rect.y,
    leftH: c.left.rect.height,
    rightY: c.right.rect.y,
    rightH: c.right.rect.height,
    svgH: header.chain.svg.boundingClientRect.height,
    viewBox: header.chain.svg.viewBox,
  })));

  const payload = { header, candles };
  console.log('[DIAG] PAYLOAD_JSON_START');
  console.log(JSON.stringify(payload));
  console.log('[DIAG] PAYLOAD_JSON_END');
  return payload;
}

// Auto-expose globally for console without import
if (typeof window !== 'undefined') {
  window.__tvCandleDiag = runDiag;
  window.runTvCandleDiag = runDiag;
  console.log('[DIAG] Loaded. Run: __tvCandleDiag() or runTvCandleDiag() or import then runDiag()');
}
