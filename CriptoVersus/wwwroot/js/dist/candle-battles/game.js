import { MarketHeartbeat, BattleClock, BattleStateMachine, FinaleStateMachine, TerritoryManager, TEAM, PERIOD, MATCH_DURATION, MATCH_ROUNDS, demoRound, sharedRange, validRound, roundInMatch, clockParts, nextCandleCountdown, combatFrame, combatAdvantage, resolveFinalePose, FINALE_PHASES } from './model.js?v=20261030a';
import { impactLevel, personalityFor, resolveCombatState, CombatSequencer } from './combat-animations.js?v=20261030a';
import { CandleRenderer } from './renderer.js?v=20261030a';
import { AudioManager } from './audio.js?v=20261030a';
import { DialogueClock, lineDuration } from './dialogue.js?v=20261030a';
import { CandleBattleDialogueEngine } from './dialogue-engine.js?v=20261030a';
import { MoneyFlowController } from './money-flow-visual.js?v=20261030a';
const displaySymbol = (symbol) => symbol.replace(/USDT$/i, '');
export async function create(host, options) {
    const url = '/games/candle-battles/vendor/phaser-3.90.0.esm.min.js';
    const Phaser = await import(url);
    const engine = new GameEngine(host, options, Phaser);
    try {
        await engine.ready;
        return engine;
    }
    catch (error) {
        engine.dispose();
        throw error;
    }
}
export class GameEngine {
    constructor(host, options, Phaser) {
        this.host = host;
        this.options = options;
        this.showAllHistory = false;
        this.lastDashboardSecond = -1;
        this.logos = new Map();
        this.logoSymbols = new Map();
        this.logoFallbacks = new Map();
        this.loadingLogos = new Set();
        this.ownedLogoTextures = new Set();
        this.prices = { left: [], right: [] };
        this.hud = new Map();
        this.tileImages = [];
        this.effects = [];
        this.market = new MarketHeartbeat();
        this.clock = new BattleClock();
        this.territory = new TerritoryManager();
        this.audio = new AudioManager();
        this.history = [];
        this.replayHistory = [];
        this.paused = false;
        this.captureFrozen = false;
        this.started = false;
        this.reduced = false;
        this.speed = 1;
        this.demoIndex = 0;
        this.demoElapsed = 0;
        this.replayIndex = 0;
        this.replayElapsed = 0;
        this.focusRound = -1;
        this.autoplayInitialized = false;
        this.catchUpReplay = false;
        this.completedRounds = 0;
        this.terminal = false;
        this.serverReceivedAt = 0;
        this.flash = 0;
        this.disposed = false;
        this.pendingReconcile = false;
        this.backgrounded = false;
        this.time = 0;
        this.combatElapsed = 0;
        /** In-round combat beats. Presentation only: never touches score or rounds. */
        this.combatSequencer = { left: new CombatSequencer(), right: new CombatSequencer() };
        this.combatPlans = { left: undefined, right: undefined };
        this.roundEvent = 'none';
        this.lastLeader = null;
        this.roundImpact = { left: undefined, right: undefined };
        this.dialogue = new DialogueClock();
        this.dialogueEngine = new CandleBattleDialogueEngine();
        this.finaleElapsed = 0;
        /** Closing cinematic. Presentation-only: never touches score, candles or rounds. */
        this.finaleSequence = new FinaleStateMachine();
        this.finaleRoles = { left: 'draw', right: 'draw' };
        this.finaleIntensity = 1;
        this.mode = options.mode;
        this.state = new BattleStateMachine(options.battleDurationMs);
        this.bubble = host.querySelector('[data-cb-bubble]');
        this.ready = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
        this.readyTimer = setTimeout(() => this.readyReject(new Error('Candle Battles asset load timeout')), 20000);
        this.controls = host.closest('.candle-battles') ?? host;
        this.dashboard = this.controls.querySelector('[data-cb-shell]');
        this.shell = options.shell ?? !!this.dashboard;
        this.controlClick = (event) => { const button = event.target.closest('button[data-cb-action]'); if (button)
            this.command(button.dataset.cbAction); };
        this.controlInput = (event) => { const element = event.target; if (element.dataset.cbAction)
            this.command(element.dataset.cbAction, Number(element.value)); };
        this.controls.addEventListener('click', this.controlClick);
        this.controls.addEventListener('input', this.controlInput);
        this.motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
        this.reduced = options.reducedMotion ?? this.motionQuery.matches;
        const owner = this;
        class BattleScene extends Phaser.Scene {
            constructor() { super('CandleBattles'); }
            preload() {
                this.load.on('loaderror', (file) => {
                    // candle-finishers is optional: its absence only selects the
                    // modular.png fallback. Every other asset failure is fatal.
                    if (String(file?.key) === 'candle-finishers') {
                        console.warn(`Candle Battles: optional finisher atlas unavailable (${String(file.src)}); keeping modular.png fallback.`);
                        return;
                    }
                    owner.readyReject(new Error(`Candle Battles asset failed to load: ${String(file.key)} (${String(file.src)})`));
                });
                this.load.atlas('modular', '/games/candle-battles/assets/modular.png?v=20261015d', '/games/candle-battles/assets/modular.json?v=20261015d');
                this.load.atlas('candle-finishers', '/games/candle-battles/assets/candle-finishers.png?v=20261024f', '/games/candle-battles/assets/candle-finishers.json?v=20261024f');
            }
            create() { owner.setup(this); }
            update(_time, delta) { owner.update(delta); }
        }
        this.game = new Phaser.Game({ type: Phaser.AUTO, parent: host, width: 1280, height: this.shell ? 480 : 800,
            backgroundColor: '#101722', transparent: false, antialias: true,
            scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
            render: { preserveDrawingBuffer: false }, audio: { noAudio: true }, scene: BattleScene,
            banner: false, fps: { target: 60 }, input: { keyboard: false, mouse: false, touch: false } });
        this.observer = new ResizeObserver(() => { if (!this.disposed)
            this.game.scale.refresh(); });
        this.observer.observe(host);
        this.backgrounded = document.hidden;
        this.visibility = () => {
            this.backgrounded = document.hidden;
            if (document.hidden)
                this.audio.pause();
            else {
                // Wake and paint from the deterministic simulation state; no
                // timer or browser-focus side effect is used to advance it.
                this.game.loop.wake();
                if (this.mode === 'live') {
                    this.pendingReconcile = true;
                    if (this.feed)
                        this.reconcile();
                }
                else if (this.started && !this.paused)
                    this.audio.loop('arena');
                if (!this.paused)
                    this.update(0);
            }
        };
        document.addEventListener('visibilitychange', this.visibility);
        this.motionChange = () => { this.reduced = this.motionQuery.matches; this.left?.setReducedMotion(this.reduced); this.right?.setReducedMotion(this.reduced); };
        this.motionQuery.addEventListener('change', this.motionChange);
    }
    text(key, fallback = key) { return this.options.labels[key] ?? fallback; }
    setup(scene) {
        if (this.disposed)
            return;
        this.scene = scene;
        this.scenery = scene.add.graphics();
        this.grid = scene.add.graphics();
        if (this.shell)
            this.drawStadium();
        else {
            const g = this.scenery;
            g.fillGradientStyle(0x182430, 0x182430, 0x080e16, 0x080e16).fillRect(0, 0, 1280, 800);
            for (let i = 0; i < 7; i++) {
                g.fillStyle(0x243342, .32).fillRect(0, 210 + i * 30, 240 - i * 18, 12).fillRect(1040 + i * 18, 210 + i * 30, 240 - i * 18, 12);
            }
            g.lineStyle(1, 0x648395, .12);
            for (let x = 0; x < 1280; x += 40)
                g.lineBetween(x, 170, x, 460);
            for (let y = 170; y < 460; y += 40)
                g.lineBetween(0, y, 1280, y);
            g.lineStyle(3, 0x668789, .5).lineBetween(35, 451, 1245, 451);
            g.fillStyle(0x1e2430, .9).fillRoundedRect(24, 24, 1232, 154, 16);
            g.lineStyle(1, 0x4c6069, .45).strokeRoundedRect(24, 24, 1232, 154, 16);
        }
        this.label('brand', 'CANDLE BATTLES', 640, 42, 30, '#f3f5f7', .5);
        this.label('subtitle', this.text('arcade'), 640, 80, 14, '#94a3b8', .5);
        this.label('mode', this.mode.toUpperCase() + ' · 5M', 640, 181, 13, '#c1f20f', .5);
        this.label('leftName', '—', 124, 48, 30, '#c1f20f');
        this.label('rightName', '—', 1150, 48, 30, '#30d7ca', 1);
        this.label('leftPrice', '—', 62, 120, 18);
        this.label('rightPrice', '—', 1218, 120, 18, '#f3f5f7', 1);
        this.label('score', '0 : 0', 640, 105, 34, '#f3f5f7', .5);
        this.label('status', this.text('waiting'), 640, 201, 16, '#94a3b8', .5);
        this.label('result', '', 640, 225, 24, '#f3f5f7', .5);
        this.label('matchTime', '', 265, 145, 16, '#f3f5f7', .5);
        this.label('nextBattle', '', 1015, 145, 16, '#c1f20f', .5);
        this.label('round', '', 640, 151, 15, '#94a3b8', .5);
        this.label('leftStrength', '', 70, 411, 17, '#c1f20f');
        this.label('rightStrength', '', 1210, 411, 17, '#30d7ca', 1);
        this.label('history', this.text('recent'), 48, 470, 17);
        this.label('lines', this.text('lines') + ' 0', 1230, 470, 17, '#94a3b8', 1);
        this.label('recent', '', 48, 502, 14, '#94a3b8');
        this.label('territory', this.text('territory'), 640, 744, 16, '#94a3b8', .5);
        this.label('percent', '50% / 50%', 640, 772, 16, '#f3f5f7', .5);
        this.chart = scene.add.graphics();
        this.lineFlash = scene.add.graphics().setDepth(20);
        this.left = new CandleRenderer(scene, 'left', 330, this.shell ? 185 : 260);
        this.right = new CandleRenderer(scene, 'right', 950, this.shell ? 185 : 260);
        if (this.options.moneyFlowVisualEffects && !this.options.socialCapture)
            this.moneyFlow = new MoneyFlowController(scene);
        if (this.shell) {
            this.left.root.setDepth(2);
            this.right.root.setDepth(2);
            for (const side of ['left', 'right']) {
                const x = side === 'left' ? 97 : 1183;
                const color = side === 'left' ? 0xb8ff00 : 0x31d3d0;
                scene.add.graphics().fillStyle(color, .11).fillCircle(x, 237, 51).setDepth(.4);
            }
        }
        this.left.setReducedMotion(this.reduced);
        this.right.setReducedMotion(this.reduced);
        if (this.shell) {
            this.left.setPresentationScale(1.55);
            this.right.setPresentationScale(1.55);
        }
        if (this.shell) {
            for (const label of this.hud.values())
                label.setVisible(false);
            this.chart?.setVisible(false);
            this.grid?.setVisible(false);
        }
        this.drawTerritory();
        if (this.options.socialCapture) {
            this.frameCapturePoster(scene);
            // Hide the arena until the poster frame is mounted so the capture
            // never shows an intermediate or first-battle frame.
            this.game.canvas.style.visibility = 'hidden';
            this.left?.freezePose();
            this.right?.freezePose();
        }
        if (this.feed)
            this.receive(this.feed, this.pendingReconcile);
        if (this.mode === 'demo') {
            this.showDemoForming(0);
            this.command('start');
        }
        if (this.readyTimer)
            clearTimeout(this.readyTimer);
        this.readyResolve();
        this.host.dataset.ready = 'true';
        this.host.dispatchEvent(new CustomEvent('candle-battles-ready'));
        this.ensureFrameLoop();
    }
    label(id, text, x, y, size = 18, color = '#f3f5f7', origin = 0) {
        this.hud.set(id, this.scene.add.text(x, y, text, { fontFamily: 'system-ui, sans-serif', fontSize: size + 'px', color, fontStyle: 'bold' }).setOrigin(origin, 0));
    }
    drawStadium() {
        const g = this.scenery;
        g.fillGradientStyle(0x0b2233, 0x0b2233, 0x04101b, 0x04101b).fillRect(0, 0, 1280, 480);
        g.fillGradientStyle(0x12364b, 0x071a2c, 0x0a1726, 0x0b3545, .45, .22, .08, .36).fillRect(0, 0, 1280, 340);
        for (let side = 0; side < 2; side++) {
            const x = side ? 1180 : 100, color = side ? 0x31d3d0 : 0xb8ff00;
            g.fillStyle(color, .11).fillTriangle(x - 70, 55, x + 70, 55, side ? 980 : 300, 350);
            g.fillStyle(color, .65).fillRoundedRect(x - 52, 45, 104, 5, 2);
            g.fillStyle(0xffffff, .65).fillCircle(x, 48, 8);
            g.lineStyle(2, color, .28).strokeRoundedRect(side ? 1110 : 25, 145, 145, 185, 8);
            g.fillStyle(color, .12).fillRoundedRect(side ? 1115 : 30, 150, 135, 175, 5);
        }
        g.fillStyle(0x092337, .8).fillEllipse(640, 175, 1420, 285);
        for (let row = 0; row < 5; row++) {
            g.lineStyle(3, 0x226484, .25 + row * .04).strokeEllipse(640, 155 + row * 14, 1470 - row * 50, 250 + row * 6);
            for (let x = 35; x < 1280; x += 35) {
                const glow = (x * 37 + row * 19) % 7 === 0;
                g.fillStyle(glow ? 0x9bc6d4 : 0x284454, glow ? .55 : .27).fillCircle(x, 125 + row * 29, glow ? 3 : 2);
            }
        }
        g.fillStyle(0x061828).fillRect(0, 330, 1280, 150);
        g.lineStyle(2, 0x416179, .4).lineBetween(0, 345, 1280, 345);
        for (let i = -6; i <= 6; i++)
            g.lineStyle(2, 0x2786a4, .22).lineBetween(640 + i * 60, 345, 640 + i * 150, 480);
        for (let y = 365; y < 480; y += 28)
            g.lineStyle(1, 0x2786a4, .28).lineBetween(0, y, 1280, y);
        g.fillStyle(0xb8ff00, .08).fillEllipse(320, 410, 440, 80);
        g.fillStyle(0x31d3d0, .09).fillEllipse(960, 410, 440, 80);
        g.lineStyle(4, 0xb8ff00, .55).lineBetween(25, 355, 180, 355);
        g.lineStyle(4, 0x31d3d0, .55).lineBetween(1100, 355, 1255, 355);
        for (let i = 0; i < 5; i++) {
            g.fillStyle(0xc8ee75, .12).fillCircle(65 + i * 35, 285 + i * 10, 5);
            g.fillStyle(0x73f2ff, .12).fillCircle(1215 - i * 35, 285 + i * 10, 5);
        }
    }
    receive(feed, reconcile = false) {
        if (this.disposed || this.captureFrozen)
            return;
        if (this.feed && this.feed.matchId !== feed.matchId) {
            this.history = [];
            this.market.clear();
            this.clock.clear();
            this.territory.reset();
            this.active = undefined;
            this.combatElapsed = 0;
            this.state.reset();
            this.autoplayInitialized = false;
            this.catchUpReplay = false;
            this.terminal = false;
            this.resetFinale();
            this.clearDialogue();
        }
        this.feed = feed;
        this.pendingReconcile || (this.pendingReconcile = reconcile);
        this.moneyFlow?.setLiveMatch(feed.matchId, feed.leftSymbol, feed.rightSymbol, this.mode === 'live' && !feed.finished);
        if (feed.serverTime != null && Number.isFinite(feed.serverTime)) {
            this.serverAnchorMs = feed.serverTime;
            this.serverReceivedAt = performance.now();
        }
        if (!this.scene)
            return;
        for (const side of ['left', 'right']) {
            const candle = feed[side];
            const previous = this.market.get(side);
            if (candle && this.market.accept(side, candle)) {
                this.audio.play('data_tick');
                if (previous && Math.sign(previous.close - previous.open) !== Math.sign(candle.close - candle.open) && candle.close !== candle.open)
                    this.audio.play(candle.close > candle.open ? 'buy_green' : 'sell_red');
                this.prices[side].push(candle.close);
                if (this.prices[side].length > 30)
                    this.prices[side].shift();
            }
        }
        const known = new Set(this.history.map(r => r.id));
        const fresh = feed.rounds.filter(r => r.matchId === feed.matchId && validRound(r) && !known.has(r.id)
            && (feed.matchStartTime == null || roundInMatch(r, feed.matchStartTime, feed.matchEndTime)));
        this.history.push(...fresh);
        this.history.sort((a, b) => a.left.openTime - b.left.openTime);
        if (!this.autoplayInitialized && feed.matchStartTime != null) {
            this.autoplayInitialized = true;
            if (this.history.length) {
                this.catchUpReplay = this.options.autoplay !== false;
                this.replayHistory = this.history.map(r => ({ ...r, left: { ...r.left }, right: { ...r.right } }));
                this.mode = 'replay';
                this.setSpeed(this.options.autoplay === false ? 1 : 5);
                this.restart();
                if (this.options.autoplay === false) {
                    this.started = false;
                    this.paused = true;
                    this.host.dataset.paused = 'true';
                }
            }
            else {
                this.mode = 'live';
                this.started = true;
                this.reconcile();
            }
            this.host.dataset.mode = this.mode;
            this.hud.get('mode')?.setText(this.mode.toUpperCase() + ' · 5M');
        }
        if (this.mode === 'live') {
            if (this.pendingReconcile)
                this.reconcile();
            else
                for (const round of fresh)
                    this.clock.enqueue(round);
            this.hud.get('status')?.setText(this.text(feed.finished ? 'finished' : feed.status === 'live' ? 'forming' : 'waiting'));
        }
        else if (this.mode === 'replay')
            this.hud.get('status')?.setText(this.text('forming'));
        this.setLogo('left', feed.leftSymbol);
        this.setLogo('right', feed.rightSymbol);
        this.releaseUnusedLogoTextures();
        this.hud.get('leftName')?.setText(displaySymbol(feed.leftSymbol));
        this.hud.get('rightName')?.setText(displaySymbol(feed.rightSymbol));
        if (this.options.socialCapture) {
            this.mountCapturePoster();
            return;
        }
        this.updateMarket();
        if (!this.paused) {
            this.ensureFrameLoop();
            this.updateClocks();
        }
        this.updateDashboard(true);
        if (!this.paused && feed.finished && this.mode === 'live' && !this.active && this.clock.count === 0)
            this.finish();
        this.maybeFreezeForCapture();
    }
    /**
     * The Phaser visibility handler pauses its frame loop on blur.  Wake it
     * whenever a visible renderer receives replay state so direct navigation
     * into a completed social match cannot wait for a later focus transition.
     */
    ensureFrameLoop() {
        if (!this.disposed && !this.paused && !document.hidden)
            this.game.loop.wake();
    }
    // Social capture mounts one poster frame directly: the persisted history is
    // applied without cinematics and the fighters hold their final pose, so the
    // capture never runs the replay timeline. A captureTarget may pin a specific
    // confrontation/phase for frame-accurate deterministic screenshots.
    mountCapturePoster() {
        this.clearDialogue();
        this.autoplayInitialized = true;
        this.mode = 'live';
        this.started = true;
        this.catchUpReplay = false;
        this.active = undefined;
        this.combatElapsed = 0;
        this.clock.clear();
        this.territory.reset();
        this.state.reset();
        this.completedRounds = 0;
        this.updateMarket();
        const rounds = this.history;
        const target = this.options.captureTarget;
        const total = rounds.length;
        const focus = total === 0 ? null : Math.max(0, Math.min(total - 1, Math.round(target?.round ?? total - 1)));
        const phase = target?.phase ?? null;
        const midBattle = phase !== null && ['SPAWNING', 'APPROACHING', 'ATTACKING', 'COLLISION', 'DESTROYING'].includes(phase);
        const applyCount = focus == null ? 0 : focus + (midBattle ? 0 : 1);
        for (const r of rounds.slice(0, applyCount)) {
            this.territory.apply(r);
            this.clock.enqueue(r);
        }
        while (this.clock.next()) { /* deduplication baseline only, no cinematics */ }
        this.completedRounds = applyCount;
        this.left?.root.setPosition(330, this.shell ? 185 : 260);
        this.right?.root.setPosition(950, this.shell ? 185 : 260);
        this.left?.resetPresentation();
        this.right?.resetPresentation();
        const focused = focus == null ? undefined : rounds[focus];
        if (focused) {
            const range = sharedRange([focused.left, focused.right]);
            this.left?.setCandle(focused.left, range, true);
            this.right?.setCandle(focused.right, range, true);
            if (phase) {
                const asPhase = phase;
                this.left?.setPose(asPhase, focused.winner === 'left', focused.winner === 'draw');
                this.right?.setPose(asPhase, focused.winner === 'right', focused.winner === 'draw');
            }
        }
        // Asset logos load asynchronously: hold the poster until the textures
        // settle so the captured frame never shows a placeholder.
        const settle = () => {
            if (this.disposed || this.captureFrozen)
                return;
            if (this.loadingLogos.size > 0) {
                this.scene?.load.once('complete', settle);
                return;
            }
            if (phase)
                this.freezeForCapture(true);
            else if (this.feed?.finished)
                this.finish();
            else
                this.freezeForCapture();
        };
        settle();
    }
    reconcile() {
        if (!this.terminal)
            this.clearDialogue();
        this.active = undefined;
        this.state.reset();
        this.clock.clear();
        this.territory.reset();
        this.tile?.destroy();
        this.tile = undefined;
        this.dropTarget = undefined;
        for (const e of this.effects)
            e.image.destroy();
        this.effects = [];
        for (const r of this.history) {
            this.territory.apply(r);
            this.clock.enqueue(r);
        }
        while (this.clock.next()) { /* establish deduplication baseline without cinematics */ }
        this.pendingReconcile = false;
        this.hud.get('result')?.setText('');
        this.left?.resetPresentation();
        this.right?.resetPresentation();
        this.left?.root.setPosition(330, this.shell ? 185 : 260);
        this.right?.root.setPosition(950, this.shell ? 185 : 260);
        this.drawTerritory();
        this.updateMarket();
        this.completedRounds = this.history.length;
        if (this.feed?.finished)
            this.finish();
        // Rebuilds clear every pose, so an already-decided match settles the
        // cinematic again to restore the definitive composition.
        if (this.terminal)
            this.finaleSequence.settle(phase => this.enterFinale(phase));
        this.updateDashboard(true);
    }
    updateMarket() {
        if (this.mode === "replay")
            return;
        const a = this.market.get('left'), b = this.market.get('right');
        for (const [side, c] of [['left', a], ['right', b]])
            if (c) {
                const pct = (c.close / c.open - 1) * 100;
                this.hud.get(side + 'Strength')?.setText(this.text('nextStrength') + ' ' + (c.strength?.toFixed(1) ?? '—'));
                this.hud.get(side + 'Price')?.setText(c.close.toLocaleString(undefined, { maximumSignificantDigits: 10 }) + '  ' + (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%');
            }
        this.drawCharts();
        if (this.active)
            return;
        const range = sharedRange([a, b].filter((x) => !!x));
        if (a)
            this.left?.setCandle(a, range);
        if (b)
            this.right?.setCandle(b, range);
    }
    command(action, value) {
        if (this.disposed)
            return;
        // Social capture never runs playback: only the idempotent freeze exists.
        if (this.options.socialCapture && action !== 'socialFreeze')
            return;
        this.audio.unlock();
        if (['start', 'replay', 'restart', 'live'].includes(action))
            this.audio.play('menu_select');
        if (action === 'start') {
            this.started = true;
            this.paused = false;
            this.audio.loop('arena');
        }
        if (action === 'pause') {
            this.paused = !this.paused;
            this.audio.play('pause');
            if (this.paused)
                this.audio.pause();
            else
                this.audio.loop('arena');
        }
        if (action === 'mute') {
            this.audio.configure(this.audio.master, this.audio.musicVolume, this.audio.effectsVolume, !this.audio.muted);
            this.audio.loop(this.started ? 'arena' : 'menu');
        }
        if (action === 'volume')
            this.audio.configure(value ?? .65, this.audio.musicVolume, this.audio.effectsVolume, this.audio.muted);
        if (action === 'music')
            this.audio.configure(this.audio.master, value ?? .35, this.audio.effectsVolume, this.audio.muted);
        if (action === 'effects')
            this.audio.configure(this.audio.master, this.audio.musicVolume, value ?? .7, this.audio.muted);
        if (action === 'speed' && [1, 2, 5, 10].includes(value ?? 0))
            this.setSpeed(value);
        if (action === 'fullscreen') {
            if (document.fullscreenElement)
                void document.exitFullscreen().catch(() => { });
            else
                void this.host.parentElement?.requestFullscreen().catch(() => { });
        }
        if (action === 'replay') {
            this.catchUpReplay = false;
            this.replayHistory = this.history.map(r => ({ ...r, left: { ...r.left }, right: { ...r.right } }));
            this.mode = 'replay';
            this.restart();
        }
        if (action === 'live' && this.options.mode === 'live') {
            this.catchUpReplay = false;
            this.mode = 'live';
            this.terminal = false;
            this.setSpeed(1);
            this.reconcile();
        }
        if (action === 'restart')
            this.restart();
        if (action === 'history')
            this.showAllHistory = !this.showAllHistory;
        if (action === 'socialFreeze')
            this.freezeForCapture();
        // Timeline inspection commands (dev tooling). They only move the
        // replay simulation clock; production controls never emit them.
        if (action === 'seek' && Number.isFinite(value))
            this.seekRound(Number(value));
        if (action === 'step' && Number.isFinite(value))
            this.seekRound(this.focusRound + (Number(value) < 0 ? -1 : 1));
        if (action === 'replayRound' && Number.isFinite(value)) {
            this.seekRound(Number(value));
            this.started = true;
            this.paused = false;
            this.audio.unlock();
            this.audio.loop('arena');
        }
        if (action === 'end')
            this.seekRound(this.replaySourceRounds().length);
        if (action === 'freeze')
            this.devFreeze();
        if (action === 'resume')
            this.devResume();
        this.host.dataset.paused = String(this.paused);
        this.host.dataset.mode = this.mode;
        this.hud.get('mode')?.setText(this.mode.toUpperCase() + ' · 5M');
        this.controls.querySelector('[data-cb-action="pause"]')?.setAttribute('aria-pressed', String(this.paused));
        this.controls.querySelector('[data-cb-action="mute"]')?.setAttribute('aria-pressed', String(!this.audio.muted));
        this.updateDashboard(true);
    }
    setSpeed(speed) {
        this.speed = speed;
        const select = this.controls.querySelector('[data-cb-action="speed"]');
        if (select)
            select.value = String(speed);
    }
    restart() {
        this.clearDialogue();
        delete this.host.dataset.finished;
        this.active = undefined;
        this.combatElapsed = 0;
        this.clock.clear();
        this.territory.reset();
        this.state.reset();
        this.market.clear();
        this.completedRounds = 0;
        this.replayElapsed = 0;
        this.terminal = false;
        this.resetFinale();
        this.tile?.destroy();
        this.tile = undefined;
        this.dropTarget = undefined;
        this.demoIndex = 0;
        this.demoElapsed = 0;
        this.replayIndex = 0;
        this.focusRound = -1;
        for (const effect of this.effects)
            effect.image.destroy();
        this.effects = [];
        this.flash = 0;
        this.lineFlash?.clear();
        this.left?.resetPresentation();
        this.right?.resetPresentation();
        this.left?.root.setPosition(330, this.shell ? 185 : 260);
        this.right?.root.setPosition(950, this.shell ? 185 : 260);
        this.started = true;
        this.paused = false;
        this.hud.get('result')?.setText('');
        this.drawTerritory();
        this.audio.loop('arena');
        if (this.mode === 'live')
            this.reconcile();
        if (this.mode === 'demo')
            this.history = [];
        this.updateClocks();
    }
    replaySourceRounds() {
        return [...this.history].sort((a, b) => a.left.openTime - b.left.openTime);
    }
    /**
     * Seek the replay simulation to a confrontation boundary. Rounds before the
     * target are applied instantly (no cinematics), every transient visual is
     * cleared first, and the shared simulation clock lands on the close of the
     * target candle so the requested confrontation plays on the next tick.
     */
    seekRound(index) {
        if (this.disposed || this.options.socialCapture)
            return;
        const all = this.replaySourceRounds();
        const total = all.length;
        const n = Math.max(0, Math.min(Math.round(index), total));
        this.clearDialogue();
        this.active = undefined;
        this.combatElapsed = 0;
        this.clock.clear();
        this.territory.reset();
        this.state.reset();
        this.market.clear();
        this.tile?.destroy();
        this.tile = undefined;
        this.dropTarget = undefined;
        for (const effect of this.effects)
            effect.image.destroy();
        this.effects = [];
        this.flash = 0;
        this.lineFlash?.clear();
        this.left?.clearCandle();
        this.right?.clearCandle();
        this.left?.resetPresentation();
        this.right?.resetPresentation();
        this.left?.root.setPosition(330, this.shell ? 185 : 260);
        this.right?.root.setPosition(950, this.shell ? 185 : 260);
        this.left?.setCombatMotion({ attack: 0, block: 0, dodge: 0, hit: 0, counter: 0, taunt: 0 });
        this.right?.setCombatMotion({ attack: 0, block: 0, dodge: 0, hit: 0, counter: 0, taunt: 0 });
        this.roundEvent = 'none';
        this.combatSequencer.left.reset();
        this.combatSequencer.right.reset();
        this.combatPlans = { left: undefined, right: undefined };
        this.mode = 'replay';
        this.autoplayInitialized = true;
        this.catchUpReplay = false;
        this.terminal = false;
        this.resetFinale();
        delete this.host.dataset.finished;
        this.replayHistory = all.map(r => ({ ...r, left: { ...r.left }, right: { ...r.right } }));
        this.replayIndex = n;
        for (const round of all.slice(0, n))
            this.territory.apply(round);
        this.completedRounds = n;
        this.focusRound = Math.min(n, Math.max(0, total - 1));
        this.replayElapsed = total > 0 && n >= total ? this.matchLimit()
            : Math.min(this.matchLimit(), (n + 1) * PERIOD);
        this.started = true;
        this.paused = false;
        this.hud.get('result')?.setText('');
        this.drawTerritory();
        this.updateClocks();
        this.updateDashboard(true);
        this.host.dataset.mode = this.mode;
        this.hud.get('mode')?.setText(this.mode.toUpperCase() + ' · 5M');
        if (total > 0 && n >= total && this.feed?.finished)
            this.finish();
    }
    /** Freeze fighters mid-pose so sprites/frames can be inspected. */
    devFreeze() {
        if (this.disposed)
            return;
        this.paused = true;
        this.audio.pause();
        this.left?.freezePose();
        this.right?.freezePose();
        this.host.dataset.paused = 'true';
        this.updateDashboard(true);
    }
    devResume() {
        if (this.disposed)
            return;
        this.paused = false;
        this.left?.releaseFrame();
        this.right?.releaseFrame();
        if (this.started && !this.terminal)
            this.audio.loop('arena');
        this.host.dataset.paused = 'false';
        this.updateDashboard(true);
    }
    /** Frame/state inspection payload for the development panel. */
    inspect() {
        const fighter = (renderer) => renderer ? {
            animation: renderer.poseAction,
            direction: renderer.poseDirection,
            phase: renderer.posePhase,
            frame: renderer.frameName,
            frozen: renderer.isFrozen,
            finalState: renderer.finalVisualState,
            overlays: renderer.overlayKinds,
            x: renderer.root.x,
            y: renderer.root.y,
            geometry: renderer.geometry ?? null
        } : null;
        return {
            mode: this.mode,
            paused: this.paused,
            started: this.started,
            speed: this.speed,
            terminal: this.terminal,
            finished: this.host.dataset.finished === 'true',
            phase: this.state.phase,
            progress: this.state.progress,
            finalePhase: this.finaleSequence.phase,
            finaleRunning: this.finaleSequence.running,
            finaleSettled: this.finaleSequence.settled,
            completedRounds: this.completedRounds,
            focusRound: this.focusRound,
            replayIndex: this.replayIndex,
            replayElapsed: this.replayElapsed,
            activeRoundId: this.active?.id ?? null,
            moneyFlow: this.moneyFlow?.inspect() ?? null,
            captureFrame: this.host.dataset.captureFrame ?? 'none',
            totalRounds: this.replaySourceRounds().length,
            left: fighter(this.left),
            right: fighter(this.right)
        };
    }
    showDemoForming(fraction) {
        const r = demoRound(this.demoIndex);
        for (const side of ['left', 'right']) {
            const c = r[side];
            const close = c.open + (c.close - c.open) * fraction;
            this.market.accept(side, { ...c, close, high: Math.max(c.open, close) + c.open * .003 * fraction,
                low: Math.min(c.open, close) - c.open * .002 * fraction, confirmed: false, strength: (side === 'left' ? r.leftStrength : r.rightStrength) * fraction, updatedAt: c.openTime + Math.round(fraction * 299999) });
        }
        this.setLogo('left', 'BTC');
        this.setLogo('right', 'ETH');
        this.hud.get('leftName')?.setText('BTC');
        this.hud.get('rightName')?.setText('ETH');
        this.updateMarket();
        this.drawCharts({ left: [...this.history.slice(-29).map(x => x.left.close), this.market.get('left').close], right: [...this.history.slice(-29).map(x => x.right.close), this.market.get('right').close] });
        this.hud.get('status')?.setText(this.text('forming'));
    }
    update(delta) {
        if (this.disposed || this.paused || this.backgrounded)
            return;
        const dt = Math.min(delta, 100), battleDt = dt * (this.mode === 'replay' ? this.speed : 1);
        this.time += battleDt;
        if (this.mode === 'replay' && this.started && !this.terminal)
            this.replayElapsed = Math.min(this.matchLimit(), this.replayElapsed + battleDt);
        if (this.mode === 'demo' && this.started) {
            this.demoElapsed += dt;
            this.showDemoForming(Math.min(1, this.demoElapsed / (this.state.durationMs + 400)));
            if (this.demoElapsed >= this.state.durationMs + 500) {
                const r = demoRound(this.demoIndex++);
                this.history.push(r);
                this.clock.enqueue(r);
                this.demoElapsed = 0;
            }
        }
        if (!this.active && !this.terminal && (this.started || this.mode === 'live')) {
            if (this.mode === 'replay' && this.clock.count === 0 && this.replayIndex < this.replayHistory.length) {
                const candidate = this.replayHistory[this.replayIndex];
                const start = this.feed?.matchStartTime ?? this.replayHistory[0].left.openTime;
                if (this.catchUpReplay || candidate.left.closeTime <= start + this.replayElapsed) {
                    if (this.catchUpReplay)
                        this.replayElapsed = Math.max(this.replayElapsed, candidate.left.closeTime - start);
                    this.clock.enqueue(candidate);
                    this.replayIndex++;
                }
            }
            if (this.mode !== 'live' || (this.clock.peek()?.left.closeTime ?? Infinity) <= this.liveNow()) {
                const next = this.clock.next();
                if (next)
                    this.begin(next);
            }
        }
        if (this.active)
            this.state.advance(battleDt, p => this.enter(p));
        const p = this.state.progress;
        // Closing cinematic runs after the last round and never touches score.
        if (this.finaleSequence.running)
            this.finaleSequence.advance(battleDt, phase => this.enterFinale(phase));
        if (this.active) {
            this.combatElapsed += battleDt;
            const frame = combatFrame(this.active.left, this.active.right, this.active.leftStrength, this.active.rightStrength, this.combatElapsed, this.state.durationMs, this.active.left.openTime, this.active.winner);
            const center = 640 + frame.centerOffset;
            const leftX = center - frame.separation / 2;
            const rightX = center + frame.separation / 2;
            this.left?.root.setPosition(leftX, this.shell ? 185 : 260);
            this.right?.root.setPosition(rightX, this.shell ? 185 : 260);
            this.left?.setCombatMotion(frame.left);
            this.right?.setCombatMotion(frame.right);
            this.applyCombatBeats(frame, 0);
        }
        else {
            const remaining = this.candleRemaining();
            const tension = remaining == null ? 0 : remaining <= 10000 ? 1 : remaining <= 60000 ? 1 - (remaining - 10000) / 50000 : 0;
            this.left?.root.setPosition(330 + Math.sin(this.time / 1100) * Math.min(5, 2 + tension * 3), this.shell ? 185 : 260);
            this.right?.root.setPosition(950 - Math.sin(this.time / 1170) * Math.min(5, 2 + tension * 3), this.shell ? 185 : 260);
            this.left?.setPreparation(tension, this.time);
            this.right?.setPreparation(tension, this.time + 650);
            this.applyCombatBeats(null, tension);
        }
        this.left?.update(this.time, dt, p);
        this.right?.update(this.time, dt, p);
        this.updateMoneyFlow(dt);
        this.updateDialogue(battleDt);
        if (this.tile && this.dropTarget)
            this.tile.setPosition(this.dropTarget.x, 470 + (this.dropTarget.y - 470) * p * p);
        this.flash = Math.max(0, this.flash - dt / 500);
        this.lineFlash?.clear();
        if (this.tile && this.dropTarget)
            this.lineFlash?.lineStyle(8, 0xb9ff65, .2).lineBetween(this.tile.x, this.tile.y - 65, this.tile.x, this.tile.y - 18);
        if (this.flash > 0) {
            const row = this.territory.history[this.territory.history.length - 1]?.row ?? 5;
            this.lineFlash?.lineStyle(26, 0xf3ffae, this.flash * .7).lineBetween(320, 550 + row * 32, 958, 550 + row * 32);
        }
        for (let i = this.effects.length - 1; i >= 0; i--) {
            const e = this.effects[i];
            e.age += dt;
            e.image.x += e.vx * dt / 1000;
            e.image.y += e.vy * dt / 1000;
            e.vy += dt * .3;
            e.image.setAlpha(Math.max(0, 1 - e.age / 650));
            if (e.age >= 650) {
                e.image.destroy();
                this.effects.splice(i, 1);
            }
        }
        this.updateClocks();
        if (this.mode === 'replay' && this.catchUpReplay && !this.active && this.clock.count === 0 && this.replayIndex >= this.replayHistory.length) {
            this.catchUpReplay = false;
            if (this.feed?.finished)
                this.finish();
            else {
                this.mode = 'live';
                this.setSpeed(1);
                this.reconcile();
                this.host.dataset.mode = this.mode;
                this.hud.get('mode')?.setText(this.mode.toUpperCase() + ' · 5M');
            }
        }
        if (this.mode === 'replay' && !this.active && this.replayElapsed >= this.matchLimit() && this.replayIndex >= this.replayHistory.length)
            this.finish();
        // Capture mode always settles through mountCapturePoster so a pinned
        // captureTarget phase is never overwritten by the live finish path.
        if (this.mode === 'live' && !this.options.socialCapture && this.feed?.finished && !this.active && this.clock.count === 0)
            this.finish();
        this.maybeFreezeForCapture();
    }
    updateMoneyFlow(delta) {
        if (!this.moneyFlow || !this.feed)
            return;
        const enabled = this.mode === 'live' && !this.feed.finished && !this.options.socialCapture;
        this.moneyFlow.setLiveMatch(this.feed.matchId, this.feed.leftSymbol, this.feed.rightSymbol, enabled);
        if (!enabled)
            return;
        this.moneyFlow.update(delta, this.left?.speechAnchorX ?? 330, this.left?.speechAnchorY ?? (this.shell ? 185 : 260), this.right?.speechAnchorX ?? 950, this.right?.speechAnchorY ?? (this.shell ? 185 : 260));
    }
    matchLimit() {
        const start = this.feed?.matchStartTime, end = this.feed?.matchEndTime;
        return this.feed?.finished && start != null && end != null ? Math.max(0, Math.min(MATCH_DURATION, end - start)) : MATCH_DURATION;
    }
    liveNow() { return this.serverAnchorMs == null ? Date.now() : this.serverAnchorMs + performance.now() - this.serverReceivedAt; }
    candleRemaining() {
        if (this.mode === 'demo')
            return Math.max(0, PERIOD - this.demoElapsed / (this.state.durationMs + 500) * PERIOD);
        const start = this.feed?.matchStartTime;
        if (start == null || this.terminal)
            return null;
        const now = this.mode === 'replay' ? start + this.replayElapsed : this.liveNow();
        const limit = this.matchLimit();
        return now >= start + limit ? null : nextCandleCountdown(now, start, limit);
    }
    updateClocks() {
        const start = this.feed?.matchStartTime;
        const elapsed = this.mode === 'demo' ? Math.min(MATCH_DURATION, this.demoIndex * PERIOD + this.demoElapsed / (this.state.durationMs + 500) * PERIOD)
            : start == null ? 0 : this.mode === 'replay' ? this.replayElapsed : this.feed?.finished ? this.matchLimit() : Math.max(0, this.liveNow() - start);
        const capped = Math.min(MATCH_DURATION, elapsed);
        this.hud.get('matchTime')?.setText(this.text('matchTime', 'MATCH TIME') + '  ' + clockParts(capped) + ' / 90:00');
        const remaining = this.candleRemaining();
        this.hud.get('nextBattle')?.setText(this.terminal ? '' : this.text('nextBattle', '5-MINUTE CANDLES') + '  ' + (remaining == null ? '--:--' : clockParts(Math.ceil(remaining / 1000) * 1000)));
        const configuredRounds = this.feed?.expectedRounds ?? MATCH_ROUNDS;
        const expectedRounds = this.terminal && this.feed?.status === 'finished' ? this.completedRounds : configuredRounds;
        const round = this.terminal ? this.completedRounds : Math.min(configuredRounds, this.completedRounds + 1);
        this.hud.get('round')?.setText(this.text('round', 'ROUND') + '  ' + round + ' / ' + expectedRounds);
        this.updateDashboard();
    }
    finish() {
        if (this.terminal || !this.feed?.finished)
            return;
        this.terminal = true;
        this.started = false;
        this.audio.pause();
        const incomplete = this.feed.status === 'incomplete' || this.feed.status !== 'finished';
        const left = this.feed.scoreLeft ?? this.territory.score.left, right = this.feed.scoreRight ?? this.territory.score.right;
        const winner = left === right ? this.text('draw', 'DRAW') : displaySymbol(left > right ? this.feed.leftSymbol : this.feed.rightSymbol);
        const decisive = !incomplete && left !== right;
        const winningSide = left > right ? 'left' : 'right';
        const losingSide = winningSide === 'left' ? 'right' : 'left';
        const scoredRounds = Math.max(1, left + right);
        this.finaleIntensity = decisive ? 1 + Math.min(1, Math.abs(left - right) / scoredRounds) * .7 : 1;
        this.host.dataset.finaleIntensity = this.finaleIntensity.toFixed(2);
        if (decisive) {
            (winningSide === 'left' ? this.left : this.right)?.setFinalState('winner');
            (losingSide === 'left' ? this.left : this.right)?.setFinalState('loser');
            this.burst(winningSide === 'left' ? 360 : 920, 385, winningSide, this.finaleIntensity);
            this.burst(winningSide === 'left' ? 390 : 890, 300, winningSide, this.finaleIntensity);
            this.audio.play('big_win');
        }
        else {
            this.left?.setFinalState('draw');
            this.right?.setFinalState('draw');
        }
        this.hud.get('status')?.setText(this.text('matchFinished', 'MATCH FINISHED') + (incomplete ? '' : ' — ' + winner + (left === right ? '' : ' ' + this.text('wins', 'WINS'))));
        this.hud.get('result')?.setText(incomplete ? this.text('incomplete', 'INCOMPLETE RESULT') : `${this.text('finalScore', 'FINAL SCORE')}: ${left} × ${right}`);
        this.hud.get('nextBattle')?.setText('');
        this.clearDialogue();
        if (!incomplete) {
            this.finale = this.dialogueEngine.captureExchange({
                matchId: this.feed.matchId,
                culture: this.options.culture ?? 'en',
                leftSymbol: this.feed.leftSymbol,
                rightSymbol: this.feed.rightSymbol,
                scoreA: left,
                scoreB: right,
                round: this.completedRounds,
                expectedRounds: this.feed.expectedRounds ?? 18,
                finished: true,
                winner: left === right ? 'draw' : left > right ? 'left' : 'right'
            });
            this.currentLine = this.finale[0];
            this.positionBubble();
        }
        this.beginFinale(decisive ? (winningSide === 'left' ? 'winner' : 'loser') : 'draw', decisive ? (losingSide === 'left' ? 'winner' : 'loser') : 'draw');
        this.updateClocks();
        this.updateDashboard(true);
        this.host.dataset.finished = 'true';
        this.host.dispatchEvent(new CustomEvent('candle-battles-finished'));
        this.maybeFreezeForCapture();
    }
    /**
     * Starts the ~8s closing cinematic. The social poster never replays it:
     * capture settles the timeline deterministically so the frame is final.
     */
    beginFinale(leftRole, rightRole) {
        this.finaleSequence.reset();
        this.finaleRoles = { left: leftRole, right: rightRole };
        this.finaleSequence.start(phase => this.enterFinale(phase));
        if (this.options.socialCapture)
            this.finaleSequence.settle(phase => this.enterFinale(phase));
    }
    enterFinale(phase) {
        this.host.dataset.finaleState = phase;
        this.left?.applyFinalePose(resolveFinalePose(phase, this.finaleRoles.left, this.left.finishersAvailable));
        this.right?.applyFinalePose(resolveFinalePose(phase, this.finaleRoles.right, this.right.finishersAvailable));
        this.applyFinaleOverlays(phase);
        const loserSide = this.finaleRoles.left === 'loser' ? 'left' : this.finaleRoles.right === 'loser' ? 'right' : null;
        const winnerSide = this.finaleRoles.left === 'winner' ? 'left' : this.finaleRoles.right === 'winner' ? 'right' : null;
        if (phase === 'FINISHER_ATTACK' && !this.reduced)
            this.scene?.cameras.main.shake(Math.round(120 * this.finaleIntensity), .003 * this.finaleIntensity);
        if (phase === 'KNOCKOUT' && loserSide)
            this.burst(loserSide === 'left' ? 330 : 950, 385, loserSide, this.finaleIntensity);
        if (phase === 'VICTORY_CELEBRATION' && winnerSide)
            this.burst(winnerSide === 'left' ? 360 : 920, 385, winnerSide, this.finaleIntensity);
    }
    /** Damage/celebration decals. Each call degrades to a no-op without the optional atlas. */
    applyFinaleOverlays(phase) {
        const rank = FINALE_PHASES.indexOf(phase);
        const loserSide = this.finaleRoles.left === 'loser' ? 'left' : this.finaleRoles.right === 'loser' ? 'right' : null;
        const of = (side) => side === 'left' ? this.left : this.right;
        if (loserSide && rank >= FINALE_PHASES.indexOf('KNOCKOUT')) {
            of(loserSide)?.attachOverlay('bruise', loserSide === 'left' ? 1 : 2);
            of(loserSide)?.attachOverlay('star', 2);
        }
        if (loserSide && rank >= FINALE_PHASES.indexOf('VICTORY_CELEBRATION'))
            of(loserSide)?.attachOverlay('bandage', loserSide === 'left' ? 1 : 2);
        if (!loserSide && rank >= FINALE_PHASES.indexOf('VICTORY_CELEBRATION')) {
            this.left?.attachOverlay('star', 1);
            this.right?.attachOverlay('star', 1);
        }
    }
    resetFinale() {
        this.finaleSequence.reset();
        this.finaleRoles = { left: 'draw', right: 'draw' };
        this.finaleIntensity = 1;
        delete this.host.dataset.finaleState;
        delete this.host.dataset.finaleIntensity;
    }
    begin(r) {
        this.clearDialogue();
        this.roundEvent = 'none';
        this.combatSequencer.left.reset();
        this.combatSequencer.right.reset();
        this.active = r;
        this.combatElapsed = 0;
        this.focusRound = this.completedRounds;
        const range = sharedRange([r.left, r.right]);
        this.hud.get('status')?.setText(`${this.text('round', 'ROUND')} ${this.completedRounds + 1} — ${this.text('fight', 'FIGHT!')}`);
        this.left?.setCandle(r.left, range, true);
        this.right?.setCandle(r.right, range, true);
        if (this.mode === 'replay') {
            for (const side of ['left', 'right']) {
                const c = r[side], pct = (c.close / c.open - 1) * 100;
                this.hud.get(side + 'Price')?.setText(c.close.toLocaleString(undefined, { maximumSignificantDigits: 10 }) + '  ' + (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%');
                this.hud.get(side + 'Strength')?.setText(this.text('strength') + ' ' + (side === 'left' ? r.leftStrength : r.rightStrength).toFixed(1));
            }
            this.drawCharts({ left: this.replayHistory.slice(0, this.replayIndex).slice(-30).map(x => x.left.close), right: this.replayHistory.slice(0, this.replayIndex).slice(-30).map(x => x.right.close) });
        }
        this.hud.get('result')?.setText('');
        this.state.start();
        this.enter('SPAWNING');
        this.updateDashboard(true);
    }
    /**
     * Records a real match event from the territory and the authoritative
     * round result. Nothing here invents a market event: the flags only fire
     * when the score, streak or strength gap actually produced them.
     */
    noteRoundEvent(r) {
        const score = this.territory.score;
        const leader = score.left === score.right ? 'draw' : score.left > score.right ? 'left' : 'right';
        const leadChanged = this.lastLeader != null && leader !== 'draw' && leader !== this.lastLeader;
        this.lastLeader = leader;
        const crushing = this.options.crushingDifference ?? 25;
        if (this.territory.special === 'comeback')
            this.roundEvent = 'recovery';
        else if (leadChanged)
            this.roundEvent = 'lead_change';
        else if (r.winner !== 'draw' && this.territory.streak >= 3)
            this.roundEvent = 'win_streak';
        else if (r.winner !== 'draw' && Math.abs(r.leftStrength - r.rightStrength) >= crushing)
            this.roundEvent = 'dominant_win';
        else
            this.roundEvent = 'none';
        this.host.dataset.combatEvent = this.roundEvent;
    }
    /**
     * Drives the in-round and between-round combat beats for both fighters.
     * The winner is only ever the authoritative round result and the impact band
     * only uses real pressure, strength and hit data, so a large red candle can
     * never look like the winner just because its sprite is bigger.
     */
    applyCombatBeats(frame, tension) {
        const round = this.active;
        // Between confrontations only the preparation pose may own a fighter.
        // Leaving the previous CombatSequencer plan alive made its manual
        // frame writer race the normal idle animation after a winner returned
        // to its corner, which reads as a frantic flicker.
        if (!round) {
            for (const side of ['left', 'right']) {
                this.combatSequencer[side].reset();
                this.combatPlans[side] = undefined;
                (side === 'left' ? this.left : this.right)?.clearCombatPlan();
                this.host.dataset[side === 'left' ? 'combatLeft' : 'combatRight'] = 'none';
            }
            return;
        }
        const seed = round?.left.openTime ?? this.feed?.matchStartTime ?? 0;
        const advantage = round ? combatAdvantage(round.left, round.right, round.leftStrength, round.rightStrength, round.winner) : null;
        const idle = { attack: 0, block: 0, dodge: 0, hit: 0, counter: 0, taunt: 0 };
        for (const side of ['left', 'right']) {
            // The renderer's phase is authoritative for presentation: a pinned
            // capture pose must never be contradicted by the engine's timeline.
            const phase = (side === 'left' ? this.left?.posePhase : this.right?.posePhase)
                ?? (round ? this.state.phase : 'FORMING_CANDLE');
            const role = !round ? 'none'
                : round.winner === 'draw' ? 'draw' : round.winner === side ? 'winner' : 'loser';
            const impactInputs = {
                pressure: advantage ? (side === 'left' ? advantage.leftPressure : advantage.rightPressure) : Number.NaN,
                opponentPressure: advantage ? (side === 'left' ? advantage.rightPressure : advantage.leftPressure) : Number.NaN,
                strength: round ? (side === 'left' ? round.leftStrength : round.rightStrength) : Number.NaN,
                opponentStrength: round ? (side === 'left' ? round.rightStrength : round.leftStrength) : Number.NaN,
                hit: frame ? (side === 'left' ? frame.left.hit : frame.right.hit) : Number.NaN,
                role,
            };
            this.roundImpact[side] = impactInputs;
            const personalityInputs = {
                role, event: this.roundEvent, tension, seed,
                roundIndex: this.completedRounds, streak: this.territory.streak,
            };
            const inputs = {
                phase,
                role,
                motion: frame ? (side === 'left' ? frame.left : frame.right) : idle,
                impact: impactLevel(impactInputs),
                personality: personalityFor(personalityInputs),
                event: this.roundEvent,
                tension,
                elapsedMs: this.combatElapsed,
                seed,
            };
            const sequencer = this.combatSequencer[side];
            sequencer.request(resolveCombatState(inputs), this.combatElapsed);
            const plan = sequencer.update(this.combatElapsed);
            this.combatPlans[side] = plan;
            const renderer = side === 'left' ? this.left : this.right;
            renderer?.setCombatPlan(plan ?? null, this.combatElapsed);
            this.host.dataset[side === 'left' ? 'combatLeft' : 'combatRight'] = plan?.state ?? 'none';
        }
    }
    enter(phase) {
        const r = this.active;
        if (!r)
            return;
        this.left?.setPose(phase, r.winner === 'left', r.winner === 'draw');
        this.right?.setPose(phase, r.winner === 'right', r.winner === 'draw');
        if (phase === 'SPAWNING')
            this.audio.play('candle_spawn');
        if (phase === 'APPROACHING')
            this.audio.play('dash');
        if (phase === 'COLLISION') {
            this.audio.play('punch_impact');
            this.burst(640, 400, r.winner === 'right' ? 'right' : 'left');
            if (!this.reduced)
                this.scene?.cameras.main.shake(100, .002);
        }
        if (phase === 'DESTROYING') {
            this.audio.play('candle_destroy');
            this.burst(r.winner === 'left' ? 720 : 560, 400, r.winner === 'left' ? 'right' : 'left');
        }
        if (phase === 'VICTORY') {
            this.hud.get('result')?.setText(r.winner === 'draw' ? this.text('draw') : (displaySymbol(r[r.winner].symbol) + ' +1'));
            this.hud.get('status')?.setText(`${this.text('round', 'ROUND')} ${this.completedRounds + 1} — ${r.winner === 'draw' ? this.text('draw') : displaySymbol(r[r.winner].symbol) + ' ' + this.text('wins', 'WINS')}`);
            this.audio.play(r.winner === 'draw' ? 'draw' : 'score_point');
            if (r.winner !== 'draw' && Math.abs(r.leftStrength - r.rightStrength) >= (this.options.crushingDifference ?? 25)) {
                this.hud.get('result')?.setText(displaySymbol(r[r.winner].symbol) + ' +1 · ' + this.text('crushing'));
                this.audio.play('big_win');
                this.burst(640, 300, r.winner);
            }
        }
        if (phase === 'BLOCK_FALLING' && !this.shell) {
            if (r.winner !== 'draw') {
                const n = this.territory.history.length, col = n % 20, row = 5 - Math.floor(n % 120 / 20);
                if (n > 0 && n % 120 === 0) {
                    for (const image of this.tileImages)
                        image.destroy();
                    this.tileImages = [];
                }
                this.dropTarget = { x: 335 + col * 32, y: 550 + row * 32 };
                this.tile = this.scene.add.image(this.dropTarget.x, 470, 'modular', 'tile-' + r.winner).setDisplaySize(30, 30);
                this.audio.play('block_fall');
            }
        }
        if (phase === 'BLOCK_LOCKING') {
            const oldLines = this.territory.lines;
            const tile = this.territory.apply(r);
            this.noteRoundEvent(r);
            this.tile?.destroy();
            this.tile = undefined;
            this.dropTarget = undefined;
            if (tile)
                this.audio.play('block_lock');
            if (this.territory.lines > oldLines) {
                this.audio.play('line_complete');
                this.flash = 1;
                this.burst(640, 700, r.winner === 'right' ? 'right' : 'left');
            }
            if (this.territory.special) {
                this.hud.get('result')?.setText(this.text(this.territory.special));
                this.audio.play(this.territory.special === 'combo' ? 'combo' : 'big_win');
            }
            this.drawTerritory();
            this.updateDashboard(true);
        }
        if (phase === 'FORMING_CANDLE') {
            this.active = undefined;
            this.combatElapsed = 0;
            this.completedRounds++;
            this.hud.get('status')?.setText(this.text('forming'));
            this.left?.setCombatMotion({ attack: 0, block: 0, dodge: 0, hit: 0, counter: 0, taunt: 0 });
            this.right?.setCombatMotion({ attack: 0, block: 0, dodge: 0, hit: 0, counter: 0, taunt: 0 });
            this.left?.setPose(phase, true);
            this.right?.setPose(phase, true);
            this.updateMarket();
            this.updateDashboard(true);
        }
    }
    localLogoUrl(symbol) {
        const local = this.options.localLogos?.[symbol.trim().toUpperCase()]
            ?? this.options.localLogos?.[displaySymbol(symbol.trim().toUpperCase())];
        return local ?? '/futurebol/team-logo/' + encodeURIComponent(symbol);
    }
    setLogo(side, symbol) {
        if (!this.scene || this.logoSymbols.get(side) === symbol)
            return;
        this.logoSymbols.set(side, symbol);
        this.logos.get(side)?.destroy();
        this.logos.delete(side);
        this.logoFallbacks.get(side)?.destroy();
        this.logoFallbacks.delete(side);
        const normalized = symbol.trim().toUpperCase();
        const base = displaySymbol(normalized);
        if (!this.shell && (base === 'BTC' || base === 'ETH')) {
            const x = side === 'left' ? 76 : 1208;
            this.logos.set(side, this.scene.add.image(x, 67, 'modular', 'logo-' + base).setDisplaySize(58, 61));
            return;
        }
        if (!/^[A-Z0-9]{1,20}$/.test(normalized)) {
            this.showLogoFallback(side);
            return;
        }
        const scene = this.scene, key = 'coin-' + normalized;
        if (scene.textures.exists(key)) {
            this.showLogo(side, key);
            return;
        }
        this.showLogoFallback(side);
        if (this.loadingLogos.has(key))
            return;
        this.loadingLogos.add(key);
        const completed = () => {
            scene.load.off('loaderror', failed);
            this.loadingLogos.delete(key);
            this.ownedLogoTextures.add(key);
            if (!this.disposed) {
                for (const activeSide of ['left', 'right'])
                    if (this.logoKey(activeSide) === key)
                        this.showLogo(activeSide, key);
                this.releaseUnusedLogoTextures();
            }
        };
        const failed = (file) => {
            if (file.key !== key)
                return;
            scene.load.off('filecomplete-image-' + key, completed);
            scene.load.off('loaderror', failed);
            this.loadingLogos.delete(key);
        };
        scene.load.once('filecomplete-image-' + key, completed);
        scene.load.on('loaderror', failed);
        scene.load.image(key, this.localLogoUrl(normalized));
        scene.load.start();
    }
    logoKey(side) {
        const symbol = this.logoSymbols.get(side)?.trim().toUpperCase();
        return symbol && /^[A-Z0-9]{1,20}$/.test(symbol) ? 'coin-' + symbol : undefined;
    }
    logoAnchor(side) {
        if (this.options.socialCapture)
            return { x: side === 'left' ? 185 : 1095, y: 385 };
        return this.shell ? { x: side === 'left' ? 97 : 1183, y: 237 } : { x: side === 'left' ? 76 : 1208, y: 67 };
    }
    // Poster framing: enlarge the fighters and keep heads, feet, wicks and
    // logos inside the captured social frame without scaling the sprites.
    frameCapturePoster(scene) {
        scene.cameras.main.setZoom(1.25).centerOn(640, 240);
    }
    showLogo(side, key) {
        if (!this.scene || !this.scene.textures.exists(key))
            return;
        this.logoFallbacks.get(side)?.destroy();
        this.logoFallbacks.delete(side);
        this.logos.get(side)?.destroy();
        const { x, y } = this.logoAnchor(side);
        const image = this.scene.add.image(x, y, key).setDepth(.6);
        const texture = image.texture.getSourceImage();
        const maxSize = this.shell ? 82 : 58;
        image.setScale(Math.min(maxSize / texture.width, maxSize / texture.height));
        this.logos.set(side, image);
    }
    showLogoFallback(side) {
        if (!this.scene)
            return;
        const { x, y } = this.logoAnchor(side);
        const label = displaySymbol(this.logoSymbols.get(side) ?? '?').slice(0, 5);
        const color = side === 'left' ? '#b8ff00' : '#31d3d0';
        this.logoFallbacks.set(side, this.scene.add.text(x, y, label, { fontFamily: 'system-ui, sans-serif', fontSize: this.shell ? '22px' : '15px', fontStyle: 'bold', color, align: 'center' }).setOrigin(.5).setDepth(.6));
    }
    releaseUnusedLogoTextures() {
        if (!this.scene)
            return;
        const active = new Set(['left', 'right'].map(side => this.logoKey(side)));
        for (const key of this.ownedLogoTextures)
            if (!active.has(key)) {
                this.scene.textures.remove(key);
                this.ownedLogoTextures.delete(key);
            }
    }
    drawCharts(series = this.prices) {
        if (!this.chart)
            return;
        this.chart.clear();
        for (const side of ['left', 'right']) {
            const points = series[side];
            if (points.length < 2)
                continue;
            const low = Math.min(...points), span = Math.max(...points) - low || 1, x = side === 'left' ? 350 : 890;
            this.chart.lineStyle(2, side === 'left' ? 0xc1f20f : 0x28cfc3).beginPath();
            points.forEach((p, i) => { const xx = x + i * 95 / (points.length - 1), yy = 132 - (p - low) / span * 27; if (i === 0)
                this.chart.moveTo(xx, yy);
            else
                this.chart.lineTo(xx, yy); });
            this.chart.strokePath();
        }
    }
    burst(x, y, side, intensity = 1) {
        if (!this.scene || this.reduced)
            return;
        const count = Math.round((this.host.clientWidth < 600 ? 8 : 18) * Math.max(1, Math.min(1.7, intensity)));
        for (let i = 0; i < count && this.effects.length < 48; i++) {
            const angle = i * 2.39996;
            const image = this.scene.add.image(x, y, 'modular', i === 0 ? 'impact-' + side : 'tile-' + side);
            const size = i === 0 ? 140 * Math.max(1, Math.min(1.45, intensity)) : 9;
            image.setDisplaySize(size, size);
            this.effects.push({ image, age: 0, vx: Math.cos(angle) * (60 + i * 7), vy: Math.sin(angle) * (60 + i * 5) - 50 });
        }
    }
    drawTerritory() {
        if (!this.grid || !this.scene)
            return;
        if (this.shell) {
            this.hud.get('score')?.setText(this.territory.score.left + ' : ' + this.territory.score.right);
            this.updateDashboard(true);
            return;
        }
        const g = this.grid.clear();
        g.fillStyle(0x101925).fillRoundedRect(310, 524, 660, 210, 8).lineStyle(1, 0x334354);
        for (let col = 0; col < 20; col++)
            for (let row = 0; row < 6; row++)
                g.strokeRect(320 + col * 32, 535 + row * 32, 30, 30);
        for (const image of this.tileImages)
            image.destroy();
        this.tileImages = [];
        for (const tile of this.territory.history.filter(t => t.page === this.territory.page))
            this.tileImages.push(this.scene.add.image(335 + tile.column * 32, 550 + tile.row * 32, 'modular', 'tile-' + tile.side).setDisplaySize(30, 30));
        const percent = this.territory.percentLeft;
        g.fillStyle(TEAM.right).fillRoundedRect(280, 774, 720, 12, 4);
        if (percent > 0)
            g.fillStyle(TEAM.left).fillRect(280, 774, 720 * percent / 100, 12);
        this.hud.get('percent')?.setPosition(640, 752).setText(percent.toFixed(1) + '% / ' + (100 - percent).toFixed(1) + '%');
        this.hud.get('territory')?.setPosition(640, 730);
        this.hud.get('score')?.setText(this.territory.score.left + ' : ' + this.territory.score.right);
        this.hud.get('lines')?.setText(this.text('lines') + ' ' + this.territory.lines + ' · ' + this.text('page') + ' ' + (this.territory.page + 1));
        this.hud.get('recent')?.setText(this.territory.history.slice(-7).reverse().map(t => (t.side === 'left' ? this.hud.get('leftName')?.text : this.hud.get('rightName')?.text) + '  +1').join('\n\n'));
    }
    setLabels(labels, culture) {
        this.options.labels = labels;
        const cultureChanged = !!culture && culture !== this.options.culture;
        if (culture)
            this.options.culture = culture;
        if (cultureChanged) {
            this.clearDialogue();
            if (this.terminal && this.feed?.status === 'finished') {
                const left = this.feed.scoreLeft ?? this.territory.score.left, right = this.feed.scoreRight ?? this.territory.score.right;
                this.finale = this.dialogueEngine.captureExchange({
                    matchId: this.feed.matchId,
                    culture: culture,
                    leftSymbol: this.feed.leftSymbol,
                    rightSymbol: this.feed.rightSymbol,
                    scoreA: left,
                    scoreB: right,
                    round: this.completedRounds,
                    expectedRounds: this.feed.expectedRounds ?? 18,
                    finished: true,
                    winner: left === right ? 'draw' : left > right ? 'left' : 'right'
                });
                this.currentLine = this.finale[0];
                this.positionBubble();
            }
        }
        this.hud.get('subtitle')?.setText(this.text('arcade'));
        this.hud.get('history')?.setText(this.text('recent'));
        this.drawTerritory();
        this.updateDashboard(true);
    }
    updateDashboard(force = false) {
        if (!this.dashboard || !this.scene)
            return;
        const timeline = this.mode === 'live' ? this.liveNow() : this.mode === 'replay' ? this.replayElapsed : this.demoElapsed;
        const second = Math.floor(timeline / 1000);
        if (!force && second === this.lastDashboardSecond)
            return;
        this.lastDashboardSecond = second;
        const node = (key) => this.controls.querySelector(`[data-cb="${key}"]`);
        const put = (key, value) => { const el = node(key); if (el && el.textContent !== value)
            el.textContent = value; };
        const start = this.feed?.matchStartTime;
        const elapsed = this.mode === 'demo' ? Math.min(MATCH_DURATION, this.demoIndex * PERIOD + this.demoElapsed / (this.state.durationMs + 500) * PERIOD)
            : start == null ? 0 : this.mode === 'replay' ? this.replayElapsed : this.feed?.finished ? this.matchLimit() : Math.max(0, this.liveNow() - start);
        const matchTime = `${clockParts(Math.min(this.matchLimit(), elapsed))} / ${clockParts(this.matchLimit())}`;
        const remaining = this.candleRemaining();
        const countdown = this.terminal ? '--:--' : remaining == null ? '--:--' : clockParts(Math.ceil(remaining / 1000) * 1000);
        put('countdown', countdown);
        put('countdownCaption', this.terminal ? this.text('finished') : this.text('candleClose'));
        put('countdownNote', this.terminal ? this.text('matchFinished') : this.active ? this.text('fight') : this.text('forming'));
        const progress = node('progress');
        const fraction = remaining == null ? 0 : Math.max(0, Math.min(1, 1 - remaining / PERIOD));
        if (progress) {
            progress.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
            const fill = progress.querySelector('i');
            if (fill)
                fill.style.width = `${(fraction * 100).toFixed(2)}%`;
        }
        const countdownCard = this.dashboard.querySelector('.candle-battles__countdown');
        countdownCard?.classList.toggle('is-soon', remaining != null && remaining > 0 && remaining <= 30000);
        countdownCard?.classList.toggle('is-imminent', remaining != null && remaining > 0 && remaining <= 10000);
        put('matchTime', matchTime);
        put('infoMatchTime', matchTime);
        const expected = this.terminal && this.feed?.status === 'finished' ? this.completedRounds : this.feed?.expectedRounds ?? MATCH_ROUNDS;
        const current = this.terminal ? this.completedRounds : Math.min(expected, this.completedRounds + 1);
        const roundText = `${current} / ${expected}`;
        put('round', `${this.text('round')} ${roundText}`);
        put('infoRound', roundText);
        const score = this.territory.score;
        put('leftScore', String(score.left));
        put('rightScore', String(score.right));
        put('infoScore', `${score.left} : ${score.right}`);
        put('mode', this.mode === 'replay' ? 'REPLAY' : this.mode === 'demo' ? 'DEMO' : '● LIVE');
        put('infoStatus', this.terminal ? this.text('finished') : this.mode === 'replay' ? 'REPLAY' : this.feed?.status === 'live' ? this.text('forming') : this.text('waiting'));
        put('candleState', this.terminal ? this.text('finished') : this.active ? this.text('fight') : this.feed?.status === 'waiting-confirmation' ? this.text('awaitingClose') : this.text('forming'));
        put('battleStatus', this.hud.get('status')?.text ?? '');
        const recent = this.mode === 'replay' ? this.replayHistory.slice(0, this.completedRounds) : this.history.slice(0, this.completedRounds);
        const candleFor = (side) => this.active?.[side] ?? (this.mode === 'replay' ? recent[recent.length - 1]?.[side] : this.market.get(side));
        for (const side of ['left', 'right']) {
            const symbol = this.feed?.[side + 'Symbol'] ?? (side === 'left' ? 'BTC' : 'ETH');
            const shown = displaySymbol(symbol);
            const c = candleFor(side);
            const pct = c ? (c.close / c.open - 1) * 100 : null;
            const change = pct == null ? '—' : `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
            put(side + 'Symbol', shown);
            put(side + 'Asset', shown);
            put(side + 'Price', c ? `$ ${c.close.toLocaleString(this.options.culture, { maximumSignificantDigits: 8 })}` : '—');
            put(side + 'Change', change);
            put(side + 'Delta', change);
            const strength = this.active ? (side === 'left' ? this.active.leftStrength : this.active.rightStrength) : c?.strength;
            put(side + 'Strength', strength == null ? '—' : strength.toFixed(1));
            put(side + 'ArenaStrength', strength == null ? '—' : strength.toFixed(1));
            const forceFill = node(side + 'ForceFill');
            if (forceFill)
                forceFill.style.width = `${Math.max(0, Math.min(100, strength ?? 0)).toFixed(1)}%`;
            put(side + 'Volume', c?.volume == null ? '—' : new Intl.NumberFormat(this.options.culture, { notation: 'compact', maximumFractionDigits: 1 }).format(c.volume));
            for (const key of [side + 'Change', side + 'Delta']) {
                const el = node(key);
                el?.classList.toggle('is-up', pct != null && pct > 0);
                el?.classList.toggle('is-down', pct != null && pct < 0);
            }
            const logo = node(side + 'Logo');
            if (logo && logo.dataset.symbol !== symbol) {
                const fallback = node(side + 'LogoFallback');
                logo.dataset.symbol = symbol;
                if (fallback)
                    fallback.textContent = shown.slice(0, 3);
                logo.onload = () => { logo.hidden = false; if (fallback)
                    fallback.hidden = true; };
                logo.onerror = () => { logo.hidden = true; if (fallback)
                    fallback.hidden = false; };
                logo.src = this.localLogoUrl(symbol);
            }
        }
        const list = node('history');
        if (list) {
            list.replaceChildren();
            const entries = this.showAllHistory ? recent : recent.slice(-5);
            for (const r of [...entries].reverse()) {
                const row = document.createElement('div');
                const number = this.history.findIndex(x => x.id === r.id) + 1;
                const round = document.createElement('span');
                round.textContent = `${this.text('round')} ${number}`;
                const winner = document.createElement('strong');
                winner.textContent = r.winner === 'draw' ? this.text('draw') : `${displaySymbol(r[r.winner].symbol)} +1`;
                const time = document.createElement('time');
                time.textContent = start == null ? new Date(r.left.closeTime).toLocaleTimeString(this.options.culture, { hour: '2-digit', minute: '2-digit' }) : clockParts(r.left.closeTime - start);
                row.append(round);
                if (r.winner !== 'draw') {
                    const symbol = r[r.winner].symbol;
                    const logo = document.createElement('img');
                    logo.alt = '';
                    logo.src = this.localLogoUrl(symbol);
                    logo.onerror = () => { const fallback = document.createElement('span'); fallback.className = 'candle-battles__history-fallback'; fallback.textContent = displaySymbol(symbol).slice(0, 2); logo.replaceWith(fallback); };
                    row.append(logo);
                }
                row.append(winner, time);
                list.append(row);
            }
        }
        const grid = node('territory');
        if (grid) {
            grid.replaceChildren();
            for (let i = 0; i < expected; i++) {
                const tile = document.createElement('i');
                const winner = recent[i]?.winner;
                if (winner === 'left' || winner === 'right')
                    tile.className = 'is-' + winner;
                tile.setAttribute('aria-label', winner ? `${this.text('round')} ${i + 1}: ${winner === 'draw' ? this.text('draw') : displaySymbol(recent[i][winner].symbol)}` : `${this.text('round')} ${i + 1}`);
                grid.append(tile);
            }
        }
        const decided = score.left + score.right;
        const leftPercent = decided ? score.left / decided * 100 : 0;
        const rightPercent = decided ? score.right / decided * 100 : 0;
        put('territoryCount', `${this.completedRounds} / ${expected}`);
        put('territoryPercent', `${leftPercent.toFixed(1)}% / ${rightPercent.toFixed(1)}%`);
        const fill = node('domainFill');
        if (fill)
            fill.style.width = `${leftPercent.toFixed(1)}%`;
        const final = node('finalPanel');
        if (final) {
            final.hidden = !this.terminal;
            if (this.terminal) {
                const incomplete = this.feed?.status !== 'finished';
                const champion = score.left === score.right ? this.text('draw') : displaySymbol(score.left > score.right ? this.feed?.leftSymbol ?? '' : this.feed?.rightSymbol ?? '');
                put('champion', incomplete ? this.text('incomplete') : `${this.text('champion')}: ${champion}`);
                put('finalScore', `${score.left} : ${score.right}`);
                put('finalDetails', `${this.text('round')} ${this.completedRounds} / ${expected} · ${this.text('territory')} ${leftPercent.toFixed(1)}% / ${rightPercent.toFixed(1)}%`);
            }
        }
    }
    snapshot() { return { mode: this.mode, phase: this.state.phase, score: { ...this.territory.score }, tiles: this.territory.history.map(t => ({ ...t })), lines: this.territory.lines, left: this.left?.geometry, right: this.right?.geometry, faceSize: this.left?.faceSize }; }
    clearDialogue() {
        this.dialogue.reset();
        this.conversation = undefined;
        this.currentLine = undefined;
        this.finale = undefined;
        this.finaleElapsed = 0;
        if (this.bubble)
            this.bubble.hidden = true;
    }
    updateDialogue(delta) {
        if (this.terminal) {
            if (!this.finale)
                return;
            this.finaleElapsed += delta;
            this.currentLine = this.finaleElapsed < 3000 ? this.finale[0] : this.finaleElapsed < 6500 ? this.finale[1] : undefined;
        }
        else if (!this.active && (this.started || this.mode === 'live')) {
            const turns = this.conversation?.length ?? 2;
            const duration = this.currentLine ? lineDuration(this.currentLine.text) : 1800;
            const step = this.dialogue.advance(delta, this.feed?.matchId ?? 0, this.completedRounds + 1, turns, duration);
            if (step) {
                if (step.line === 0) {
                    const previous = this.mode === 'replay' && this.replayIndex > 0 ? this.replayHistory[this.replayIndex - 1] : undefined;
                    const speaker = step.slot % 2 === 0 ? 'left' : 'right';
                    const speakerCandle = previous ? { ...previous[speaker], strength: speaker === 'left' ? previous.leftStrength : previous.rightStrength }
                        : this.mode === 'replay' ? undefined : this.market.get(speaker);
                    const opponent = speaker === 'left' ? 'right' : 'left';
                    const opponentCandle = previous ? { ...previous[opponent], strength: opponent === 'left' ? previous.leftStrength : previous.rightStrength }
                        : this.mode === 'replay' ? undefined : this.market.get(opponent);
                    const change = speakerCandle && speakerCandle.open > 0 ? (speakerCandle.close / speakerCandle.open - 1) * 100 : undefined;
                    const lead = this.territory.score.left - this.territory.score.right;
                    const fromSpeaker = speaker === 'left' ? lead : -lead;
                    const last = this.territory.lastWinner;
                    const moment = fromSpeaker === 0 ? 'draw'
                        : last === speaker ? 'roundWin' : last && last !== 'draw' ? 'roundLoss' : 'banter';
                    this.conversation = this.dialogueEngine.pickExchange({
                        matchId: this.feed?.matchId ?? 0,
                        culture: this.options.culture ?? 'en',
                        speaker,
                        speakerSymbol: speakerCandle?.symbol ?? (speaker === 'left' ? 'LEFT' : 'RIGHT'),
                        opponentSymbol: opponentCandle?.symbol ?? (opponent === 'left' ? 'LEFT' : 'RIGHT'),
                        round: this.completedRounds + 1,
                        expectedRounds: this.feed?.expectedRounds ?? 18,
                        score: this.territory.score,
                        moment,
                        changePercent: change,
                        hasVolume: !!speakerCandle?.volume
                    }, step.slot);
                }
                this.currentLine = this.conversation?.[step.line];
            }
            else if (!this.dialogue.visible)
                this.currentLine = undefined;
        }
        else
            this.currentLine = undefined;
        this.positionBubble();
    }
    positionBubble() {
        const bubble = this.bubble, line = this.currentLine, fighter = line?.side === 'left' ? this.left : this.right;
        if (!bubble || !line || !fighter) {
            if (bubble)
                bubble.hidden = true;
            return;
        }
        const canvas = this.game.canvas;
        const hostRect = this.host.getBoundingClientRect(), canvasRect = canvas.getBoundingClientRect();
        const anchor = fighter.speechAnchor;
        bubble.className = 'candle-battles__bubble candle-battles__bubble--' + line.kind;
        const content = bubble.querySelector('[data-cb-bubble-text]');
        if (content && content.textContent !== line.text)
            content.textContent = line.text;
        bubble.hidden = false;
        bubble.style.left = '0px';
        const x = canvasRect.left - hostRect.left + anchor.x * canvasRect.width / 1280;
        const y = canvasRect.top - hostRect.top + anchor.y * canvasRect.height / (this.shell ? 480 : 800);
        const width = bubble.offsetWidth, height = bubble.offsetHeight;
        const bubbleCenter = x + (line.side === 'left' ? -105 : 105) * canvasRect.width / 1280;
        const left = Math.max(12, Math.min(this.host.clientWidth - width - 12, bubbleCenter - width / 2));
        const hudBottom = this.shell ? 4 : canvasRect.top - hostRect.top + canvasRect.height * 235 / 800;
        const tailReach = line.kind === 'thought' ? 25 : line.kind === 'shout' ? 0 : 15;
        const top = Math.max(hudBottom, Math.min(this.host.clientHeight - height - 20, y - height - tailReach));
        bubble.style.left = left + 'px';
        bubble.style.top = top + 'px';
        bubble.style.setProperty('--tail-x', Math.max(18, Math.min(width - 18, x - left)) + 'px');
    }
    // Social capture freezes one poster frame: the settled victory/defeat pose
    // when the battle is over, or the home stance once the replay caught up.
    maybeFreezeForCapture() {
        if (!this.options.socialCapture || this.captureFrozen || !this.feed || this.catchUpReplay)
            return;
        if (this.loadingLogos.size > 0)
            return;
        if (!this.terminal && this.mode !== 'live')
            return;
        this.freezeForCapture();
    }
    freezeForCapture(force = false) {
        if (this.captureFrozen || this.disposed)
            return;
        const holdPose = force || this.options.captureTarget?.phase != null;
        if (!holdPose && this.feed?.finished && !this.terminal) {
            this.finish();
            return;
        }
        // The definitive composition must exist before a frozen frame is
        // announced, so an in-flight cinematic settles first.
        if (this.finaleSequence.running)
            this.finaleSequence.settle(phase => this.enterFinale(phase));
        this.captureFrozen = true;
        this.paused = true;
        this.audio.pause();
        this.clearDialogue();
        if (!this.terminal && !holdPose) {
            this.active = undefined;
            this.combatElapsed = 0;
            this.left?.resetPresentation();
            this.right?.resetPresentation();
        }
        // A pinned capture pose is authoritative: an ambient idle beat must not
        // replace the phase frame the poster is supposed to show.
        if (holdPose) {
            this.combatSequencer.left.reset();
            this.combatSequencer.right.reset();
            this.combatPlans = { left: undefined, right: undefined };
            this.left?.clearCombatPlan();
            this.right?.clearCombatPlan();
        }
        this.left?.root.setPosition(330, this.shell ? 185 : 260);
        this.right?.root.setPosition(950, this.shell ? 185 : 260);
        this.left?.freezePose();
        this.right?.freezePose();
        this.left?.update(this.time, 0);
        this.right?.update(this.time, 0);
        this.game.canvas.style.visibility = 'visible';
        this.host.dataset.paused = 'true';
        this.updateClocks();
        this.updateDashboard(true);
        // Announce readiness only after one fully rendered frame of the frozen
        // poster so screenshot automation never captures a half-drawn canvas.
        let announced = false;
        const announce = () => {
            if (announced || this.disposed)
                return;
            if (this.finaleSequence.running && !this.finaleSequence.settled) {
                this.game.events.once('postrender', announce);
                setTimeout(announce, 250);
                return;
            }
            announced = true;
            this.host.dataset.captureFrame = 'frozen';
            this.host.dispatchEvent(new CustomEvent('candle-battles-capture-frozen'));
        };
        this.game.events.once('postrender', announce);
        setTimeout(announce, 250);
    }
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.clearDialogue();
        if (this.readyTimer)
            clearTimeout(this.readyTimer);
        this.controls.removeEventListener('click', this.controlClick);
        this.controls.removeEventListener('input', this.controlInput);
        this.observer.disconnect();
        document.removeEventListener('visibilitychange', this.visibility);
        this.motionQuery.removeEventListener('change', this.motionChange);
        this.audio.dispose();
        this.moneyFlow?.destroy();
        this.moneyFlow = undefined;
        this.game.destroy(true);
        this.history = [];
        this.market.clear();
        this.clock.clear();
        this.effects = [];
        this.hud.clear();
        this.logos.clear();
        this.logoFallbacks.clear();
        this.logoSymbols.clear();
        this.loadingLogos.clear();
        this.ownedLogoTextures.clear();
        this.scene = undefined;
        delete this.host.dataset.ready;
    }
}
