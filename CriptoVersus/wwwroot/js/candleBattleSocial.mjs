const observers = new Map();

function waitImages(root) {
  return Promise.all([...root.querySelectorAll('img')].map(image => image.complete ? Promise.resolve() : new Promise(resolve => {
    const timeout = setTimeout(resolve, 10000);
    const complete = () => { clearTimeout(timeout); resolve(); };
    image.addEventListener('load', complete, { once: true });
    image.addEventListener('error', complete, { once: true });
  })));
}

export async function watchReadiness(id, replayAvailable, completed) {
  disposeReadiness(id);
  const root = document.getElementById(id);
  if (!root) return;
  let disposed = false;
  const canvas = root.querySelector('.candle-battles__canvas');
  const images = [...root.querySelectorAll('img')];
  const ready = async () => {
    clearTimeout(fallbackTimer);
    await document.fonts.ready;
    await Promise.all(images.map(image => image.complete ? Promise.resolve() : new Promise(resolve => {
      const timeout = setTimeout(resolve, 10000);
      const complete = () => { clearTimeout(timeout); resolve(); };
      image.addEventListener('load', complete, { once:true});
      image.addEventListener('error', complete, { once:true});
    })));
    if (!disposed) {
      root.dataset.replayReady = completed
        ? (canvas?.dataset.finished === 'true' ? 'true' : 'false')
        : (canvas?.dataset.ready === 'true' ? 'true' : 'false');
      root.dataset.socialReady = 'true';
    }
  };
  if (root.dataset.replayFailure) {
    await ready();
    return;
  }
  const onFinished = () => { void ready(); };
  const onReady = () => {
    if (!completed || canvas?.dataset.finished === 'true') void ready();
    else canvas?.addEventListener('candle-battles-finished', onFinished, {once:true});
  };
  const fallbackTimer = setTimeout(() => { void ready(); }, 45000);
  if (!replayAvailable) void ready();
  else if (canvas?.dataset.ready === 'true') onReady();
  else canvas?.addEventListener('candle-battles-ready', onReady, {once:true});
  observers.set(id, () => {
    disposed = true;
    clearTimeout(fallbackTimer);
    canvas?.removeEventListener('candle-battles-ready', onReady);
    canvas?.removeEventListener('candle-battles-finished', onFinished);
  });
}

/**
 * Compact social capture readiness. Waits for the frozen poster frame of the
 * arena (engine option `socialCapture`), keeps the pinned comic bubbles in the
 * frame and only then exposes `data-social-ready="true"` for the screenshot.
 */
export async function watchCaptureReadiness(id, replayAvailable, completed) {
  disposeReadiness(id);
  const root = document.getElementById(id);
  if (!root) return;
  const canvas = root.querySelector('.candle-battles__canvas');
  let disposed = false;
  let settled = false;
  let fallbackTimer;
  const frameSettled = () => (completed
    ? canvas?.dataset.finished === 'true'
    : canvas?.dataset.captureFrame === 'frozen') === true;
  const freeze = () => {
    if (root.dataset.captureFrame === 'frozen') return;
    root.querySelector('[data-cb-action="socialFreeze"]')?.click();
    root.dataset.captureFrame = 'frozen';
    if (canvas && canvas.dataset.captureFrame !== 'frozen') canvas.dataset.captureFrame = 'frozen';
  };
  const done = async () => {
    if (settled) return;
    settled = true;
    const replayReady = frameSettled();
    clearTimeout(fallbackTimer);
    freeze();
    await document.fonts.ready;
    await waitImages(root);
    if (disposed) return;
    root.dataset.replayReady = replayReady ? 'true' : 'false';
    root.dataset.socialReady = 'true';
  };
  if (root.dataset.replayFailure) { await done(); return; }
  if (!replayAvailable || !canvas) { await done(); return; }
  const onFrozen = () => { void done(); };
  fallbackTimer = setTimeout(() => { void done(); }, 40000);
  if (canvas.dataset.captureFrame === 'frozen') void done();
  else canvas.addEventListener('candle-battles-capture-frozen', onFrozen, { once: true });
  observers.set(id, () => {
    disposed = true;
    clearTimeout(fallbackTimer);
    canvas.removeEventListener('candle-battles-capture-frozen', onFrozen);
  });
}

export function reportFailure(id, reason) {
  const root = document.getElementById(id);
  if (!root) return;
  root.dataset.replayFailure = reason || 'unknown';
  root.dataset.replayReady = 'false';
  root.dataset.captureFrame = 'frozen';
  root.dataset.socialReady = 'true';
}

export function disposeReadiness(id) {
  observers.get(id)?.();
  observers.delete(id);
}
