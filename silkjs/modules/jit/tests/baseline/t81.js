// Regression test for Phase 7:
// 1. Inline Math.sqrt / Math.abs / Math.floor / Math.min / Math.max (Int, Float64,
//    negative zero, NaN, INT32_MIN, non-number fallback).
// 2. Virtualized construct live across PutField (exitHasVirtual step guard) and
//    dead-local join cleanup.
// 3. Constant-specialized equalsFast (=== null, === undefined, == null, === true/false,
//    === string literal, with both fused branch and value forms).
// 4. Baseline bitwise with Bool/Null/Undefined (Int & Bool), Float64 % Int (OP_mod),
//    String + Bool/Null/Undefined (CONCAT_PRIM), and zeroStack recycling in construction.
// 5. Optimizer OP_special_object kind=4 (HOME_OBJECT via super.method()).

function Vec3(x, y, z) {
  this.x = x;
  this.y = y;
  this.z = z;
}
Vec3.prototype.dot = function (o) {
  return this.x * o.x + this.y * o.y + this.z * o.z;
};
Vec3.prototype.sub = function (o) {
  return new Vec3(this.x - o.x, this.y - o.y, this.z - o.z);
};

// Virtualized dst live in JS local across PutField on info.
function hitTest(a, b, info, r) {
  var dst = a.sub(b);
  var d2 = dst.dot(dst);
  var root = Math.sqrt(d2);
  var fl = Math.floor(root);
  var ab = Math.abs(-root);
  var mn = Math.min(ab, r);
  var mx = Math.max(fl, 1.5);
  info.isHit = d2 < r * r;
  info.dist = mn + mx;
  return info.dist;
}

var va = new Vec3(3.5, 4.25, 1.5);
var vb = new Vec3(1.0, 0.25, 0.5);
var info = { isHit: false, dist: 0 };
var hRes = 0;
for (var i = 0; i < 60; i++) {
  hRes += hitTest(va, vb, info, 10.0);
}
// Edge cases for Math fast paths: -0, NaN, INT32_MIN, negative floor, equal min/max.
function mathEdges(a, b) {
  var s = 0;
  s += Math.abs(-2147483648);
  s += Math.abs(-0) === 0 && (1 / Math.abs(-0)) > 0 ? 1 : 0;
  s += Math.floor(-1.25) === -2 ? 2 : 0;
  s += Math.floor(5) === 5 ? 4 : 0;
  s += isNaN(Math.sqrt(-1)) ? 8 : 0;
  s += isNaN(Math.min(a, NaN)) ? 16 : 0;
  s += isNaN(Math.max(NaN, b)) ? 32 : 0;
  s += (1 / Math.min(-0, 0)) < 0 ? 64 : 0;
  s += (1 / Math.max(-0, 0)) > 0 ? 128 : 0;
  return s;
}
var mEdge = 0;
for (var i = 0; i < 40; i++) mEdge += mathEdges(i + 0.5, i - 0.5);

// Constant-specialized equalsFast (strict & loose, fused & value).
function eqConsts(v, s) {
  var c = 0;
  if (v === null) c += 1;
  if (v !== undefined) c += 2;
  if (v == null) c += 4;
  if (v != undefined) c += 8;
  if (v === true) c += 16;
  if (v === false) c += 32;
  if (s === "POST") c += 64;
  var b1 = (v === null);
  var b2 = (v == null);
  var b3 = (v === true);
  var b4 = (s === "POST");
  return c + (b1 ? 128 : 0) + (b2 ? 256 : 0) + (b3 ? 512 : 0) + (b4 ? 1024 : 0);
}
var eqRes = 0;
var ropePost = "PO" + "ST";
for (var i = 0; i < 40; i++) {
  eqRes += eqConsts(null, "POST");
  eqRes += eqConsts(undefined, ropePost);
  eqRes += eqConsts(true, "GET");
  eqRes += eqConsts(false, 123);
  eqRes += eqConsts({ a: 1 }, "POST");
}

// Baseline arithmetic & concat fast paths (Int & Bool, Float64 % Int, String + Bool/Null/Undefined).
function httpArith(n, flag) {
  var a = (n & flag) + (n | null) + (n ^ undefined);
  var b = ((n * 2.5 + 1.0) % 2) === 1 ? 1 : 0;
  var s1 = "ret=" + flag;
  var s2 = flag + "=ret";
  var s3 = "x=" + null + ":" + undefined;
  return a + b + s1.length + s2.length + s3.length;
}
var arithRes = 0;
for (var i = 0; i < 60; i++) {
  arithRes += httpArith(i, (i & 1) === 1);
}

// Allocation churn triggering zeroStack recycling in baselineConstructFast (> 250 objects).
function Box(v) { this.v = v; this.w = v + 1; }
var boxSum = 0;
for (var i = 0; i < 400; i++) {
  var bx = new Box(i & 15);
  boxSum += bx.v + bx.w;
}

// Optimizer HOME_OBJECT (super.method()) in a hot function.
class Parent {
  calc(x) { return x + 3; }
}
class Child extends Parent {
  run(x) { return super.calc(x) * 2; }
}
var ch = new Child();
var supRes = 0;
for (var i = 0; i < 60; i++) supRes += ch.run(i & 7);

print(Math.round(hRes * 100), Math.round(mEdge), eqRes, arithRes, boxSum, supRes);
