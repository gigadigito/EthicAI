export class ArenaParticleSystem {
    constructor(scene) {
        this.lastSparkTime = 0;
        this.scene = scene;
        this.sparksGroup = scene.add.group({
            maxSize: 16
        });
    }
    /**
     * Emits subtle friction sparks when a team is enduring severe strain (> 65% opponent dominance).
     */
    emitStrainSparks(time, footPositions, colorHex) {
        if (time - this.lastSparkTime < 180 || footPositions.length === 0) {
            return;
        }
        this.lastSparkTime = time;
        const targetFoot = footPositions[Math.floor(Math.random() * footPositions.length)];
        const sparkX = targetFoot.x + (Math.random() * 20 - 10);
        const sparkY = targetFoot.y + 70 + (Math.random() * 6 - 3);
        const spark = this.scene.add.image(sparkX, sparkY, 'effect-sparks')
            .setDisplaySize(28 + Math.random() * 12, 16 + Math.random() * 8)
            .setTint(colorHex)
            .setAlpha(0.85)
            .setDepth(15);
        this.scene.tweens.add({
            targets: spark,
            alpha: 0,
            scaleX: 0.4,
            scaleY: 0.4,
            y: sparkY - 12 - Math.random() * 8,
            duration: 220,
            ease: 'Cubic.easeOut',
            onComplete: () => {
                spark.destroy();
            }
        });
    }
    /**
     * Emits subtle smoke puff around the central wheel during high-strain activity.
     */
    emitWheelSmoke(wheelX, wheelY) {
        if (!this.scene.textures.exists('effect-smoke'))
            return;
        const smokeX = wheelX + (Math.random() * 40 - 20);
        const smokeY = wheelY + 60 + (Math.random() * 20 - 10);
        const smoke = this.scene.add.image(smokeX, smokeY, 'effect-smoke')
            .setDisplaySize(32, 22)
            .setAlpha(0.4)
            .setDepth(6);
        this.scene.tweens.add({
            targets: smoke,
            alpha: 0,
            scaleX: 1.6,
            scaleY: 1.6,
            y: smokeY - 25,
            duration: 600,
            ease: 'Quad.easeOut',
            onComplete: () => {
                smoke.destroy();
            }
        });
    }
    destroy() {
        this.sparksGroup.destroy(true);
    }
}
