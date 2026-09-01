const observers = new Map();
let nextId = 1;

export function observe(elementId, dotNetRef, threshold) {
    const el = document.getElementById(elementId);
    if (!el) {
        console.warn('[tvCandleBattleResize] observe: element not found', elementId);
        return 0;
    }

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
            console.log('[tvCandleBattleResize] OnPlotResized', elementId, w, h);
            dotNetRef.invokeMethodAsync('OnPlotResized', w, h).catch(() => {});
        }
    });

    ro.observe(el);
    observers.set(id, { ro, el });

    // Fallback: poll for late layout (carousel mount, grid 1fr resolve) for 5s
    let polls = 0;
    const poll = setInterval(() => {
        polls++;
        const rect = el.getBoundingClientRect();
        const w = Math.round(rect.width);
        const h = Math.round(rect.height);
        if (Math.abs(w - lastWidth) >= (threshold || 1) || Math.abs(h - lastHeight) >= (threshold || 1)) {
            if (w > 0 && h > 0) {
                lastWidth = w;
                lastHeight = h;
                console.log('[tvCandleBattleResize] poll OnPlotResized', elementId, w, h);
                dotNetRef.invokeMethodAsync('OnPlotResized', w, h).catch(() => {});
            }
        }
        if (polls >= 10) clearInterval(poll);
    }, 300);

    // Also observe via MutationObserver in case element was hidden and becomes visible
    return id;
}

export function getSize(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { width: Math.round(r.width), height: Math.round(r.height) };
}

export function dispose(id) {
    const entry = observers.get(id);
    if (!entry) return;
    entry.ro.disconnect();
    observers.delete(id);
}
