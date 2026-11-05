import { ARENA_COLORS, DEFAULT_LABELS, formatDisplaySymbol } from './model.20261105b.js';
export class ArenaPressureHud {
    constructor(scene, labels = DEFAULT_LABELS, leftSymbol = 'LSK', rightSymbol = 'BMT') {
        this.scene = scene;
        this.labels = { ...DEFAULT_LABELS, ...labels };
        this.topG = scene.add.graphics().setDepth(20);
        this.bottomG = scene.add.graphics().setDepth(20);
        // 1. TOP BAR ELEMENTS
        this.titleText = scene.add.text(480, 33, this.labels.title, {
            fontFamily: 'Inter, Montserrat, "Segoe UI", Arial, sans-serif',
            fontSize: '26px',
            fontStyle: '900',
            color: '#f0f6fc',
            letterSpacing: 2
        }).setOrigin(0.5).setDepth(22);
        // Left Symbol Badge (Orange)
        const leftFormatted = `${formatDisplaySymbol(leftSymbol)} / USDT`;
        this.leftSymbolText = scene.add.text(90, 42, leftFormatted, {
            fontFamily: 'Inter, Montserrat, "Segoe UI", Arial, sans-serif',
            fontSize: '20px',
            fontStyle: '800',
            color: ARENA_COLORS.leftHex,
            letterSpacing: 1
        }).setOrigin(0, 0.5).setDepth(22);
        // Right Symbol Badge (Cyan)
        const rightFormatted = `${formatDisplaySymbol(rightSymbol)} / USDT`;
        this.rightSymbolText = scene.add.text(870, 42, rightFormatted, {
            fontFamily: 'Inter, Montserrat, "Segoe UI", Arial, sans-serif',
            fontSize: '20px',
            fontStyle: '800',
            color: ARENA_COLORS.rightHex,
            letterSpacing: 1
        }).setOrigin(1, 0.5).setDepth(22);
        // 2. BOTTOM BAR ELEMENTS
        // Left Pressure Value
        this.leftLabelText = scene.add.text(140, 474, this.labels.leftPressure, {
            fontFamily: 'Inter, "Segoe UI", Arial, sans-serif',
            fontSize: '11px',
            fontStyle: '800',
            color: '#a0aec0',
            letterSpacing: 1
        }).setOrigin(0.5).setDepth(22);
        this.leftPercentText = scene.add.text(140, 504, '50%', {
            fontFamily: 'Inter, Montserrat, "Segoe UI", Arial, sans-serif',
            fontSize: '34px',
            fontStyle: '900',
            color: ARENA_COLORS.leftHex
        }).setOrigin(0.5).setDepth(22);
        // Right Pressure Value
        this.rightLabelText = scene.add.text(820, 474, this.labels.rightPressure, {
            fontFamily: 'Inter, "Segoe UI", Arial, sans-serif',
            fontSize: '11px',
            fontStyle: '800',
            color: '#a0aec0',
            letterSpacing: 1
        }).setOrigin(0.5).setDepth(22);
        this.rightPercentText = scene.add.text(820, 504, '50%', {
            fontFamily: 'Inter, Montserrat, "Segoe UI", Arial, sans-serif',
            fontSize: '34px',
            fontStyle: '900',
            color: ARENA_COLORS.rightHex
        }).setOrigin(0.5).setDepth(22);
        // Center Dominance Badge
        this.statusText = scene.add.text(480, 502, this.labels.balanced, {
            fontFamily: 'Inter, Montserrat, "Segoe UI", Arial, sans-serif',
            fontSize: '17px',
            fontStyle: '900',
            color: '#ffffff',
            letterSpacing: 1.5
        }).setOrigin(0.5).setDepth(22);
        this.drawStaticTopFrames();
    }
    drawStaticTopFrames() {
        const g = this.topG;
        g.clear();
        // Top bar backdrop strip
        g.fillStyle(0x060c18, 0.88);
        g.fillRoundedRect(16, 12, 928, 58, 8);
        // Subtly bevelled top stroke with orange/cyan side gradients
        g.lineStyle(1.5, 0x223249, 0.75);
        g.strokeRoundedRect(16, 12, 928, 58, 8);
        // Left Asset Hex Box
        g.fillStyle(0x111c2e, 0.95);
        g.fillRoundedRect(28, 22, 220, 38, 6);
        g.lineStyle(2, ARENA_COLORS.left, 0.9);
        g.strokeRoundedRect(28, 22, 220, 38, 6);
        // Right Asset Hex Box
        g.fillStyle(0x111c2e, 0.95);
        g.fillRoundedRect(712, 22, 220, 38, 6);
        g.lineStyle(2, ARENA_COLORS.right, 0.9);
        g.strokeRoundedRect(712, 22, 220, 38, 6);
        // Center title plaque: clean and symmetrical, with linear colour accents
        // instead of chevrons that can read as stray < or > characters.
        g.fillStyle(0x0c1524, 0.96);
        g.fillRoundedRect(320, 11, 320, 44, 7);
        g.lineStyle(2, 0x364860, 0.85);
        g.strokeRoundedRect(320, 11, 320, 44, 7);
        g.fillStyle(ARENA_COLORS.left, 0.95);
        g.fillRoundedRect(328, 17, 42, 3, 1.5);
        g.fillStyle(ARENA_COLORS.right, 0.95);
        g.fillRoundedRect(590, 17, 42, 3, 1.5);
        g.fillStyle(ARENA_COLORS.left, 0.7);
        g.fillCircle(326, 18.5, 2);
        g.fillStyle(ARENA_COLORS.right, 0.7);
        g.fillCircle(634, 18.5, 2);
    }
    /**
     * Updates dynamic HUD values, proportion bar, and dominance banner.
     */
    update(currentPressure, dominance, leftSymbol, rightSymbol, isFinished = false) {
        const leftVal = Math.round(currentPressure);
        const rightVal = 100 - leftVal;
        // Texts
        this.leftPercentText.setText(`${leftVal}%`);
        this.rightPercentText.setText(`${rightVal}%`);
        this.leftSymbolText.setText(`${formatDisplaySymbol(leftSymbol)} / USDT`);
        this.rightSymbolText.setText(`${formatDisplaySymbol(rightSymbol)} / USDT`);
        let statusString = this.labels.balanced;
        let statusColor = '#ffffff';
        if (isFinished) {
            // A finished match keeps the real final pressure visible and marks the winner.
            statusString = dominance === 'balanced'
                ? this.labels.finished
                : (dominance === 'left' ? this.labels.leftDominance : this.labels.rightDominance);
            statusColor = dominance === 'left'
                ? ARENA_COLORS.leftHex
                : dominance === 'right'
                    ? ARENA_COLORS.rightHex
                    : '#ffffff';
        }
        else if (dominance === 'left') {
            statusString = this.labels.leftDominance;
            statusColor = ARENA_COLORS.leftHex;
        }
        else if (dominance === 'right') {
            statusString = this.labels.rightDominance;
            statusColor = ARENA_COLORS.rightHex;
        }
        this.statusText.setText(statusString);
        this.statusText.setColor(statusColor);
        // Draw Bottom Dynamic Bar & Frames
        const g = this.bottomG;
        g.clear();
        // 1. Left Card Frame
        g.fillStyle(0x080f1d, 0.94);
        g.fillRoundedRect(36, 458, 208, 68, 8);
        g.lineStyle(2, ARENA_COLORS.left, 0.9);
        g.strokeRoundedRect(36, 458, 208, 68, 8);
        // 2. Right Card Frame
        g.fillStyle(0x080f1d, 0.94);
        g.fillRoundedRect(716, 458, 208, 68, 8);
        g.lineStyle(2, ARENA_COLORS.right, 0.9);
        g.strokeRoundedRect(716, 458, 208, 68, 8);
        // 3. Center Dominance Plaque
        g.fillStyle(0x0a1424, 0.96);
        g.fillRoundedRect(280, 480, 400, 44, 8);
        const centerStrokeColor = dominance === 'left' ? ARENA_COLORS.left : dominance === 'right' ? ARENA_COLORS.right : 0x485a73;
        g.lineStyle(2, centerStrokeColor, 0.9);
        g.strokeRoundedRect(280, 480, 400, 44, 8);
        // 4. Center Proportion Gauge Bar (Dual progress line at y = 464)
        const barX = 280;
        const barY = 462;
        const barW = 400;
        const barH = 10;
        const splitW = (barW * currentPressure) / 100;
        // Dark track
        g.fillStyle(0x131f30, 1.0);
        g.fillRoundedRect(barX, barY, barW, barH, 4);
        // Left fill (Orange)
        if (splitW > 2) {
            g.fillStyle(ARENA_COLORS.left, 1.0);
            g.fillRoundedRect(barX, barY, splitW, barH, 4);
        }
        // Right fill (Cyan)
        if (barW - splitW > 2) {
            g.fillStyle(ARENA_COLORS.right, 1.0);
            g.fillRoundedRect(barX + splitW, barY, barW - splitW, barH, 4);
        }
        // Divider notch at split point
        g.fillStyle(0xffffff, 0.95);
        g.fillRect(barX + splitW - 2, barY - 2, 4, barH + 4);
    }
    setLabels(labels) {
        this.labels = { ...this.labels, ...labels };
        this.titleText.setText(this.labels.title || 'ARENA PRESSURE');
        this.leftLabelText.setText(this.labels.leftPressure || 'LEFT PRESSURE');
        this.rightLabelText.setText(this.labels.rightPressure || 'RIGHT PRESSURE');
    }
    destroy() {
        this.topG.destroy();
        this.bottomG.destroy();
        this.titleText.destroy();
        this.leftSymbolText.destroy();
        this.rightSymbolText.destroy();
        this.leftLabelText.destroy();
        this.leftPercentText.destroy();
        this.rightLabelText.destroy();
        this.rightPercentText.destroy();
        this.statusText.destroy();
    }
}
