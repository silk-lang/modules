import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BROWSER_COMMIT_VERSION,
  PREVENT_KEYS_BIT,
  PREVENT_WHEEL_BIT,
  CommitTracker,
  EpochRetirementQueue,
  WebCompositor,
  decodeBrowserCommit,
  evalEasing,
  findSnapTarget,
  rubberBand,
  stepSpring,
} from './web-compositor.mjs';

function makeBinaryCommit({
  version = BROWSER_COMMIT_VERSION,
  windowId = 1,
  commitEpoch = 1n,
  consumedInputSeq = 0n,
  viewportWidth = 800,
  viewportHeight = 600,
  deviceScale = 2.0,
  preventFlags = 0,
  scrolls = [],
  blockedRegions = [],
  layers = [],
}) {
  const totalBytes = 40 + 4 + scrolls.length * 28 + 4 + blockedRegions.length * 16 + 4 + layers.length * 28;
  const buf = new ArrayBuffer(totalBytes);
  const view = new DataView(buf);
  let at = 0;
  const u32 = v => { view.setUint32(at, v >>> 0, true); at += 4; };
  const u64 = v => {
    const big = BigInt(v);
    u32(Number(big & 0xffffffffn));
    u32(Number((big >> 32n) & 0xffffffffn));
  };
  const f32 = v => { view.setFloat32(at, v, true); at += 4; };

  u32(version);
  u32(windowId);
  u64(commitEpoch);
  u64(consumedInputSeq);
  u32(viewportWidth);
  u32(viewportHeight);
  f32(deviceScale);
  u32(preventFlags);

  u32(scrolls.length);
  for (const s of scrolls) {
    u32(s.node); f32(s.x); f32(s.y); f32(s.minX); f32(s.maxX); f32(s.minY); f32(s.maxY);
  }
  u32(blockedRegions.length);
  for (const b of blockedRegions) {
    f32(b.xMin); f32(b.yMin); f32(b.xMax); f32(b.yMax);
  }
  u32(layers.length);
  for (const l of layers) {
    u32(l.layerId); f32(l.xMin); f32(l.yMin); f32(l.xMax); f32(l.yMax); u32(l.scrollNode); f32(l.opacity);
  }
  return buf;
}

function makeFakeBitmap(id, w = 800, h = 600) {
  return { id, width: w, height: h, closed: false, close() { this.closed = true; } };
}

function makeFakeCanvas() {
  const draws = [];
  const ctx = {
    globalAlpha: 1,
    transforms: [],
    save() {},
    restore() {},
    clearRect() {},
    translate(x, y) { this.transforms.push([x, y]); },
    drawImage(bmp, x, y, w, h) { draws.push({ id: bmp.id, x, y, w, h, tx: this.transforms.at(-1) ?? [0, 0], alpha: this.globalAlpha }); },
  };
  return { width: 800, height: 600, draws, getContext: () => ctx };
}

test('decodeBrowserCommit parses exact browser_commit.silk binary wire format', () => {
  const buf = makeBinaryCommit({
    windowId: 2,
    commitEpoch: 9n,
    consumedInputSeq: 42n,
    viewportWidth: 1280,
    viewportHeight: 720,
    deviceScale: 2.0,
    preventFlags: PREVENT_WHEEL_BIT | PREVENT_KEYS_BIT,
    scrolls: [{ node: 10, x: 0, y: 120, minX: 0, maxX: 0, minY: 0, maxY: 1000 }],
    blockedRegions: [{ xMin: 10, yMin: 20, xMax: 210, yMax: 120 }],
    layers: [{ layerId: 5, xMin: 0, yMin: 0, xMax: 400, yMax: 300, scrollNode: 10, opacity: 0.5 }],
  });

  const decoded = decodeBrowserCommit(buf);
  assert.equal(decoded.windowId, 2);
  assert.equal(decoded.commitEpoch, 9);
  assert.equal(decoded.consumedInputSeq, 42);
  assert.equal(decoded.viewportWidth, 1280);
  assert.equal(decoded.viewportHeight, 720);
  assert.equal(decoded.deviceScale, 2);
  assert.equal(decoded.preventFlags, PREVENT_WHEEL_BIT | PREVENT_KEYS_BIT);
  assert.equal(decoded.scrolls.length, 1);
  assert.equal(decoded.scrolls[0].y, 120);
  assert.equal(decoded.blockedRegions.length, 1);
  assert.equal(decoded.layers[0].layerId, 5);
  assert.equal(decoded.layers[0].opacity, 0.5);
});

test('CommitTracker 1-in-flight backpressure, Delta resync, and EpochRetirementQueue work cleanly', () => {
  const tracker = new CommitTracker();
  const t1 = tracker.beginCommit('delta');
  assert.equal(t1.kind, 'keyframe');
  assert.equal(t1.commitEpoch, 1);
  assert.equal(tracker.beginCommit('delta'), null, 'second commit blocked while in flight');
  assert.equal(tracker.hasPendingDirty(), true);

  const compositor = new WebCompositor();
  const bmp1 = makeFakeBitmap(1);
  const bmp2 = makeFakeBitmap(2);
  const ack1 = compositor.applyCommit({ windowId: 1, commitEpoch: 1, baseEpoch: 0, kind: 'keyframe', layers: [{ layerId: 1 }] }, bmp1);
  assert.equal(ack1.applied, true);
  assert.equal(tracker.onAck(ack1), true, 'coalesced dirty triggers next commit');

  // Out-of-order Delta referencing wrong baseEpoch must NOT corrupt state and must ask for Keyframe.
  const badDelta = compositor.applyCommit({ windowId: 1, commitEpoch: 3, baseEpoch: 99, kind: 'delta', layers: [] }, bmp2);
  assert.equal(badDelta.applied, false);
  assert.equal(badDelta.needsKeyframe, true);
  assert.equal(bmp2.closed, true, 'rejected commit closes unused bitmap');
  assert.equal(bmp1.closed, false, 'retained active bitmap stays open until retired & GPU finished');

  // Newer keyframe epoch 4 replaces bmp1 -> bmp1 deferred into retirement until present().
  const bmp4 = makeFakeBitmap(4);
  const recovery = compositor.applyCommit({ windowId: 1, commitEpoch: 4, baseEpoch: 0, kind: 'keyframe', layers: [{ layerId: 1 }] }, bmp4);
  assert.equal(recovery.applied, true);
  assert.equal(bmp1.closed, false, 'bmp1 retained until presentedEpoch/gpuFinishedEpoch advances past epoch 1');
  compositor.present(16);
  assert.equal(bmp1.closed, true, 'bmp1 closed once GPU epoch finishes');

  const q = new EpochRetirementQueue();
  const r = makeFakeBitmap(99);
  q.defer(5, r);
  assert.equal(q.drainRetired(4).length, 0);
  assert.equal(r.closed, false);
  assert.equal(q.drainRetired(5).length, 1);
  assert.equal(r.closed, true);
});

test('2-second Worker JS stall: main-thread compositor keeps 60Hz scroll/animations/present alive and reconciles consumedInputSeq', () => {
  const compositor = new WebCompositor();
  const canvas = makeFakeCanvas();
  compositor.attachWindow(1, canvas, { width: 800, height: 600, deviceScale: 1 });

  const bmp1 = makeFakeBitmap(1);
  compositor.applyCommit({
    windowId: 1,
    commitEpoch: 1,
    baseEpoch: 0,
    kind: 'keyframe',
    consumedInputSeq: 0,
    viewportWidth: 800,
    viewportHeight: 600,
    deviceScale: 1,
    preventFlags: 0,
    scrolls: [{ node: 10, x: 0, y: 0, minX: 0, maxX: 0, minY: 0, maxY: 2000 }],
    blockedRegions: [{ xMin: 500, yMin: 0, xMax: 800, yMax: 200 }],
    layers: [{ layerId: 10, bounds: { xMin: 0, yMin: 0, xMax: 800, yMax: 600 }, scrollNode: 10, opacity: 1 }],
  }, bmp1);
  compositor.setAnimations(1, [{
    id: 1, layerId: 0, property: 'opacity', timeline: 'monotonic',
    easing: evalEasing({ kind: 'linear' }, 0) === 0 ? 'linear' : 'linear',
    startMs: 0, durationMs: 2000, fromValue: 0.2, toValue: 1.0,
  }], 0);
  compositor.present(0);

  // Simulate Worker blocked for 2,000ms (120 frames at 16.6ms) — no Worker commits arrive!
  const wheel1 = compositor.routeWheel(1, 100, 100, 0, 150, 100);
  assert.equal(wheel1.scrolledOnCompositor, true);
  assert.equal(wheel1.gestureId, 0);
  const wheel2 = compositor.routeWheel(1, 100, 100, 0, 150, 200);
  assert.equal(wheel2.scrollOffsets[0].y, 300);

  // Blocked (non-passive) wheel region must park a gesture instead of scrolling immediately.
  const blockedWheel = compositor.routeWheel(1, 600, 50, 0, 80, 250);
  assert.equal(blockedWheel.scrolledOnCompositor, false);
  assert.ok(blockedWheel.gestureId > 0);
  assert.equal(compositor.snapshotScrolls(1)[0].y, 300);

  // Pump 120 rAF frames during Worker stall -> animation + presentation continue uninterrupted!
  for (let frame = 1; frame <= 120; frame++) {
    const t = frame * 16.666;
    compositor.tick(t);
    compositor.present(t);
  }
  const win = compositor.windows.get(1);
  assert.ok(win.presentedCount >= 120, 'main-thread compositor presented at 60Hz throughout 2s Worker stall');
  assert.ok(Math.abs(win.overrides.get(0).opacity - 1.0) < 0.02, 'monotonic animation completed on main thread');

  // Stamped pointer click sees live presentedEpoch=1 and scrolled offset y=300.
  const click = compositor.routePointer(1, 'down', 120, 140, 2010);
  assert.equal(click.presentedEpoch, 1);
  assert.equal(click.scrollOffsets[0].y, 300);

  // Worker wakes and commits epoch 2 consuming ONLY wheel1 (consumedInputSeq = wheel1.inputSeq):
  // wheel2 (150px) must stay layered on top -> y remains 300 without jumping back to 150!
  const bmp2 = makeFakeBitmap(2);
  compositor.applyCommit({
    windowId: 1,
    commitEpoch: 2,
    baseEpoch: 1,
    kind: 'delta',
    consumedInputSeq: wheel1.inputSeq,
    scrolls: [{ node: 10, x: 0, y: 150, minX: 0, maxX: 0, minY: 0, maxY: 2000 }],
  }, bmp2);
  assert.equal(compositor.snapshotScrolls(1)[0].y, 300, 'unconsumed scroll delta preserved after Worker commit');

  // If the Worker eventually decides the blocked wheel wasn't consumed, compositor replays it cleanly.
  assert.equal(compositor.ackGesture(1, { gestureId: blockedWheel.gestureId, consumed: false }), true);
  assert.equal(compositor.snapshotScrolls(1)[0].y, 380);

  // When idle (no motion left), zero polling needed.
  compositor.tick(3000);
  assert.equal(compositor.hasActiveMotion(), false);
});

test('scroll physics: overscroll chaining/contain/none, fling decay, smooth cancel, snap points, spring solver', () => {
  const compositor = new WebCompositor();
  compositor.attachWindow(1);
  compositor.setScrollerConfigs(1, [
    { node: 1, parentNode: 0, minX: 0, maxX: 0, minY: 0, maxY: 500, overscrollY: 'contain' },
    { node: 2, parentNode: 1, minX: 0, maxX: 0, minY: 0, maxY: 100, overscrollY: 'auto' },
    { node: 3, parentNode: 0, minX: 0, maxX: 0, minY: 0, maxY: 100, overscrollY: 'none' },
  ]);

  // Chaining: child (2) at max chains excess 50px to parent (1); 'none' (3) clamps hard.
  compositor.routeWheel(1, 0, 0, 0, 150, 0, 2);
  const s = new Map(compositor.snapshotScrolls(1).map(x => [x.node, x]));
  assert.equal(s.get(2).y, 100);
  assert.equal(s.get(1).y, 50, 'overscroll-behavior: auto chains unused delta to parent');

  compositor.routeWheel(1, 0, 0, 0, 150, 10, 3);
  const sAfter = new Map(compositor.snapshotScrolls(1).map(x => [x.node, x]));
  assert.equal(sAfter.get(3).y, 100);
  assert.equal(sAfter.get(3).overscrollY, 0, 'overscroll-behavior: none produces zero overscroll');

  // Smooth scroll canceled immediately by user input.
  compositor.startSmoothScroll(1, 1, 0, 400, 20, 500);
  assert.equal(compositor.hasActiveMotion(), true);
  compositor.routeWheel(1, 0, 0, 0, 10, 30, 1);
  assert.equal(compositor.windows.get(1).scrolls.get(1).smoothActive, false);

  // Touch fling + decay + stop.
  compositor.onTouchBegin(1, 1, 10, 200, 100);
  compositor.onTouchMove(1, 1, 10, 140, 116);
  compositor.onTouchEnd(1, 1, 120);
  assert.equal(compositor.hasActiveMotion(), true);
  for (let t = 136; t < 2000; t += 16) compositor.tick(t, 16);
  assert.equal(compositor.hasActiveMotion(), false);

  // Snap target + stopAlways + spring settle + rubberBand sanity.
  assert.equal(
    findSnapTarget(0, 350, 0, 500, 'mandatory', 40, [
      { offset: 100, stopAlways: false },
      { offset: 200, stopAlways: true },
      { offset: 400, stopAlways: false },
    ]),
    200,
  );
  let sp = { value: 0, target: 100, velocity: 0, active: true };
  for (let i = 0; i < 300 && sp.active; i++) sp = stepSpring({ stiffness: 220, damping: 24, mass: 1 }, sp, 0.016);
  assert.equal(sp.active, false);
  assert.equal(sp.value, 100);
  assert.ok(rubberBand(200) < 200 && rubberBand(-200) < 0);
});
