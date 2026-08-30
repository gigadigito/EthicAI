// tvCandleBattleDiag.mjs — diagnóstico probatório 2026-08-30-v3
// NÃO altera layout/CSS. Apenas lê DOM para comparar /partida vs /tv/match
// Uso no console do browser:
//   import('/js/tvCandleBattleDiag.mjs').then(m=>m.runDiag())
// ou copie a função runDiag para console

export function runDiag(limit = 5) {
  const root = document.querySelector('[data-candle-render-version]');
  const version = root?.getAttribute('data-candle-render-version') ?? 'MISSING';
  const allVersions = [...document.querySelectorAll('[data-candle-render-version]')].map(e=>e.getAttribute('data-candle-render-version'));
  const uniqueVersions = [...new Set(allVersions)];

  const svg = document.querySelector('.tv-candle-battle__svg');
  const plotShell = document.querySelector('.tv-candle-battle-card__plot-shell');
  if (!svg) { console.error('[DIAG] SVG not found'); return; }
  if (!plotShell) { console.error('[DIAG] plot-shell not found'); return; }

  const svgRect = svg.getBoundingClientRect();
  const plotRect = plotShell.getBoundingClientRect();
  const svgCS = getComputedStyle(svg);
  const plotCS = getComputedStyle(plotShell);
  const svgCTM = svg.getScreenCTM ? svg.getScreenCTM() : null;

  const header = {
    url: location.href,
    version,
    uniqueVersions,
    svg: {
      viewBox: svg.getAttribute('viewBox'),
      widthAttr: svg.getAttribute('width'),
      heightAttr: svg.getAttribute('height'),
      style: svg.getAttribute('style'),
      preserveAspectRatio: svg.getAttribute('preserveAspectRatio'),
      width: svgRect.width,
      height: svgRect.height,
      boundingClientRect: { x: svgRect.x, y: svgRect.y, width: svgRect.width, height: svgRect.height, top: svgRect.top, left: svgRect.left, bottom: svgRect.bottom, right: svgRect.right },
      computedStyle: {
        width: svgCS.width,
        height: svgCS.height,
        transform: svgCS.transform,
        transformOrigin: svgCS.transformOrigin,
        display: svgCS.display,
      },
      ctm: svgCTM ? { a: svgCTM.a, b: svgCTM.b, c: svgCTM.c, d: svgCTM.d, e: svgCTM.e, f: svgCTM.f } : null,
    },
    plotShell: {
      boundingClientRect: { x: plotRect.x, y: plotRect.y, width: plotRect.width, height: plotRect.height, top: plotRect.top, left: plotRect.left, bottom: plotRect.bottom, right: plotRect.right },
      computedStyle: {
        width: plotCS.width,
        height: plotCS.height,
        display: plotCS.display,
        gridTemplateRows: plotCS.gridTemplateRows,
        transform: plotCS.transform,
      },
    },
    card: (() => {
      const card = document.querySelector('.tv-candle-battle-card');
      if (!card) return null;
      const r = card.getBoundingClientRect();
      const cs = getComputedStyle(card);
      return {
        boundingClientRect: { width: r.width, height: r.height },
        computedStyle: { display: cs.display, gridTemplateRows: cs.gridTemplateRows, height: cs.height, gap: cs.gap, padding: cs.padding },
      };
    })(),
    chartModel: {
      chartViewWidth: svg.getAttribute('data-chart-view-width'),
      logicalHeight: svg.getAttribute('data-logical-height'),
    }
  };

  console.log('[DIAG] HEADER', JSON.stringify(header, null, 2));

  // Captura candles: cada <g> com data-ts
  const groups = [...document.querySelectorAll('g[data-ts]')];
  console.log(`[DIAG] Found ${groups.length} candle groups`);

  const candles = groups.slice(0, limit).map((g, idx) => {
    const ts = g.getAttribute('data-ts');
    const leftBody = g.querySelector('rect.tv-candle-battle__body--left, rect.tv-candle-battle__body');
    const rightBody = g.querySelector('rect.tv-candle-battle__body--right');
    // fallback: first rect is left, second is right
    const rects = [...g.querySelectorAll('rect.tv-candle-battle__body')];
    const leftRect = rects[0] || leftBody;
    const rightRect = rects[1] || rightBody;
    const wicks = [...g.querySelectorAll('line.tv-candle-battle__wick')];
    const leftWick = g.querySelector('line.tv-candle-battle__wick--left') || wicks[0];
    const rightWick = g.querySelector('line.tv-candle-battle__wick--right') || wicks[1];
    const leftDoji = g.querySelector('line.tv-candle-battle__doji--left');
    const rightDoji = g.querySelector('line.tv-candle-battle__doji--right');

    function rectInfo(el, label) {
      if (!el) return { label, missing: true };
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        label,
        x: el.getAttribute('x'),
        y: el.getAttribute('y'),
        width: el.getAttribute('width'),
        height: el.getAttribute('height'),
        computedTransform: cs.transform,
        boundingClientRect: { width: r.width, height: r.height, x: r.x, y: r.y },
      };
    }
    function wickInfo(el, dojiEl, label) {
      const target = el || dojiEl;
      if (!target) return { label, missing: true, isDoji: !!dojiEl };
      const r = target.getBoundingClientRect();
      const cs = getComputedStyle(target);
      return {
        label,
        isDoji: !!dojiEl,
        x1: target.getAttribute('x1'),
        y1: target.getAttribute('y1'),
        x2: target.getAttribute('x2'),
        y2: target.getAttribute('y2'),
        computedTransform: cs.transform,
        boundingClientRect: { width: r.width, height: r.height, x: r.x, y: r.y },
      };
    }

    return {
      index: g.getAttribute('data-index') ?? String(idx),
      ts,
      title: g.querySelector('title')?.textContent ?? '',
      left: {
        normalizedOpen: g.getAttribute('data-left-normalized-open'),
        normalizedClose: g.getAttribute('data-left-normalized-close'),
        openY: g.getAttribute('data-left-open-y'),
        closeY: g.getAttribute('data-left-close-y'),
        rect: rectInfo(leftRect, 'left-body'),
        wick: wickInfo(leftWick, leftDoji, 'left-wick'),
      },
      right: {
        normalizedOpen: g.getAttribute('data-right-normalized-open'),
        normalizedClose: g.getAttribute('data-right-normalized-close'),
        openY: g.getAttribute('data-right-open-y'),
        closeY: g.getAttribute('data-right-close-y'),
        rect: rectInfo(rightRect, 'right-body'),
        wick: wickInfo(rightWick, rightDoji, 'right-wick'),
      },
    };
  });

  console.log('[DIAG] CANDLES', JSON.stringify(candles, null, 2));

  // Tabela resumida para copiar
  console.table(candles.map(c => ({
    ts: c.ts,
    leftOpenY: c.left.openY,
    leftCloseY: c.left.closeY,
    leftRectY: c.left.rect.y,
    leftRectH: c.left.rect.height,
    rightOpenY: c.right.openY,
    rightCloseY: c.right.closeY,
    rightRectY: c.right.rect.y,
    rightRectH: c.right.rect.height,
    svgW: header.svg.width,
    svgH: header.svg.height,
    viewBox: header.svg.viewBox,
  })));

  const payload = { header, candles };
  console.log('[DIAG] PAYLOAD_JSON_START');
  console.log(JSON.stringify(payload));
  console.log('[DIAG] PAYLOAD_JSON_END');
  console.log('[DIAG] Copy the JSON between PAYLOAD_JSON_START/END and compare /partida vs /tv/match');
  console.log('[DIAG] Classification hint: if rect y/height differ => CASO A (BuildChartVisuals inputs differ). If equal but visual differs => CASO B (CSS/SVG scaling). If SVG missing/different branch => CASO C');
  return payload;
}

// Auto-expose globally for console without import
if (typeof window !== 'undefined') {
  window.__tvCandleDiag = runDiag;
  window.runTvCandleDiag = runDiag;
  console.log('[DIAG] Loaded. Run: __tvCandleDiag() or runTvCandleDiag() or import then runDiag()');
}
