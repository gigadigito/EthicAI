/**
 * Arena Pressure visual state & animation model.
 * Pure logic and contracts for the tug-of-war experience.
 */
export const ARENA_COLORS = {
    left: 0xff9100,
    leftHex: '#ff9100',
    leftDim: 0x553010,
    right: 0x18d8d2,
    rightHex: '#18d8d2',
    rightDim: 0x124749,
    background: 0x09111f,
    backgroundHex: '#09111f',
    gold: 0xfdc62e,
    white: 0xffffff,
    textMuted: 0x8a99ad
};
export const DEFAULT_LABELS = {
    title: 'ARENA PRESSURE',
    leftPressure: 'LEFT PRESSURE',
    rightPressure: 'RIGHT PRESSURE',
    leftDominance: 'LEFT DOMINANCE',
    rightDominance: 'RIGHT DOMINANCE',
    balanced: 'BALANCED',
    live: 'LIVE',
    finished: 'FINISHED',
    pressureEngine: 'PRESSURE ENGINE'
};
/**
 * Normalizes any raw pressure pair to sum to exactly 100%.
 * If missing, falls back to 50/50 balance.
 */
export function normalizePressure(leftRaw, rightRaw) {
    const hasLeft = leftRaw !== undefined && leftRaw !== null && Number.isFinite(Number(leftRaw));
    const hasRight = rightRaw !== undefined && rightRaw !== null && Number.isFinite(Number(rightRaw));
    if (!hasLeft && !hasRight) {
        return { left: 50, right: 50 };
    }
    let left = hasLeft ? Number(leftRaw) : 100 - Number(rightRaw);
    let right = hasRight ? Number(rightRaw) : 100 - left;
    left = Math.max(0, Math.min(100, left));
    right = Math.max(0, Math.min(100, right));
    const total = left + right;
    if (total <= 0.001) {
        return { left: 50, right: 50 };
    }
    const normalizedLeft = Math.round((left / total) * 100);
    const clampedLeft = Math.max(0, Math.min(100, normalizedLeft));
    return { left: clampedLeft, right: 100 - clampedLeft };
}
/**
 * Determines dominance with a 4% deadband around 50% for stability.
 */
export function determineDominance(left, right) {
    const diff = left - right;
    if (Math.abs(diff) <= 4) {
        return 'balanced';
    }
    return diff > 0 ? 'left' : 'right';
}
/**
 * Determines visual pull state for a candle based on pressure, dominance, and match lifecycle.
 */
export function determineCandleState(pressure, isDominant, isFinished, hasWon, previousPressure) {
    if (isFinished) {
        if (Math.abs(pressure - 50) <= 5)
            return 'idle';
        return hasWon ? 'victory' : 'defeat';
    }
    // Detecting quick momentum shift / recovery
    if (previousPressure !== undefined && isDominant && previousPressure < 50 && pressure >= 52) {
        return 'recover';
    }
    if (isDominant) {
        if (pressure >= 72)
            return 'pull-heavy';
        if (pressure >= 58)
            return 'pull-medium';
        return 'pull-light';
    }
    else {
        // Submissive / defending side
        if (pressure <= 28)
            return 'exhausted';
        if (pressure <= 42)
            return 'resist';
        return 'idle';
    }
}
/**
 * Formats token symbol cleanly (strips trailing USDT if requested).
 */
export function formatDisplaySymbol(symbol) {
    if (!symbol)
        return '--';
    const trimmed = symbol.trim().toUpperCase();
    return trimmed.replace(/\/USDT$/i, '').replace(/USDT$/i, '');
}
/**
 * Reads the left pressure at an arbitrary point in the replay.
 *
 * Sampling is stateless: seeking or resuming recomputes the value from the timeline
 * instead of accumulating events, so a jump in time can never duplicate or skip state.
 */
export function sampleHistory(history, seconds) {
    if (!history || history.length === 0) {
        return null;
    }
    if (history.length === 1) {
        return clampPercent(history[0].l);
    }
    const t = Number.isFinite(seconds) ? seconds : 0;
    if (t <= history[0].t) {
        return clampPercent(history[0].l);
    }
    const last = history[history.length - 1];
    if (t >= last.t) {
        return clampPercent(last.l);
    }
    // History is expected to be sorted by time; binary search keeps sampling cheap
    // even for dense reconstructions.
    let low = 0;
    let high = history.length - 1;
    while (high - low > 1) {
        const mid = (low + high) >> 1;
        if (history[mid].t <= t) {
            low = mid;
        }
        else {
            high = mid;
        }
    }
    const a = history[low];
    const b = history[high];
    const span = b.t - a.t;
    const mix = span > 0.0001 ? (t - a.t) / span : 0;
    return clampPercent(a.l + (b.l - a.l) * mix);
}
/**
 * Replay length in seconds. Falls back to the last sample so a short timeline still
 * plays back at a readable pace.
 */
export function resolveHistoryDuration(history, requested) {
    const last = history && history.length > 0 ? history[history.length - 1].t : 0;
    const candidate = Number.isFinite(requested) && requested > 0 ? requested : last;
    return Math.max(candidate, 1);
}
export function clampPercent(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return 50;
    }
    return Math.max(0, Math.min(100, numeric));
}
