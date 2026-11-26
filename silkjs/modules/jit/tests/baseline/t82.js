// Phase 8 regression: inline instanceof (inlined + fast path), inline PutVar
// (prim/heap/const/TDZ), and GC-safe planned construction with Tier-3 pooled allocation.
function Pair(car, cdr) {
  this.car = car;
  this.cdr = cdr;
}
function SubPair(car, cdr, tag) {
  this.car = car;
  this.cdr = cdr;
  this.tag = tag;
}
SubPair.prototype = Object.create(Pair.prototype);
SubPair.prototype.constructor = SubPair;

function isPair(x) { return x instanceof Pair; }
function isSub(x) { return x instanceof SubPair; }
function isArr(x) { return x instanceof Array; }

var counter = 0;
var holder = null;

function testInstanceOfAndPutVar(n) {
  var hits = 0;
  var p = new Pair(1, 2);
  var sp = new SubPair(3, 4, 5);
  var arr = [1, 2, 3];
  var ta = new Uint8Array(4);
  for (var i = 0; i < n; i++) {
    counter = counter + 1;
    if (isPair(p)) hits++;
    if (isPair(sp)) hits++;
    if (!isSub(p)) hits++;
    if (isSub(sp)) hits++;
    if (!isPair(null)) hits++;
    if (!isPair(undefined)) hits++;
    if (!isPair(42)) hits++;
    if (!isPair("str")) hits++;
    if (isArr(arr)) hits++;
    if (!isArr(p)) hits++;
    if (ta instanceof Uint8Array) hits++;
    holder = p;
    holder = sp;
    holder = i;
  }
  return hits;
}

// Custom @@hasInstance and non-callable RHS must still take the slow path cleanly.
function Custom() {}
Object.defineProperty(Custom, Symbol.hasInstance, {
  value: function (x) { return typeof x === "number" && x > 10; }
});
function testCustom(x) { return x instanceof Custom; }

// Trigger Tier-3 pooled allocation across many live Pairs and many distinct constructors.
function makeList(len) {
  var head = null;
  for (var i = 0; i < len; i++) {
    head = new Pair(i, head);
  }
  var sum = 0;
  while (isPair(head)) {
    sum += head.car;
    head = head.cdr;
  }
  return sum;
}

var r1 = testInstanceOfAndPutVar(200);
var r2 = 0;
for (var i = 0; i < 60; i++) {
  if (testCustom(i)) r2++;
}

// Exercise const global write rejection on slow path.
const IMMUTABLE = 7;
function writeConst() { IMMUTABLE = 9; }
var constErr = 0;
for (var i = 0; i < 40; i++) {
  try { writeConst(); } catch (e) { if (e instanceof TypeError) constErr++; }
}

// Exercise non-callable RHS rejection on slow path.
function badRhs(x, rhs) { return x instanceof rhs; }
var rhsErr = 0;
for (var i = 0; i < 40; i++) {
  try { badRhs({}, 123); } catch (e) { if (e instanceof TypeError) rhsErr++; }
}

// Live list allocation + sum across multiple rounds.
var listSum = 0;
for (var r = 0; r < 10; r++) listSum += makeList(2000);

print(r1, counter, r2, constErr, rhsErr, listSum);
