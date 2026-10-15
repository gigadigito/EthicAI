import { MarketHeartbeat, BattleClock, BattleStateMachine, TerritoryManager, TEAM, demoRound, sharedRange, validRound, combatFrame } from './model.js?v=20261015c';
import { CandleRenderer } from './renderer.js?v=20261015c';
import { AudioManager } from './audio.js?v=20261015c';
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
        this.logos = new Map();
        this.logoSymbols = new Map();
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
        this.started = false;
        this.reduced = false;
        this.speed = 1;
        this.demoIndex = 0;
        this.demoElapsed = 0;
        this.replayIndex = 0;
        this.flash = 0;
        this.disposed = false;
        this.pendingReconcile = false;
        this.backgrounded = false;
        this.time = 0;
        this.combatElapsed = 0;
        this.mode = options.mode;
        this.state = new BattleStateMachine(options.battleDurationMs);
        this.ready = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
        this.readyTimer = setTimeout(() => this.readyReject(new Error('Candle Battles asset load timeout')), 20000);
        this.controls = host.closest('.candle-battles') ?? host;
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
            preload() { this.load.on('loaderror', () => owner.readyReject(new Error('Candle Battles asset failed to load'))); this.load.atlas('modular', '/games/candle-battles/assets/modular.png?v=20261015c', '/games/candle-battles/assets/modular.json?v=20261015c'); }
            create() { owner.setup(this); }
            update(_time, delta) { owner.update(delta); }
        }
        this.game = new Phaser.Game({ type: Phaser.AUTO, parent: host, width: 1280, height: 800,
            backgroundColor: '#101722', transparent: false, antialias: true,
            scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
            render: { preserveDrawingBuffer: false }, audio: { noAudio: true }, scene: BattleScene,
            banner: false, fps: { target: 60 }, input: { keyboard: false, mouse: false, touch: false } });
        this.observer = new ResizeObserver(() => { if (!this.disposed)
            this.game.scale.refresh(); });
        this.observer.observe(host);
        this.visibility = () => {
            this.backgrounded = document.hidden;
            if (document.hidden)
                this.audio.pause();
            else if (this.mode === 'live') {
                this.pendingReconcile = true;
                if (this.feed)
                    this.reconcile();
            }
            else if (this.started && !this.paused)
                this.audio.loop('arena');
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
        g.fillStyle(0x1e2430, .9).fillRoundedRect(24, 24, 1232, 126, 16);
        g.lineStyle(1, 0x4c6069, .45).strokeRoundedRect(24, 24, 1232, 126, 16);
        this.label('brand', 'CANDLE BATTLES', 640, 42, 30, '#f3f5f7', .5);
        this.label('subtitle', this.text('arcade'), 640, 80, 14, '#94a3b8', .5);
        this.label('mode', this.mode.toUpperCase() + ' · 5M', 640, 155, 13, '#c1f20f', .5);
        this.label('leftName', '—', 124, 48, 30, '#c1f20f');
        this.label('rightName', '—', 1150, 48, 30, '#30d7ca', 1);
        this.label('leftPrice', '—', 62, 120, 18);
        this.label('rightPrice', '—', 1218, 120, 18, '#f3f5f7', 1);
        this.label('score', '0 : 0', 640, 105, 34, '#f3f5f7', .5);
        this.label('status', this.text('waiting'), 640, 182, 16, '#94a3b8', .5);
        this.label('result', '', 640, 208, 27, '#f3f5f7', .5);
        this.label('leftStrength', '', 70, 411, 17, '#c1f20f');
        this.label('rightStrength', '', 1210, 411, 17, '#30d7ca', 1);
        this.label('history', this.text('recent'), 48, 470, 17);
        this.label('lines', this.text('lines') + ' 0', 1230, 470, 17, '#94a3b8', 1);
        this.label('recent', '', 48, 502, 14, '#94a3b8');
        this.label('territory', this.text('territory'), 640, 744, 16, '#94a3b8', .5);
        this.label('percent', '50% / 50%', 640, 772, 16, '#f3f5f7', .5);
        this.chart = scene.add.graphics();
        this.lineFlash = scene.add.graphics().setDepth(20);
        this.left = new CandleRenderer(scene, 'left', 330, 230);
        this.right = new CandleRenderer(scene, 'right', 950, 230);
        this.left.setReducedMotion(this.reduced);
        this.right.setReducedMotion(this.reduced);
        this.drawTerritory();
        if (this.feed)
            this.receive(this.feed, this.pendingReconcile);
        if (this.mode === 'demo')
            this.showDemoForming(0);
        if (this.readyTimer)
            clearTimeout(this.readyTimer);
        this.readyResolve();
        this.host.dataset.ready = 'true';
        this.host.dispatchEvent(new CustomEvent('candle-battles-ready'));
    }
    label(id, text, x, y, size = 18, color = '#f3f5f7', origin = 0) {
        this.hud.set(id, this.scene.add.text(x, y, text, { fontFamily: 'system-ui, sans-serif', fontSize: size + 'px', color, fontStyle: 'bold' }).setOrigin(origin, 0));
    }
    receive(feed, reconcile = false) {
        if (this.disposed)
            return;
        if (this.feed && this.feed.matchId !== feed.matchId) {
            this.history = [];
            this.market.clear();
            this.clock.clear();
            this.territory.reset();
            this.active = undefined;
            this.combatElapsed = 0;
            this.state.reset();
        }
        this.feed = feed;
        this.pendingReconcile || (this.pendingReconcile = reconcile);
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
        const fresh = feed.rounds.filter(r => r.matchId === feed.matchId && validRound(r) && !known.has(r.id));
        this.history.push(...fresh);
        this.history.sort((a, b) => a.left.openTime - b.left.openTime);
        if (this.mode === 'live') {
            if (this.pendingReconcile)
                this.reconcile();
            else
                for (const round of fresh)
                    this.clock.enqueue(round);
            this.hud.get('status')?.setText(this.text(feed.finished ? 'finished' : feed.status === 'live' ? 'forming' : 'waiting'));
        }
        this.setLogo('left', feed.leftSymbol);
        this.setLogo('right', feed.rightSymbol);
        this.hud.get('leftName')?.setText(feed.leftSymbol);
        this.hud.get('rightName')?.setText(feed.rightSymbol);
        this.updateMarket();
    }
    reconcile() {
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
        this.left?.setPose('FORMING_CANDLE', true);
        this.right?.setPose('FORMING_CANDLE', true);
        this.drawTerritory();
        this.updateMarket();
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
            this.speed = value;
        if (action === 'fullscreen') {
            if (document.fullscreenElement)
                void document.exitFullscreen().catch(() => { });
            else
                void this.host.parentElement?.requestFullscreen().catch(() => { });
        }
        if (action === 'replay') {
            this.replayHistory = this.history.map(r => ({ ...r, left: { ...r.left }, right: { ...r.right } }));
            this.mode = 'replay';
            this.restart();
        }
        if (action === 'live' && this.options.mode === 'live') {
            this.mode = 'live';
            this.reconcile();
        }
        if (action === 'restart')
            this.restart();
        this.host.dataset.paused = String(this.paused);
        this.host.dataset.mode = this.mode;
        this.hud.get('mode')?.setText(this.mode.toUpperCase() + ' · 5M');
        this.controls.querySelector('[data-cb-action="pause"]')?.setAttribute('aria-pressed', String(this.paused));
        this.controls.querySelector('[data-cb-action="mute"]')?.setAttribute('aria-pressed', String(!this.audio.muted));
    }
    restart() {
        this.active = undefined;
        this.combatElapsed = 0;
        this.clock.clear();
        this.territory.reset();
        this.state.reset();
        this.market.clear();
        this.tile?.destroy();
        this.tile = undefined;
        this.dropTarget = undefined;
        this.demoIndex = 0;
        this.demoElapsed = 0;
        this.replayIndex = 0;
        this.started = true;
        this.paused = false;
        this.hud.get('result')?.setText('');
        this.drawTerritory();
        this.audio.loop('arena');
        if (this.mode === 'live')
            this.reconcile();
        if (this.mode === 'demo')
            this.history = [];
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
        this.time += dt;
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
        if (!this.active && (this.started || this.mode === 'live')) {
            if (this.mode === 'replay' && this.clock.count === 0 && this.replayIndex < this.replayHistory.length)
                this.clock.enqueue(this.replayHistory[this.replayIndex++]);
            const next = this.clock.next();
            if (next)
                this.begin(next);
        }
        if (this.active)
            this.state.advance(battleDt, p => this.enter(p));
        const p = this.state.progress;
        if (this.active) {
            this.combatElapsed += battleDt;
            const frame = combatFrame(this.active.left, this.active.right, this.active.leftStrength, this.active.rightStrength, this.combatElapsed, this.state.durationMs, this.active.left.openTime, this.active.winner);
            const center = 640 + frame.centerOffset;
            const leftX = center - frame.separation / 2;
            const rightX = center + frame.separation / 2;
            this.left?.root.setPosition(leftX, 230);
            this.right?.root.setPosition(rightX, 230);
            this.left?.setCombatMotion(frame.left);
            this.right?.setCombatMotion(frame.right);
        }
        else {
            // LIVE has no confirmed round while the exchange candle is forming.
            // Show readable footwork and anticipation without fabricating attacks
            // or using information from the future candle close.
            const idleStep = Math.sin(this.time / 420) * 9;
            this.left?.root.setPosition(330 + idleStep, 230);
            this.right?.root.setPosition(950 - idleStep, 230);
            const idle = .2 + Math.abs(Math.sin(this.time / 260)) * .2;
            this.left?.setCombatMotion({ attack: 0, block: idle, dodge: idle * .35, hit: 0, counter: 0, taunt: idle });
            this.right?.setCombatMotion({ attack: 0, block: idle, dodge: idle * .35, hit: 0, counter: 0, taunt: idle });
        }
        this.left?.update(this.time, dt, p);
        this.right?.update(this.time, dt, p);
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
    }
    begin(r) {
        this.active = r;
        this.combatElapsed = 0;
        const range = sharedRange([r.left, r.right]);
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
            this.burst(640, 330, r.winner === 'right' ? 'right' : 'left');
            if (!this.reduced)
                this.scene?.cameras.main.shake(100, .002);
        }
        if (phase === 'DESTROYING') {
            this.audio.play('candle_destroy');
            this.burst(r.winner === 'left' ? 720 : 560, 350, r.winner === 'left' ? 'right' : 'left');
        }
        if (phase === 'VICTORY') {
            this.hud.get('result')?.setText(r.winner === 'draw' ? this.text('draw') : (r[r.winner].symbol + ' +1'));
            this.audio.play(r.winner === 'draw' ? 'draw' : 'score_point');
            if (r.winner !== 'draw' && Math.abs(r.leftStrength - r.rightStrength) >= (this.options.crushingDifference ?? 25)) {
                this.hud.get('result')?.setText(r[r.winner].symbol + ' +1 · ' + this.text('crushing'));
                this.audio.play('big_win');
                this.burst(640, 300, r.winner);
            }
        }
        if (phase === 'BLOCK_FALLING') {
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
        }
        if (phase === 'FORMING_CANDLE') {
            this.active = undefined;
            this.combatElapsed = 0;
            this.left?.setCombatMotion({ attack: 0, block: 0, dodge: 0, hit: 0, counter: 0, taunt: 0 });
            this.right?.setCombatMotion({ attack: 0, block: 0, dodge: 0, hit: 0, counter: 0, taunt: 0 });
            this.left?.setPose(phase, true);
            this.right?.setPose(phase, true);
            this.updateMarket();
        }
    }
    setLogo(side, symbol) {
        if (!this.scene || this.logoSymbols.get(side) === symbol)
            return;
        this.logoSymbols.set(side, symbol);
        this.logos.get(side)?.destroy();
        this.logos.delete(side);
        const x = side === 'left' ? 76 : 1208;
        const simple = symbol.replace(/USDT$/, '');
        if (simple === 'BTC' || simple === 'ETH') {
            this.logos.set(side, this.scene.add.image(x, 67, 'modular', 'logo-' + simple).setDisplaySize(58, 61));
            return;
        }
        const scene = this.scene, key = 'coin-' + symbol;
        const show = () => { if (!this.disposed && this.logoSymbols.get(side) === symbol && scene.textures.exists(key))
            this.logos.set(side, scene.add.image(x, 67, key).setDisplaySize(52, 52)); };
        if (scene.textures.exists(key)) {
            show();
            return;
        }
        scene.load.once('filecomplete-image-' + key, show);
        scene.load.image(key, '/futurebol/team-logo/' + encodeURIComponent(symbol));
        scene.load.start();
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
    burst(x, y, side) {
        if (!this.scene || this.reduced)
            return;
        const count = this.host.clientWidth < 600 ? 8 : 18;
        for (let i = 0; i < count && this.effects.length < 48; i++) {
            const angle = i * 2.39996;
            const image = this.scene.add.image(x, y, 'modular', i === 0 ? 'impact-' + side : 'tile-' + side);
            image.setDisplaySize(i === 0 ? 140 : 9, i === 0 ? 140 : 9);
            this.effects.push({ image, age: 0, vx: Math.cos(angle) * (60 + i * 7), vy: Math.sin(angle) * (60 + i * 5) - 50 });
        }
    }
    drawTerritory() {
        if (!this.grid || !this.scene)
            return;
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
    setLabels(labels) {
        this.options.labels = labels;
        this.hud.get('subtitle')?.setText(this.text('arcade'));
        this.hud.get('history')?.setText(this.text('recent'));
        this.drawTerritory();
    }
    snapshot() { return { mode: this.mode, phase: this.state.phase, score: { ...this.territory.score }, tiles: this.territory.history.map(t => ({ ...t })), lines: this.territory.lines, left: this.left?.geometry, right: this.right?.geometry, faceSize: this.left?.faceSize }; }
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        if (this.readyTimer)
            clearTimeout(this.readyTimer);
        this.controls.removeEventListener('click', this.controlClick);
        this.controls.removeEventListener('input', this.controlInput);
        this.observer.disconnect();
        document.removeEventListener('visibilitychange', this.visibility);
        this.motionQuery.removeEventListener('change', this.motionChange);
        this.audio.dispose();
        this.game.destroy(true);
        this.history = [];
        this.market.clear();
        this.clock.clear();
        this.effects = [];
        this.hud.clear();
        delete this.host.dataset.ready;
    }
}
