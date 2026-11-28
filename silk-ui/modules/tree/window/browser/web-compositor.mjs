// Main-thread browser compositor for Silk UI (`web-canvas`).
//
// Runs on the browser main thread alongside the platform DOM/IME shim. Owns the visible
// <canvas> per window, retained layer bitmaps/metadata, property trees, passive scroll/fling/snap
// physics, monotonic/scroll/pointer/spring animations, declarative browser-level default-action
// rules, 1-in-flight commit tracking, epoch-fenced resource retirement, and stamped input routing.
//
// Communicates with the Worker-hosted Document Group purely via structured messages and
// Transferables (`ArrayBuffer`, `ImageBitmap`) — no SharedArrayBuffer / COOP-COEP required.

export const BROWSER_COMMIT_VERSION = 1;
export const PREVENT_WHEEL_BIT = 1;
export const PREVENT_TOUCH_BIT = 2;
export const PREVENT_KEYS_BIT = 4;

const FLING_DECAY = 3.25;
const MIN_FLING_VELOCITY = 25.0;
const STOP_FLING_VELOCITY = 12.0;
const RUBBER_BAND_LIMIT = 140.0;

/**
 * Decodes the compact binary `LayerCommit` header + tables written by `browser_commit.silk`.
 */
export function decodeBrowserCommit(buffer, offset = 0, length = buffer.byteLength) {
  if (!buffer || length < 40) return null;
  const view = new DataView(buffer, offset, length);
  let at = 0;
  const u32 = () => {
    if (at + 4 > length) throw new RangeError('Truncated browser commit u32');
    const v = view.getUint32(at, true);
    at += 4;
    return v;
  };
  const u64 = () => {
    const lo = u32();
    const hi = u32();
    return lo + hi * 0x100000000;
  };
  const f32 = () => {
    if (at + 4 > length) throw new RangeError('Truncated browser commit f32');
    const v = view.getFloat32(at, true);
    at += 4;
    return v;
  };

  const version = u32();
  if (version !== BROWSER_COMMIT_VERSION) return null;
  const windowId = u32();
  const commitEpoch = u64();
  const consumedInputSeq = u64();
  const viewportWidth = u32();
  const viewportHeight = u32();
  const deviceScale = f32() || 1;
  const preventFlags = u32();

  const scrolls = [];
  if (at + 4 <= length) {
    const scrollCount = u32();
    for (let i = 0; i < scrollCount && at + 28 <= length; i++) {
      scrolls.push({
        node: u32(),
        x: f32(),
        y: f32(),
        minX: f32(),
        maxX: f32(),
        minY: f32(),
        maxY: f32(),
      });
    }
  }

  const blockedRegions = [];
  if (at + 4 <= length) {
    const blockedCount = u32();
    for (let i = 0; i < blockedCount && at + 16 <= length; i++) {
      blockedRegions.push({
        xMin: f32(),
        yMin: f32(),
        xMax: f32(),
        yMax: f32(),
      });
    }
  }

  const layers = [];
  if (at + 4 <= length) {
    const layerCount = u32();
    for (let i = 0; i < layerCount && at + 28 <= length; i++) {
      layers.push({
        layerId: u32(),
        bounds: { xMin: f32(), yMin: f32(), xMax: f32(), yMax: f32() },
        scrollNode: u32(),
        opacity: f32(),
      });
    }
  }

  return {
    version,
    windowId,
    commitEpoch,
    consumedInputSeq,
    viewportWidth,
    viewportHeight,
    deviceScale,
    preventFlags,
    scrolls,
    blockedRegions,
    layers,
  };
}

function clampAxis(value, minVal, maxVal) {
  const hi = Math.max(minVal, maxVal);
  return Math.max(minVal, Math.min(hi, value));
}

function bezierSample(p1, p2, u) {
  const a = 1 - 3 * p2 + 3 * p1;
  const b = 3 * p2 - 6 * p1;
  const c = 3 * p1;
  return ((a * u + b) * u + c) * u;
}

function bezierSlope(p1, p2, u) {
  const a = 1 - 3 * p2 + 3 * p1;
  const b = 3 * p2 - 6 * p1;
  const c = 3 * p1;
  return (3 * a * u + 2 * b) * u + c;
}

function evalBezier(x1, y1, x2, y2, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let u = x;
  for (let i = 0; i < 8; i++) {
    const err = bezierSample(x1, x2, u) - x;
    if (Math.abs(err) < 0.0001) return bezierSample(y1, y2, u);
    const d = bezierSlope(x1, x2, u);
    if (Math.abs(d) < 0.00001) break;
    u = Math.max(0, Math.min(1, u - err / d));
  }
  let lo = 0;
  let hi = 1;
  u = x;
  for (let b = 0; b < 12; b++) {
    const val = bezierSample(x1, x2, u);
    if (Math.abs(val - x) < 0.0001) return bezierSample(y1, y2, u);
    if (val < x) lo = u;
    else hi = u;
    u = (lo + hi) * 0.5;
  }
  return bezierSample(y1, y2, u);
}

/** Evaluates an easing curve (`linear`, `cubic-bezier`, `steps`) at progress `t`. */
export function evalEasing(easing, rawT) {
  const t = Math.max(0, Math.min(1, rawT));
  if (!easing || easing.kind === 'linear' || easing === 'linear') return t;
  if (easing.kind === 'cubic-bezier') {
    return evalBezier(easing.x1, easing.y1, easing.x2, easing.y2, t);
  }
  if (easing.kind === 'steps') {
    const n = easing.count | 0;
    if (n <= 0) return t;
    if (easing.jumpStart) return Math.min(1, (Math.min(n, Math.floor(t * n) + 1)) / n);
    if (t >= 1) return 1;
    return Math.min(1, Math.floor(t * n) / n);
  }
  return t;
}

/** Sub-stepped semi-implicit Euler spring solver matching `compositor_state.silk:stepSpring`. */
export function stepSpring(spec, state, dtSec) {
  if (!state?.active || dtSec <= 0) return state;
  const clampedDt = Math.min(dtSec, 0.1);
  const mass = Math.max(spec.mass ?? 1, 0.001);
  const stiffness = spec.stiffness ?? 180;
  const damping = spec.damping ?? 22;
  const restDelta = spec.restDelta ?? 0.001;
  const restVelocity = spec.restVelocity ?? 0.01;
  const steps = Math.max(1, Math.ceil(clampedDt * 240));
  const subDt = clampedDt / steps;

  let x = state.value;
  let v = state.velocity;
  for (let s = 0; s < steps; s++) {
    const accel = (-stiffness * (x - state.target) - damping * v) / mass;
    v += accel * subDt;
    x += v * subDt;
  }
  if (Math.abs(x - state.target) <= restDelta && Math.abs(v) <= restVelocity) {
    return { value: state.target, target: state.target, velocity: 0, active: false };
  }
  return { value: x, target: state.target, velocity: v, active: true };
}

/** Logarithmic overscroll rubber-band damping curve matching `compositor_state.silk:rubberBand`. */
export function rubberBand(excess, limit = RUBBER_BAND_LIMIT) {
  if (excess === 0) return 0;
  const c = Math.max(limit, 1);
  const mag = Math.abs(excess);
  const damped = (1 - 1 / ((mag * 0.55) / c + 1)) * c;
  return excess < 0 ? -damped : damped;
}

/** Resolves CSS scroll-snap alignment (`none`, `proximity`, `mandatory`, `stopAlways`). */
export function findSnapTarget(
  startOffset,
  currentOffset,
  minOffset,
  maxOffset,
  strictness = 'none',
  proximityThreshold = 40,
  points = [],
) {
  const clamped = clampAxis(currentOffset, minOffset, maxOffset);
  if (!strictness || strictness === 'none' || !points.length) return clamped;

  if (Math.abs(clamped - startOffset) > 0.5) {
    const forward = clamped > startOffset;
    let stopTarget = null;
    let bestStopDist = Infinity;
    for (const pt of points) {
      if (!pt.stopAlways) continue;
      const p = clampAxis(pt.offset, minOffset, maxOffset);
      const crossed = forward
        ? p > startOffset + 0.5 && p < clamped - 0.5
        : p < startOffset - 0.5 && p > clamped + 0.5;
      if (crossed) {
        const dist = Math.abs(p - startOffset);
        if (stopTarget === null || dist < bestStopDist) {
          bestStopDist = dist;
          stopTarget = p;
        }
      }
    }
    if (stopTarget !== null) return stopTarget;
  }

  let nearest = clampAxis(points[0].offset, minOffset, maxOffset);
  let bestDist = Math.abs(nearest - clamped);
  for (let i = 1; i < points.length; i++) {
    const p = clampAxis(points[i].offset, minOffset, maxOffset);
    const d = Math.abs(p - clamped);
    if (d < bestDist) {
      bestDist = d;
      nearest = p;
    }
  }
  if (strictness === 'mandatory') return nearest;
  if (strictness === 'proximity') return bestDist <= proximityThreshold ? nearest : clamped;
  return clamped;
}

/** Enforces strict 1-in-flight commit per window, coalescing dirty frames while waiting for ack. */
export class CommitTracker {
  constructor() {
    this.inFlight = false;
    this.activeInFlightEpoch = 0;
    this.ackedEpoch = 0;
    this.nextEpoch = 0;
    this.pendingDirty = false;
    this.mustSendKeyframe = true;
  }

  canSend() { return !this.inFlight; }
  isInFlight() { return this.inFlight; }
  inFlightEpoch() { return this.activeInFlightEpoch; }
  lastAckedEpoch() { return this.ackedEpoch; }
  needsKeyframe() { return this.mustSendKeyframe; }
  hasPendingDirty() { return this.pendingDirty; }

  markDirty() { this.pendingDirty = true; }
  forceKeyframe() {
    this.mustSendKeyframe = true;
    this.pendingDirty = true;
  }

  beginCommit(requested = 'delta') {
    if (this.inFlight) {
      this.pendingDirty = true;
      return null;
    }
    const kind = this.mustSendKeyframe || this.ackedEpoch === 0 ? 'keyframe' : requested;
    this.nextEpoch += 1;
    const commitEpoch = this.nextEpoch;
    const baseEpoch = kind === 'keyframe' ? 0 : this.ackedEpoch;
    this.inFlight = true;
    this.activeInFlightEpoch = commitEpoch;
    this.pendingDirty = false;
    this.mustSendKeyframe = false;
    return { commitEpoch, baseEpoch, kind };
  }

  onAck(ack) {
    if (!ack) return false;
    if (ack.commitEpoch >= this.activeInFlightEpoch) this.inFlight = false;
    if (ack.applied && ack.activeEpoch > this.ackedEpoch) this.ackedEpoch = ack.activeEpoch;
    if (ack.needsKeyframe) {
      this.mustSendKeyframe = true;
      this.pendingDirty = true;
    }
    return !this.inFlight && (this.pendingDirty || this.mustSendKeyframe);
  }
}

/** Defers releasing `ImageBitmap`s / GPU textures until `gpuFinishedEpoch >= retireAfterEpoch`. */
export class EpochRetirementQueue {
  constructor() {
    this.entries = [];
  }

  pendingCount() { return this.entries.length; }

  defer(retireAfterEpoch, item) {
    if (item == null) return;
    this.entries.push({ retireAfterEpoch, item });
  }

  drainRetired(gpuFinishedEpoch) {
    const retired = [];
    const remaining = [];
    for (const entry of this.entries) {
      if (entry.retireAfterEpoch <= gpuFinishedEpoch) {
        retired.push(entry.item);
        if (typeof entry.item === 'function') entry.item();
        else {
          try { entry.item.close?.(); } catch {}
          try { entry.item.destroy?.(); } catch {}
        }
      } else {
        remaining.push(entry);
      }
    }
    this.entries = remaining;
    return retired;
  }

  clear() {
    while (this.entries.length) {
      const { item } = this.entries.shift();
      if (typeof item === 'function') item();
      else {
        try { item.close?.(); } catch {}
        try { item.destroy?.(); } catch {}
      }
    }
  }
}

function defaultScroller(node, minX = 0, maxX = 0, minY = 0, maxY = 0) {
  return {
    node,
    parentNode: 0,
    x: clampAxis(0, minX, maxX),
    y: clampAxis(0, minY, maxY),
    minX,
    maxX,
    minY,
    maxY,
    overscrollX: 0,
    overscrollY: 0,
    overscrollBehaviorX: 'auto',
    overscrollBehaviorY: 'auto',
    snapStrictnessX: 'none',
    snapStrictnessY: 'none',
    proximityThreshold: 40,
    snapPointsX: [],
    snapPointsY: [],
    trackBounds: { xMin: 0, yMin: 0, xMax: 0, yMax: 0 },
    thumbSize: 20,
    verticalScrollbar: true,
    velX: 0,
    velY: 0,
    dragging: false,
    lastTouchX: 0,
    lastTouchY: 0,
    lastTouchMs: 0,
    gestureStartX: 0,
    gestureStartY: 0,
    thumbDragging: false,
    lastThumbPointer: 0,
    smoothActive: false,
    smoothStartX: 0,
    smoothStartY: 0,
    smoothTargetX: 0,
    smoothTargetY: 0,
    smoothStartMs: 0,
    smoothDurationMs: 0,
    bounceSpringX: { value: 0, target: 0, velocity: 0, active: false },
    bounceSpringY: { value: 0, target: 0, velocity: 0, active: false },
  };
}

function matchesKeyRule(rule, event) {
  if (rule.requireNotComposing && event.isComposing) return false;
  const held =
    (event.shiftKey ? 1 : 0) |
    (event.ctrlKey ? 2 : 0) |
    (event.altKey ? 4 : 0) |
    (event.metaKey ? 8 : 0);
  if (rule.modifiersMask && (held & rule.modifiersMask) !== rule.modifiersValue) return false;
  if (rule.anyModifierMask && (held & rule.anyModifierMask) === 0) return false;
  const key = event.key ?? '';
  const code = event.code ?? '';
  switch (rule.matchKind) {
    case 0:
      return rule.caseInsensitive ? key.toLowerCase() === rule.value.toLowerCase() : key === rule.value;
    case 1:
      return code === rule.value;
    case 2:
      return /^(Enter|Tab|Backspace|Escape|Delete|Insert|Home|End|PageUp|PageDown|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|F(?:[1-9]|1[0-9]|2[0-4]))$/.test(key);
    case 3:
      return true;
    default:
      return false;
  }
}

/**
 * Main-thread Compositor holding per-window retained layers, property trees, animations,
 * scroll physics, passive/non-passive routing, and EpochRetirementQueue.
 */
export class WebCompositor {
  constructor() {
    this.windows = new Map();
    this.inputSeq = 0;
    this.gestureId = 0;
    this.pointerX = 0;
    this.pointerY = 0;
    this.presentedIntervals = [];
    this.lastTickMs = null;
  }

  nextInputSeq() {
    this.inputSeq += 1;
    return this.inputSeq;
  }

  nextGestureId() {
    this.gestureId += 1;
    return this.gestureId;
  }

  attachWindow(windowId, canvas = null, options = {}) {
    let win = this.windows.get(windowId);
    if (!win) {
      win = {
        windowId,
        canvas,
        ctx2d: null,
        epochs: { commitEpoch: 0, activeEpoch: 0, presentedEpoch: 0, gpuFinishedEpoch: 0 },
        lastConsumedInputSeq: 0,
        viewportWidth: options.width ?? canvas?.width ?? 0,
        viewportHeight: options.height ?? canvas?.height ?? 0,
        deviceScale: options.deviceScale ?? 1,
        preventFlags: 0,
        preventRules: null,
        blockedRegions: [],
        scrolls: new Map(),
        pendingScrollDeltas: [],
        pendingGestures: new Map(),
        layers: [],
        layerMap: new Map(),
        overrides: new Map(),
        animations: [],
        surfaceBitmap: null,
        retirement: new EpochRetirementQueue(),
        needsPresent: false,
        presentedCount: 0,
        lastPresentMs: 0,
      };
      this.windows.set(windowId, win);
    } else if (canvas) {
      win.canvas = canvas;
    }
    return win;
  }

  removeWindow(windowId) {
    const win = this.windows.get(windowId);
    if (!win) return;
    if (win.surfaceBitmap) {
      win.retirement.defer(win.epochs.presentedEpoch, win.surfaceBitmap);
      win.surfaceBitmap = null;
    }
    win.retirement.clear();
    this.windows.delete(windowId);
  }

  ensureScroller(win, node, minX = 0, maxX = 0, minY = 0, maxY = 0) {
    let sc = win.scrolls.get(node);
    if (!sc) {
      sc = defaultScroller(node, minX, maxX, minY, maxY);
      win.scrolls.set(node, sc);
    } else {
      sc.minX = minX;
      sc.maxX = maxX;
      sc.minY = minY;
      sc.maxY = maxY;
      sc.x = clampAxis(sc.x, minX, maxX);
      sc.y = clampAxis(sc.y, minY, maxY);
    }
    return sc;
  }

  setScrollerConfigs(windowId, configs) {
    const win = this.attachWindow(windowId);
    for (const c of configs) {
      const sc = this.ensureScroller(win, c.node, c.minX ?? 0, c.maxX ?? 0, c.minY ?? 0, c.maxY ?? 0);
      if (c.parentNode !== undefined) sc.parentNode = c.parentNode;
      if (c.overscrollX !== undefined) sc.overscrollBehaviorX = c.overscrollX;
      if (c.overscrollY !== undefined) sc.overscrollBehaviorY = c.overscrollY;
      if (c.snapStrictnessX !== undefined) sc.snapStrictnessX = c.snapStrictnessX;
      if (c.snapStrictnessY !== undefined) sc.snapStrictnessY = c.snapStrictnessY;
      if (c.proximityThreshold !== undefined) sc.proximityThreshold = c.proximityThreshold;
      if (c.snapPointsX !== undefined) sc.snapPointsX = [...c.snapPointsX];
      if (c.snapPointsY !== undefined) sc.snapPointsY = [...c.snapPointsY];
      if (c.trackBounds !== undefined) sc.trackBounds = { ...c.trackBounds };
      if (c.thumbSize !== undefined) sc.thumbSize = c.thumbSize;
      if (c.verticalScrollbar !== undefined) sc.verticalScrollbar = c.verticalScrollbar;
    }
  }

  setAnimations(windowId, animations, nowMs = performance.now()) {
    const win = this.attachWindow(windowId);
    win.animations = animations.map(a => ({ ...a, active: a.active ?? (a.timeline === 'monotonic' || !a.timeline || a.useSpring) }));
    this.rebuildOverrides(win, nowMs);
  }

  setPreventRules(windowId, rules) {
    const win = this.attachWindow(windowId);
    win.preventRules = rules;
  }

  applyCommit(commit, surfaceBitmap = null) {
    const win = this.attachWindow(commit.windowId);
    const kind = commit.kind ?? 'keyframe';
    const commitEpoch = commit.commitEpoch ?? 0;
    const baseEpoch = commit.baseEpoch ?? 0;

    if (commitEpoch === 0 || commitEpoch <= win.epochs.activeEpoch) {
      try { surfaceBitmap?.close?.(); } catch {}
      return {
        windowId: win.windowId,
        commitEpoch,
        activeEpoch: win.epochs.activeEpoch,
        applied: false,
        needsKeyframe: false,
      };
    }

    if (kind === 'delta' && (win.epochs.activeEpoch === 0 || baseEpoch !== win.epochs.activeEpoch || commit.needsKeyframe)) {
      try { surfaceBitmap?.close?.(); } catch {}
      return {
        windowId: win.windowId,
        commitEpoch,
        activeEpoch: win.epochs.activeEpoch,
        applied: false,
        needsKeyframe: true,
      };
    }

    const prevEpoch = win.epochs.activeEpoch;
    if (surfaceBitmap && surfaceBitmap !== win.surfaceBitmap) {
      if (win.surfaceBitmap) win.retirement.defer(prevEpoch, win.surfaceBitmap);
      win.surfaceBitmap = surfaceBitmap;
    }

    if (kind === 'keyframe') {
      if (commit.layers) {
        win.layers = commit.layers.map(l => ({ ...l }));
        win.layerMap = new Map(win.layers.map(l => [l.layerId, l]));
      }
    } else if (commit.layers) {
      if (commit.removedLayerIds) {
        for (const id of commit.removedLayerIds) win.layerMap.delete(id);
      }
      for (const layer of commit.layers) win.layerMap.set(layer.layerId, { ...layer });
      win.layers = [...win.layerMap.values()];
    }

    if (commit.viewportWidth) win.viewportWidth = commit.viewportWidth;
    if (commit.viewportHeight) win.viewportHeight = commit.viewportHeight;
    if (commit.deviceScale) win.deviceScale = commit.deviceScale;
    if (commit.preventFlags !== undefined) win.preventFlags = commit.preventFlags;
    if (commit.blockedRegions) win.blockedRegions = commit.blockedRegions.map(r => ({ ...r }));
    if (commit.preventRules !== undefined) win.preventRules = commit.preventRules;

    const consumed = commit.consumedInputSeq ?? 0;
    if (consumed > win.lastConsumedInputSeq) win.lastConsumedInputSeq = consumed;
    win.pendingScrollDeltas = win.pendingScrollDeltas.filter(d => d.inputSeq > win.lastConsumedInputSeq);

    if (commit.scrolls) {
      for (const sp of commit.scrolls) {
        const sc = this.ensureScroller(win, sp.node, sp.minX, sp.maxX, sp.minY, sp.maxY);
        sc.x = clampAxis(sp.x, sc.minX, sc.maxX);
        sc.y = clampAxis(sp.y, sc.minY, sc.maxY);
      }
      for (const d of win.pendingScrollDeltas) {
        this.applyScrollDeltaInternal(win, d.node, d.dx, d.dy, false);
      }
    }

    win.epochs.commitEpoch = commitEpoch;
    win.epochs.activeEpoch = commitEpoch;
    win.needsPresent = true;
    this.rebuildOverrides(win, performance.now());

    return {
      windowId: win.windowId,
      commitEpoch,
      activeEpoch: win.epochs.activeEpoch,
      applied: true,
      needsKeyframe: false,
    };
  }

  isBlocked(win, x, y) {
    if (!win?.blockedRegions?.length) return false;
    const scale = win.deviceScale || 1;
    const dx = x * scale;
    const dy = y * scale;
    for (const r of win.blockedRegions) {
      if (dx >= r.xMin && dx <= r.xMax && dy >= r.yMin && dy <= r.yMax) return true;
    }
    return false;
  }

  shouldPreventWheel(windowId, x, y) {
    const win = this.windows.get(windowId);
    if (!win) return false;
    if ((win.preventFlags & PREVENT_WHEEL_BIT) !== 0) return true;
    if (win.preventRules && ((win.preventRules.actions ?? 0) & PREVENT_WHEEL_BIT) !== 0) return true;
    return this.isBlocked(win, x, y);
  }

  shouldPreventKey(windowId, event) {
    const win = this.windows.get(windowId);
    if (!win) return false;
    const rules = win.preventRules;
    if (rules?.keyRules?.length) {
      for (const rule of rules.keyRules) {
        if (matchesKeyRule(rule, event)) return rule.action === 0;
      }
    }
    if (!event?.isComposing) {
      if ((win.preventFlags & PREVENT_KEYS_BIT) !== 0) return true;
      if (rules && ((rules.actions ?? 0) & PREVENT_KEYS_BIT) !== 0) return true;
    }
    return false;
  }

  snapshotScrolls(windowId) {
    const win = this.windows.get(windowId);
    if (!win) return [];
    const out = [];
    for (const sc of win.scrolls.values()) {
      out.push({ node: sc.node, x: sc.x, y: sc.y, overscrollX: sc.overscrollX, overscrollY: sc.overscrollY });
    }
    return out;
  }

  defaultScrollNode(win) {
    for (const sc of win.scrolls.values()) {
      if (sc.maxY > sc.minY || sc.maxX > sc.minX) return sc.node;
    }
    return win.scrolls.keys().next().value ?? 0;
  }

  applyScrollDeltaInternal(win, node, dx, dy, cancelSmooth = true) {
    let sc = win.scrolls.get(node);
    if (!sc) return false;
    if (cancelSmooth) {
      sc.smoothActive = false;
      sc.bounceSpringX.active = false;
      sc.bounceSpringY.active = false;
    }

    let changed = false;
    let remX = dx;
    let remY = dy;
    let cur = sc;
    const visited = new Set();

    while (cur && !visited.has(cur.node)) {
      visited.add(cur.node);
      if (remX !== 0) {
        const nextX = cur.x + remX;
        const clampedX = clampAxis(nextX, cur.minX, cur.maxX);
        const consumedX = clampedX - cur.x;
        const unusedX = remX - consumedX;
        if (consumedX !== 0) {
          cur.x = clampedX;
          cur.overscrollX = 0;
          changed = true;
        }
        if (Math.abs(unusedX) > 0.001) {
          if (cur.overscrollBehaviorX === 'none') {
            cur.overscrollX = 0;
            remX = 0;
          } else if (cur.overscrollBehaviorX === 'contain' || !cur.parentNode) {
            cur.overscrollX = rubberBand(cur.overscrollX + unusedX);
            changed = true;
            remX = 0;
          } else {
            remX = unusedX;
          }
        } else {
          remX = 0;
        }
      }
      if (remY !== 0) {
        const nextY = cur.y + remY;
        const clampedY = clampAxis(nextY, cur.minY, cur.maxY);
        const consumedY = clampedY - cur.y;
        const unusedY = remY - consumedY;
        if (consumedY !== 0) {
          cur.y = clampedY;
          cur.overscrollY = 0;
          changed = true;
        }
        if (Math.abs(unusedY) > 0.001) {
          if (cur.overscrollBehaviorY === 'none') {
            cur.overscrollY = 0;
            remY = 0;
          } else if (cur.overscrollBehaviorY === 'contain' || !cur.parentNode) {
            cur.overscrollY = rubberBand(cur.overscrollY + unusedY);
            changed = true;
            remY = 0;
          } else {
            remY = unusedY;
          }
        } else {
          remY = 0;
        }
      }
      if (remX === 0 && remY === 0) break;
      cur = cur.parentNode ? win.scrolls.get(cur.parentNode) : null;
    }
    return changed;
  }

  routeWheel(windowId, x, y, dx, dy, nowMs = performance.now(), targetNode = null) {
    const win = this.attachWindow(windowId);
    const inputSeq = this.nextInputSeq();
    const node = targetNode ?? this.defaultScrollNode(win);
    if (this.isBlocked(win, x, y)) {
      const gestureId = this.nextGestureId();
      win.pendingGestures.set(gestureId, { gestureId, windowId, node, x, y, dx, dy, inputSeq });
      return {
        windowId,
        inputSeq,
        presentedEpoch: win.epochs.presentedEpoch,
        scrolledOnCompositor: false,
        gestureId,
        scrollOffsets: this.snapshotScrolls(windowId),
      };
    }

    // Notice Worker receives negative dx/dy semantics or exact scroll delta; here dx/dy represent scroll offset change.
    const changed = node ? this.applyScrollDeltaInternal(win, node, dx, dy, true) : false;
    if (changed) {
      win.pendingScrollDeltas.push({ inputSeq, node, dx, dy });
      win.needsPresent = true;
      this.rebuildOverrides(win, nowMs);
    }
    return {
      windowId,
      inputSeq,
      presentedEpoch: win.epochs.presentedEpoch,
      scrolledOnCompositor: changed,
      gestureId: 0,
      scrollOffsets: this.snapshotScrolls(windowId),
    };
  }

  ackGesture(windowId, { gestureId, consumed, nowMs = performance.now() }) {
    const win = this.windows.get(windowId);
    if (!win) return false;
    const pending = win.pendingGestures.get(gestureId);
    if (!pending) return false;
    win.pendingGestures.delete(gestureId);
    if (consumed) return false;
    const changed = pending.node
      ? this.applyScrollDeltaInternal(win, pending.node, pending.dx, pending.dy, true)
      : false;
    if (changed) {
      win.pendingScrollDeltas.push({
        inputSeq: pending.inputSeq,
        node: pending.node,
        dx: pending.dx,
        dy: pending.dy,
      });
      win.needsPresent = true;
      this.rebuildOverrides(win, nowMs);
    }
    return changed;
  }

  routePointer(windowId, kind, x, y, nowMs = performance.now()) {
    const win = this.attachWindow(windowId);
    const inputSeq = this.nextInputSeq();
    this.pointerX = x;
    this.pointerY = y;
    for (const sc of win.scrolls.values()) {
      if (sc.thumbDragging && kind === 'move') {
        const coord = sc.verticalScrollbar ? y : x;
        this.moveThumbDrag(windowId, sc.node, coord, nowMs);
      }
    }
    this.rebuildOverrides(win, nowMs);
    return {
      windowId,
      kind,
      x,
      y,
      inputSeq,
      presentedEpoch: win.epochs.presentedEpoch,
      scrollOffsets: this.snapshotScrolls(windowId),
    };
  }

  onTouchBegin(windowId, node, x, y, nowMs = performance.now()) {
    const win = this.attachWindow(windowId);
    const sc = this.ensureScroller(win, node);
    sc.smoothActive = false;
    sc.velX = 0;
    sc.velY = 0;
    sc.bounceSpringX.active = false;
    sc.bounceSpringY.active = false;
    sc.dragging = true;
    sc.lastTouchX = x;
    sc.lastTouchY = y;
    sc.lastTouchMs = nowMs;
    sc.gestureStartX = sc.x;
    sc.gestureStartY = sc.y;
  }

  onTouchMove(windowId, node, x, y, nowMs = performance.now()) {
    const win = this.windows.get(windowId);
    const sc = win?.scrolls.get(node);
    if (!sc?.dragging) return false;
    const dx = sc.lastTouchX - x;
    const dy = sc.lastTouchY - y;
    const dtSec = Math.max((nowMs - sc.lastTouchMs) / 1000, 0.001);
    sc.velX = sc.velX * 0.4 + (dx / dtSec) * 0.6;
    sc.velY = sc.velY * 0.4 + (dy / dtSec) * 0.6;
    sc.lastTouchX = x;
    sc.lastTouchY = y;
    sc.lastTouchMs = nowMs;
    const changed = this.applyScrollDeltaInternal(win, node, dx, dy, true);
    if (changed) {
      const seq = this.nextInputSeq();
      win.pendingScrollDeltas.push({ inputSeq: seq, node, dx, dy });
      win.needsPresent = true;
    }
    this.rebuildOverrides(win, nowMs);
    return changed;
  }

  onTouchEnd(windowId, node, nowMs = performance.now()) {
    const win = this.windows.get(windowId);
    const sc = win?.scrolls.get(node);
    if (!sc) return false;
    sc.dragging = false;
    let launchedBounce = false;
    if (Math.abs(sc.overscrollX) > 0.01) {
      sc.bounceSpringX = { value: sc.overscrollX, target: 0, velocity: 0, active: true };
      sc.velX = 0;
      launchedBounce = true;
    } else if (Math.abs(sc.velX) < MIN_FLING_VELOCITY) {
      sc.velX = 0;
    }
    if (Math.abs(sc.overscrollY) > 0.01) {
      sc.bounceSpringY = { value: sc.overscrollY, target: 0, velocity: 0, active: true };
      sc.velY = 0;
      launchedBounce = true;
    } else if (Math.abs(sc.velY) < MIN_FLING_VELOCITY) {
      sc.velY = 0;
    }
    if (!launchedBounce && sc.velX === 0 && sc.velY === 0) {
      return this.snapScroller(win, sc, nowMs, false);
    }
    if (launchedBounce) win.needsPresent = true;
    return launchedBounce;
  }

  beginThumbDrag(windowId, node, pointerCoord) {
    const win = this.attachWindow(windowId);
    const sc = this.ensureScroller(win, node);
    sc.smoothActive = false;
    sc.velX = 0;
    sc.velY = 0;
    sc.thumbDragging = true;
    sc.lastThumbPointer = pointerCoord;
  }

  moveThumbDrag(windowId, node, pointerCoord, nowMs = performance.now()) {
    const win = this.windows.get(windowId);
    const sc = win?.scrolls.get(node);
    if (!sc?.thumbDragging) return false;
    const deltaPtr = pointerCoord - sc.lastThumbPointer;
    sc.lastThumbPointer = pointerCoord;
    const trackLen = sc.verticalScrollbar
      ? sc.trackBounds.yMax - sc.trackBounds.yMin || 100
      : sc.trackBounds.xMax - sc.trackBounds.xMin || 100;
    const travel = Math.max(trackLen - sc.thumbSize, 1);
    const range = sc.verticalScrollbar ? Math.max(0, sc.maxY - sc.minY) : Math.max(0, sc.maxX - sc.minX);
    const deltaContent = (deltaPtr * range) / travel;
    if (sc.verticalScrollbar) sc.y = clampAxis(sc.y + deltaContent, sc.minY, sc.maxY);
    else sc.x = clampAxis(sc.x + deltaContent, sc.minX, sc.maxX);
    const seq = this.nextInputSeq();
    win.pendingScrollDeltas.push({
      inputSeq: seq,
      node,
      dx: sc.verticalScrollbar ? 0 : deltaContent,
      dy: sc.verticalScrollbar ? deltaContent : 0,
    });
    win.needsPresent = true;
    this.rebuildOverrides(win, nowMs);
    return true;
  }

  endThumbDrag(windowId, node) {
    const sc = this.windows.get(windowId)?.scrolls.get(node);
    if (sc) sc.thumbDragging = false;
  }

  startSmoothScroll(windowId, node, targetX, targetY, nowMs = performance.now(), durationMs = 250) {
    const win = this.attachWindow(windowId);
    const sc = this.ensureScroller(win, node);
    sc.velX = 0;
    sc.velY = 0;
    sc.overscrollX = 0;
    sc.overscrollY = 0;
    sc.bounceSpringX.active = false;
    sc.bounceSpringY.active = false;
    sc.smoothStartX = sc.x;
    sc.smoothStartY = sc.y;
    sc.smoothTargetX = clampAxis(targetX, sc.minX, sc.maxX);
    sc.smoothTargetY = clampAxis(targetY, sc.minY, sc.maxY);
    sc.smoothStartMs = nowMs;
    sc.smoothDurationMs = Math.max(durationMs, 1);
    sc.smoothActive = true;
    win.needsPresent = true;
  }

  snapScroller(win, sc, nowMs, smooth = true) {
    const tx = findSnapTarget(
      sc.gestureStartX,
      sc.x,
      sc.minX,
      sc.maxX,
      sc.snapStrictnessX,
      sc.proximityThreshold,
      sc.snapPointsX,
    );
    const ty = findSnapTarget(
      sc.gestureStartY,
      sc.y,
      sc.minY,
      sc.maxY,
      sc.snapStrictnessY,
      sc.proximityThreshold,
      sc.snapPointsY,
    );
    if (Math.abs(tx - sc.x) < 0.1 && Math.abs(ty - sc.y) < 0.1) return false;
    if (smooth) {
      this.startSmoothScroll(win.windowId, sc.node, tx, ty, nowMs, 180);
    } else {
      sc.x = tx;
      sc.y = ty;
      win.needsPresent = true;
    }
    return true;
  }

  evalTimelineProgress(win, anim, nowMs) {
    const tl = anim.timeline;
    if (!tl || tl === 'monotonic' || tl.kind === 'monotonic') {
      const elapsed = nowMs - (anim.startMs ?? 0) - (anim.delayMs ?? 0);
      if (elapsed < 0) return 0;
      const dur = Math.max(anim.durationMs ?? 1, 1);
      if ((anim.iterations ?? 1) > 0) {
        const total = dur * anim.iterations;
        if (elapsed >= total) return anim.fillForwards === false ? 0 : (anim.alternate && Math.floor(anim.iterations) % 2 === 0 ? 0 : 1);
      }
      const cycle = Math.floor(elapsed / dur);
      let raw = (elapsed % dur) / dur;
      if (elapsed > 0 && raw === 0 && (anim.iterations ?? 1) > 0 && elapsed >= dur * anim.iterations) raw = 1;
      if (anim.alternate && cycle % 2 === 1) raw = 1 - raw;
      return evalEasing(anim.easing, raw);
    }
    if (tl.kind === 'scroll') {
      const sc = win.scrolls.get(tl.scrollerNode);
      if (!sc) return 0;
      const cur = tl.horizontal ? sc.x : sc.y;
      const span = tl.endOffset - tl.startOffset;
      if (Math.abs(span) < 0.0001) return 0;
      return evalEasing(anim.easing, Math.max(0, Math.min(1, (cur - tl.startOffset) / span)));
    }
    if (tl.kind === 'pointer') {
      const coord = tl.axisX ? this.pointerX : this.pointerY;
      const span = tl.maxPos - tl.minPos;
      if (Math.abs(span) < 0.0001) return 0;
      return evalEasing(anim.easing, Math.max(0, Math.min(1, (coord - tl.minPos) / span)));
    }
    return 0;
  }

  rebuildOverrides(win, nowMs) {
    const next = new Map();
    for (const anim of win.animations) {
      const value = anim.useSpring
        ? anim.springState.value
        : anim.fromValue + (anim.toValue - anim.fromValue) * this.evalTimelineProgress(win, anim, nowMs);
      let entry = next.get(anim.layerId);
      if (!entry) {
        entry = { layerId: anim.layerId };
        next.set(anim.layerId, entry);
      }
      entry[anim.property] = value;
    }
    win.overrides = next;
  }

  tick(nowMs = performance.now(), dtMs = null) {
    const computedDt = dtMs ?? (this.lastTickMs === null ? 16.666 : Math.max(0, nowMs - this.lastTickMs));
    this.lastTickMs = nowMs;
    const safeDt = Math.max(0, Math.min(computedDt / 1000, 0.1));
    let anyChanged = false;

    for (const win of this.windows.values()) {
      for (const sc of win.scrolls.values()) {
        if (sc.smoothActive) {
          const rawT = (nowMs - sc.smoothStartMs) / Math.max(sc.smoothDurationMs, 1);
          const eased = evalEasing({ kind: 'cubic-bezier', x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 }, rawT);
          sc.x = sc.smoothStartX + (sc.smoothTargetX - sc.smoothStartX) * eased;
          sc.y = sc.smoothStartY + (sc.smoothTargetY - sc.smoothStartY) * eased;
          if (rawT >= 1) {
            sc.x = sc.smoothTargetX;
            sc.y = sc.smoothTargetY;
            sc.smoothActive = false;
          }
          anyChanged = true;
          win.needsPresent = true;
        }
        if ((sc.velX !== 0 || sc.velY !== 0) && safeDt > 0) {
          const decay = Math.exp(-FLING_DECAY * safeDt);
          const stepFactor = (1 - decay) / FLING_DECAY;
          const dx = sc.velX * stepFactor;
          const dy = sc.velY * stepFactor;
          let nvx = sc.velX * decay;
          let nvy = sc.velY * decay;
          if (Math.abs(nvx) < STOP_FLING_VELOCITY) nvx = 0;
          if (Math.abs(nvy) < STOP_FLING_VELOCITY) nvy = 0;
          if (this.applyScrollDeltaInternal(win, sc.node, dx, dy, false)) anyChanged = true;
          sc.velX = nvx;
          sc.velY = nvy;
          if (Math.abs(sc.overscrollX) > 0.01) {
            sc.bounceSpringX = { value: sc.overscrollX, target: 0, velocity: 0, active: true };
            sc.velX = 0;
          }
          if (Math.abs(sc.overscrollY) > 0.01) {
            sc.bounceSpringY = { value: sc.overscrollY, target: 0, velocity: 0, active: true };
            sc.velY = 0;
          }
          if (sc.velX === 0 && sc.velY === 0 && !sc.bounceSpringX.active && !sc.bounceSpringY.active) {
            this.snapScroller(win, sc, nowMs, true);
          }
          win.needsPresent = true;
          anyChanged = true;
        }
        if (sc.bounceSpringX.active || sc.bounceSpringY.active) {
          const spec = { stiffness: 320, damping: 32, mass: 1, restDelta: 0.05, restVelocity: 0.5 };
          if (sc.bounceSpringX.active) {
            sc.bounceSpringX = stepSpring(spec, sc.bounceSpringX, safeDt);
            sc.overscrollX = sc.bounceSpringX.value;
          }
          if (sc.bounceSpringY.active) {
            sc.bounceSpringY = stepSpring(spec, sc.bounceSpringY, safeDt);
            sc.overscrollY = sc.bounceSpringY.value;
          }
          if (!sc.bounceSpringX.active && !sc.bounceSpringY.active) {
            this.snapScroller(win, sc, nowMs, true);
          }
          win.needsPresent = true;
          anyChanged = true;
        }
      }

      for (const anim of win.animations) {
        if (!anim.active) continue;
        if (anim.useSpring) {
          anim.springState = stepSpring(anim.spring ?? { stiffness: 180, damping: 22, mass: 1 }, anim.springState, safeDt);
          if (!anim.springState.active) anim.active = false;
          win.needsPresent = true;
          anyChanged = true;
        } else if (!anim.timeline || anim.timeline === 'monotonic' || anim.timeline.kind === 'monotonic') {
          const elapsed = nowMs - (anim.startMs ?? 0) - (anim.delayMs ?? 0);
          if (elapsed >= 0) {
            const iters = anim.iterations ?? 1;
            if (iters > 0 && elapsed >= (anim.durationMs ?? 1) * iters) {
              anim.active = false;
            }
            win.needsPresent = true;
            anyChanged = true;
          }
        }
      }
      this.rebuildOverrides(win, nowMs);
    }
    return anyChanged;
  }

  hasActiveMotion() {
    for (const win of this.windows.values()) {
      for (const sc of win.scrolls.values()) {
        if (sc.velX !== 0 || sc.velY !== 0 || sc.smoothActive || sc.bounceSpringX.active || sc.bounceSpringY.active) {
          return true;
        }
      }
      for (const anim of win.animations) {
        if (anim.active && (!anim.timeline || anim.timeline === 'monotonic' || anim.timeline.kind === 'monotonic' || anim.useSpring)) {
          return true;
        }
      }
    }
    return false;
  }

  present(nowMs = performance.now()) {
    let presentedAny = false;
    for (const win of this.windows.values()) {
      if (!win.needsPresent && !this.hasActiveMotion()) continue;
      win.needsPresent = false;
      if (win.canvas && win.surfaceBitmap) {
        const w = Math.max(1, win.viewportWidth || win.surfaceBitmap.width || win.canvas.width || 1);
        const h = Math.max(1, win.viewportHeight || win.surfaceBitmap.height || win.canvas.height || 1);
        if (win.canvas.width !== w) win.canvas.width = w;
        if (win.canvas.height !== h) win.canvas.height = h;
        const ctx = (win.ctx2d ??= win.canvas.getContext?.('2d') ?? null);
        if (ctx) {
          ctx.save?.();
          ctx.clearRect?.(0, 0, w, h);
          const rootOverride = win.overrides.get(0);
          if (rootOverride?.opacity !== undefined && 'globalAlpha' in ctx) ctx.globalAlpha = rootOverride.opacity;
          const sc = win.scrolls.values().next().value;
          const dx = sc ? -(sc.x + sc.overscrollX) : 0;
          const dy = sc ? -(sc.y + sc.overscrollY) : 0;
          if (dx || dy || rootOverride?.translateX || rootOverride?.translateY) {
            ctx.translate?.((rootOverride?.translateX ?? 0) + dx, (rootOverride?.translateY ?? 0) + dy);
          }
          ctx.drawImage?.(win.surfaceBitmap, 0, 0, w, h);
          ctx.restore?.();
        }
      }
      if (win.epochs.activeEpoch > win.epochs.presentedEpoch) {
        win.epochs.presentedEpoch = win.epochs.activeEpoch;
      }
      if (win.epochs.presentedEpoch > win.epochs.gpuFinishedEpoch) {
        win.epochs.gpuFinishedEpoch = win.epochs.presentedEpoch;
      }
      win.retirement.drainRetired(win.epochs.gpuFinishedEpoch);
      if (win.lastPresentMs > 0) {
        const dt = nowMs - win.lastPresentMs;
        if (dt > 0 && dt < 1000 && this.presentedIntervals.length < 1024) this.presentedIntervals.push(dt);
      }
      win.lastPresentMs = nowMs;
      win.presentedCount += 1;
      presentedAny = true;
    }
    return presentedAny;
  }
}
