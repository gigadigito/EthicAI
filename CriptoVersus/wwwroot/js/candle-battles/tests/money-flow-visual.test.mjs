import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  decideMoneyFlow, MoneyFlowEventCounter, MoneyFlowVisualState, MoneyFlowVolumeNormalizer, ReusablePool,
  moneyFlowBatchBelongsToRound, moneyFlowCounterPolarities, moneyFlowEventKey, moneyFlowSidesForBatch,
  moneyFlowTakerFieldState, formatMoneyFlowAmount, calculateFinancialLabelPosition, planBagSpawn,
} from '../../dist/candle-battles/money-flow-visual.js';
import {
  bagFrameForPhase, accentFrameFor,
  BAG_FALL_FRAMES, BAG_FLYING_FRAMES, BAG_SQUASH_FRAMES, BAG_BURN_FRAMES,
  BAG_INTO_PIT_FRAMES, POSITIVE_COINS_FRAMES, NEGATIVE_ARROWS_FRAMES,
  POSITIVE_BAG_WINGS_FRAMES, POSITIVE_BAG_WINGS_CYCLE_MS,
  POSITIVE_BAG_WINGS_OPEN_FRAME, POSITIVE_BAG_WINGS_CLOSED_FRAME, positiveBagWingsFrame,
} from '../../dist/candle-battles/money-flow-effects-renderer.js';
import { buildMoneyFlowAnchors } from '../../dist/candle-battles/money-flow-collectors.js';

const batch = (overrides = {}) => ({
  matchId: 12, symbol: 'BTCUSDT', sequence: 1, windowStartUtc: '2026-01-01T00:00:00Z', windowEndUtc: '2026-01-01T00:00:01Z',
  eventTimeUtc: '2026-01-01T00:00:01Z', receivedAtUtc: '2026-01-01T00:00:01Z', publishedAtUtc: '2026-01-01T00:00:01Z',
  tradeCount: 30, totalBaseQuantity: '3', takerBuyBaseQuantity: '2', takerSellBaseQuantity: '1', takerBuyQuote: '220',
  takerSellQuote: '100', netQuote: '120', firstPrice: '100', lastPrice: '100.2', highPrice: '100.3', lowPrice: '99.9', isPartial: false,
  ...overrides
});

test('taker quote flow decides visual direction independently of OHLC and net quote', () => {
  assert.equal(decideMoneyFlow(batch({ lastPrice: '100.4', takerBuyQuote: '220', takerSellQuote: '100', netQuote: '-500' })).direction, 'positive');
  assert.equal(decideMoneyFlow(batch({ lastPrice: '99.6', takerBuyQuote: '100', takerSellQuote: '220', netQuote: '500' })).direction, 'negative');
  assert.equal(decideMoneyFlow(batch({ firstPrice: '0', lastPrice: '0', takerBuyQuote: '0', takerSellQuote: '0' })).direction, 'neutral');
});

test('stable prices still produce visual flow when real taker volume exists', () => {
  const decision = decideMoneyFlow(batch({ firstPrice: '100', lastPrice: '100', takerBuyQuote: '220', takerSellQuote: '100' }));
  assert.equal(decision.direction, 'positive');
  assert.equal(decision.buyVolume, 220);
  assert.equal(decision.sellVolume, 100);
});

test('relative volume normalization gives larger parcels stronger visual intensity', () => {
  const normalizer = new MoneyFlowVolumeNormalizer();
  normalizer.observe('BTCUSDT', 'buy', '100');
  const small = normalizer.observe('BTCUSDT', 'buy', '60');
  const large = normalizer.observe('BTCUSDT', 'buy', '1000');
  assert.ok(small.intensity < large.intensity);
  assert.equal(large.sizeCategory, 'very-large');
});

test('zero volume never produces a financial bag', () => {
  const decision = decideMoneyFlow(batch({ takerBuyQuote: '0', takerSellQuote: '0', firstPrice: 'NaN', lastPrice: 'NaN' }));
  assert.equal(decision.direction, 'neutral');
  assert.equal(decision.intensity, 0);
  assert.equal(decision.buyVolume, 0);
  assert.equal(decision.sellVolume, 0);
});

test('partial batches are intentionally conservative', () => {
  const full = decideMoneyFlow(batch()).intensity;
  const partial = decideMoneyFlow(batch({ isPartial: true })).intensity;
  assert.ok(partial > 0);
  assert.ok(partial < full);
});

test('single-price batches use taker quote flow without inventing price movement', () => {
  const state = new MoneyFlowVisualState();
  assert.equal(state.ingest(batch({ firstPrice: '100', lastPrice: '100', takerBuyQuote: '0', takerSellQuote: '0' })).direction, 'neutral');
  assert.equal(state.ingest(batch({ sequence: 2, firstPrice: '100.3', lastPrice: '100.3', takerBuyQuote: '100', takerSellQuote: '0' })).direction, 'positive');
  assert.equal(state.ingest(batch({ sequence: 3, firstPrice: '99.8', lastPrice: '99.8', takerBuyQuote: '0', takerSellQuote: '120' })).direction, 'negative');
  assert.equal(state.ingest(batch({ sequence: 4, firstPrice: '99.8', lastPrice: '99.8', takerBuyQuote: '0', takerSellQuote: '0' })).direction, 'neutral');
});

test('freeze resume can discard accumulated visual parcels without losing financial energy', () => {
  const state = new MoneyFlowVisualState();
  state.ingest(batch());
  assert.ok(state.pendingPositiveVolume > 0);
  const before = state.snapshot();
  state.discardPendingVisualEffects();
  assert.equal(state.pendingPositiveVolume, 0);
  assert.equal(state.pendingNegativeVolume, 0);
  assert.deepEqual(state.snapshot(), before);
});

test('visual accumulator is bounded, smoothed, and responds in both directions', () => {
  const state = new MoneyFlowVisualState();
  for (let index = 0; index < 10; index++) state.ingest(batch({ sequence: index + 1 }));
  state.advance(160);
  const raised = state.snapshot();
  assert.ok(raised.accumulator <= 1 && raised.accumulator > 0);
  assert.ok(raised.displayedCandle > .5 && raised.displayedCandle <= .84);
  for (let index = 0; index < 12; index++) state.ingest(batch({ sequence: index + 20, lastPrice: '99.2', takerBuyQuote: '20', takerSellQuote: '200' }));
  state.advance(320);
  const lowered = state.snapshot();
  assert.ok(lowered.accumulator >= -1 && lowered.accumulator < 0);
  assert.ok(lowered.displayedCandle >= .16 && lowered.displayedCandle < raised.displayedCandle);
});

test('accepted batches remain bilateral and increment actual buy and sell counters per side', () => {
  const counters = new MoneyFlowEventCounter();
  const symbols = { left: 'BTCUSDT', right: 'ETHUSDT' };
  const positiveLeft = batch({ symbol: 'BTCUSDT', sequence: 11, lastPrice: '100.6' });
  const negativeRight = batch({ symbol: 'ETHUSDT', sequence: 11, lastPrice: '99.4' });
  assert.deepEqual(moneyFlowSidesForBatch(positiveLeft, symbols), ['left']);
  assert.deepEqual(moneyFlowSidesForBatch(negativeRight, symbols), ['right']);
  const round = '12:5m:1767225600000';
  assert.deepEqual(moneyFlowCounterPolarities(positiveLeft), ['buy', 'sell']);
  assert.equal(counters.accept(round, 'left', positiveLeft, 'buy', 220), true);
  assert.equal(counters.accept(round, 'left', positiveLeft, 'buy', 220), false, 'duplicate receipt is ignored');
  assert.equal(counters.accept(round, 'right', negativeRight, 'sell', 100), true);
  assert.deepEqual(counters.snapshot(), {
    left: { buy: 220, sell: 0, partial: false },
    right: { buy: 0, sell: 100, partial: false },
  });
  assert.equal(moneyFlowEventKey(round, 'left', 'buy', positiveLeft), '12:12:5m:1767225600000:left:buy:BTCUSDT:11');
});

test('same-symbol matches keep one deterministic visual event identity per candle', () => {
  const counters = new MoneyFlowEventCounter();
  const shared = batch({ symbol: 'BTCUSDT', sequence: 8, lastPrice: '100.6' });
  assert.deepEqual(moneyFlowSidesForBatch(shared, { left: 'BTCUSDT', right: 'BTCUSDT' }), ['left', 'right']);
  const round = '12:5m:1767225600000';
  assert.equal(counters.accept(round, 'left', shared, 'buy', 220), true);
  assert.equal(counters.accept(round, 'right', shared, 'buy', 220), true);
  assert.deepEqual(counters.snapshot(), {
    left: { buy: 220, sell: 0, partial: false },
    right: { buy: 220, sell: 0, partial: false },
  });
  counters.setRound('12:5m:1767225900000');
  assert.deepEqual(counters.snapshot(), {
    left: { buy: 0, sell: 0, partial: false },
    right: { buy: 0, sell: 0, partial: false },
  }, 'a new round starts with independent presentation counters');
  counters.setRound(round);
  assert.deepEqual(counters.snapshot(), {
    left: { buy: 220, sell: 0, partial: false },
    right: { buy: 220, sell: 0, partial: false },
  }, 'replay can restore the counters owned by its historical round');
});

test('buy and sell labels remain independent from net quote and price movement', () => {
  const risingWithSellerFlow = batch({ lastPrice: '100.5', takerBuyQuote: '0', takerSellQuote: '120' });
  assert.equal(decideMoneyFlow(risingWithSellerFlow).direction, 'negative');
  assert.deepEqual(moneyFlowCounterPolarities(risingWithSellerFlow), ['sell']);
});

test('financial labels use compact values and preserve the quote asset', () => {
  assert.equal(formatMoneyFlowAmount(850, 'BTCUSDT'), '850 USDT');
  assert.equal(formatMoneyFlowAmount(1250, 'ETHUSDC'), '1.3K USDC');
  assert.equal(formatMoneyFlowAmount(1_200_000, 'ETHBTC'), '1.2M BTC');
});

test('financial labels stay beside the bag and adapt to its visual size', () => {
  const region = buildMoneyFlowAnchors({ side: 'left', centreX: 330, groundY: 445, laneLeft: 80, laneRight: 560 }).region;
  const small = calculateFinancialLabelPosition({
    bagX: 330, bagY: 360, bagWidth: 18, bagHeight: 22, labelWidth: 78, labelHeight: 18,
    region, preferredSide: 'right',
  });
  const veryLarge = calculateFinancialLabelPosition({
    bagX: 330, bagY: 360, bagWidth: 72, bagHeight: 92, labelWidth: 78, labelHeight: 18,
    region, preferredSide: 'right',
  });
  assert.ok(Math.abs(small.x - 330) > 18, 'small bag label clears the bag body');
  assert.ok(Math.abs(veryLarge.x - 330) > 45, 'very-large bag label clears its scaled body');
  assert.ok(small.y >= region.top - 18 && small.y <= region.floorY + 18);
  assert.ok(veryLarge.y >= region.top - 18 && veryLarge.y <= region.floorY + 18);
});

test('financial labels use a compact side gap without entering the bag bounds', () => {
  const region = buildMoneyFlowAnchors({ side: 'left', centreX: 330, groundY: 445, laneLeft: 80, laneRight: 560 }).region;
  const position = calculateFinancialLabelPosition({
    bagX: 330, bagY: 360, bagWidth: 34, bagHeight: 40, labelWidth: 82, labelHeight: 18,
    region, preferredSide: 'right',
  });
  const labelLeft = position.x - 82 / 2;
  assert.ok(labelLeft - (330 + 34 / 2) >= 4, 'the label keeps a small clear gap from the bag');
  assert.ok(labelLeft - (330 + 34 / 2) <= 12, 'the label gap stays visually close');
});

test('financial labels keep a four-pixel edge gap across bag scales and sides', () => {
  const region = buildMoneyFlowAnchors({ side: 'left', centreX: 330, groundY: 445, laneLeft: 80, laneRight: 560 }).region;
  for (const [width, height] of [[18, 22], [34, 40], [58, 68], [88, 120]]) {
    const bounds = { left: 330 - width / 2, top: 360 - height / 2, right: 330 + width / 2, bottom: 360 + height / 2 };
    const right = calculateFinancialLabelPosition({ bagBounds: bounds, labelWidth: 82, labelHeight: 18, region, preferredSide: 'right' });
    const rightGap = right.x - 82 / 2 - bounds.right;
    assert.ok(Math.abs(rightGap - 4) < .001, `right-side gap stays at 4px for ${width}px bag`);
    const left = calculateFinancialLabelPosition({ bagBounds: bounds, labelWidth: 82, labelHeight: 18, region, preferredSide: 'left' });
    const leftGap = bounds.left - (left.x + 82 / 2);
    assert.ok(Math.abs(leftGap - 4) < .001, `left-side gap stays at 4px for ${width}px bag`);
  }
});

test('financial labels switch sides at an arena edge and can follow a carried collector', () => {
  const region = buildMoneyFlowAnchors({ side: 'left', centreX: 330, groundY: 445, laneLeft: 80, laneRight: 560 }).region;
  const atEdge = calculateFinancialLabelPosition({
    bagX: region.left + 4, bagY: 360, bagWidth: 34, bagHeight: 40, labelWidth: 82, labelHeight: 18,
    region, preferredSide: 'left',
  });
  assert.equal(atEdge.side, 'right', 'edge bags use the available side');
  assert.ok(atEdge.x >= region.left + 41 && atEdge.x <= region.right - 41);

  const carried = calculateFinancialLabelPosition({
    bagX: -35, bagY: 90, bagWidth: 34, bagHeight: 40, labelWidth: 82, labelHeight: 18,
    region, preferredSide: 'left', clampToRegion: false,
  });
  assert.ok(carried.x < region.left, 'carried labels are not frozen at the arena edge');
});

test('unavailable taker data is never classified as a measured zero flow', () => {
  const missingBuy = batch({ takerBuyQuote: undefined, takerSellQuote: '0' });
  assert.equal(moneyFlowTakerFieldState(missingBuy, 'buy'), 'unavailable');
  assert.equal(moneyFlowTakerFieldState(missingBuy, 'sell'), 'zero');
  assert.deepEqual(moneyFlowCounterPolarities(missingBuy), []);
  const unparseableSell = batch({ takerBuyQuote: '120', takerSellQuote: 'n/a' });
  assert.equal(moneyFlowTakerFieldState(unparseableSell, 'sell'), 'unavailable');
  assert.deepEqual(moneyFlowCounterPolarities(unparseableSell), ['buy']);
  const measuredNull = batch({ takerBuyQuote: '0', takerSellQuote: '0' });
  assert.equal(moneyFlowTakerFieldState(measuredNull, 'buy'), 'zero');
  assert.equal(moneyFlowTakerFieldState(measuredNull, 'sell'), 'zero');
  const counted = batch({ takerBuyQuote: '120', takerSellQuote: '20' });
  assert.equal(moneyFlowTakerFieldState(counted, 'buy'), 'flow');
  assert.equal(moneyFlowTakerFieldState(counted, 'sell'), 'flow');
});

test('a batch belongs only to the official round that contains its event time', () => {
  const first = { id: '12:5m:1767225600000', startMs: Date.parse('2026-01-01T00:00:00Z'), endMs: Date.parse('2026-01-01T00:05:00Z') };
  const second = { id: '12:5m:1767225900000', startMs: first.endMs, endMs: first.endMs + 300_000 };
  const delayedFirst = batch({ eventTimeUtc: '2026-01-01T00:04:59.999Z' });
  const currentSecond = batch({ sequence: 2, eventTimeUtc: '2026-01-01T00:05:00.000Z' });
  assert.equal(moneyFlowBatchBelongsToRound(delayedFirst, first), true);
  assert.equal(moneyFlowBatchBelongsToRound(delayedFirst, second), false, 'a delayed SignalR delivery cannot enter the next round');
  assert.equal(moneyFlowBatchBelongsToRound(currentSecond, second), true);
});

test('fixed pools reuse released particles and never exceed their capacity', () => {
  let creations = 0;
  const pool = new ReusablePool(2, () => ({ active: false, id: ++creations }));
  const first = pool.acquire();
  const second = pool.acquire();
  assert.equal(pool.acquire(), undefined);
  pool.release(first);
  const reused = pool.acquire();
  assert.equal(reused, first);
  assert.equal(creations, 2);
  assert.equal(pool.activeCount, 2);
  assert.equal(second.id, 2);
});

test('bag frames follow the real atlas order for every visual phase', () => {
  // Aerial phases never reach the landing plate: the fall is capped at the
  // flying prefix so a mid-air bag can never show a ground impact.
  assert.equal(bagFrameForPhase('flying', 0), 'bag-fall-1');
  assert.equal(bagFrameForPhase('flying', 1), `bag-fall-${BAG_FLYING_FRAMES}`);
  assert.equal(bagFrameForPhase('descending', .5), 'bag-fall-4');
  assert.equal(bagFrameForPhase('floating'), `bag-fall-${BAG_FLYING_FRAMES}`);
  // Ground impact belongs to a real landing only.
  assert.equal(bagFrameForPhase('landing', 0), 'bag-squash-1');
  assert.equal(bagFrameForPhase('landing', .6), 'bag-squash-3');
  assert.equal(bagFrameForPhase('landing', 1), `bag-squash-${BAG_SQUASH_FRAMES}`);
  // A resting or carried bag is a plain bag, never a burn frame.
  assert.equal(bagFrameForPhase('resting'), 'bag-fall-1');
  assert.equal(bagFrameForPhase('carried'), 'bag-fall-1');
  assert.equal(bagFrameForPhase('absorbed', 0), 'bag-into-pit-1');
  assert.equal(bagFrameForPhase('absorbed', 1), `bag-into-pit-${BAG_INTO_PIT_FRAMES}`);
  assert.equal(bagFrameForPhase('burning', 0), 'bag-burn-1');
  assert.equal(bagFrameForPhase('burning', 1), `bag-burn-${BAG_BURN_FRAMES}`);
});

test('no aerial bag frame carries the ground-impact plate', () => {
  const catalog = JSON.parse(readFileSync(fileURLToPath(
    new URL('../../../../tools/candle-battles/money-flow-catalog.json', import.meta.url)), 'utf-8'));
  const phases = catalog.sequences['bag-fall'].phases;
  // Every frame the aerial phase can reach is declared plate-free by the asset
  // audit, and the landing-only frames are exactly the complement.
  assert.equal(phases.flying.length, BAG_FLYING_FRAMES);
  assert.equal(phases.flying.length + phases.landing.length, BAG_FALL_FRAMES);
  for (const name of phases.landing) {
    assert.ok(!phases.flying.includes(name), `${name} must not be reachable mid-air`);
  }
});

test('runtime frame counts stay in sync with the generated atlas catalog', () => {
  const catalog = JSON.parse(readFileSync(fileURLToPath(
    new URL('../../../../tools/candle-battles/money-flow-catalog.json', import.meta.url)), 'utf-8'));
  const sequences = catalog.sequences;
  assert.equal(sequences['bag-fall'].count, BAG_FALL_FRAMES);
  assert.equal(sequences['bag-squash'].count, BAG_SQUASH_FRAMES);
  assert.equal(sequences['bag-burn'].count, BAG_BURN_FRAMES);
  assert.equal(sequences['bag-into-pit'].count, BAG_INTO_PIT_FRAMES);
  assert.equal(sequences['positive-coins'].count, POSITIVE_COINS_FRAMES);
  assert.equal(sequences['negative-arrows'].count, NEGATIVE_ARROWS_FRAMES);
  assert.equal(sequences['positive-bag-wings'].count, POSITIVE_BAG_WINGS_FRAMES);
  assert.deepEqual(sequences['positive-bag-wings'].canvas, { w: 112, h: 152 });
  assert.deepEqual(sequences['positive-bag-wings'].pivot, { x: .5, y: .55 });
});

test('negative arrow frames carry readable minus signs in varied positions', () => {
  // The sign must be visually separate from the arrows and must move between
  // frames: a static sign in one corner reads as part of the arrow glyph.
  const catalog = JSON.parse(readFileSync(fileURLToPath(
    new URL('../../../../tools/candle-battles/money-flow-catalog.json', import.meta.url)), 'utf-8'));
  const frames = catalog.sequences['negative-arrows'].frames;
  assert.equal(frames.length, 8);
  assert.equal(new Set(frames).size, 8, 'the eight negative frames must be distinct');
});

test('the aerial bag sequence is never built from identical frames', () => {
  const catalog = JSON.parse(readFileSync(fileURLToPath(
    new URL('../../../../tools/candle-battles/money-flow-catalog.json', import.meta.url)), 'utf-8'));
  const audit = JSON.parse(readFileSync(fileURLToPath(
    new URL('../../../../tools/candle-battles/frame-audit.json', import.meta.url)), 'utf-8'));
  const digests = audit['money-flow-effects'].frames;
  const seen = new Map();
  for (const name of catalog.sequences['bag-fall'].frames) {
    const digest = digests[name];
    assert.ok(digest, `${name} missing from the frame audit`);
    assert.ok(!seen.has(digest), `${name} duplicates ${seen.get(digest)}`);
    seen.set(digest, name);
  }
});

test('accent frames expose the coin and arrow sequences from the atlas', () => {
  assert.equal(accentFrameFor(true, 0), 'positive-coins-1');
  assert.equal(accentFrameFor(true, 1), 'positive-coins-8');
  assert.equal(accentFrameFor(false, 0), 'negative-arrows-1');
  assert.equal(accentFrameFor(false, 1), 'negative-arrows-8');
});

test('positive-bag wings alternate on the bag clock and freeze for reduced motion', () => {
  assert.equal(positiveBagWingsFrame(0), POSITIVE_BAG_WINGS_OPEN_FRAME);
  assert.equal(positiveBagWingsFrame(POSITIVE_BAG_WINGS_CYCLE_MS / 2), POSITIVE_BAG_WINGS_CLOSED_FRAME);
  assert.equal(positiveBagWingsFrame(POSITIVE_BAG_WINGS_CYCLE_MS), POSITIVE_BAG_WINGS_OPEN_FRAME);
  assert.equal(positiveBagWingsFrame(0, true), POSITIVE_BAG_WINGS_CLOSED_FRAME);
  assert.equal(positiveBagWingsFrame(POSITIVE_BAG_WINGS_CYCLE_MS / 2, true), POSITIVE_BAG_WINGS_CLOSED_FRAME);
});

const anchors = () => buildMoneyFlowAnchors({ side: 'left', centreX: 330, groundY: 445, laneLeft: 80, laneRight: 560 });

test('positive spawn plans fall from the upper region onto varied hand targets', () => {
  const base = anchors();
  const plan = planBagSpawn(true, base, [.5, .5, 0, .5, .5]);
  assert.ok(plan.y >= base.region.top, 'spawn clears the fixed HUD panel');
  assert.ok(plan.y < base.body.y, 'spawn stays in the upper region of the fighter');
  assert.equal(plan.targetY, base.hands.y + 34);
  assert.ok(Math.abs(plan.targetX - base.hands.x) <= base.region.fighterWidth * .63);
  assert.ok(plan.x >= base.region.left && plan.x <= base.region.right);
  assert.ok(plan.fallDuration >= 850 && plan.fallDuration <= 1450);
  const lateral = planBagSpawn(true, base, [.02, .02, .5, .5, .5]);
  const lateralRight = planBagSpawn(true, base, [.98, .98, .5, .5, .5]);
  assert.ok(lateral.x < plan.x && lateralRight.x > plan.x, 'triangular sampling spreads across the region');
  assert.ok(lateralRight.x - lateral.x > 150, 'horizontal spread far exceeds the old 72px column');
});

test('negative spawn plans leave the body and land on varied floor points', () => {
  const base = anchors();
  const plan = planBagSpawn(false, base, [.5, .5, .5, .5, .5]);
  assert.ok(plan.y > base.head.y && plan.y < base.body.y + 30, 'negative bags start close to the body');
  assert.equal(plan.targetY, base.region.floorY);
  assert.ok(plan.targetX >= base.region.left && plan.targetX <= base.region.right);
  const left = planBagSpawn(false, base, [0, 0, .5, 0, .5]);
  const right = planBagSpawn(false, base, [1, 1, .5, 1, .5]);
  assert.ok(left.x < plan.x && right.x > plan.x);
  assert.ok(right.targetX - left.targetX > 100, 'landing points vary across the floor');
});

test('spawn plans stay inside the safe region for both sides, scales and polarities', () => {
  for (const [side, centreX, laneLeft, laneRight] of [['left', 330, 80, 560], ['right', 950, 720, 1200]]) {
    for (const scale of [.8, 1.55]) {
      const built = buildMoneyFlowAnchors({
        side, centreX, groundY: scale > 1 ? 370 : 445, fighterScale: scale, laneLeft, laneRight,
      });
      for (const positive of [true, false]) {
        for (let run = 0; run < 40; run++) {
          const plan = planBagSpawn(positive, built, [run / 40, (run * 7 % 40) / 40, (run * 13 % 40) / 40, (run * 3 % 40) / 40, .5]);
          assert.ok(plan.x >= built.region.left - 1e-9 && plan.x <= built.region.right + 1e-9, `${side}/${scale} spawn x in region`);
          assert.ok(plan.targetX >= built.region.left - 1e-9 && plan.targetX <= built.region.right + 1e-9, `${side}/${scale} target x in region`);
          assert.ok(plan.y >= built.region.top - 1e-9, `${side}/${scale} spawn clears the HUD`);
          assert.ok(plan.targetY <= built.region.floorY + 1e-9, `${side}/${scale} lands on the floor line`);
        }
      }
    }
  }
});
