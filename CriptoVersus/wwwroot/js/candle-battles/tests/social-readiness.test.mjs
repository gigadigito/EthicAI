import test from 'node:test';
import assert from 'node:assert/strict';
import { watchReadiness, watchCaptureReadiness, disposeReadiness, reportFailure } from '../../candleBattleSocial.mjs';

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

function capturePage() {
  const canvas = new EventTarget();
  canvas.dataset = {};
  const pause = { clicked: 0, click() { this.clicked++; } };
  const root = {
    dataset: {},
    querySelector: selector => selector === '.candle-battles__canvas' ? canvas
      : selector === '[data-cb-action="pause"]' ? pause : null,
    querySelectorAll: () => []
  };
  globalThis.document = { getElementById: () => root, fonts: { ready: Promise.resolve() } };
  return { canvas, root, pause };
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

test('compact capture becomes ready only after the frozen poster frame', async () => {
  const { canvas, root, pause } = capturePage();
  await watchCaptureReadiness('capture-test', true, false);
  await new Promise(setImmediate);
  assert.equal(root.dataset.socialReady, undefined);

  canvas.dataset.captureFrame = 'frozen';
  canvas.dataset.paused = 'true';
  canvas.dispatchEvent(new Event('candle-battles-capture-frozen'));
  await new Promise(setImmediate);
  assert.equal(pause.clicked, 0);
  assert.equal(root.dataset.captureFrame, 'frozen');
  assert.equal(root.dataset.replayReady, 'true');
  assert.equal(root.dataset.socialReady, 'true');
  disposeReadiness('capture-test');
});

test('compact capture of a finished match reports a degraded frame without the victory state', async () => {
  const { canvas, root } = capturePage();
  await watchCaptureReadiness('capture-test', true, true);
  canvas.dataset.captureFrame = 'frozen';
  canvas.dispatchEvent(new Event('candle-battles-capture-frozen'));
  await new Promise(setImmediate);
  assert.equal(root.dataset.socialReady, 'true');
  assert.equal(root.dataset.replayReady, 'false');
  disposeReadiness('capture-test');

  const second = capturePage();
  await watchCaptureReadiness('capture-test-2', true, true);
  second.canvas.dataset.captureFrame = 'frozen';
  second.canvas.dataset.finished = 'true';
  second.canvas.dispatchEvent(new Event('candle-battles-capture-frozen'));
  await new Promise(setImmediate);
  assert.equal(second.root.dataset.replayReady, 'true');
  assert.equal(second.root.dataset.socialReady, 'true');
  disposeReadiness('capture-test-2');
});

test('compact capture force-freezes the scene when the arena never settles', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { canvas, root, pause } = capturePage();
  await watchCaptureReadiness('capture-test-3', true, false);
  t.mock.timers.tick(40000);
  await new Promise(setImmediate);
  assert.equal(pause.clicked, 1);
  assert.equal(canvas.dataset.captureFrame, 'frozen');
  assert.equal(root.dataset.captureFrame, 'frozen');
  assert.equal(root.dataset.replayReady, 'false');
  assert.equal(root.dataset.socialReady, 'true');
  disposeReadiness('capture-test-3');
});

test('compact capture without replay stays capturable with the summary flag', async () => {
  const { root } = capturePage();
  await watchCaptureReadiness('capture-test-4', false, true);
  await new Promise(setImmediate);
  assert.equal(root.dataset.socialReady, 'true');
  assert.equal(root.dataset.replayReady, 'false');
  disposeReadiness('capture-test-4');
});
