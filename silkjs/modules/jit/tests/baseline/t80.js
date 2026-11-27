// Regression test for Phase 6:
// 1. advect-like float loop: fractional x|0 (OP_or_imm), multi-block phi cycle, repeated
//    same-array trusted reads + non-adjacent GetElem+UnboxF64 + Int element cold fallback.
// 2. Mixed own + prototype SiteShape reads + non-adjacent GetField+UnboxF64 + float OP_mod/OP_add_imm.
// 3. Op.Truthy (Object, empty/non-empty flat string, rope), equalsFast (all primitive/null/undef/
//    string/object strict & loose), Op.TypeofAtom (all tags + classes), optimized #private fields,
//    and OP_special_object HOME_OBJECT (super method call).

function advectLike(d, d0, u, dt, n) {
  var dt0 = dt * n;
  var acc = 0.0;
  for (var j = 1; j < n - 1; j++) {
    var unusedA, unusedB;
    for (var i = 1; i < n - 1; i++) {
      var x = i - dt0 * u[i];
      if (x < 0.5) x = 0.5;
      if (x > n - 1.5) x = n - 1.5;
      var i0 = x | 0;
      var s1 = x - i0;
      var s0 = 1 - s1;
      // Repeated reads of d0 + non-adjacent (d0[i0] - d0[i0+1]) + store to d.
      var diff = d0[i0] - d0[i0 + 1];
      var v = s0 * d0[i0] + s1 * d0[i0 + 1] + 0.125 * diff;
      d[i] = v;
      acc += v;
    }
  }
  return acc;
}

var N = 12;
var d = [];
var d0 = [];
var u = [];
for (var i = 0; i < N; i++) {
  d[i] = 0;
  d0[i] = (i & 1) ? i + 0.25 : i; // mixes Int and Float64 elements (hits cold notFloat!)
  u[i] = 0.15 * (i - 5);
}
var advRes = 0;
for (var r = 0; r < 30; r++) {
  advRes += advectLike(d, d0, u, 0.1, N);
}

// Mixed own + prototype SiteShape reads + non-adjacent GetField+UnboxF64 + float mod/add_imm.
function HitInfo() {}
HitInfo.prototype.isHit = false;
HitInfo.prototype.dist = 1.5;
function makeHit(hit, x, y) {
  var h = new HitInfo();
  if (hit) {
    h.isHit = true;
    h.dist = x + y;
  }
  h.x = x;
  h.y = y;
  return h;
}
function checkHits(list) {
  var s = 0.0;
  for (var i = 0; i < list.length; i++) {
    var a = list[i];
    var b = list[(i + 1) % list.length];
    var d = a.x * b.x + a.y * b.y; // non-adjacent GetField+UnboxF64
    var w = (d % 2.5) + 1;         // float OP_mod + OP_add_imm
    if (a.isHit) s += a.dist + w;
    else s += a.dist * 0.5 + w;
  }
  return s;
}
var hits = [makeHit(false, 1.5, 2.5), makeHit(true, 3.25, 4.5), makeHit(false, 2, 3), makeHit(true, 1.25, 0.75)];
var hitRes = 0;
for (var r = 0; r < 40; r++) hitRes += checkHits(hits);

// Op.Truthy + equalsFast + Op.TypeofAtom.
function httpGlue(a, b, s1, s2, fn) {
  var score = 0;
  if (a) score += 1;
  if (s1) score += 2;
  if (s2) score += 4;
  if (a === null) score += 8;
  if (a !== undefined) score += 16;
  if (a == null) score += 32;
  if (b === true) score += 64;
  if (s1 === s2) score += 128;
  if (s1 === "POST") score += 256;
  if (typeof fn === "function") score += 512;
  if (typeof s1 === "string") score += 1024;
  if (typeof a === "object") score += 2048;
  if (typeof b === "boolean") score += 4096;
  if (typeof 42 === "number") score += 8192;
  if (typeof undefined === "undefined") score += 16384;
  return score;
}
var postStr = "POST";
var ropePost = "PO" + "ST";
var emptyStr = "";
var objA = { x: 1 };
var noop = function () {};
var glueSum = 0;
for (var r = 0; r < 40; r++) {
  glueSum += httpGlue(objA, true, postStr, postStr, noop);
  glueSum += httpGlue(null, false, emptyStr, ropePost, objA);
  glueSum += httpGlue(undefined, 1, ropePost, postStr, Math.max);
}

// Optimized private fields + HOME_OBJECT (super).
class Base {
  mul(v) { return v * 2; }
}
class Derived extends Base {
  #acc = 1;
  bump(v) {
    this.#acc = this.#acc + super.mul(v);
    return this.#acc;
  }
}
var der = new Derived();
var privSum = 0;
for (var r = 0; r < 60; r++) privSum += der.bump(r & 7);

print(Math.round(advRes * 100), Math.round(hitRes * 100), glueSum, privSum);
