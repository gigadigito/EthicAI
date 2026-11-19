const DEFAULTS = {
    mode: "dark",
    speed: 1,
    size: 1,
    gap: 2,
    length: 1,
    density: 1,
    strokeWidth: 1,
    opacity: 1,
    hue: 0,
    saturation: 1,
    brightness: 1,
};
const LIGHT_PAPER = "#eef1f6";
const DARK_PAPER = "#000000";
function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}
function scaleCount(base, density, minimum = 1) {
    return Math.max(minimum, Math.round(base * density));
}
function readAutomaticMode() {
    if (typeof document === "undefined" || typeof window === "undefined") {
        return "dark";
    }
    const root = document.documentElement;
    const declared = root.dataset.scheme ?? root.dataset.theme;
    if (declared === "light" || declared === "dark") {
        return declared;
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
}
function resolveMode(preference) {
    if (!preference || preference === "dark")
        return "dark";
    if (preference === "light")
        return "light";
    return readAutomaticMode();
}
function getBezierPoint(t, p0, p1, p2, p3) {
    const u = 1 - t;
    const uu = u * u;
    const tt = t * t;
    const uuu = uu * u;
    const ttt = tt * t;
    return {
        x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
        y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
    };
}
function readCssRgbToken(tokenName, fallbackRgb) {
    if (typeof document === "undefined" || typeof window === "undefined") {
        return fallbackRgb;
    }
    const value = getComputedStyle(document.documentElement)
        .getPropertyValue(tokenName)
        .trim();
    return value || fallbackRgb;
}
const instances = new Map();
export function mountGatewayFlow(container, canvas, options = {}) {
    if (!container || !canvas)
        return;
    destroyGatewayFlow(container);
    const ctx = canvas.getContext("2d");
    if (!ctx)
        return;
    let config = { ...DEFAULTS, ...options };
    let resolvedMode = resolveMode(config.mode);
    let leftParticleRgb = readCssRgbToken("--team-a-rgb", "184, 255, 0");
    let rightParticleRgb = readCssRgbToken("--team-b-rgb", "0, 213, 223");
    let width = 0;
    let height = 0;
    let explosions = [];
    let paths = [];
    let rafId = 0;
    let lastTimestamp = 0;
    let destroyed = false;
    let isDocumentVisible = !document.hidden;
    let isInViewport = true;
    const reducedMotionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
    const colorSchemeMedia = window.matchMedia("(prefers-color-scheme: dark)");
    const applyContainerVisuals = () => {
        const safeOpacity = clamp(config.opacity, 0.05, 1);
        const safeHue = clamp(config.hue, -180, 180);
        const safeSaturation = clamp(config.saturation, 0, 2);
        const safeBrightness = clamp(config.brightness, 0.35, 1.65);
        container.style.background = resolvedMode === "light" ? LIGHT_PAPER : DARK_PAPER;
        canvas.style.opacity = String(safeOpacity);
        canvas.style.filter =
            safeHue === 0 && safeSaturation === 1 && safeBrightness === 1
                ? ""
                : `hue-rotate(${safeHue}deg) saturate(${safeSaturation}) brightness(${safeBrightness})`;
    };
    const buildPaths = () => {
        const safeDensity = clamp(config.density, 0.25, 2.5);
        const numPaths = scaleCount(80, safeDensity, 12);
        const effectiveHeight = Math.max(height, 1);
        paths = [];
        for (let i = 0; i < numPaths; i++) {
            paths.push({
                isLeft: i % 2 === 0,
                startY: (i / numPaths) * effectiveHeight * 1.4 - effectiveHeight * 0.2,
                particles: [
                    {
                        t: Math.random(),
                        speed: 0.0015 + Math.random() * 0.002,
                    },
                ],
            });
        }
    };
    const resize = () => {
        const rect = container.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const nextWidth = Math.max(1, Math.round(rect.width || window.innerWidth));
        const nextHeight = Math.max(1, Math.round(rect.height || window.innerHeight));
        const heightChanged = nextHeight !== height;
        width = nextWidth;
        height = nextHeight;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (paths.length === 0 || heightChanged) {
            buildPaths();
        }
    };
    const canAnimate = () => !destroyed && !reducedMotionMedia.matches && isDocumentVisible && isInViewport;
    const stopAnimation = () => {
        if (rafId) {
            window.cancelAnimationFrame(rafId);
            rafId = 0;
        }
    };
    const scheduleFrame = () => {
        if (canAnimate() && !rafId) {
            lastTimestamp = 0;
            rafId = window.requestAnimationFrame(renderFrame);
        }
    };
    const renderFrame = (timestamp) => {
        if (destroyed)
            return;
        const dtRatio = lastTimestamp === 0
            ? 1
            : clamp((timestamp - lastTimestamp) / 16.6667, 0.1, 3);
        lastTimestamp = timestamp;
        const safeSpeed = clamp(config.speed, 0, 3);
        const safeSize = clamp(config.size, 0.05, 200);
        const motionFactor = reducedMotionMedia.matches ? 0 : safeSpeed * dtRatio;
        ctx.clearRect(0, 0, width, height);
        const centerX = width / 2;
        const centerY = height / 2;
        if (motionFactor > 0) {
            for (const exp of explosions) {
                exp.radius += 15 * dtRatio;
                exp.life -= 0.015 * dtRatio;
            }
            explosions = explosions.filter((exp) => exp.life > 0);
        }
        const strokeColor = resolvedMode === "light"
            ? "rgba(26, 31, 42, 0.4)"
            : "rgba(255, 255, 255, 0.35)";
        const leftParticleColor = resolvedMode === "light"
            ? `rgba(${leftParticleRgb}, 0.9)`
            : `rgba(${leftParticleRgb}, 0.85)`;
        const rightParticleColor = resolvedMode === "light"
            ? `rgba(${rightParticleRgb}, 0.9)`
            : `rgba(${rightParticleRgb}, 0.85)`;
        const lineWidth = Number((1.2 * safeSize).toFixed(2));
        for (const path of paths) {
            const p0 = { x: path.isLeft ? 0 : width, y: path.startY };
            const p1 = {
                x: path.isLeft ? centerX * 0.5 : width - centerX * 0.5,
                y: path.startY,
            };
            const p2 = {
                x: path.isLeft ? centerX * 0.8 : width - centerX * 0.8,
                y: centerY,
            };
            const p3 = { x: centerX, y: centerY };
            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = lineWidth;
            ctx.setLineDash([1, 4]);
            ctx.stroke();
            ctx.setLineDash([]);
            for (const p of path.particles) {
                if (motionFactor > 0) {
                    p.t += p.speed * motionFactor;
                    if (p.t > 1) {
                        p.t = 0;
                        path.startY += (Math.random() - 0.5) * 10;
                    }
                }
                const pos = getBezierPoint(p.t, p0, p1, p2, p3);
                let dxTotal = 0;
                let dyTotal = 0;
                for (const exp of explosions) {
                    const dx = pos.x - exp.x;
                    const dy = pos.y - exp.y;
                    const dist = Math.hypot(dx, dy);
                    if (dist > 0.001 && dist < exp.radius + 120 && dist > exp.radius - 120) {
                        const force = (1 - Math.abs(dist - exp.radius) / 120) * exp.life;
                        dxTotal += (dx / dist) * force * 80;
                        dyTotal += (dy / dist) * force * 80;
                    }
                }
                pos.x += dxTotal;
                pos.y += dyTotal;
                ctx.fillStyle = path.isLeft ? leftParticleColor : rightParticleColor;
                ctx.fillRect(pos.x - 1.5, pos.y - 1.5, 3, 3);
            }
        }
        if (canAnimate()) {
            rafId = window.requestAnimationFrame(renderFrame);
        }
        else {
            rafId = 0;
        }
    };
    const handleClick = (event) => {
        if (reducedMotionMedia.matches)
            return;
        const rect = canvas.getBoundingClientRect();
        explosions.push({
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
            radius: 0,
            life: 1,
        });
    };
    const handleModeChange = () => {
        if (config.mode === "auto") {
            resolvedMode = readAutomaticMode();
            applyContainerVisuals();
            if (reducedMotionMedia.matches) {
                renderFrame(performance.now());
            }
        }
    };
    const handleReducedMotionChange = () => {
        if (reducedMotionMedia.matches) {
            stopAnimation();
            renderFrame(performance.now());
        }
        else {
            scheduleFrame();
        }
    };
    const handleVisibilityChange = () => {
        isDocumentVisible = !document.hidden;
        if (isDocumentVisible) {
            scheduleFrame();
        }
        else {
            stopAnimation();
        }
    };
    const intersectionObserver = new IntersectionObserver(([entry]) => {
        isInViewport = entry?.isIntersecting ?? false;
        if (isInViewport) {
            scheduleFrame();
        }
        else {
            stopAnimation();
        }
    }, { threshold: 0.01 });
    const mutationObserver = new MutationObserver(handleModeChange);
    mutationObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-scheme", "data-theme"],
    });
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    intersectionObserver.observe(container);
    window.addEventListener("resize", resize);
    canvas.addEventListener("click", handleClick);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    colorSchemeMedia.addEventListener("change", handleModeChange);
    reducedMotionMedia.addEventListener("change", handleReducedMotionChange);
    applyContainerVisuals();
    resize();
    if (reducedMotionMedia.matches) {
        renderFrame(performance.now());
    }
    else {
        scheduleFrame();
    }
    instances.set(container, {
        update(next) {
            const prevDensity = config.density;
            config = { ...DEFAULTS, ...next };
            resolvedMode = resolveMode(config.mode);
            applyContainerVisuals();
            if (next.density !== undefined && next.density !== prevDensity) {
                buildPaths();
            }
            if (reducedMotionMedia.matches) {
                renderFrame(performance.now());
            }
            else {
                scheduleFrame();
            }
        },
        destroy() {
            destroyed = true;
            stopAnimation();
            mutationObserver.disconnect();
            resizeObserver.disconnect();
            intersectionObserver.disconnect();
            window.removeEventListener("resize", resize);
            canvas.removeEventListener("click", handleClick);
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            colorSchemeMedia.removeEventListener("change", handleModeChange);
            reducedMotionMedia.removeEventListener("change", handleReducedMotionChange);
            explosions = [];
            paths = [];
        },
    });
}
export function updateGatewayFlow(container, options = {}) {
    if (!container)
        return;
    instances.get(container)?.update(options);
}
export function destroyGatewayFlow(container) {
    if (!container)
        return;
    const instance = instances.get(container);
    if (!instance)
        return;
    instance.destroy();
    instances.delete(container);
}
