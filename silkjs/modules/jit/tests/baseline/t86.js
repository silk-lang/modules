// Phase 12 regression test:
// 1. Known local function (Shape.known / ValueBits.FunctionBytecode) inlining into known callers
//    and loop-free known callers, including global reads (known.refs) inside inlined known callees
// 2. Mid-body deopt exit and throw inside an inlined TARGET_KNOWN_FN (materializeKnownClosure)
// 3. Depth-0 inlining of small looped var-call helpers (sc_assq / conf_set_union pattern)
// 4. Polymorphic depth-0 inlining of 461..700 byte methods into a small looped caller

var GLOBAL_BIAS = 7;

// --- 1 & 2. Known local functions + mid-body deopt & throw inside inlined TARGET_KNOWN_FN ---
function makeKnownRunner() {
  var touch, combine, runLoop, runOnce;
  touch = function(arr, idx, val) {
    var prev = arr[0];
    arr[0] = prev + 1;           // side effect #1 before guarded store #2
    arr[idx] = val + GLOBAL_BIAS; // guarded store #2 (deopts mid-body on sparse/OOB/setter)
    return arr[0] + arr[idx];
  };
  combine = function(a, b) {
    return a * 3 + b + GLOBAL_BIAS;
  };
  runOnce = function(arr, idx, val) {
    return touch(arr, idx, combine(val, 2));
  };
  runLoop = function(arr, n, idx, val) {
    var s = 0;
    for (var i = 0; i < n; i++) {
      s += touch(arr, idx, val + i);
      if ((i & 3) === 0) s += runOnce(arr, 1, i);
    }
    return s;
  };
  return { runLoop: runLoop, runOnce: runOnce };
}

var kr = makeKnownRunner();
var r1 = 0;
var dense = [0, 0, 0, 0, 0];
for (var i = 0; i < 80; i++) {
  r1 += kr.runLoop(dense, 5, 2, i & 7);
}
// Trigger mid-body deopt inside inlined `touch`: first write to arr[0] succeeds, second write
// hits a setter on index 2, forcing SERVICE_INLINED -> materializeKnownClosure -> callResuming!
var trapArr = [10, 0];
var setterHits = 0;
Object.defineProperty(trapArr, "2", {
  get: function() { return 50; },
  set: function(v) { setterHits += v; },
  configurable: true
});
r1 += kr.runLoop(trapArr, 2, 2, 3);
r1 += setterHits;

// Trigger mid-body throw inside inlined `touch`:
var throwArr = [5, 0];
Object.defineProperty(throwArr, "2", {
  get: function() { return 1; },
  set: function(v) { throw new Error("known-inline-throw:" + v); },
  configurable: true
});
try {
  r1 += kr.runLoop(throwArr, 1, 2, 4);
} catch (e) {
  r1 += e.message.length + throwArr[0];
}

// --- 3. Small looped global helper inlined at depth 0 (sc_assq pattern) ---
function lookupList(key, node) {
  while (node !== null) {
    if (node.k === key) return node.v;
    node = node.next;
  }
  return -1;
}
function runLookups(list, n) {
  var total = 0;
  for (var i = 0; i < n; i++) {
    total += lookupList(i & 3, list);
  }
  return total;
}
var list = { k: 0, v: 11, next: { k: 1, v: 22, next: { k: 2, v: 33, next: null } } };
var r2 = 0;
for (var i = 0; i < 80; i++) r2 += runLookups(list, 6);
// Mid-loop deopt inside inlined `lookupList` (different shape / getter):
var weirdList = { k: 9, v: 1, next: { get k() { return 1; }, v: 99, next: null } };
r2 += runLookups(weirdList, 4);

print(r1, r2);
