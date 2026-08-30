const observers = new Map();
let nextId = 1;

export function observe(elementId, dotNetRef, threshold) {
    const el = document.getElementById(elementId);
    if (!el) return 0;

    const id = nextId++;
    let lastWidth = 0;
    let lastHeight = 0;

    const ro = new ResizeObserver(entries => {
        for (const entry of entries) {
            const { width, height } = entry.contentRect;
            const w = Math.round(width);
            const h = Math.round(height);

            if (Math.abs(w - lastWidth) < (threshold || 1) && Math.abs(h - lastHeight) < (threshold || 1))
                continue;

            lastWidth = w;
            lastHeight = h;
            dotNetRef.invokeMethodAsync('OnPlotResized', w, h).catch(() => {});
        }
    });

    ro.observe(el);
    observers.set(id, { ro, el });
    return id;
}

export function dispose(id) {
    const entry = observers.get(id);
    if (!entry) return;
    entry.ro.disconnect();
    observers.delete(id);
}
