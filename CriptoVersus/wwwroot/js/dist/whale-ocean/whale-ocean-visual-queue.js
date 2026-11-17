const DEFAULT_OPTIONS = {
    maxPendingEvents: 48,
    maxProcessPerFrame: 3,
    maxProcessMs: 1.5,
    coalesceWindowMs: 900,
    maxSeenEventIds: 2048,
    seenRetentionMs: 120000
};
/**
 * Presentation-only event queue. It is deliberately independent of the
 * official scoreboard: dropping an entry here can only drop an animation.
 */
export class WhaleOceanVisualEventQueue {
    constructor(options = {}) {
        this.pending = [];
        this.seen = new Map();
        this.stats = { dropped: 0, coalesced: 0, expired: 0, processed: 0 };
        this.options = this.normalizeOptions({ ...DEFAULT_OPTIONS, ...options });
    }
    configure(options) {
        this.options = this.normalizeOptions({ ...this.options, ...options });
        this.maintain(Date.now());
        while (this.pending.length > this.options.maxPendingEvents) {
            this.pending.pop();
            this.stats.dropped++;
        }
    }
    get size() {
        return this.pending.length;
    }
    get seenSize() {
        return this.seen.size;
    }
    get capacity() {
        return this.options.maxPendingEvents;
    }
    hasPending(kind) {
        return this.pending.some(item => item.event.kind === kind);
    }
    hasSeen(id, now = Date.now()) {
        this.maintainSeen(now);
        return this.seen.has(id);
    }
    markSeen(id, now = Date.now()) {
        this.maintainSeen(now);
        if (this.seen.has(id))
            return false;
        this.seen.set(id, now);
        this.maintainSeen(now);
        return true;
    }
    enqueue(event, now = Date.now()) {
        this.maintain(now);
        const priority = this.priority(event);
        const eventTime = Date.parse(event.eventTimeUtc);
        const coalescible = this.pending.findIndex(item => {
            if (item.event.symbol !== event.symbol || item.event.side !== event.side || item.event.kind !== event.kind)
                return false;
            const itemTime = Date.parse(item.event.eventTimeUtc);
            return Math.abs(item.enqueuedAt - now) <= this.options.coalesceWindowMs
                || (Number.isFinite(itemTime) && Number.isFinite(eventTime) && Math.abs(itemTime - eventTime) <= this.options.coalesceWindowMs);
        });
        if (coalescible >= 0) {
            if (priority > this.pending[coalescible].priority)
                this.pending[coalescible] = { event, enqueuedAt: now, priority };
            this.stats.coalesced++;
            this.sortPending();
            return "coalesced";
        }
        if (this.pending.length >= this.options.maxPendingEvents) {
            const lowest = this.pending.length - 1;
            if (priority <= this.pending[lowest].priority) {
                this.stats.dropped++;
                return "dropped";
            }
            this.pending.pop();
            this.stats.dropped++;
        }
        this.pending.push({ event, enqueuedAt: now, priority });
        this.sortPending();
        return "queued";
    }
    drain(now, canSpawn, spawn, onExpire) {
        this.maintain(now);
        const startedAt = performance.now();
        let scanned = 0;
        let processed = 0;
        const scanLimit = Math.min(this.pending.length, Math.max(4, this.options.maxProcessPerFrame * 4));
        while (scanned < scanLimit && processed < this.options.maxProcessPerFrame && this.pending.length > 0) {
            if (performance.now() - startedAt >= this.options.maxProcessMs)
                break;
            const item = this.pending[scanned];
            if (!item)
                break;
            const eventAt = Date.parse(item.event.eventTimeUtc);
            if (Number.isFinite(eventAt) && eventAt < now - this.options.seenRetentionMs) {
                this.pending.splice(scanned, 1);
                this.stats.expired++;
                onExpire?.(item.event);
                continue;
            }
            if (!canSpawn(item.event)) {
                scanned++;
                continue;
            }
            this.pending.splice(scanned, 1);
            spawn(item.event);
            processed++;
            this.stats.processed++;
        }
    }
    maintain(now = Date.now()) {
        this.maintainSeen(now);
        for (let index = this.pending.length - 1; index >= 0; index--) {
            const eventAt = Date.parse(this.pending[index].event.eventTimeUtc);
            if (Number.isFinite(eventAt) && eventAt < now - this.options.seenRetentionMs) {
                this.pending.splice(index, 1);
                this.stats.expired++;
            }
        }
    }
    takeStats() {
        const result = { ...this.stats };
        this.stats = { dropped: 0, coalesced: 0, expired: 0, processed: 0 };
        return result;
    }
    clear() {
        this.pending.length = 0;
    }
    maintainSeen(now) {
        const cutoff = now - this.options.seenRetentionMs;
        let removed = 0;
        for (const [id, seenAt] of this.seen) {
            if (seenAt >= cutoff && this.seen.size <= this.options.maxSeenEventIds)
                break;
            this.seen.delete(id);
            removed++;
            if (removed >= 128 && this.seen.size <= this.options.maxSeenEventIds)
                break;
        }
        while (this.seen.size > this.options.maxSeenEventIds) {
            const oldest = this.seen.keys().next().value;
            if (oldest === undefined)
                break;
            this.seen.delete(oldest);
        }
    }
    priority(event) {
        const kindWeight = event.kind === "whale" ? 2 : 1;
        const ratio = Number.isFinite(event.ratio) && event.ratio > 0 ? event.ratio : 0;
        const notional = Number.isFinite(event.notionalUsdt) && event.notionalUsdt > 0 ? Math.log1p(event.notionalUsdt) : 0;
        return kindWeight * 1000000 + ratio * 1000 + notional;
    }
    sortPending() {
        this.pending.sort((a, b) => b.priority - a.priority || a.enqueuedAt - b.enqueuedAt);
    }
    normalizeOptions(options) {
        return {
            maxPendingEvents: Math.max(8, Math.min(256, Math.round(options.maxPendingEvents))),
            maxProcessPerFrame: Math.max(1, Math.min(8, Math.round(options.maxProcessPerFrame))),
            maxProcessMs: Math.max(0.25, Math.min(4, options.maxProcessMs)),
            coalesceWindowMs: Math.max(100, Math.min(5000, Math.round(options.coalesceWindowMs))),
            maxSeenEventIds: Math.max(128, Math.min(8192, Math.round(options.maxSeenEventIds))),
            seenRetentionMs: Math.max(30000, Math.min(600000, Math.round(options.seenRetentionMs)))
        };
    }
}
