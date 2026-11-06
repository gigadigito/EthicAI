const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const clamp01 = (value) => clamp(Number.isFinite(value) ? value : .5, 0, 1);
/** Small deterministic hash used for cadence and blink timing. */
function hash(seed) {
    let value = Math.imul(seed | 0, 2246822507);
    value ^= value >>> 15;
    value = Math.imul(value, 3266489907);
    value ^= value >>> 16;
    return (value >>> 0) / 4294967296;
}
/** Presentation-only movement and facial timing. */
export class CandleCharacterBehaviorController {
    constructor(side) {
        this.side = side;
        this.seed = 0;
        this.initialized = false;
        this.currentX = 0;
        this.targetX = 0;
        this.state = 'idle';
        this.decisionAt = 0;
        this.holdUntil = 0;
        this.lastNow = 0;
        this.nextBlinkAt = 0;
        this.blinkUntil = 0;
        this.secondBlinkStart = 0;
        this.secondBlinkUntil = 0;
        this.blinkIndex = 0;
        this.forwardSign = side === 'left' ? 1 : -1;
    }
    reset(seed = 0, x = 0, nowMs = 0) {
        this.seed = (seed | 0) ^ (this.side === 'left' ? 0x13579bdf : 0x2468ace0);
        this.initialized = true;
        this.currentX = x;
        this.targetX = x;
        this.state = 'idle';
        this.decisionAt = nowMs;
        this.holdUntil = nowMs;
        this.lastNow = nowMs;
        this.nextBlinkAt = Math.max(0, nowMs) + 3000 + hash(this.seed) * 4000;
        this.blinkUntil = 0;
        this.secondBlinkStart = 0;
        this.secondBlinkUntil = 0;
        this.blinkIndex = 0;
    }
    get position() { return this.currentX; }
    update(input) {
        const now = Number.isFinite(input.nowMs) ? input.nowMs : this.lastNow;
        const delta = Math.max(0, Math.min(100, Number.isFinite(input.deltaMs) ? input.deltaMs : 0));
        if (!this.initialized)
            this.reset(0, input.baseX, now);
        if (now < this.lastNow)
            this.reset(this.seed, input.baseX, now);
        this.lastNow = now;
        const blink = this.updateBlink(now);
        const disabled = !!input.reducedMotion || !!input.terminal || input.active;
        if (disabled) {
            this.targetX = clamp(input.baseX, input.minX, input.maxX);
            this.state = 'idle';
        }
        else if (now >= this.decisionAt) {
            this.chooseTarget(input, now);
        }
        this.targetX = this.constrainTarget(this.targetX, input);
        const distance = this.targetX - this.currentX;
        const step = disabled ? 1 : Math.min(1, delta / 420);
        this.currentX += distance * (step * (2 - step));
        if (Math.abs(this.targetX - this.currentX) < .75)
            this.currentX = this.targetX;
        this.currentX = this.constrainTarget(this.currentX, input);
        const moving = Math.abs(this.targetX - this.currentX) > .75;
        if (!disabled && moving) {
            if (this.state === 'return-to-base') {
                // Preserve the return semantic while the run cycle walks home.
            }
            else if (this.state === 'approach') {
                this.state = this.forwardSign * distance > 0 ? 'walk-forward' : 'idle';
            }
            else if (this.state === 'retreat') {
                this.state = this.forwardSign * distance < 0 ? 'walk-backward' : 'idle';
            }
            else {
                this.state = this.forwardSign * distance > 0 ? 'walk-forward' : 'walk-backward';
            }
        }
        else if (!disabled && now >= this.holdUntil && Math.abs(this.targetX - input.baseX) > 1) {
            this.targetX = input.baseX;
            this.state = 'return-to-base';
            this.decisionAt = now + 1200;
        }
        else if (!moving) {
            this.state = 'idle';
        }
        return { x: this.currentX, locomotion: this.state, blink: blink && !disabled, moving };
    }
    chooseTarget(input, now) {
        const pressure = clamp01(input.pressure);
        const currentOffset = this.currentX - input.baseX;
        this.decisionAt = now + 1600 + hash(this.seed + Math.floor(now / 1000)) * 2200;
        if (pressure >= .60 && currentOffset * this.forwardSign < 64) {
            const distance = 24 + hash(this.seed + 11 + this.blinkIndex) * 32;
            this.targetX = input.baseX + this.forwardSign * distance;
            this.state = 'approach';
            this.holdUntil = now + 1300 + hash(this.seed + 17) * 2200;
        }
        else if (pressure <= .40 && currentOffset * this.forwardSign > -64) {
            const distance = 22 + hash(this.seed + 23 + this.blinkIndex) * 30;
            this.targetX = input.baseX - this.forwardSign * distance;
            this.state = 'retreat';
            this.holdUntil = now + 1500 + hash(this.seed + 29) * 2400;
        }
        else if (Math.abs(pressure - .5) < .08) {
            this.targetX = input.baseX;
            this.state = 'return-to-base';
            this.holdUntil = now + 1100;
        }
    }
    constrainTarget(x, input) {
        const opponentLimit = this.side === 'left'
            ? input.opponentX - input.minSeparation
            : input.opponentX + input.minSeparation;
        const min = this.side === 'right' ? Math.max(input.minX, opponentLimit) : input.minX;
        const max = this.side === 'left' ? Math.min(input.maxX, opponentLimit) : input.maxX;
        return clamp(x, min, max);
    }
    updateBlink(now) {
        if (now >= this.nextBlinkAt && now <= this.nextBlinkAt + 240 && !this.blinkUntil) {
            const duration = 100 + hash(this.seed + 31 + this.blinkIndex) * 80;
            this.blinkUntil = this.nextBlinkAt + duration;
            if (hash(this.seed + 37 + this.blinkIndex) > .74) {
                this.secondBlinkStart = this.blinkUntil + 110 + hash(this.seed + 41) * 80;
                this.secondBlinkUntil = this.secondBlinkStart + duration * .82;
            }
            this.blinkIndex++;
        }
        const active = (now >= this.nextBlinkAt && now <= this.blinkUntil)
            || (this.secondBlinkStart > 0 && now >= this.secondBlinkStart && now <= this.secondBlinkUntil);
        if (this.blinkUntil > 0 && now > Math.max(this.blinkUntil, this.secondBlinkUntil)) {
            this.nextBlinkAt = now + 3000 + hash(this.seed + 43 + this.blinkIndex) * 4000;
            this.blinkUntil = 0;
            this.secondBlinkStart = 0;
            this.secondBlinkUntil = 0;
        }
        return active;
    }
}
