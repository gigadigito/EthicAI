(function () {
    const replayMap = {
        THRESHOLD_2: "SIMPLE_SHOT",
        THRESHOLD_8: "POWER_SHOT",
        THRESHOLD_16: "CINEMATIC_SUPER_GOAL",
        CROSSOVER_UP: "BICYCLE_KICK",
        VOLUME_SPIKE: "HEADER_GOAL",
        FEAR_DOMINANCE: "CORNER_GOAL",
        PENALTY_KICK: "PENALTY_KICK"
    };

    const fallbackAnimation = "POWER_SHOT";
    const replayDurationMs = 4000;
    const kickStartMs = 300;
    const shotLaunchMs = 800;
    const ballImpactMs = 1800;
    const goalCalloutMs = 2300;
    const fadeOutMs = 3500;
    const threeModuleUrl = "/js/vendor/three.module.min.js?v=20260520-2";
    const logoImageCache = new Map();
    const ballAssetUrl = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 128 128'%3E%3Cdefs%3E%3CradialGradient id='g' cx='32%25' cy='28%25' r='72%25'%3E%3Cstop offset='0%25' stop-color='%23ffffff'/%3E%3Cstop offset='68%25' stop-color='%23f2f6fb'/%3E%3Cstop offset='100%25' stop-color='%23cbd5e1'/%3E%3C/radialGradient%3E%3C/defs%3E%3Ccircle cx='64' cy='64' r='58' fill='url(%23g)'/%3E%3Ccircle cx='64' cy='64' r='58' fill='none' stroke='%230f172a' stroke-width='6'/%3E%3Cpath d='M64 30l18 13-7 21H53l-7-21 18-13z' fill='%23111827'/%3E%3Cpath d='M46 43l-17 12 6 22h18l-7-34zM82 43l17 12-6 22H75l7-34zM53 77l11 21 11-21H53z' fill='%231f2937'/%3E%3C/svg%3E";

    let state = null;
    let threeModulePromise = null;

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function lerp(a, b, t) {
        return a + (b - a) * t;
    }

    function easeOutCubic(t) {
        return 1 - Math.pow(1 - t, 3);
    }

    function easeInOutQuad(t) {
        return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }

    function getThree() {
        return state?.threeModule || window.THREE || null;
    }

    async function ensureThreeModule() {
        const existing = getThree();
        if (existing) {
            return existing;
        }

        if (!threeModulePromise) {
            threeModulePromise = import(threeModuleUrl)
                .then((module) => {
                    window.THREE = module;
                    if (state) {
                        state.threeModule = module;
                    }
                    return module;
                })
                .catch((error) => {
                    logReplay("three module import failed", error);
                    threeModulePromise = null;
                    return null;
                });
        }

        const module = await threeModulePromise;
        if (module && state) {
            state.threeModule = module;
        }
        return module;
    }

    function normalizeString(value, fallback) {
        return typeof value === "string" && value.trim() ? value.trim() : fallback;
    }

    function formatPercent(value) {
        const num = Number(value);
        const safe = Number.isFinite(num) ? num : 0;
        const prefix = safe > 0 ? "+" : "";
        return `${prefix}${safe.toFixed(2)}%`;
    }

    function toCssColor(value, fallback) {
        if (typeof value === "string" && value.trim()) {
            return value.trim();
        }

        if (typeof value === "number" && Number.isFinite(value)) {
            return `#${value.toString(16).padStart(6, "0")}`;
        }

        return fallback;
    }

    function safeNumber(value, fallback) {
        const num = Number(value);
        return Number.isFinite(num) ? num : fallback;
    }

    function createBallTexture(THREE) {
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            return createCanvasTexture(THREE, canvas);
        }

        ctx.clearRect(0, 0, 256, 256);
        ctx.fillStyle = "#f7f7f7";
        ctx.fillRect(0, 0, 256, 256);

        ctx.fillStyle = "#1a1f2d";
        ctx.strokeStyle = "#11151f";
        ctx.lineWidth = 8;

        const centerX = 128;
        const centerY = 128;
        const radius = 96;
        const panels = [
            [centerX, centerY - 16, 24, 5],
            [centerX - 30, centerY - 2, 20, 6],
            [centerX + 32, centerY + 2, 20, 6],
            [centerX - 6, centerY + 34, 22, 5],
            [centerX, centerY, 36, 6]
        ];

        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.fillStyle = "#fdfdfd";
        ctx.fill();
        ctx.strokeStyle = "rgba(32, 36, 44, 0.3)";
        ctx.lineWidth = 6;
        ctx.stroke();

        panels.forEach(([x, y, size, points]) => {
            ctx.beginPath();
            for (let i = 0; i < points; i += 1) {
                const angle = (Math.PI * 2 * i) / points - Math.PI / 2;
                const px = x + Math.cos(angle) * size;
                const py = y + Math.sin(angle) * size;
                if (i === 0) {
                    ctx.moveTo(px, py);
                } else {
                    ctx.lineTo(px, py);
                }
            }
            ctx.closePath();
            ctx.fill();
        });

        ctx.globalAlpha = 0.18;
        ctx.fillStyle = "#7a859b";
        ctx.beginPath();
        ctx.arc(centerX - 20, centerY - 24, 42, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(centerX + 26, centerY + 20, 38, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;

        ctx.strokeStyle = "#12151d";
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(centerX - 76, centerY - 14);
        ctx.lineTo(centerX - 28, centerY - 2);
        ctx.lineTo(centerX - 4, centerY + 34);
        ctx.lineTo(centerX + 18, centerY + 18);
        ctx.lineTo(centerX + 52, centerY + 34);
        ctx.stroke();

        return createCanvasTexture(THREE, canvas);
    }

    function resolveAnimation(event) {
        const source = event || {};
        const candidates = [source.animation, replayMap[source.eventType], fallbackAnimation];
        for (const candidate of candidates) {
            if (typeof candidate === "string" && candidate.trim()) {
                const normalized = candidate.trim().toUpperCase();
                if (
                    normalized === "POWER_SHOT" ||
                    normalized === "SIMPLE_SHOT" ||
                    normalized === "CINEMATIC_SUPER_GOAL" ||
                    normalized === "BICYCLE_KICK" ||
                    normalized === "HEADER_GOAL" ||
                    normalized === "CORNER_GOAL" ||
                    normalized === "PENALTY_KICK"
                ) {
                    return normalized;
                }
            }
        }
        return fallbackAnimation;
    }

    function normalizeEvent(event) {
        const source = event || {};
        const value = Number(source.value);
        return {
            eventType: normalizeString(source.eventType, "THRESHOLD_8"),
            team: normalizeString(source.team, "BTC"),
            opponent: normalizeString(source.opponent, "SOL"),
            animation: resolveAnimation(source),
            reason: normalizeString(source.reason, "Superou 8% de diferenca"),
            value: Number.isFinite(value) ? value : 0,
            minute: normalizeString(source.minute, "--:--"),
            teamLogo: normalizeString(source.teamLogo, ""),
            opponentLogo: normalizeString(source.opponentLogo, ""),
            teamColor: normalizeString(source.teamColor, "#F7931A"),
            opponentColor: normalizeString(source.opponentColor, "#14F195"),
            intensity: clamp(Number(source.intensity) || 0.75, 0.15, 1)
        };
    }

    function ensureState() {
        if (state) {
            return state;
        }

        state = {
            container: null,
            sceneHost: null,
            overlay: null,
            panel: null,
            goalCallout: null,
            title: null,
            teamName: null,
            opponentName: null,
            reason: null,
            value: null,
            minute: null,
            eventTypeChip: null,
            intensityLabel: null,
            intensityBar: null,
            scoreLine: null,
            teamBadge: null,
            opponentBadge: null,
            canvas: null,
            renderer: null,
            scene: null,
            camera: null,
            resizeObserver: null,
            rafId: 0,
            activeToken: 0,
            activeReplay: null,
            active: false,
            disposed: false,
            mode: "dom",
            threeAvailable: false,
            threeModule: null,
            dom: null,
            domProfile: null,
            rootWidth: 0,
            rootHeight: 0,
            particleGeometry: null,
            particleMaterial: null,
            particlePoints: null,
            particleVelocities: [],
            flash: null,
            field: null,
            grid: null,
            fieldLines: null,
            goalFrame: null,
            ballTrail: null,
            ballTrailGeometry: null,
            ballTrailMaterial: null,
            ballTrailPositions: null,
            ballTrailHistoryLength: 0,
            ballTrailHistory: [],
            ball: null,
            attacker: null,
            defender: null,
            ballStart: null,
            ballControl: null,
            ballEnd: null,
            impactTriggered: false,
            cleanupTimers: [],
            startedAtMs: 0,
            lastFrameMs: 0,
            loggedFrameStart: false
        };

        return state;
    }

    function clearTimers() {
        if (!state) {
            return;
        }

        while (state.cleanupTimers.length > 0) {
            window.clearTimeout(state.cleanupTimers.pop());
        }
    }

    function buildOverlayMarkup(container) {
        container.innerHTML = `
            <div class="tv-replay-stage" data-role="stage">
                <div class="replay-field-bg" data-role="field-bg"></div>
                <div class="replay-field-glow"></div>
                <div class="replay-goal" data-role="goal">
                    <img class="replay-goal__image" data-role="goal-image" alt="" />
                    <span class="replay-goal__post replay-goal__post--left"></span>
                    <span class="replay-goal__post replay-goal__post--right"></span>
                    <span class="replay-goal__bar"></span>
                    <span class="replay-goal__net"></span>
                </div>
                <div class="replay-player attacker" data-role="attacker" data-side="attacker">
                    <div class="replay-player__shadow"></div>
                    <div class="replay-arm replay-arm--left"><span class="replay-hand"></span></div>
                    <div class="replay-arm replay-arm--right"><span class="replay-hand"></span></div>
                    <div class="replay-leg replay-leg--left"><span class="replay-foot"></span></div>
                    <div class="replay-leg replay-leg--right"><span class="replay-foot"></span></div>
                    <div class="replay-player__body">
                        <span class="replay-player-logo" data-role="attacker-logo">
                            <img data-role="attacker-logo-img" alt="" />
                            <span data-role="attacker-logo-fallback">BTC</span>
                        </span>
                    </div>
                </div>
                <div class="replay-player defender" data-role="defender" data-side="defender">
                    <div class="replay-player__shadow"></div>
                    <div class="replay-arm replay-arm--left"><span class="replay-hand"></span></div>
                    <div class="replay-arm replay-arm--right"><span class="replay-hand"></span></div>
                    <div class="replay-leg replay-leg--left"><span class="replay-foot"></span></div>
                    <div class="replay-leg replay-leg--right"><span class="replay-foot"></span></div>
                    <div class="replay-player__body">
                        <span class="replay-player-logo" data-role="defender-logo">
                            <img data-role="defender-logo-img" alt="" />
                            <span data-role="defender-logo-fallback">SOL</span>
                        </span>
                    </div>
                </div>
                <div class="replay-ball-trail" data-role="trail"></div>
                <div class="replay-ball" data-role="ball"></div>
                <div class="replay-impact" data-role="impact"></div>
                <div class="replay-overlay" data-role="overlay" aria-live="polite" aria-atomic="true" data-phase="intro">
                    <div class="replay-overlay__panel" data-role="panel">
                        <span class="replay-overlay__eyebrow">REPLAY</span>
                        <h2 class="replay-overlay__title" data-role="title">POWER SHOT</h2>
                        <div class="replay-overlay__teams" data-role="teams">
                            <span class="replay-overlay__team">
                                <span class="replay-overlay__team-badge" data-role="team-badge"></span>
                                <strong data-role="team-name">BTC</strong>
                            </span>
                            <span class="replay-overlay__vs">vs</span>
                            <span class="replay-overlay__team">
                                <span class="replay-overlay__team-badge" data-role="opponent-badge"></span>
                                <strong data-role="opponent-name">SOL</strong>
                            </span>
                        </div>
                <div class="replay-overlay__reason" data-role="reason">Superou 8% de diferenca</div>
                <div class="replay-overlay__metrics">
                    <div class="replay-overlay__metric-row">
                        <span>Placar do gol</span>
                        <strong data-role="score-line">1 vs 0</strong>
                    </div>
                    <div class="replay-overlay__metric-row">
                        <span>Valor</span>
                        <strong data-role="value">+8.24%</strong>
                    </div>
                            <div class="replay-overlay__metric-row">
                                <span>Minuto</span>
                                <strong data-role="minute">43:27</strong>
                            </div>
                            <div class="replay-overlay__bar">
                                <span class="replay-overlay__bar-fill" data-role="intensity-bar"></span>
                            </div>
                        </div>
                        <div class="replay-overlay__chips">
                            <span class="replay-overlay__chip" data-role="event-type">THRESHOLD_8</span>
                            <span class="replay-overlay__chip" data-role="intensity-label">Intensity 80%</span>
                        </div>
                        <div class="replay-goal-text" data-role="goal-text">GOOOOL!</div>
                    </div>
                </div>
            </div>
        `;
    }

    function preloadBackgroundAsset(element, url) {
        if (!element || !url) {
            return;
        }

        const image = new Image();
        image.onload = () => {
            element.style.backgroundImage = `url("${url}")`;
            element.classList.add("has-asset");
        };
        image.onerror = () => {
            element.classList.remove("has-asset");
        };
        image.src = url;
    }

    function preloadDomImage(imageElement, container, url, className) {
        if (!imageElement || !url) {
            return;
        }

        imageElement.hidden = true;
        imageElement.onload = () => {
            imageElement.hidden = false;
            if (container && className) {
                container.classList.add(className);
            }
        };
        imageElement.onerror = () => {
            imageElement.hidden = true;
            if (container && className) {
                container.classList.remove(className);
            }
        };
        imageElement.src = url;
    }

    function setLogoForPlayer(player, symbol, primaryUrl, fallbackUrl) {
        if (!player) {
            return;
        }

        const img = player.logoImg;
        const fallback = player.logoFallback;
        const normalizedSymbol = normalizeString(symbol, "---").toUpperCase();
        const attempts = [primaryUrl, fallbackUrl].filter((value) => typeof value === "string" && value.trim());

        if (fallback) {
            fallback.textContent = normalizedSymbol.length > 5 ? normalizedSymbol.slice(0, 5) : normalizedSymbol;
            fallback.hidden = false;
        }

        if (!img) {
            return;
        }

        let attemptIndex = 0;
        const tryNext = () => {
            if (attemptIndex >= attempts.length) {
                if (fallback) {
                    fallback.hidden = false;
                }
                img.hidden = true;
                logReplay(`logo fallback ${normalizedSymbol}`);
                return;
            }

            const nextUrl = attempts[attemptIndex];
            attemptIndex += 1;
            img.onload = () => {
                img.hidden = false;
                if (fallback) {
                    fallback.hidden = true;
                }
                logReplay(`logo loaded ${normalizedSymbol}`);
            };
            img.onerror = () => {
                tryNext();
            };
            img.src = nextUrl;
        };

        img.hidden = true;
        tryNext();
    }

    function createPlayerDomRefs(root) {
        return {
            root,
            body: root.querySelector(".replay-player__body"),
            logo: root.querySelector(".replay-player-logo"),
            logoImg: root.querySelector(".replay-player-logo img"),
            logoFallback: root.querySelector(".replay-player-logo > span"),
            shadow: root.querySelector(".replay-player__shadow"),
            armLeft: root.querySelector(".replay-arm--left"),
            armRight: root.querySelector(".replay-arm--right"),
            legLeft: root.querySelector(".replay-leg--left"),
            legRight: root.querySelector(".replay-leg--right")
        };
    }

    function prepareDomReplayAssets() {
        if (!state?.dom) {
            return;
        }

        const profile = state.domProfile || buildDomReplayProfile(state.activeReplay || {}, state.layout || computeDomLayout() || { width: window.innerWidth || 1280, height: window.innerHeight || 720 });
        const { fieldBg, goal, goalImage, ball } = state.dom;
        preloadBackgroundAsset(fieldBg, "/img/tv-replay/field-replay-bg.png");
        preloadDomImage(goalImage, goal, profile.goalImageUrl || "/img/tv-replay/goal-right.png", "has-asset");
        preloadBackgroundAsset(ball, ballAssetUrl);
    }

    function computeDomLayout() {
        if (!state) {
            return null;
        }

        const width = Math.max(1, Math.floor(state.rootWidth || window.innerWidth || document.documentElement.clientWidth || 1280));
        const height = Math.max(1, Math.floor(state.rootHeight || window.innerHeight || document.documentElement.clientHeight || 720));
        const attacker = { x: width * 0.19, y: height * 0.67, scale: 0.92 };
        const defender = { x: width * 0.79, y: height * 0.55, scale: 0.88 };
        const goal = { x: width * 0.86, y: height * 0.52, scale: 1 };
        const ballStart = { x: width * 0.31, y: height * 0.62 };
        const ballControl = { x: width * 0.56, y: height * 0.36 };
        const ballEnd = { x: width * 0.82, y: height * 0.49 };
        const overlay = { x: width * 0.5, y: height * 0.12 };

        state.layout = {
            width,
            height,
            attacker,
            defender,
            goal,
            ballStart,
            ballControl,
            ballEnd,
            overlay
        };

        return state.layout;
    }

    function buildDomReplayProfile(event, layout) {
        const animation = resolveAnimation(event);
        const width = layout.width;
        const height = layout.height;
        const base = {
            attacker: { x: width * 0.19, y: height * 0.67, scale: 0.92 },
            defender: { x: width * 0.79, y: height * 0.55, scale: 0.88 },
            goal: { x: width * 0.86, y: height * 0.56, scale: 1 },
            ballStart: { x: width * 0.31, y: height * 0.62 },
            ballControl: { x: width * 0.56, y: height * 0.36 },
            ballEnd: { x: width * 0.82, y: height * 0.49 },
            overlay: { x: width * 0.5, y: height * 0.12 },
            ballScale: 0.84,
            trailStrength: 0.48,
            trailLength: 8,
            goalImageUrl: "/img/tv-replay/goal-right.png",
            timings: { prep: 300, kick: 600, shot: 900, follow: 1400, impact: 1900, goal: 2400, fade: 3500 },
            stage: { dx: -10, dy: -4, zoom: 1.02 }
        };

        const profiles = {
            SIMPLE_SHOT: {
                ballControl: { x: width * 0.54, y: height * 0.40 },
                ballEnd: { x: width * 0.81, y: height * 0.50 },
                ballScale: 0.74,
                trailStrength: 0.24,
                timings: { prep: 260, kick: 540, shot: 860, follow: 1320, impact: 1820, goal: 2240, fade: 3400 },
                stage: { dx: -7, dy: -2, zoom: 1.01 }
            },
            POWER_SHOT: {
                ballScale: 0.84,
                trailStrength: 0.56,
                timings: { prep: 300, kick: 600, shot: 900, follow: 1400, impact: 1900, goal: 2300, fade: 3500 },
                stage: { dx: -10, dy: -4, zoom: 1.03 }
            },
            BICYCLE_KICK: {
                attacker: { x: width * 0.24, y: height * 0.61, scale: 1.0 },
                defender: { x: width * 0.76, y: height * 0.56, scale: 0.84 },
                ballStart: { x: width * 0.35, y: height * 0.57 },
                ballControl: { x: width * 0.60, y: height * 0.22 },
                ballEnd: { x: width * 0.84, y: height * 0.45 },
                ballScale: 0.82,
                trailStrength: 0.72,
                attackerSpin: 360,
                timings: { prep: 420, kick: 760, shot: 1080, follow: 1540, impact: 2040, goal: 2520, fade: 3600 },
                stage: { dx: -14, dy: -7, zoom: 1.08 }
            },
            HEADER_GOAL: {
                attacker: { x: width * 0.22, y: height * 0.63, scale: 0.9 },
                defender: { x: width * 0.77, y: height * 0.53, scale: 0.82 },
                ballStart: { x: width * 0.30, y: height * 0.43 },
                ballControl: { x: width * 0.58, y: height * 0.24 },
                ballEnd: { x: width * 0.83, y: height * 0.49 },
                ballScale: 0.72,
                trailStrength: 0.64,
                headerJump: 56,
                timings: { prep: 320, kick: 620, shot: 920, follow: 1380, impact: 1860, goal: 2320, fade: 3420 },
                stage: { dx: -9, dy: -6, zoom: 1.04 }
            },
            CORNER_GOAL: {
                attacker: { x: width * 0.82, y: height * 0.70, scale: 0.88 },
                defender: { x: width * 0.20, y: height * 0.58, scale: 0.76 },
                goal: { x: width * 0.22, y: height * 0.58, scale: 1.68 },
                ballStart: { x: width * 0.74, y: height * 0.67 },
                ballControl: { x: width * 0.50, y: height * 0.36 },
                ballEnd: { x: width * 0.21, y: height * 0.56 },
                ballScale: 0.78,
                trailStrength: 0.58,
                goalImageUrl: "/img/tv-replay/goal-penalty.png",
                goalImagePosition: "center center",
                timings: { prep: 300, kick: 640, shot: 960, follow: 1450, impact: 1970, goal: 2480, fade: 3540 },
                stage: { dx: 10, dy: -5, zoom: 1.05 }
            },
            PENALTY_KICK: {
                attacker: { x: width * 0.44, y: height * 0.74, scale: 0.98 },
                defender: { x: width * 0.79, y: height * 0.45, scale: 0.78 },
                goal: { x: width * 0.84, y: height * 0.43, scale: 1.18 },
                ballStart: { x: width * 0.50, y: height * 0.69 },
                ballControl: { x: width * 0.64, y: height * 0.60 },
                ballEnd: { x: width * 0.84, y: height * 0.43 },
                ballScale: 0.70,
                trailStrength: 0.28,
                goalImageUrl: "/img/tv-replay/goal-penalty.png",
                timings: { prep: 180, kick: 420, shot: 680, follow: 1120, impact: 1560, goal: 2080, fade: 3200 },
                stage: { dx: -2, dy: 12, zoom: 1.12 }
            },
            CINEMATIC_SUPER_GOAL: {
                attacker: { x: width * 0.21, y: height * 0.63, scale: 0.98 },
                defender: { x: width * 0.77, y: height * 0.54, scale: 0.86 },
                ballStart: { x: width * 0.32, y: height * 0.58 },
                ballControl: { x: width * 0.58, y: height * 0.22 },
                ballEnd: { x: width * 0.84, y: height * 0.45 },
                ballScale: 0.86,
                trailStrength: 0.78,
                timings: { prep: 380, kick: 780, shot: 1140, follow: 1620, impact: 2100, goal: 2640, fade: 3660 },
                stage: { dx: -18, dy: -7, zoom: 1.09 }
            }
        };

        const profile = profiles[animation] || profiles.POWER_SHOT;
        return {
            animation,
            attacker: profile.attacker || base.attacker,
            defender: profile.defender || base.defender,
            goal: profile.goal || base.goal,
            ballStart: profile.ballStart || base.ballStart,
            ballControl: profile.ballControl || base.ballControl,
            ballEnd: profile.ballEnd || base.ballEnd,
            overlay: profile.overlay || base.overlay,
            goalImageUrl: profile.goalImageUrl || base.goalImageUrl,
            goalImagePosition: profile.goalImagePosition || base.goalImagePosition || "center right",
            ballScale: profile.ballScale || base.ballScale,
            trailStrength: profile.trailStrength || base.trailStrength,
            trailLength: profile.trailLength || base.trailLength,
            attackerSpin: profile.attackerSpin || base.attackerSpin || 0,
            headerJump: profile.headerJump || base.headerJump || 0,
            timings: { ...base.timings, ...(profile.timings || {}) },
            stage: { ...base.stage, ...(profile.stage || {}) }
        };
    }

    function setDomPosition(node, x, y, scale = 1, rotate = 0) {
        if (!node) {
            return;
        }

        node.style.left = `${x}px`;
        node.style.top = `${y}px`;
        if (node.classList && node.classList.contains("replay-player")) {
            node.style.setProperty("--player-scale", String(scale));
            node.style.setProperty("--player-tilt", `${rotate}deg`);
            return;
        }

        node.style.transform = `translate(-50%, -50%) scale(${scale}) rotate(${rotate}deg)`;
    }

    function setPlayerPose(player, role, progress, intensity) {
        if (!player) {
            return;
        }

        const lift = clamp(progress, 0, 1);
        const power = clamp(intensity, 0.15, 1);
        const attacking = role === "attacker";
        const armLeft = player.armLeft;
        const armRight = player.armRight;
        const legLeft = player.legLeft;
        const legRight = player.legRight;
        const lockedPose = player.root.dataset.pose === "bicycle-kick" || player.root.dataset.pose === "penalty-kick" || player.root.dataset.pose === "header-goal";

        if (attacking) {
            if (!lockedPose) {
                player.root.dataset.pose = lift > 0.55 ? "kick" : "ready";
            }
            if (!lockedPose) {
                player.root.style.setProperty("--player-tilt", `${lerp(-6, -12, lift)}deg`);
            }
            player.root.style.setProperty("--player-scale", `${1 + lift * 0.06}`);
            if (player.root.dataset.pose === "penalty-kick") {
                player.body.style.transform = `scale(${1 + lift * 0.02})`;
                if (armLeft) armLeft.style.transform = `translateY(0px) rotate(${lerp(-12, -26, lift)}deg)`;
                if (armRight) armRight.style.transform = `translateY(0px) rotate(${lerp(12, 26, lift)}deg)`;
                if (legLeft) legLeft.style.transform = `translateY(0px) rotate(${lerp(6, 12, lift)}deg)`;
                if (legRight) legRight.style.transform = `translateY(0px) rotate(${lerp(-2, -28, lift)}deg)`;
            } else if (player.root.dataset.pose === "header-goal") {
                player.body.style.transform = `scale(${1 + lift * 0.04})`;
                if (armLeft) armLeft.style.transform = `translateY(0px) rotate(${lerp(-78, -28, lift)}deg)`;
                if (armRight) armRight.style.transform = `translateY(0px) rotate(${lerp(78, 28, lift)}deg)`;
                if (legLeft) legLeft.style.transform = `translateY(0px) rotate(${lerp(6, 0, lift)}deg)`;
                if (legRight) legRight.style.transform = `translateY(0px) rotate(${lerp(-6, 0, lift)}deg)`;
            } else {
                player.body.style.transform = `scale(${1 + lift * 0.03})`;
                if (armLeft) armLeft.style.transform = `translateY(0px) rotate(${lerp(-22, -6, lift)}deg)`;
                if (armRight) armRight.style.transform = `translateY(0px) rotate(${lerp(22, 72, lift)}deg)`;
                if (legLeft) legLeft.style.transform = `translateY(0px) rotate(${lerp(8, 20, lift)}deg)`;
                if (legRight) legRight.style.transform = `translateY(0px) rotate(${lerp(-6, -68, lift)}deg)`;
            }
        } else {
            player.root.dataset.pose = lift > 0.35 ? "defend" : "ready";
            player.root.style.setProperty("--player-tilt", `${lerp(4, -3, lift)}deg`);
            player.root.style.setProperty("--player-scale", `${1 + power * 0.02}`);
            player.body.style.transform = `scale(${1 + power * 0.01})`;
            if (armLeft) armLeft.style.transform = `translateY(0px) rotate(${lerp(-52, -88, lift)}deg)`;
            if (armRight) armRight.style.transform = `translateY(0px) rotate(${lerp(52, 94, lift)}deg)`;
            if (legLeft) legLeft.style.transform = `translateY(0px) rotate(${lerp(4, 10, lift)}deg)`;
            if (legRight) legRight.style.transform = `translateY(0px) rotate(${lerp(-4, -10, lift)}deg)`;
        }
    }

    function setPlayerLogoAndLabel(player, symbol, primaryUrl, fallbackUrl) {
        if (!player) {
            return;
        }

        const fallbackLabel = normalizeString(symbol, "---").toUpperCase();
        if (player.logoFallback) {
            player.logoFallback.textContent = fallbackLabel.length > 6 ? fallbackLabel.slice(0, 6) : fallbackLabel;
        }

        setLogoForPlayer(player, fallbackLabel, primaryUrl, fallbackUrl);
    }

    function updateDomBallTrail(ballX, ballY, intensity, strength = 0.48, maxLength = 8) {
        if (!state?.dom?.trail) {
            return;
        }

        if (!state.trailHistory) {
            state.trailHistory = [];
        }

        state.trailHistory.unshift({ x: ballX, y: ballY });
        while (state.trailHistory.length > maxLength) {
            state.trailHistory.pop();
        }

        const previous = state.trailHistory[1];
        if (!previous) {
            state.dom.trail.style.opacity = "0";
            return;
        }

        const dx = ballX - previous.x;
        const dy = ballY - previous.y;
        const length = Math.max(24, Math.hypot(dx, dy));
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);
        state.dom.trail.style.left = `${previous.x}px`;
        state.dom.trail.style.top = `${previous.y}px`;
        state.dom.trail.style.width = `${length}px`;
        state.dom.trail.style.opacity = `${clamp(0.15 + (intensity * strength), 0.16, 0.82)}`;
        state.dom.trail.style.transform = `translateY(-50%) rotate(${angle}deg)`;
    }

    function spawnDomImpact(x, y, teamColor, intensity) {
        if (!state?.dom?.impact) {
            return;
        }

        const impact = state.dom.impact;
        impact.innerHTML = "";
        const count = 18;
        for (let i = 0; i < count; i += 1) {
            const particle = document.createElement("span");
            particle.className = "replay-impact__particle";
            particle.style.background = i % 2 === 0 ? teamColor : "#ffffff";
            impact.appendChild(particle);
        }

        state.particles = Array.from(impact.children).map((particle, index) => {
            const angle = (Math.PI * 2 * index) / count;
            const speed = 120 + Math.random() * 160 + intensity * 120;
            return {
                el: particle,
                x: 0,
                y: 0,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 60,
                life: 0.9 + Math.random() * 0.3
            };
        });

        state.dom.impact.style.opacity = "1";
        state.dom.impact.style.left = `${x}px`;
        state.dom.impact.style.top = `${y}px`;
    }

    function updateDomParticles(deltaSeconds) {
        if (!state?.particles?.length || !state?.dom?.impact) {
            return;
        }

        const gravity = 320;
        state.particles.forEach((particle) => {
            particle.life -= deltaSeconds;
            if (particle.life <= 0) {
                particle.el.style.opacity = "0";
                return;
            }

            particle.vy += gravity * deltaSeconds;
            particle.x += particle.vx * deltaSeconds;
            particle.y += particle.vy * deltaSeconds;
            particle.el.style.transform = `translate3d(${particle.x}px, ${particle.y}px, 0) scale(${particle.life})`;
            particle.el.style.opacity = String(clamp(particle.life, 0, 1));
        });

        state.particles = state.particles.filter((particle) => particle.life > 0);
        state.dom.impact.style.opacity = state.particles.length ? "1" : "0";
    }

    function layoutDomScene() {
        const layout = computeDomLayout();
        if (!layout || !state?.dom) {
            return;
        }

        const profile = state.domProfile || buildDomReplayProfile(state.activeReplay || {}, layout);
        const { stage, fieldBg, goal, attacker, defender, ball, overlay } = state.dom;
        const zoom = profile.stage.zoom;
        const dx = profile.stage.dx;
        const dy = profile.stage.dy;

        if (stage) {
            stage.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(${zoom})`;
        }
        if (fieldBg) {
            fieldBg.style.backgroundPosition = "center center";
        }
        if (goal) {
            setDomPosition(goal, profile.goal.x, profile.goal.y, profile.goal.scale, 0);
        }
        if (attacker?.root) {
            setDomPosition(attacker.root, profile.attacker.x, profile.attacker.y, profile.attacker.scale, 0);
        }
        if (defender?.root) {
            setDomPosition(defender.root, profile.defender.x, profile.defender.y, profile.defender.scale, 0);
        }
        if (ball) {
            setDomPosition(ball, profile.ballStart.x, profile.ballStart.y, 0.84, 0);
        }
        if (overlay) {
            overlay.style.setProperty("--overlay-x", `${profile.overlay.x}px`);
            overlay.style.setProperty("--overlay-y", `${profile.overlay.y}px`);
        }
    }

    function updateDomFrame(nowMs, token) {
        if (!state || state.disposed || token !== state.activeToken || !state.activeReplay || state.mode !== "dom") {
            return;
        }

        const event = state.activeReplay;
        const elapsedMs = nowMs - state.startedAtMs;
        const deltaSeconds = state.lastFrameMs ? (nowMs - state.lastFrameMs) / 1000 : 0;
        state.lastFrameMs = nowMs;

        updateOverlay(event, elapsedMs);
        layoutDomScene();

        const layout = state.layout;
        const profile = state.domProfile || buildDomReplayProfile(event, layout);
        const timings = profile.timings;
        const attackPrep = clamp((elapsedMs - timings.prep) / (timings.kick - timings.prep), 0, 1);
        const kick = clamp((elapsedMs - timings.kick) / Math.max(1, timings.shot - timings.kick), 0, 1);
        const shot = clamp((elapsedMs - timings.shot) / Math.max(1, timings.follow - timings.shot), 0, 1);
        const follow = clamp((elapsedMs - timings.follow) / Math.max(1, timings.impact - timings.follow), 0, 1);
        const impact = clamp((elapsedMs - timings.impact) / Math.max(1, timings.goal - timings.impact), 0, 1);
        const callout = clamp((elapsedMs - timings.goal) / Math.max(1, timings.fade - timings.goal), 0, 1);
        const fade = clamp((elapsedMs - timings.fade) / 500, 0, 1);

        const stage = state.dom.stage;
        if (stage) {
            const zoom = profile.stage.zoom + follow * 0.045;
            const dx = lerp(profile.stage.dx, profile.stage.dx - 6, follow);
            const dy = lerp(profile.stage.dy, profile.stage.dy - 3, follow);
            stage.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(${zoom})`;
        }

        const attacker = state.dom.attacker;
        const defender = state.dom.defender;
        const ball = state.dom.ball;
        const goal = state.dom.goal;
        const goalText = state.dom.goalText;
        const overlay = state.dom.overlay;

        if (attacker?.root) {
            const xBase = lerp(profile.attacker.x - 56, profile.attacker.x, attackPrep);
            const yBase = profile.attacker.y + Math.sin(nowMs / 120) * 1.5 - attackPrep * 8;
            let x = xBase;
            let y = yBase;
            let attackerTilt = profile.animation === "PENALTY_KICK"
                ? lerp(0, 360, attackPrep)
                : lerp(-4, -10, attackPrep);
            if (profile.animation === "BICYCLE_KICK") {
                const spinProgress = clamp((elapsedMs - timings.prep) / Math.max(1, timings.kick - timings.prep), 0, 1);
                const spin = (profile.attackerSpin || 360) * spinProgress;
                attackerTilt = spin - 90 + lerp(0, -22, attackPrep);
                attacker.root.dataset.pose = spinProgress > 0.6 ? "bicycle-kick" : "ready";
            } else if (profile.animation === "PENALTY_KICK") {
                attacker.root.dataset.pose = "penalty-kick";
            } else if (profile.animation === "HEADER_GOAL") {
                const jumpProgress = clamp((elapsedMs - timings.prep) / Math.max(1, timings.follow - timings.prep), 0, 1);
                const jumpArc = Math.sin(Math.PI * jumpProgress) * (profile.headerJump || 56);
                x = lerp(xBase - 10, xBase + 4, jumpProgress);
                y = yBase - jumpArc;
                attackerTilt = lerp(-2, 6, jumpProgress) - jumpArc * 0.03;
                attacker.root.dataset.pose = "header-goal";
            }
            setDomPosition(attacker.root, x, y, profile.attacker.scale * (1 + attackPrep * 0.04), attackerTilt);
            attacker.root.style.opacity = String(clamp((elapsedMs - 120) / 220, 0, 1));
            if (profile.animation === "BICYCLE_KICK") {
                setPlayerPose(attacker, "attacker", Math.max(kick, attackPrep), event.intensity);
            } else if (profile.animation === "PENALTY_KICK") {
                setPlayerPose(attacker, "attacker", attackPrep, event.intensity);
            } else if (profile.animation === "HEADER_GOAL") {
                const jumpProgress = clamp((elapsedMs - timings.prep) / Math.max(1, timings.follow - timings.prep), 0, 1);
                const jumpState = jumpProgress < 0.5 ? jumpProgress * 2 : (1 - jumpProgress) * 2;
                setPlayerPose(attacker, "attacker", jumpState, event.intensity);
            } else {
                setPlayerPose(attacker, "attacker", kick, event.intensity);
            }
        }

        if (defender?.root) {
            let x = lerp(profile.defender.x + 34, profile.defender.x, follow);
            let y = profile.defender.y - Math.sin(nowMs / 160) * 1.2;
            let rotate = lerp(8, 0, follow);

            if (profile.animation === "PENALTY_KICK") {
                const keeperDive = clamp((elapsedMs - timings.kick) / Math.max(1, timings.impact - timings.kick), 0, 1);
                x = lerp(profile.defender.x + 12, profile.defender.x - 46, keeperDive);
                y = lerp(profile.defender.y + 6, profile.defender.y - 54, keeperDive);
                rotate = lerp(-8, -28, keeperDive);
            }

            setDomPosition(defender.root, x, y, profile.defender.scale * (profile.animation === "PENALTY_KICK" ? (1 + follow * 0.08) : 1), rotate);
            defender.root.style.opacity = String(clamp((elapsedMs - 220) / 260, 0, 1));
            setPlayerPose(defender, "defender", shot, event.intensity);
        }

        const bezierPoint = (a, b, c, t) => {
            const inv = 1 - t;
            return {
                x: inv * inv * a.x + 2 * inv * t * b.x + t * t * c.x,
                y: inv * inv * a.y + 2 * inv * t * b.y + t * t * c.y
            };
        };

        let ballPoint;
        if (elapsedMs < timings.shot) {
            ballPoint = {
                x: lerp(profile.ballStart.x - 26, profile.ballStart.x + 6, attackPrep),
                y: lerp(profile.ballStart.y + 10, profile.ballStart.y - 12, kick)
            };
        } else {
            const curve = profile.animation === "PENALTY_KICK"
                ? bezierPoint(
                    profile.ballStart,
                    { x: lerp(profile.ballControl.x, profile.ballEnd.x - 24, 0.25), y: lerp(profile.ballControl.y, profile.ballEnd.y - 12, 0.35) },
                    profile.ballEnd,
                    shot
                )
                : bezierPoint(profile.ballStart, profile.ballControl, profile.ballEnd, shot);
            ballPoint = curve;
        }

        if (ball) {
            const ballScale = elapsedMs < timings.shot ? profile.ballScale : profile.ballScale + event.intensity * 0.05;
            setDomPosition(ball, ballPoint.x, ballPoint.y, ballScale, elapsedMs * 0.12);
            ball.style.opacity = "1";
            ball.style.zIndex = "80";
        }

        if (goal) {
            goal.style.opacity = "1";
            goal.style.transform = `translate(-50%, -50%) scale(${profile.goal.scale * (1 + follow * 0.02)})`;
        }
        if (state.dom.goalImage && profile.goalImagePosition) {
            state.dom.goalImage.style.objectPosition = profile.goalImagePosition;
        }

        if (elapsedMs >= 1400) {
            updateDomBallTrail(ballPoint.x, ballPoint.y, event.intensity, profile.trailStrength, profile.trailLength);
        } else if (state.dom.trail) {
            state.dom.trail.style.opacity = "0";
        }

        const impactThreshold = profile.animation === "PENALTY_KICK" ? timings.impact - 120 : timings.impact;
        if (elapsedMs >= impactThreshold && !state.impactTriggered) {
            state.impactTriggered = true;
            spawnDomImpact(ballPoint.x, ballPoint.y, event.teamColor, event.intensity);
        }

        if (state.impactTriggered) {
            updateDomParticles(deltaSeconds);
        }

        if (state.impactTriggered && goalText) {
            goalText.style.opacity = callout > 0 ? "1" : "0";
            goalText.style.transform = `translateY(${lerp(10, 0, callout)}px) scale(${lerp(0.96, 1, callout)})`;
        }

        if (overlay) {
            overlay.style.opacity = String(1 - fade * 0.95);
        }
        if (stage) {
            stage.style.opacity = String(1 - fade * 0.96);
        }

        if (elapsedMs >= replayDurationMs) {
            finishReplay(token);
            return;
        }

        state.rafId = requestAnimationFrame((nextNow) => updateDomFrame(nextNow, token));
    }

    function startDomReplay(event) {
        if (!state?.dom) {
            return;
        }

        const token = ++state.activeToken;
        state.active = true;
        state.activeReplay = event;
        state.startedAtMs = performance.now();
        state.lastFrameMs = state.startedAtMs;
        state.impactTriggered = false;
        state.trailHistory = [];
        state.particles = [];
        clearTimers();
        setOverlayVisible(true);
        updateOverlay(event, 0);
        setReplayPhase("intro");
        layoutDomScene();
        state.domProfile = buildDomReplayProfile(event, state.layout);
        layoutDomScene();
        if (state.dom?.goalImage && state.dom?.goal) {
            preloadDomImage(state.dom.goalImage, state.dom.goal, state.domProfile.goalImageUrl || "/img/tv-replay/goal-right.png", "has-asset");
        }

        const { attacker, defender, ball, trail, impact, goalText, overlay, stage } = state.dom;
        if (stage) {
            stage.style.opacity = "1";
        }
        if (overlay) {
            overlay.style.opacity = "1";
        }
        if (goalText) {
            goalText.style.opacity = "0";
            goalText.style.transform = "translateY(10px) scale(.96)";
        }
        if (trail) {
            trail.style.opacity = "0";
        }
        if (impact) {
            impact.innerHTML = "";
            impact.style.opacity = "0";
        }
        if (ball) {
            ball.style.opacity = "1";
        }

        if (attacker) {
            setPlayerLogoAndLabel(attacker, event.team, event.teamLogo, `/api/icons/binance/${encodeURIComponent(event.team)}`);
        }
        if (defender) {
            setPlayerLogoAndLabel(defender, event.opponent, event.opponentLogo, `/api/icons/binance/${encodeURIComponent(event.opponent)}`);
        }

        state.cleanupTimers.push(window.setTimeout(() => {
            if (state && token === state.activeToken) {
                setReplayPhase("goal");
            }
        }, goalCalloutMs));

        state.cleanupTimers.push(window.setTimeout(() => {
            finishReplay(token);
        }, replayDurationMs));

        logReplay("playReplay POWER_SHOT", event);
        logReplay("animation frame running");
        state.rafId = requestAnimationFrame((nowMs) => updateDomFrame(nowMs, token));
    }

    function createLogoImage(url) {
        if (!url) {
            return Promise.resolve(null);
        }

        if (logoImageCache.has(url)) {
            return logoImageCache.get(url);
        }

        const promise = fetch(url, { credentials: "include" })
            .then((response) => response.ok ? response.blob() : null)
            .then((blob) => {
                if (!blob) {
                    return null;
                }

                return new Promise((resolve) => {
                    const objectUrl = URL.createObjectURL(blob);
                    const image = new Image();
                    image.onload = () => {
                        URL.revokeObjectURL(objectUrl);
                        resolve(image);
                    };
                    image.onerror = () => {
                        URL.revokeObjectURL(objectUrl);
                        resolve(null);
                    };
                    image.src = objectUrl;
                });
            })
            .catch(() => null);

        logoImageCache.set(url, promise);
        return promise;
    }

    function applyLogoTexture(THREE, material, label, baseColor, accentColor, logoUrl, token, spriteRef) {
        const fallbackTexture = createCanvasTexture(THREE, createBadgeCanvas(label, baseColor, accentColor, null));
        material.map?.dispose?.();
        material.map = fallbackTexture;
        material.needsUpdate = true;

        if (!logoUrl) {
            return;
        }

        createLogoImage(logoUrl).then((image) => {
            if (!image) {
                if (!state || !state.disposed) {
                    logReplay("logo fallback " + label);
                }
                return;
            }

            if (spriteRef && spriteRef.userData.badgeToken !== token) {
                return;
            }

            const updatedTexture = createCanvasTexture(THREE, createBadgeCanvas(label, baseColor, accentColor, image));
            if (material.map) {
                material.map.dispose();
            }
            material.map = updatedTexture;
            material.needsUpdate = true;
            logReplay("logo loaded " + label);
        });
    }

    function logReplay(message, payload) {
        try {
            if (payload !== undefined) {
                console.info(`[ReplayEngine] ${message}`, payload);
            } else {
                console.info(`[ReplayEngine] ${message}`);
            }
        } catch {
        }
    }

    function setOverlayVisible(visible) {
        if (!state) {
            return;
        }

        state.sceneHost?.classList.toggle("is-visible", visible);
        state.overlay?.classList.toggle("is-visible", visible);
    }

    function setReplayPhase(phase) {
        if (!state?.overlay) {
            return;
        }

        state.overlay.dataset.phase = phase;
    }

    function createBadgeCanvas(label, color, accent, image) {
        const fillColor = toCssColor(color, "#53c8ff");
        const accentColor = toCssColor(accent, "#7ff6df");
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            return canvas;
        }

        const cx = 128;
        const cy = 128;
        const radius = 108;

        const gradient = ctx.createRadialGradient(cx - 24, cy - 30, 18, cx, cy, radius);
        gradient.addColorStop(0, fillColor);
        gradient.addColorStop(1, accentColor);

        ctx.clearRect(0, 0, 256, 256);
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();

        ctx.lineWidth = 16;
        ctx.strokeStyle = "rgba(255,255,255,0.24)";
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(cx, cy, 82, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(2, 6, 12, 0.56)";
        ctx.fill();

        if (image) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, 74, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(image, 56, 56, 144, 144);
            ctx.restore();
        } else {
            ctx.fillStyle = "rgba(255,255,255,0.92)";
            ctx.font = "900 72px system-ui, -apple-system, Segoe UI, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(label.slice(0, 3), cx, cy - 2);
        }

        ctx.beginPath();
        ctx.arc(cx, cy, 118, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,0.16)";
        ctx.lineWidth = 4;
        ctx.stroke();

        return canvas;
    }

    function createCanvasTexture(THREE, canvas) {
        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        if (THREE.SRGBColorSpace) {
            texture.colorSpace = THREE.SRGBColorSpace;
        }
        return texture;
    }

    function createAppendage(THREE, options) {
        const {
            length,
            radius,
            color,
            tipColor,
            tipShape = "sphere"
        } = options;
        const group = new THREE.Group();
        const limbMaterial = new THREE.MeshStandardMaterial({
            color,
            roughness: 0.55,
            metalness: 0.05
        });
        const limb = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.95, radius, length, 8), limbMaterial);
        limb.position.y = -length / 2;
        group.add(limb);

        let tip;
        if (tipShape === "box") {
            tip = new THREE.Mesh(
                new THREE.BoxGeometry(radius * 1.55, radius * 0.95, radius * 1.85),
                new THREE.MeshStandardMaterial({
                    color: tipColor || color,
                    roughness: 0.72,
                    metalness: 0.02
                })
            );
            tip.position.y = -length;
        } else {
            tip = new THREE.Mesh(
                new THREE.SphereGeometry(radius * 1.05, 12, 12),
                new THREE.MeshStandardMaterial({
                    color: tipColor || color,
                    roughness: 0.68,
                    metalness: 0.01
                })
            );
            tip.position.y = -length;
        }

        group.add(tip);
        return { group, limb, tip };
    }

    function attachPlayerLimbs(THREE, sprite, baseColor, accentColor) {
        const bodyColor = new THREE.Color(baseColor);
        const limbColor = bodyColor.clone().lerp(new THREE.Color(0x10131a), 0.22).getHex();
        const highlightColor = new THREE.Color(accentColor).getHex();

        const leftArm = createAppendage(THREE, { length: 0.42, radius: 0.04, color: limbColor, tipColor: highlightColor, tipShape: "sphere" });
        const rightArm = createAppendage(THREE, { length: 0.42, radius: 0.04, color: limbColor, tipColor: highlightColor, tipShape: "sphere" });
        const leftLeg = createAppendage(THREE, { length: 0.56, radius: 0.05, color: limbColor, tipColor: highlightColor, tipShape: "box" });
        const rightLeg = createAppendage(THREE, { length: 0.56, radius: 0.05, color: limbColor, tipColor: highlightColor, tipShape: "box" });

        leftArm.group.position.set(-0.48, 0.1, 0.18);
        rightArm.group.position.set(0.48, 0.1, -0.18);
        leftLeg.group.position.set(-0.2, -0.62, 0.14);
        rightLeg.group.position.set(0.2, -0.62, -0.14);

        leftArm.group.rotation.z = -0.75;
        rightArm.group.rotation.z = 0.72;
        leftLeg.group.rotation.z = 0.16;
        rightLeg.group.rotation.z = -0.16;

        sprite.add(leftArm.group, rightArm.group, leftLeg.group, rightLeg.group);
        sprite.userData.limbs = {
            leftArm: leftArm.group,
            rightArm: rightArm.group,
            leftLeg: leftLeg.group,
            rightLeg: rightLeg.group
        };
    }

    function buildBadgeSprite(THREE, label, baseColor, accentColor, logoUrl) {
        const fallbackCanvas = createBadgeCanvas(label, baseColor, accentColor, null);
        const texture = createCanvasTexture(THREE, fallbackCanvas);
        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthWrite: false,
            depthTest: false,
            toneMapped: false
        });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(1.45, 1.45, 1);
        sprite.renderOrder = 4;
        attachPlayerLimbs(THREE, sprite, baseColor, accentColor);
        sprite.userData.badgeToken = 0;

        if (logoUrl) {
            const badgeToken = ++sprite.userData.badgeToken;
            applyLogoTexture(THREE, material, label, baseColor, accentColor, logoUrl, badgeToken, sprite);
        }

        return sprite;
    }

    function updateBadgeSprite(sprite, label, baseColor, accentColor, logoUrl) {
        if (!sprite || !sprite.material) {
            return;
        }

        const THREE = getThree();
        sprite.userData.badgeToken = (sprite.userData.badgeToken || 0) + 1;
        const badgeToken = sprite.userData.badgeToken;
        const material = sprite.material;
        sprite.scale.set(1.45, 1.45, 1);

        applyLogoTexture(THREE, material, label, baseColor, accentColor, logoUrl, badgeToken, sprite);

        if (!logoUrl || !sprite.userData.limbs) {
            return;
        }
    }

    function buildParticleTexture(THREE) {
        const canvas = document.createElement("canvas");
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext("2d");
        if (ctx) {
            const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 28);
            gradient.addColorStop(0, "rgba(255,255,255,0.95)");
            gradient.addColorStop(0.25, "rgba(255,255,255,0.7)");
            gradient.addColorStop(1, "rgba(255,255,255,0)");
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 64, 64);
        }

        return createCanvasTexture(THREE, canvas);
    }

    function createBallTrail(THREE) {
        const historyLength = 12;
        const positions = new Float32Array(historyLength * 3);
        for (let i = 0; i < historyLength; i += 1) {
            positions[i * 3 + 0] = -5.7;
            positions[i * 3 + 1] = -0.95;
            positions[i * 3 + 2] = 0;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        const material = new THREE.LineBasicMaterial({
            color: 0xa8fff0,
            transparent: true,
            opacity: 0.0
        });
        const trail = new THREE.Line(geometry, material);
        trail.visible = false;

        return { trail, geometry, material, positions, historyLength };
    }

    function createSceneGeometry(THREE) {
        const fieldGeometry = new THREE.PlaneGeometry(24, 15);
        const fieldMaterial = new THREE.MeshPhongMaterial({
            color: 0x1a5b2d,
            shininess: 10,
            flatShading: true
        });
        const field = new THREE.Mesh(fieldGeometry, fieldMaterial);
        field.rotation.x = -Math.PI / 2;
        field.position.y = -2.05;

        const grid = new THREE.GridHelper(24, 24, 0x3ae7cf, 0x234030);
        grid.position.y = -2.03;

        const lineMaterial = new THREE.LineBasicMaterial({
            color: 0xf1ff9b,
            transparent: true,
            opacity: 0.92
        });
        const linePoints = [
            new THREE.Vector3(-11.5, -2.0, -7.1), new THREE.Vector3(11.5, -2.0, -7.1),
            new THREE.Vector3(11.5, -2.0, 7.1), new THREE.Vector3(-11.5, -2.0, 7.1), new THREE.Vector3(-11.5, -2.0, -7.1),
            new THREE.Vector3(0, -2.0, -7.1), new THREE.Vector3(0, -2.0, 7.1),
            new THREE.Vector3(-7.0, -2.0, -3.0), new THREE.Vector3(-7.0, -2.0, 3.0), new THREE.Vector3(7.0, -2.0, -3.0), new THREE.Vector3(7.0, -2.0, 3.0)
        ];
        const fieldLines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(linePoints), lineMaterial);

        const goalMaterial = new THREE.MeshPhongMaterial({
            color: 0xe8fbff,
            emissive: 0x3f8fb8,
            transparent: true,
            opacity: 0.92
        });
        const goalFrame = new THREE.Group();
        const goalX = 7.05;
        const goalWidth = 2.1;
        const goalHeight = 1.42;
        const goalDepth = 0.52;
        const postGeometry = new THREE.BoxGeometry(0.06, goalHeight, 0.06);
        const crossbarGeometry = new THREE.BoxGeometry(goalWidth, 0.06, 0.06);
        const leftPost = new THREE.Mesh(postGeometry, goalMaterial);
        const rightPost = new THREE.Mesh(postGeometry, goalMaterial);
        const crossbar = new THREE.Mesh(crossbarGeometry, goalMaterial);
        leftPost.position.set(goalX, -1.23, -goalWidth / 2);
        rightPost.position.set(goalX, -1.23, goalWidth / 2);
        crossbar.position.set(goalX, -0.5, 0);
        goalFrame.add(leftPost, rightPost, crossbar);

        const backLeft = new THREE.Mesh(new THREE.BoxGeometry(0.04, goalHeight * 0.88, 0.04), goalMaterial);
        const backRight = new THREE.Mesh(new THREE.BoxGeometry(0.04, goalHeight * 0.88, 0.04), goalMaterial);
        const backBar = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, goalWidth * 0.88), goalMaterial);
        backLeft.position.set(goalX - goalDepth, -1.24, -goalWidth / 2);
        backRight.position.set(goalX - goalDepth, -1.24, goalWidth / 2);
        backBar.position.set(goalX - goalDepth, -0.52, 0);
        goalFrame.add(backLeft, backRight, backBar);

        const net = new THREE.LineSegments(
            new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(goalX - goalDepth, -1.23, -goalWidth / 2),
                new THREE.Vector3(goalX - goalDepth, -1.23, goalWidth / 2),
                new THREE.Vector3(goalX - goalDepth, -0.52, goalWidth / 2),
                new THREE.Vector3(goalX - goalDepth, -0.52, -goalWidth / 2),
                new THREE.Vector3(goalX - goalDepth, -1.23, -goalWidth / 2)
            ]),
            new THREE.LineBasicMaterial({
                color: 0xb9f6e5,
                transparent: true,
                opacity: 0.22
            })
        );
        goalFrame.add(net);

        const ballTexture = createBallTexture(THREE);
        const ball = new THREE.Mesh(
            new THREE.SphereGeometry(0.26, 24, 24),
            new THREE.MeshStandardMaterial({
                color: 0xffffff,
                map: ballTexture,
                roughness: 0.72,
                metalness: 0.02,
                emissive: 0x0f1218,
                emissiveIntensity: 0.08
            })
        );
        ball.position.set(-5.8, -0.92, 0);
        ball.renderOrder = 20;

        const flash = new THREE.Sprite(new THREE.SpriteMaterial({
            map: buildParticleTexture(THREE),
            color: 0xffffff,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false,
            opacity: 0
        }));
        flash.scale.set(0.1, 0.1, 1);
        flash.position.set(goalX, -0.55, 0);
        flash.visible = false;
        flash.renderOrder = 30;

        const trail = createBallTrail(THREE);
        trail.trail.renderOrder = 19;

        const particleCount = 72;
        const particlePositions = new Float32Array(particleCount * 3);
        const particleVelocities = [];
        for (let i = 0; i < particleCount; i += 1) {
            particlePositions[i * 3 + 0] = 9999;
            particlePositions[i * 3 + 1] = 9999;
            particlePositions[i * 3 + 2] = 9999;
            particleVelocities.push({ x: 0, y: 0, z: 0, life: 0 });
        }

        const particleGeometry = new THREE.BufferGeometry();
        particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
        const particleMaterial = new THREE.PointsMaterial({
            color: 0xfff3b0,
            size: 0.22,
            sizeAttenuation: true,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            opacity: 0
        });
        const particlePoints = new THREE.Points(particleGeometry, particleMaterial);
        particlePoints.visible = false;
        particlePoints.renderOrder = 29;

        const attacker = buildBadgeSprite(THREE, "BTC", 0xf7931a, 0xffd194, "");
        attacker.position.set(-6.2, -0.76, -0.3);
        attacker.scale.set(1.95, 1.95, 1);
        attacker.renderOrder = 5;

        const defender = buildBadgeSprite(THREE, "SOL", 0x14f195, 0x8fffd8, "");
        defender.position.set(5.95, -0.7, 0.45);
        defender.scale.set(1.85, 1.85, 1);
        defender.renderOrder = 5;

        return {
            field,
            grid,
            fieldLines,
            goalFrame,
            ballTrail: trail.trail,
            ballTrailGeometry: trail.geometry,
            ballTrailMaterial: trail.material,
            ballTrailPositions: trail.positions,
            ballTrailHistoryLength: trail.historyLength,
            ball,
            flash,
            particleGeometry,
            particleMaterial,
            particlePoints,
            particleVelocities,
            attacker,
            defender
        };
    }

    function disposeMaterial(material) {
        if (!material) {
            return;
        }

        if (Array.isArray(material)) {
            material.forEach(disposeMaterial);
            return;
        }

        if (material.map) {
            material.map.dispose();
        }

        material.dispose();
    }

    function disposeSceneObjects() {
        if (!state) {
            return;
        }

        clearTimers();
        cancelAnimationFrame(state.rafId);
        state.rafId = 0;

        if (state.resizeObserver) {
            try {
                state.resizeObserver.disconnect();
            } catch {
            }
            state.resizeObserver = null;
        }

        if (state.scene) {
            state.scene.traverse((object) => {
                if (object.geometry) {
                    object.geometry.dispose();
                }
                if (object.material) {
                    disposeMaterial(object.material);
                }
            });
        }

        if (state.renderer) {
            try {
                state.renderer.dispose();
                state.renderer.forceContextLoss?.();
            } catch {
            }
            state.renderer = null;
        }

        state.scene = null;
        state.camera = null;
        state.particleGeometry = null;
        state.particleMaterial = null;
        state.particlePoints = null;
        state.particleVelocities = [];
        state.flash = null;
        state.field = null;
        state.grid = null;
        state.fieldLines = null;
        state.goalFrame = null;
        state.ballTrail = null;
        state.ballTrailGeometry = null;
        state.ballTrailMaterial = null;
        state.ballTrailPositions = null;
        state.ballTrailHistoryLength = 0;
        state.ballTrailHistory = [];
        state.ball = null;
        state.attacker = null;
        state.defender = null;
    }

    function resizeRenderer() {
        if (!state || !state.container) {
            return;
        }

        const rect = state.container.getBoundingClientRect();
        const fallbackWidth = Math.max(1, Math.floor(window.innerWidth || document.documentElement.clientWidth || 1280));
        const fallbackHeight = Math.max(1, Math.floor(window.innerHeight || document.documentElement.clientHeight || 720));
        const width = Math.max(1, Math.floor(rect.width || fallbackWidth));
        const height = Math.max(1, Math.floor(rect.height || fallbackHeight));
        if (state.mode === "dom") {
            state.rootWidth = width;
            state.rootHeight = height;
            layoutDomScene();
            logReplay("init container rect", { width, height, fallbackWidth, fallbackHeight });
            return;
        }

        if (!state.renderer || !state.camera) {
            return;
        }

        if (width === state.rootWidth && height === state.rootHeight) {
            return;
        }

        state.rootWidth = width;
        state.rootHeight = height;
        state.camera.aspect = width / height;
        state.camera.updateProjectionMatrix();
        state.renderer.setSize(width, height, false);
        state.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        logReplay("init container rect", { width, height, fallbackWidth, fallbackHeight });
    }

    function renderScene() {
        if (state?.renderer && state.scene && state.camera) {
            state.renderer.render(state.scene, state.camera);
        }
    }

    function updateOverlay(event, elapsedMs) {
        if (!state) {
            return;
        }

        const intensity = clamp(event.intensity, 0, 1);
        state.panel?.style.setProperty("--team-accent", event.teamColor);
        state.panel?.style.setProperty("--opponent-accent", event.opponentColor);
        state.overlay?.style.setProperty("--team-accent", event.teamColor);
        state.overlay?.style.setProperty("--opponent-accent", event.opponentColor);
        if (state.overlay) {
            state.overlay.dataset.animation = event.animation;
        }
        if (state.panel) {
            state.panel.dataset.animation = event.animation;
        }

        if (state.teamBadge) {
            state.teamBadge.style.background = event.teamColor;
        }
        if (state.opponentBadge) {
            state.opponentBadge.style.background = event.opponentColor;
        }

        if (state.title) state.title.textContent = event.animation;
        if (state.teamName) state.teamName.textContent = event.team;
        if (state.opponentName) state.opponentName.textContent = event.opponent;
        if (state.reason) state.reason.textContent = event.reason;
        if (state.value) state.value.textContent = formatPercent(event.value);
        if (state.minute) state.minute.textContent = event.minute;
        if (state.eventTypeChip) state.eventTypeChip.textContent = event.eventType;
        if (state.intensityLabel) state.intensityLabel.textContent = `Intensity ${(intensity * 100).toFixed(0)}%`;
        if (state.intensityBar) state.intensityBar.style.transform = `scaleX(${Math.max(0.14, intensity)})`;
        if (state.scoreLine) state.scoreLine.textContent = normalizeString(event.scoreLine, "0 vs 0");
        if (state.goalCallout) state.goalCallout.textContent = "GOOOOL!";

        setReplayPhase(elapsedMs >= goalCalloutMs ? "goal" : "intro");
    }

    function resetBallTrail() {
        if (!state?.ballTrailGeometry || !state.ballTrailPositions || !state.ballTrail) {
            return;
        }

        state.ballTrailHistory = [];
        for (let i = 0; i < state.ballTrailHistoryLength; i += 1) {
            state.ballTrailHistory.push(state.ball.position.clone());
        }

        const positions = state.ballTrailPositions;
        for (let i = 0; i < state.ballTrailHistory.length; i += 1) {
            const point = state.ballTrailHistory[i];
            positions[i * 3 + 0] = point.x;
            positions[i * 3 + 1] = point.y;
            positions[i * 3 + 2] = point.z;
        }

        state.ballTrailGeometry.attributes.position.needsUpdate = true;
        state.ballTrail.visible = false;
        state.ballTrailMaterial.opacity = 0;
    }

    function updateBallTrail() {
        if (!state?.ballTrailGeometry || !state.ballTrailPositions || !state.ballTrail || !state.ball) {
            return;
        }

        if (!state.ballTrailHistoryLength) {
            return;
        }

        state.ballTrailHistory.unshift(state.ball.position.clone());
        while (state.ballTrailHistory.length > state.ballTrailHistoryLength) {
            state.ballTrailHistory.pop();
        }

        const positions = state.ballTrailPositions;
        for (let i = 0; i < state.ballTrailHistoryLength; i += 1) {
            const point = state.ballTrailHistory[i] || state.ballTrailHistory[state.ballTrailHistory.length - 1];
            if (!point) {
                continue;
            }
            positions[i * 3 + 0] = point.x;
            positions[i * 3 + 1] = point.y;
            positions[i * 3 + 2] = point.z;
        }

        state.ballTrailGeometry.attributes.position.needsUpdate = true;
        state.ballTrail.visible = state.ballTrailHistory.length > 1;
        state.ballTrailMaterial.opacity = state.ballTrail.visible ? 0.48 : 0;
    }

    function setPlayerPose(sprite, role, progress, intensity) {
        if (!sprite?.userData?.limbs) {
            return;
        }

        const limbs = sprite.userData.limbs;
        const lift = clamp(progress, 0, 1);
        const power = clamp(intensity, 0.15, 1);

        if (role === "attacker") {
            sprite.rotation.z = lerp(-0.12, -0.3, lift);
            sprite.scale.setScalar(1.82 + lift * 0.1);
            limbs.leftArm.rotation.z = lerp(-0.7, -0.2, lift);
            limbs.rightArm.rotation.z = lerp(0.4, 1.18, lift);
            limbs.leftLeg.rotation.z = lerp(0.18, 0.38, lift);
            limbs.rightLeg.rotation.z = lerp(-0.2, -1.08, lift);
            limbs.rightLeg.position.y = lerp(-0.86, -0.8, lift);
        } else {
            sprite.rotation.z = lerp(0.12, -0.08, lift);
            sprite.scale.setScalar(1.76 + power * 0.06);
            limbs.leftArm.rotation.z = lerp(-0.95, -1.25, lift);
            limbs.rightArm.rotation.z = lerp(0.95, 1.26, lift);
            limbs.leftLeg.rotation.z = lerp(0.16, 0.05, lift);
            limbs.rightLeg.rotation.z = lerp(-0.16, -0.04, lift);
        }
    }

    function applyReplayToScene(event) {
        if (!state || !state.scene || !state.camera || !state.ball || !state.attacker || !state.defender) {
            return;
        }

        const THREE = getThree();
        state.activeReplay = event;
        state.impactTriggered = false;
        state.ball.position.set(-5.8, -0.92, 0);
        state.ball.rotation.set(0, 0, 0);
        state.ball.scale.setScalar(0.82);
        state.attacker.position.set(-6.2, -0.76, -0.3);
        state.attacker.scale.setScalar(1.95);
        state.defender.position.set(5.95, -0.7, 0.45);
        state.defender.scale.setScalar(1.85);
        state.flash.visible = false;
        state.flash.material.opacity = 0;
        state.flash.scale.set(0.1, 0.1, 1);
        state.particlePoints.visible = false;
        state.particleMaterial.opacity = 0;
        if (state.ballTrail) {
            state.ballTrail.visible = false;
        }
        if (state.ballTrailMaterial) {
            state.ballTrailMaterial.opacity = 0;
        }

        state.scene.background = new THREE.Color(0x06101a);
        state.scene.fog = new THREE.Fog(0x06101a, 16, 34);
        state.camera.position.set(-2.2, 5.5, 15.8);
        state.camera.lookAt(-0.4, -0.7, 0);
        if (!state.loggedFrameStart) {
            logReplay("animation frame running");
            state.loggedFrameStart = true;
        }

        const intensity = event.intensity;
        state.ballStart = new THREE.Vector3(-5.8, -0.92, 0);
        state.ballControl = new THREE.Vector3(-1.7, 3.8 + intensity * 1.3, lerp(-0.3, 1.0, intensity));
        state.ballEnd = new THREE.Vector3(6.95, -0.55, lerp(0.08, -0.34, intensity));
        state.ballTrailHistory = [];
        resetBallTrail();
        updateBadgeSprite(state.attacker, event.team, parseInt(event.teamColor.replace("#", ""), 16) || 0xf7931a, 0xffd194, event.teamLogo);
        updateBadgeSprite(state.defender, event.opponent, parseInt(event.opponentColor.replace("#", ""), 16) || 0x14f195, 0x8fffd8, event.opponentLogo);
    }

    function spawnImpactParticles(event) {
        if (!state || !state.particleGeometry || !state.particleMaterial || !state.particlePoints) {
            return;
        }

        const THREE = getThree();
        const positions = state.particleGeometry.attributes.position.array;
        const total = state.particleVelocities.length;
        const origin = state.ball.position.clone();
        const baseColor = new THREE.Color(event.teamColor);
        const sparkle = new THREE.Color(0xffffff);
        const mixColor = baseColor.clone().lerp(sparkle, 0.45);

        for (let i = 0; i < total; i += 1) {
            const angle = (Math.PI * 2 * i) / total;
            const power = 1.6 + Math.random() * 2.8 + event.intensity * 1.6;
            const lift = 0.8 + Math.random() * 1.8 + event.intensity * 0.8;

            positions[i * 3 + 0] = origin.x;
            positions[i * 3 + 1] = origin.y;
            positions[i * 3 + 2] = origin.z;
            state.particleVelocities[i] = {
                x: Math.cos(angle) * power,
                y: lift,
                z: Math.sin(angle) * power,
                life: 0.6 + Math.random() * 0.55
            };
        }

        state.particleGeometry.attributes.position.needsUpdate = true;
        state.particleMaterial.color.copy(mixColor);
        state.particleMaterial.opacity = 1;
        state.particlePoints.visible = true;
    }

    function updateParticles(deltaSeconds) {
        if (!state || !state.particleGeometry || !state.particlePoints) {
            return;
        }

        const positions = state.particleGeometry.attributes.position.array;
        let anyAlive = false;

        for (let i = 0; i < state.particleVelocities.length; i += 1) {
            const particle = state.particleVelocities[i];
            if (!particle || particle.life <= 0) {
                continue;
            }

            particle.life -= deltaSeconds;
            if (particle.life <= 0) {
                positions[i * 3 + 0] = 9999;
                positions[i * 3 + 1] = 9999;
                positions[i * 3 + 2] = 9999;
                continue;
            }

            anyAlive = true;
            positions[i * 3 + 0] += particle.x * deltaSeconds;
            positions[i * 3 + 1] += particle.y * deltaSeconds;
            positions[i * 3 + 2] += particle.z * deltaSeconds;
            particle.y -= 6.6 * deltaSeconds;
            particle.x *= 0.985;
            particle.z *= 0.985;
            particle.y *= 0.99;
        }

        state.particleGeometry.attributes.position.needsUpdate = true;
        state.particleMaterial.opacity = anyAlive ? 0.95 : 0;
        state.particlePoints.visible = anyAlive;
    }

    function finishReplay(token) {
        if (!state || token !== state.activeToken) {
            return;
        }

        state.active = false;
        state.activeReplay = null;
        state.impactTriggered = false;
        state.lastFrameMs = 0;
        setOverlayVisible(false);
        if (state.mode === "dom" && state.dom) {
            if (state.dom.stage) {
                state.dom.stage.style.opacity = "";
                state.dom.stage.style.transform = "";
            }
            if (state.dom.overlay) {
                state.dom.overlay.style.opacity = "";
            }
            if (state.dom.goalText) {
                state.dom.goalText.style.opacity = "0";
            }
            if (state.dom.trail) {
                state.dom.trail.style.opacity = "0";
            }
            if (state.dom.impact) {
                state.dom.impact.innerHTML = "";
                state.dom.impact.style.opacity = "0";
            }
            state.trailHistory = [];
            state.particles = [];
            renderScene();
            return;
        }

        if (state.sceneHost) {
            state.sceneHost.style.opacity = "";
        }
        if (state.overlay) {
            state.overlay.style.opacity = "";
        }
        if (state.ball) {
            state.ball.position.set(-5.8, -0.92, 0);
            state.ball.scale.setScalar(0.82);
        }
        if (state.flash) {
            state.flash.visible = false;
            state.flash.material.opacity = 0;
        }
        if (state.particlePoints) {
            state.particlePoints.visible = false;
        }
        if (state.particleMaterial) {
            state.particleMaterial.opacity = 0;
        }
        if (state.ballTrail) {
            state.ballTrail.visible = false;
        }
        if (state.ballTrailMaterial) {
            state.ballTrailMaterial.opacity = 0;
        }
        state.ballTrailHistory = [];
        renderScene();
    }

    function updateReplayFrame(nowMs, token) {
        if (!state || state.disposed || token !== state.activeToken || !state.activeReplay) {
            return;
        }

        const event = state.activeReplay;
        const elapsedMs = nowMs - state.startedAtMs;
        const deltaSeconds = state.lastFrameMs ? (nowMs - state.lastFrameMs) / 1000 : 0;
        state.lastFrameMs = nowMs;

        updateOverlay(event, elapsedMs);

        if (state.scene && state.camera && state.ball && state.attacker && state.defender) {
            const flightProgress = clamp((elapsedMs - shotLaunchMs) / (ballImpactMs - shotLaunchMs), 0, 1);
            const kickCharge = clamp((elapsedMs - kickStartMs) / (shotLaunchMs - kickStartMs), 0, 1);
            const followProgress = clamp((elapsedMs - 1200) / 900, 0, 1);
            const attackEase = easeOutCubic(kickCharge);
            const flightEase = easeInOutQuad(flightProgress);

            state.attacker.position.x = lerp(-6.2, -5.7, attackEase);
            state.attacker.position.y = lerp(-0.76, -0.68, attackEase) + Math.sin(nowMs / 140) * 0.025;

            state.defender.position.x = lerp(5.95, 6.25, flightEase * 0.28);
            state.defender.position.y = lerp(-0.7, -0.62, flightEase * 0.18);

            if (elapsedMs < shotLaunchMs) {
                state.ball.position.copy(state.ballStart);
                state.ball.position.x = lerp(state.ballStart.x, state.ballStart.x + 0.28, attackEase * event.intensity);
                state.ball.position.y = lerp(state.ballStart.y, state.ballStart.y + 0.72, attackEase * event.intensity);
            } else {
                const t = flightEase;
                const inv = 1 - t;
                const x = inv * inv * state.ballStart.x + 2 * inv * t * state.ballControl.x + t * t * state.ballEnd.x;
                const y = inv * inv * state.ballStart.y + 2 * inv * t * state.ballControl.y + t * t * state.ballEnd.y;
                const z = inv * inv * state.ballStart.z + 2 * inv * t * state.ballControl.z + t * t * state.ballEnd.z;
                state.ball.position.set(x, y, z);
            }

            state.ball.rotation.x += (0.18 + event.intensity * 0.18) * (0.7 + event.intensity * 0.4);
            state.ball.rotation.y += 0.11 + event.intensity * 0.08;
            state.ball.rotation.z += 0.08 + event.intensity * 0.05;
            state.ball.scale.setScalar(0.82 + Math.min(0.08, event.intensity * 0.06));

            setPlayerPose(state.attacker, "attacker", attackEase, event.intensity);
            setPlayerPose(state.defender, "defender", flightEase, event.intensity);

            const cameraBaseX = lerp(-2.2, 1.0, followProgress);
            const cameraBaseY = lerp(5.5, 4.4, followProgress);
            const cameraBaseZ = lerp(15.8, 11.8, followProgress);
            const chaseX = lerp(0, state.ball.position.x * 0.33, followProgress);
            const chaseY = lerp(0, state.ball.position.y * 0.28, followProgress);
            const chaseZ = lerp(0, state.ball.position.z * 0.16, followProgress);

            state.camera.position.x += (cameraBaseX + chaseX - state.camera.position.x) * 0.055;
            state.camera.position.y += (cameraBaseY + chaseY - state.camera.position.y) * 0.055;
            state.camera.position.z += (cameraBaseZ + chaseZ - state.camera.position.z) * 0.055;
            state.camera.lookAt(0.5, -0.55 + state.ball.position.y * 0.18, state.ball.position.z * 0.16);

            if (elapsedMs >= shotLaunchMs && elapsedMs <= fadeOutMs) {
                updateBallTrail();
            }

            if (elapsedMs >= ballImpactMs && !state.impactTriggered) {
                state.impactTriggered = true;
                spawnImpactParticles(event);
                state.flash.visible = true;
                state.flash.position.copy(state.ball.position);
                state.flash.material.opacity = 1;
                state.flash.scale.setScalar(0.1);
            }

            if (state.impactTriggered) {
                const flashAge = clamp((elapsedMs - ballImpactMs) / 650, 0, 1);
                state.flash.scale.setScalar(0.3 + flashAge * (2.4 + event.intensity * 1.6));
                state.flash.material.opacity = Math.max(0, 1 - flashAge);
                state.flash.position.copy(state.ball.position);
                state.ball.scale.setScalar(0.88 + (1 - flashAge) * 0.12);
            }

            if (elapsedMs >= fadeOutMs) {
                const fadeProgress = clamp((elapsedMs - fadeOutMs) / 500, 0, 1);
                if (state.overlay) {
                    state.overlay.style.opacity = String(1 - fadeProgress);
                }
                if (state.sceneHost) {
                    state.sceneHost.style.opacity = String(1 - fadeProgress * 0.92);
                }
            }

            updateParticles(deltaSeconds);
            renderScene();
        }

        if (elapsedMs >= replayDurationMs) {
            finishReplay(token);
            return;
        }

        state.rafId = requestAnimationFrame((nextNow) => updateReplayFrame(nextNow, token));
    }

    function applyReplayFallback(event) {
        const token = ++state.activeToken;
        state.active = true;
        state.activeReplay = event;
        state.startedAtMs = performance.now();
        state.lastFrameMs = state.startedAtMs;
        setOverlayVisible(true);
        updateOverlay(event, 0);
        setReplayPhase("intro");
        clearTimers();

        state.cleanupTimers.push(window.setTimeout(() => {
            if (state && token === state.activeToken) {
                setReplayPhase("goal");
            }
        }, goalCalloutMs));

        state.cleanupTimers.push(window.setTimeout(() => {
            finishReplay(token);
        }, replayDurationMs));
    }

    async function init(containerId) {
        const container = document.getElementById(containerId);
        if (!container) {
            return;
        }

        const current = ensureState();
        if (current.container === container && current.sceneHost) {
            return;
        }

        dispose();

        state = ensureState();
        state.container = container;
        state.disposed = false;

        buildOverlayMarkup(container);

        state.sceneHost = container.querySelector("[data-role='stage']");
        state.overlay = container.querySelector("[data-role='overlay']");
        state.panel = container.querySelector("[data-role='panel']");
        state.goalCallout = container.querySelector("[data-role='goal-text']");
        state.title = container.querySelector("[data-role='title']");
        state.teamName = container.querySelector("[data-role='team-name']");
        state.opponentName = container.querySelector("[data-role='opponent-name']");
        state.reason = container.querySelector("[data-role='reason']");
        state.value = container.querySelector("[data-role='value']");
        state.minute = container.querySelector("[data-role='minute']");
        state.eventTypeChip = container.querySelector("[data-role='event-type']");
        state.intensityLabel = container.querySelector("[data-role='intensity-label']");
        state.intensityBar = container.querySelector("[data-role='intensity-bar']");
        state.scoreLine = container.querySelector("[data-role='score-line']");
        state.teamBadge = container.querySelector("[data-role='team-badge']");
        state.opponentBadge = container.querySelector("[data-role='opponent-badge']");
        state.canvas = container.querySelector("[data-role='canvas']");

        if (state.sceneHost) {
            state.sceneHost.style.position = "absolute";
            state.sceneHost.style.inset = "0";
            state.sceneHost.style.width = "100%";
            state.sceneHost.style.height = "100%";
            state.sceneHost.style.zIndex = "1";
        }

        if (state.canvas) {
            state.canvas.style.position = "absolute";
            state.canvas.style.inset = "0";
            state.canvas.style.width = "100%";
            state.canvas.style.height = "100%";
            state.canvas.style.display = "block";
            state.canvas.style.zIndex = "1";
        }

        if (state.overlay) {
            state.overlay.style.position = "absolute";
            state.overlay.style.inset = "0";
            state.overlay.style.zIndex = "2";
        }

        state.mode = "dom";
        state.threeAvailable = false;
        state.dom = {
            stage: state.sceneHost,
            fieldBg: container.querySelector("[data-role='field-bg']"),
            goal: container.querySelector("[data-role='goal']"),
            goalImage: container.querySelector("[data-role='goal-image']"),
            attacker: createPlayerDomRefs(container.querySelector("[data-role='attacker']")),
            defender: createPlayerDomRefs(container.querySelector("[data-role='defender']")),
            ball: container.querySelector("[data-role='ball']"),
            trail: container.querySelector("[data-role='trail']"),
            impact: container.querySelector("[data-role='impact']"),
            overlay: state.overlay,
            panel: state.panel,
            goalText: container.querySelector("[data-role='goal-text']")
        };

        state.domProfile = null;
        prepareDomReplayAssets();
        resizeRenderer();
        state.resizeObserver = new ResizeObserver(() => resizeRenderer());
        state.resizeObserver.observe(state.container);
        return;
    }

    async function playReplay(event) {
        const normalized = normalizeEvent(event);
        const current = ensureState();
        if (!current.container) {
            await init("tv-replay-root");
        }

        if (!state || !state.container) {
            return;
        }

        clearTimers();
        setOverlayVisible(true);
        if (state.sceneHost) {
            state.sceneHost.style.opacity = "1";
        }
        if (state.overlay) {
            state.overlay.style.opacity = "1";
        }
        updateOverlay(normalized, 0);

        if (state.mode === "dom") {
            startDomReplay(normalized);
            return;
        }

        if (!state.threeAvailable || !getThree()) {
            applyReplayFallback(normalized);
            return;
        }

        logReplay("playReplay POWER_SHOT", normalized);
        state.activeToken += 1;
        const token = state.activeToken;
        state.active = true;
        state.startedAtMs = performance.now();
        state.lastFrameMs = state.startedAtMs;

        applyReplayToScene(normalized);

        cancelAnimationFrame(state.rafId);
        state.rafId = requestAnimationFrame((nowMs) => updateReplayFrame(nowMs, token));
    }

    function dispose() {
        if (!state) {
            return;
        }

        state.activeToken += 1;
        state.disposed = true;
        clearTimers();
        cancelAnimationFrame(state.rafId);
        state.rafId = 0;
        disposeSceneObjects();

        if (state.container) {
            state.container.innerHTML = "";
        }

        state.container = null;
        state.sceneHost = null;
        state.overlay = null;
        state.panel = null;
        state.goalCallout = null;
        state.title = null;
        state.teamName = null;
        state.opponentName = null;
        state.reason = null;
        state.value = null;
        state.minute = null;
        state.eventTypeChip = null;
        state.intensityLabel = null;
        state.intensityBar = null;
        state.scoreLine = null;
        state.teamBadge = null;
        state.opponentBadge = null;
        state.canvas = null;
        state.activeReplay = null;
        state.active = false;
        state.dom = null;
        state.domProfile = null;
        state.trailHistory = [];
        state.particles = [];
        state.threeAvailable = false;
        state.threeModule = null;
        state.loggedFrameStart = false;
        state = null;
        threeModulePromise = null;
    }

    window.criptoVersusReplay = {
        init,
        playReplay,
        dispose
    };
})();
