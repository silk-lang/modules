// Regression test for Phase 4:
// 1. Live F64 values in XMM registers across Op.Poll, Op.Release, GetElem, PutElem,
//    GetField, plus fused GetElem+UnboxF64, BoxF64+PutElem, and BoxF64 loop-entry unboxing.
// 2. Module/enclosing-scope direct-call inlining (OP_get_scope0) with late reassignment.
// 3. Function.prototype.call fast-path retargeting (0 args, multi-arg, native callee).
// 4. Private class field reads and writes (#x / #y) + private getter fallback.

function floatArrayLoop(arr, out, a, invC, iters) {
  var total = 0;
  for (var k = 0; k < iters; k++) {
    var last = arr[0];
    for (var i = 1; i < arr.length - 1; i++) {
      var next = (out[i] + a * (last + arr[i + 1])) * invC;
      arr[i] = next;
      last = next;
    }
    total += last;
  }
  return total;
}

var fa = [];
var fo = [];
for (var i = 0; i < 16; i++) {
  fa[i] = (i & 1) ? i + 0.5 : i;
  fo[i] = i * 0.25 + 0.125;
}
var fRes = 0;
for (var r = 0; r < 30; r++) {
  fRes += floatArrayLoop(fa, fo, 0.25, 0.5, 4);
}
// Trigger non-number deopt out of fused GetElem+UnboxF64.
var mixed = [1.5, 2.5, "3.5", 4.5, 5.5];
var mixedOut = [0.5, 0.5, 0.5, 0.5, 0.5];
var mRes = floatArrayLoop(mixed, mixedOut, 0.5, 0.5, 1);

// Scope-slot direct-call inlining with late reassignment.
function makeScopeCaller() {
  var helper = function (x, y) { return x * 3 + y; };
  function run(n) {
    var s = 0;
    for (var i = 0; i < n; i++) s += helper(i, 2);
    return s;
  }
  return { run: run, swap: function (f) { helper = f; } };
}
var sc = makeScopeCaller();
var s1 = 0;
for (var i = 0; i < 40; i++) s1 += sc.run(10);
sc.swap(function (x, y) { return x - y; });
var s2 = sc.run(10);

// Function.prototype.call fast-path retargeting.
function addThis(a, b) { return this.base + a * 2 + b; }
function zeroArg() { return this.base + 7; }
function callLoop(obj, n) {
  var s = 0;
  for (var i = 0; i < n; i++) {
    s += addThis.call(obj, i, 3);
    s += zeroArg.call(obj);
    s += Math.max.call(null, i, 5);
  }
  return s;
}
var cRes = 0;
for (var i = 0; i < 30; i++) cRes += callLoop({ base: 10 }, 10);

// Private fields (#x, #y) + private getter fallback.
class Counter {
  #x = 0;
  #y = 1;
  constructor(v) { this.#x = v; }
  step(d) {
    this.#x = this.#x + d;
    this.#y = this.#y + this.#x;
    return this.#y;
  }
  get #sum() { return this.#x + this.#y; }
  total() { return this.#sum; }
}
var ctr = new Counter(5);
var pRes = 0;
for (var i = 0; i < 60; i++) pRes += ctr.step(i & 3);
pRes += ctr.total();

print(Math.round(fRes * 1000), Math.round(mRes * 1000), s1, s2, cRes, pRes);
