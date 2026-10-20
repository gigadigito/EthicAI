const observers = new Map();

export async function watchReadiness(id, replayAvailable) {
  disposeReadiness(id);
  const root = document.getElementById(id);
  if (!root) return;
  let disposed = false;
  const canvas = root.querySelector('.candle-battles__canvas');
  const images = [...root.querySelectorAll('img')];
  const ready = async () => {
    await document.fonts.ready;
    await Promise.all(images.map(image => image.complete ? Promise.resolve() : new Promise(resolve => {
      image.addEventListener('load', resolve, {once:true});
      image.addEventListener('error', resolve, {once:true});
    })));
    if (!disposed) root.dataset.socialReady = 'true';
  };
  const onReady = () => { void ready(); };
  if (!replayAvailable || canvas?.dataset.ready === 'true') void ready();
  else canvas?.addEventListener('candle-battles-ready', onReady, {once:true});
  observers.set(id, () => { disposed = true; canvas?.removeEventListener('candle-battles-ready', onReady); });
}

export function disposeReadiness(id) {
  observers.get(id)?.();
  observers.delete(id);
}
