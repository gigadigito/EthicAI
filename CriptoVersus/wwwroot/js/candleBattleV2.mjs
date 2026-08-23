const observers = new Map();
let nextId = 1;

export function initialize(dotNetRef) {
    const id = nextId++;
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const notify = () => {
        dotNetRef.invokeMethodAsync(
            "OnBrowserVisibilityChanged",
            document.visibilityState === "visible",
            motionQuery.matches).catch(() => {});
    };

    document.addEventListener("visibilitychange", notify, { passive: true });
    if (typeof motionQuery.addEventListener === "function")
        motionQuery.addEventListener("change", notify);
    else
        motionQuery.addListener(notify);

    observers.set(id, { motionQuery, notify });
    return id;
}

export function isReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function dispose(id) {
    const observer = observers.get(id);
    if (!observer)
        return;

    document.removeEventListener("visibilitychange", observer.notify);
    if (typeof observer.motionQuery.removeEventListener === "function")
        observer.motionQuery.removeEventListener("change", observer.notify);
    else
        observer.motionQuery.removeListener(observer.notify);
    observers.delete(id);
}
