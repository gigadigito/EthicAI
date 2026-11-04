import type Phaser from 'phaser';

interface PooledParticle {
    image: Phaser.GameObjects.Image;
    active: boolean;
    age: number;
    life: number;
    vx: number;
    vy: number;
    baseAlpha: number;
    baseScaleX: number;
    baseScaleY: number;
    grow: number;
}

const MAX_SPARKS = 18;
const MAX_SMOKE = 10;

/**
 * Small pooled effect layer: friction sparks under the strained team and dust around
 * the fixed wheel. Particles are recycled from a bounded pool so long sessions cannot
 * grow the scene graph.
 */
export class ArenaParticleSystem {
    private readonly scene: Phaser.Scene;
    private readonly reducedMotion: boolean;
    private readonly sparks: PooledParticle[] = [];
    private readonly smoke: PooledParticle[] = [];
    private lastSparkTime: number = 0;
    private lastSmokeTime: number = 0;

    constructor(scene: Phaser.Scene, reducedMotion: boolean = false) {
        this.scene = scene;
        this.reducedMotion = reducedMotion;
    }

    /**
     * Emits friction sparks when a team is enduring severe strain.
     */
    public emitStrainSparks(
        time: number,
        footPositions: { x: number; y: number }[],
        colorHex: number
    ): void {
        if (this.reducedMotion || footPositions.length === 0) {
            return;
        }

        const interval = 180;
        if (time - this.lastSparkTime < interval) {
            return;
        }
        this.lastSparkTime = time;

        const targetFoot = footPositions[Math.floor(Math.random() * footPositions.length)];
        this.spawn(this.sparks, MAX_SPARKS, 'effect-sparks', {
            x: targetFoot.x + (Math.random() * 20 - 10),
            y: targetFoot.y + 70 + (Math.random() * 6 - 3),
            width: 28 + Math.random() * 12,
            height: 16 + Math.random() * 8,
            tint: colorHex,
            alpha: 0.85,
            depth: 15,
            life: 240,
            vy: -0.06,
            grow: 0.45
        });
    }

    /**
     * Emits a smoke puff around the central wheel while the mechanism works hard.
     */
    public emitWheelSmoke(wheelX: number, wheelY: number): void {
        if (this.reducedMotion || !this.scene.textures.exists('effect-smoke')) {
            return;
        }

        const interval = 220;
        const now = this.scene.time.now;
        if (now - this.lastSmokeTime < interval) {
            return;
        }
        this.lastSmokeTime = now;

        this.spawn(this.smoke, MAX_SMOKE, 'effect-smoke', {
            x: wheelX + (Math.random() * 40 - 20),
            y: wheelY + 60 + (Math.random() * 20 - 10),
            width: 32,
            height: 22,
            tint: 0xffffff,
            alpha: 0.4,
            depth: 6,
            life: 620,
            vy: -0.045,
            grow: 1.6
        });
    }

    /**
     * Advances pooled particles. Called once per frame from the scene update.
     */
    public update(delta: number): void {
        this.advance(this.sparks, delta);
        this.advance(this.smoke, delta);
    }

    private spawn(
        pool: PooledParticle[],
        max: number,
        texture: string,
        spec: {
            x: number;
            y: number;
            width: number;
            height: number;
            tint: number;
            alpha: number;
            depth: number;
            life: number;
            vy: number;
            grow: number;
        }
    ): void {
        let particle = pool.find(entry => !entry.active);
        if (!particle) {
            if (pool.length >= max) {
                return;
            }
            particle = {
                image: this.scene.add.image(spec.x, spec.y, texture).setDepth(spec.depth),
                active: false,
                age: 0,
                life: 1,
                vx: 0,
                vy: 0,
                baseAlpha: spec.alpha,
                baseScaleX: 1,
                baseScaleY: 1,
                grow: 1
            };
            pool.push(particle);
        }

        const image = particle.image;
        image.setPosition(spec.x, spec.y);
        image.setDepth(spec.depth);
        image.setTint(spec.tint);
        image.setAlpha(spec.alpha);
        image.setVisible(true);

        particle.baseAlpha = spec.alpha;
        particle.baseScaleX = spec.width / Math.max(1, image.width);
        particle.baseScaleY = spec.height / Math.max(1, image.height);
        image.setScale(particle.baseScaleX, particle.baseScaleY);

        particle.active = true;
        particle.age = 0;
        particle.life = spec.life;
        particle.vy = spec.vy;
        particle.vx = 0;
        particle.grow = spec.grow;
    }

    private advance(pool: PooledParticle[], delta: number): void {
        for (const particle of pool) {
            if (!particle.active) {
                continue;
            }

            particle.age += delta;
            const progress = particle.age / particle.life;
            if (progress >= 1) {
                particle.active = false;
                particle.image.setVisible(false);
                continue;
            }

            const image = particle.image;
            image.y += particle.vy * delta;
            const scale = 1 + (particle.grow - 1) * progress;
            image.setScale(particle.baseScaleX * scale, particle.baseScaleY * scale);
            image.setAlpha(particle.baseAlpha * (1 - progress));
        }
    }

    public destroy(): void {
        for (const particle of this.sparks) {
            particle.image.destroy();
        }
        for (const particle of this.smoke) {
            particle.image.destroy();
        }
        this.sparks.length = 0;
        this.smoke.length = 0;
    }
}
