import type Phaser from 'phaser';
import { ARENA_COLORS, formatDisplaySymbol, RopePoint } from './model.js';

type TeamSide = 'left' | 'right';

interface TeamBadge {
    readonly side: TeamSide;
    readonly frame: Phaser.GameObjects.Graphics;
    symbol: string;
    displaySymbol: string;
    textureKey?: string;
    image?: Phaser.GameObjects.Image;
    fallback?: Phaser.GameObjects.Text;
}

/** Keeps one cached coin emblem per team and follows the middle candle. */
export class TeamLogoRenderer {
    private readonly scene: Phaser.Scene;
    private readonly badges: Record<TeamSide, TeamBadge>;
    private readonly loading = new Set<string>();
    private readonly ownedTextures = new Set<string>();
    private disposed = false;

    constructor(scene: Phaser.Scene, leftSymbol: string, rightSymbol: string) {
        this.scene = scene;
        this.badges = {
            left: this.createBadge('left'),
            right: this.createBadge('right')
        };
        this.setSymbol(this.badges.left, leftSymbol);
        this.setSymbol(this.badges.right, rightSymbol);
    }

    public setSymbols(leftSymbol: string, rightSymbol: string): void {
        this.setSymbol(this.badges.left, leftSymbol);
        this.setSymbol(this.badges.right, rightSymbol);
    }

    public update(time: number, leftAnchor: RopePoint, rightAnchor: RopePoint): void {
        this.updateBadge(this.badges.left, leftAnchor, time, 0);
        this.updateBadge(this.badges.right, rightAnchor, time, Math.PI);
    }

    private createBadge(side: TeamSide): TeamBadge {
        const badge: TeamBadge = {
            side,
            frame: this.scene.add.graphics().setDepth(16),
            symbol: '',
            displaySymbol: '?'
        };
        this.drawFrame(badge, 0);
        return badge;
    }

    private setSymbol(badge: TeamBadge, rawSymbol: string): void {
        const display = formatDisplaySymbol(rawSymbol).slice(0, 8) || '?';
        const normalized = /^[A-Z0-9]{1,20}$/.test(display) ? display : '';
        if (badge.symbol === normalized && badge.displaySymbol === display) {
            return;
        }

        badge.symbol = normalized;
        badge.displaySymbol = display;
        badge.textureKey = normalized ? `arena-coin-${normalized}` : undefined;
        badge.image?.destroy();
        badge.image = undefined;
        badge.fallback?.destroy();
        badge.fallback = undefined;
        this.showFallback(badge);

        if (!normalized || !badge.textureKey) {
            return;
        }

        const key = badge.textureKey;
        if (this.scene.textures.exists(key)) {
            this.showImage(badge, key);
            return;
        }
        if (this.loading.has(key)) {
            return;
        }

        this.loading.add(key);
        const completed = (): void => {
            this.scene.load.off(`filecomplete-image-${key}`, completed);
            this.scene.load.off('loaderror', failed);
            this.loading.delete(key);
            this.ownedTextures.add(key);
            if (!this.disposed) {
                this.showImageIfCurrent(key);
            }
        };
        const failed = (file: Phaser.Loader.File): void => {
            if (file.key !== key) {
                return;
            }
            this.scene.load.off(`filecomplete-image-${key}`, completed);
            this.scene.load.off('loaderror', failed);
            this.loading.delete(key);
        };

        this.scene.load.once(`filecomplete-image-${key}`, completed);
        this.scene.load.on('loaderror', failed);
        this.scene.load.image(key, `/futurebol/team-logo/${encodeURIComponent(normalized)}`);
        this.scene.load.start();
    }

    private showImageIfCurrent(key: string): void {
        for (const badge of Object.values(this.badges)) {
            if (badge.textureKey === key) {
                this.showImage(badge, key);
            }
        }
    }

    private showImage(badge: TeamBadge, key: string): void {
        if (this.disposed || !this.scene.textures.exists(key)) {
            return;
        }
        badge.fallback?.destroy();
        badge.fallback = undefined;
        badge.image?.destroy();

        const image = this.scene.add.image(0, 0, key).setDepth(17).setAlpha(0.98);
        const source = image.texture.getSourceImage() as { width?: number; height?: number };
        const width = Math.max(1, Number(source.width) || 1);
        const height = Math.max(1, Number(source.height) || 1);
        image.setScale(Math.min(29 / width, 29 / height));
        badge.image = image;
    }

    private showFallback(badge: TeamBadge): void {
        const color = badge.side === 'left' ? ARENA_COLORS.leftHex : ARENA_COLORS.rightHex;
        badge.fallback = this.scene.add.text(0, 0, badge.displaySymbol, {
            fontFamily: 'Inter, Montserrat, "Segoe UI", Arial, sans-serif',
            fontSize: '11px',
            fontStyle: '900',
            color,
            align: 'center'
        }).setOrigin(0.5).setDepth(17);
    }

    private updateBadge(badge: TeamBadge, anchor: RopePoint, time: number, phase: number): void {
        const bob = Math.sin(time * 0.002 + phase) * 0.8;
        const x = anchor.x;
        const y = anchor.y + bob;
        badge.frame.setPosition(x, y);
        this.drawFrame(badge, time * 0.001 + phase);
        badge.image?.setPosition(x, y);
        badge.fallback?.setPosition(x, y);
    }

    private drawFrame(badge: TeamBadge, phase: number): void {
        const color = badge.side === 'left' ? ARENA_COLORS.left : ARENA_COLORS.right;
        const glow = badge.side === 'left' ? 0x5d2c05 : 0x073f42;
        const pulse = 0.72 + Math.sin(phase * 2.4) * 0.08;
        const g = badge.frame;
        g.clear();
        g.fillStyle(0x07101b, 0.96);
        g.fillCircle(0, 0, 25);
        g.fillStyle(glow, 0.42);
        g.fillCircle(0, 0, 22);
        g.lineStyle(3, color, pulse);
        g.strokeCircle(0, 0, 24);
        g.lineStyle(1, 0xffffff, 0.24);
        g.strokeCircle(0, 0, 19);
    }

    public destroy(): void {
        this.disposed = true;
        for (const badge of Object.values(this.badges)) {
            badge.frame.destroy();
            badge.image?.destroy();
            badge.fallback?.destroy();
        }
        for (const key of this.ownedTextures) {
            if (this.scene.textures.exists(key)) {
                this.scene.textures.remove(key);
            }
        }
        this.ownedTextures.clear();
        this.loading.clear();
    }
}
