import assert from "node:assert/strict";
import test from "node:test";
import { WhaleOceanVisualEventQueue } from "../../dist/whale-ocean/whale-ocean-visual-queue.js";

const event = (id, kind = "shark", ratio = 4, at = "2026-01-01T00:00:00.000Z") => ({
    id, kind, symbol: "LIMAUSDT", side: "buy", notionalUsdt: ratio * 100, ratio, sequence: Number(id.replace(/\D/g, "")) || 1, eventTimeUtc: at
});

test("visual queue coalesces bursts without changing seen-event retention", () => {
    const queue = new WhaleOceanVisualEventQueue({ maxPendingEvents: 8, coalesceWindowMs: 1_000 });
    assert.equal(queue.markSeen("event-1", 1_000), true);
    assert.equal(queue.markSeen("event-1", 1_100), false);
    assert.equal(queue.enqueue(event("event-1"), 1_000), "queued");
    assert.equal(queue.enqueue(event("event-2", "shark", 5), 1_100), "coalesced");
    assert.equal(queue.size, 1);
    assert.equal(queue.seenSize, 1);
    assert.equal(queue.takeStats().coalesced, 1);
});

test("visual queue keeps high-priority highlights when full", () => {
    const queue = new WhaleOceanVisualEventQueue({ maxPendingEvents: 8 });
    for (let index = 0; index < 8; index++) queue.enqueue(event(`shark-${index}`, "shark", 4, `2026-01-01T00:00:${String(index).padStart(2, "0")}.000Z`), index * 1_000);
    assert.equal(queue.enqueue(event("whale-9", "whale", 8, "2026-01-01T00:01:00.000Z"), 9_000), "queued");
    const seen = [];
    queue.drain(10_000, () => true, item => seen.push(item));
    assert.equal(seen[0].kind, "whale");
    assert.ok(queue.takeStats().dropped >= 1);
});

test("drain is bounded by the per-frame item budget", () => {
    const queue = new WhaleOceanVisualEventQueue({ maxPendingEvents: 16, maxProcessPerFrame: 2, maxProcessMs: 4 });
    for (let index = 0; index < 6; index++) queue.enqueue(event(`whale-${index}`, "whale", 8 + index, `2026-01-01T00:00:0${index}.000Z`), index * 1_000);
    const seen = [];
    queue.drain(10_000, () => true, item => seen.push(item));
    assert.equal(seen.length, 2);
    assert.equal(queue.size, 4);
});

test("seen ids expire by retention window and capacity", () => {
    const queue = new WhaleOceanVisualEventQueue({ maxSeenEventIds: 128, seenRetentionMs: 30_000 });
    assert.equal(queue.markSeen("old", 1_000), true);
    assert.equal(queue.hasSeen("old", 32_000), false);
    for (let index = 0; index < 140; index++) queue.markSeen(`id-${index}`, 40_000 + index);
    assert.ok(queue.seenSize <= 128);
});
