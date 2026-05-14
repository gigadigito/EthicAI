(function () {
    const activeTimelines = new Map();
    const motionQuery = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

    function canAnimate() {
        return typeof window !== "undefined" && typeof window.gsap !== "undefined";
    }

    function getEventNode(eventId) {
        return document.querySelector(`[data-tv-narration-id="${eventId}"]`);
    }

    function killTimeline(eventId) {
        const existing = activeTimelines.get(eventId);
        if (!existing) {
            return;
        }

        existing.kill();
        activeTimelines.delete(eventId);
    }

    function gsapSet(target, vars) {
        if (!window.gsap || !target) {
            return;
        }

        window.gsap.set(target, vars);
    }

    function resolveStage() {
        return document.querySelector(".tv-stage--live") || document.querySelector(".tv-stage--waiting") || document.querySelector(".tv-stage");
    }

    function playReducedMotion(container) {
        const title = container.querySelector(".tv-narration-title");
        const subtitle = container.querySelector(".tv-narration-subtitle");
        const flare = container.querySelector(".tv-narration-flare");
        const tl = window.gsap.timeline();
        tl.set(container, { opacity: 0, filter: "blur(0px)", scale: 1 });
        tl.to(container, { opacity: 1, duration: 0.18, ease: "power2.out" });
        tl.to([title, subtitle, flare].filter(Boolean), { opacity: 0.9, duration: 0.12 }, 0);
        tl.to(container, { opacity: 0, duration: 0.28, ease: "power1.inOut", delay: 1.4 });
        return tl;
    }

    function applyBaseState(container) {
        const title = container.querySelector(".tv-narration-title");
        const chromatic = container.querySelector(".tv-narration-chromatic");
        const subtitle = container.querySelector(".tv-narration-subtitle");
        const glow = container.querySelector(".tv-narration-backglow");
        const flare = container.querySelector(".tv-narration-flare");
        const streaks = container.querySelector(".tv-narration-streaks");
        const scanlines = container.querySelector(".tv-narration-scanlines");

        gsapSet(container, {
            opacity: 0,
            scale: 0.82,
            filter: "blur(20px)"
        });
        gsapSet([title, chromatic, subtitle].filter(Boolean), { opacity: 0, yPercent: 8 });
        gsapSet(chromatic, { x: 0 });
        gsapSet(glow, { opacity: 0, scale: 0.7 });
        gsapSet(flare, { opacity: 0, scaleX: 0.55 });
        gsapSet(streaks, { opacity: 0, scale: 0.9, rotate: -4 });
        gsapSet(scanlines, { opacity: 0 });
        gsapSet(container, { clearProps: "clipPath" });
    }

    function buildTimeline(container, severity, animation) {
        const title = container.querySelector(".tv-narration-title");
        const chromatic = container.querySelector(".tv-narration-chromatic");
        const subtitle = container.querySelector(".tv-narration-subtitle");
        const glow = container.querySelector(".tv-narration-backglow");
        const flare = container.querySelector(".tv-narration-flare");
        const streaks = container.querySelector(".tv-narration-streaks");
        const scanlines = container.querySelector(".tv-narration-scanlines");
        const reduced = motionQuery && motionQuery.matches;

        if (reduced) {
            return playReducedMotion(container);
        }

        applyBaseState(container);

        const tl = window.gsap.timeline({
            defaults: { ease: "power3.out" }
        });

        tl.to(container, { opacity: 1, duration: 0.08 }, 0);
        tl.to(glow, { opacity: 0.95, scale: 1.08, duration: 0.36, ease: "power2.out" }, 0);
        tl.to(flare, { opacity: 0.72, scaleX: 1, duration: 0.22, ease: "power2.out" }, 0.05);
        tl.to(streaks, { opacity: 0.46, scale: 1.02, rotate: 0, duration: 0.34 }, 0.04);
        tl.to(scanlines, { opacity: 0.2, duration: 0.18 }, 0.1);
        tl.to(chromatic, { opacity: 0.9, yPercent: 0, duration: 0.24 }, 0.08);
        tl.to(title, { opacity: 1, yPercent: 0, duration: 0.24 }, 0.12);
        if (subtitle) {
            tl.to(subtitle, { opacity: 1, yPercent: 0, duration: 0.28 }, 0.28);
        }

        switch ((animation || "grow").toLowerCase()) {
            case "zoom-burst":
                tl.fromTo(container, { scale: 0.2, filter: "blur(18px)" }, { scale: 1.18, filter: "blur(0px)", duration: 0.42, ease: "expo.out" }, 0);
                tl.to(container, { scale: 1, duration: 0.24, ease: "back.out(1.5)" }, 0.42);
                tl.to(container, { scale: 1.35, opacity: 0, filter: "blur(12px)", duration: 0.44, ease: "power2.in" }, ">1.7");
                break;
            case "glitch":
                tl.fromTo(container, { scale: 0.92, skewX: -10, filter: "blur(14px)" }, { scale: 1.04, skewX: 0, filter: "blur(0px)", duration: 0.24 }, 0);
                tl.to([title, chromatic], { x: 12, duration: 0.04, repeat: 5, yoyo: true, ease: "steps(2)" }, 0.2);
                tl.to(chromatic, { x: -10, duration: 0.04, repeat: 5, yoyo: true, ease: "steps(2)" }, 0.2);
                tl.to(container, { opacity: 0, filter: "blur(10px)", duration: 0.3 }, ">1.6");
                break;
            case "neon-flash":
                tl.fromTo(container, { scale: 0.76 }, { scale: 1.04, duration: 0.28 }, 0);
                tl.to(glow, { opacity: 1, repeat: 2, yoyo: true, duration: 0.16, ease: "power1.inOut" }, 0.18);
                tl.to(container, { scale: 1, duration: 0.18 }, 0.34);
                tl.to(container, { opacity: 0, filter: "blur(10px)", duration: 0.34 }, ">1.5");
                break;
            case "shockwave":
                tl.fromTo(container, { scale: 0.6, yPercent: 5 }, { scale: 1.08, yPercent: 0, duration: 0.34, ease: "expo.out" }, 0);
                tl.to(container, { scale: 1, duration: 0.24, ease: "power2.out" }, 0.34);
                tl.to(container, { "--tv-shockwave-scale": 1.2, duration: 0.6, ease: "power2.out" }, 0.08);
                tl.to(container, { yPercent: -6, opacity: 0, filter: "blur(10px)", duration: 0.36, ease: "power2.in" }, ">1.6");
                break;
            case "screen-impact":
                tl.fromTo(container, { scale: 0.28, filter: "blur(16px)" }, { scale: 1.14, filter: "blur(0px)", duration: 0.3, ease: "expo.out" }, 0);
                tl.to(container, { x: -10, duration: 0.05, repeat: 5, yoyo: true, ease: "power1.inOut" }, 0.16);
                tl.to(container, { scale: 1, duration: 0.24, ease: "back.out(1.4)" }, 0.32);
                tl.to(container, { scale: 1.16, opacity: 0, filter: "blur(12px)", duration: 0.36, ease: "power2.in" }, ">1.5");
                break;
            case "diagonal-swipe":
                tl.fromTo(container, { xPercent: -18, yPercent: 12, rotate: -5, scale: 0.9 }, { xPercent: 0, yPercent: 0, rotate: 0, scale: 1.03, duration: 0.38, ease: "expo.out" }, 0);
                tl.to(container, { scale: 1, duration: 0.18 }, 0.38);
                tl.to(container, { xPercent: 14, yPercent: -10, rotate: 4, opacity: 0, duration: 0.34, ease: "power2.in" }, ">1.6");
                break;
            case "split-reveal":
                gsapSet(container, { clipPath: "inset(0 50% 0 50%)" });
                tl.to(container, { clipPath: "inset(0 0% 0 0%)", scale: 1.04, opacity: 1, duration: 0.34, ease: "expo.out" }, 0);
                tl.to(container, { scale: 1, duration: 0.18 }, 0.34);
                tl.to(container, { clipPath: "inset(6% 0 0 0)", opacity: 0, duration: 0.34, ease: "power2.in" }, ">1.6");
                break;
            case "hologram-reveal":
                tl.fromTo(container, { scale: 0.82, filter: "blur(16px) saturate(1.6)" }, { scale: 1.02, filter: "blur(0px) saturate(1)", duration: 0.36 }, 0);
                tl.to(scanlines, { opacity: 0.3, repeat: 3, yoyo: true, duration: 0.12 }, 0.1);
                tl.to(container, { opacity: 0, yPercent: -4, filter: "blur(8px)", duration: 0.32 }, ">1.6");
                break;
            case "pulse":
                tl.fromTo(container, { scale: 0.8 }, { scale: 1.06, duration: 0.24 }, 0);
                tl.to(container, { scale: 1, duration: 0.18 }, 0.24);
                tl.to(glow, { opacity: 1, scale: 1.16, repeat: 1, yoyo: true, duration: 0.22 }, 0.18);
                tl.to(container, { opacity: 0, duration: 0.32 }, ">1.4");
                break;
            case "grow":
            default:
                tl.fromTo(container, { scale: 0.35, filter: "blur(20px)" }, { scale: 1.12, filter: "blur(0px)", duration: 0.34, ease: "expo.out" }, 0);
                tl.to(container, { scale: 1, duration: 0.22, ease: "back.out(1.3)" }, 0.34);
                tl.to(container, { scale: 1.04, opacity: 0, filter: "blur(12px)", duration: 0.34, ease: "power2.in" }, ">1.5");
                break;
        }

        return tl;
    }

    function play(eventId, severity, animation) {
        if (!canAnimate()) {
            return;
        }

        const container = getEventNode(eventId);
        if (!container) {
            return;
        }

        killTimeline(eventId);

        const timeline = buildTimeline(container, severity, animation);
        activeTimelines.set(eventId, timeline);
        timeline.eventCallback("onComplete", () => {
            activeTimelines.delete(eventId);
        });
    }

    function impact() {
        if (!canAnimate()) {
            return;
        }

        const stage = resolveStage();
        if (!stage) {
            return;
        }

        stage.classList.add("tv-stage-impact-active");
        window.gsap.killTweensOf(stage);
        window.gsap.fromTo(stage,
            { scale: 1, x: 0, y: 0, filter: "brightness(1)" },
            {
                scale: 1.018,
                x: -6,
                y: 0,
                filter: "brightness(1.12)",
                duration: 0.08,
                yoyo: true,
                repeat: 5,
                ease: "power1.inOut",
                onComplete: () => {
                    stage.classList.remove("tv-stage-impact-active");
                    window.gsap.set(stage, { clearProps: "transform,filter" });
                }
            });
    }

    function clear() {
        if (!canAnimate()) {
            return;
        }

        activeTimelines.forEach((timeline, eventId) => {
            timeline.kill();
            const node = getEventNode(eventId);
            if (node) {
                window.gsap.set(node, { clearProps: "all" });
            }
        });
        activeTimelines.clear();
    }

    window.criptoVersusTvNarration = {
        play,
        impact,
        clear
    };
})();
