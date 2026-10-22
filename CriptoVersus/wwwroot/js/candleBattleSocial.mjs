const observers = new Map();

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
      image.addEventListener('load', complete, {once:true});
      image.addEventListener('error', complete, {once:true});
    })));
    if (!disposed) {
      root.dataset.replayReady = completed
        ? (canvas?.dataset.finished === 'true' ? 'true' : 'false')
        : (canvas?.dataset.ready === 'true' ? 'true' : 'false');
      root.dataset.socialReady = 'true';
    }
  };
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

export function disposeReadiness(id) {
  observers.get(id)?.();
  observers.delete(id);
}
