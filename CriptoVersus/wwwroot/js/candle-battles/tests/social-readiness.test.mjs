import test from 'node:test';
import assert from 'node:assert/strict';
import { watchReadiness, disposeReadiness, reportFailure } from '../../candleBattleSocial.mjs';

function page() {
  const canvas = new EventTarget();
  canvas.dataset = {};
  const root = {
    dataset: {},
    querySelector: selector => selector === '.candle-battles__canvas' ? canvas : null,
    querySelectorAll: () => []
  };
  globalThis.document = { getElementById: () => root, fonts: { ready: Promise.resolve() } };
  return { canvas, root };
}

test('completed battle waits for the final replay frame before capture', async () => {
  const { canvas, root } = page();
  await watchReadiness('social-test', true, true);
  canvas.dataset.ready = 'true';
  canvas.dispatchEvent(new Event('candle-battles-ready'));
  await new Promise(setImmediate);
  assert.equal(root.dataset.socialReady, undefined);

  canvas.dataset.finished = 'true';
  canvas.dispatchEvent(new Event('candle-battles-finished'));
  await new Promise(setImmediate);
  assert.equal(root.dataset.socialReady, 'true');
  assert.equal(root.dataset.replayReady, 'true');
  disposeReadiness('social-test');
});

test('historical summary becomes capturable without replay', async () => {
  const { root } = page();
  await watchReadiness('social-test', false, true);
  await new Promise(setImmediate);
  assert.equal(root.dataset.socialReady, 'true');
  assert.equal(root.dataset.replayReady, 'false');
  disposeReadiness('social-test');
});

test('renderer failure makes the persisted fallback capturable with an observable reason', async () => {
  const { root } = page();
  await watchReadiness('social-test', true, true);
  reportFailure('social-test', 'renderer_initialization');
  await new Promise(setImmediate);
  assert.equal(root.dataset.socialReady, 'true');
  assert.equal(root.dataset.replayReady, 'false');
  assert.equal(root.dataset.replayFailure, 'renderer_initialization');
  disposeReadiness('social-test');
});
