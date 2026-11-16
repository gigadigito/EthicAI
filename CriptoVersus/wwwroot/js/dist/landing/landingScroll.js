const instances = new Map();
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
export function mountLandingScroll(root) {
    if (!root || typeof window === "undefined")
        return;
    destroyLandingScroll(root);
    const hero = root.querySelector(".landing-hero");
    const translation = root.querySelector(".landing-translation");
    if (!hero || !translation)
        return;
    const reducedMotionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
    let rafId = 0;
    let observer = null;
    const applyProgress = () => {
        rafId = 0;
        if (reducedMotionMedia.matches) {
            root.style.setProperty("--hero-exit", "0");
            root.style.setProperty("--section-enter", "1");
            translation.classList.add("is-in-view");
            return;
        }
        const viewportH = Math.max(window.innerHeight, 1);
        const heroRect = hero.getBoundingClientRect();
        const heroHeight = Math.max(heroRect.height, viewportH);
        // 0 at top of page, 1 when hero has scrolled 85% out of view
        const heroExit = clamp(-heroRect.top / (heroHeight * 0.85), 0, 1);
        root.style.setProperty("--hero-exit", heroExit.toFixed(4));
        const sectionRect = translation.getBoundingClientRect();
        // 0 before entering bottom of viewport, 1 once upper third reaches comfortable reading zone
        const sectionEnter = clamp((viewportH - sectionRect.top) / (viewportH * 0.72), 0, 1);
        root.style.setProperty("--section-enter", sectionEnter.toFixed(4));
    };
    const scheduleUpdate = () => {
        if (rafId !== 0)
            return;
        rafId = window.requestAnimationFrame(applyProgress);
    };
    const handleReducedMotionChange = () => {
        scheduleUpdate();
    };
    if ("IntersectionObserver" in window) {
        observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting) {
                    translation.classList.add("is-in-view");
                }
            }
        }, { threshold: 0.14 });
        observer.observe(translation);
    }
    else {
        translation.classList.add("is-in-view");
    }
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate, { passive: true });
    reducedMotionMedia.addEventListener("change", handleReducedMotionChange);
    applyProgress();
    instances.set(root, {
        destroy() {
            if (rafId !== 0) {
                window.cancelAnimationFrame(rafId);
                rafId = 0;
            }
            observer?.disconnect();
            observer = null;
            window.removeEventListener("scroll", scheduleUpdate);
            window.removeEventListener("resize", scheduleUpdate);
            reducedMotionMedia.removeEventListener("change", handleReducedMotionChange);
            root.style.removeProperty("--hero-exit");
            root.style.removeProperty("--section-enter");
        },
    });
}
export function destroyLandingScroll(root) {
    if (!root)
        return;
    const instance = instances.get(root);
    if (!instance)
        return;
    instance.destroy();
    instances.delete(root);
}
