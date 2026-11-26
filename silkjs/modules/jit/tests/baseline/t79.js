// Regression test for Phase 5:
// 1. Fused monomorphic GetField+UnboxF64 (Float64, Int32, non-number deopt) and aliased GetField.
// 2. Live XMM values across top-level PutField, GetLength, GetVar, and stepOnFrame slow paths.
// 3. equalsFast + STEP_EQUALS_SLOW (Int, Object, Float64, String, null/undefined, strict & loose).
// 4. STEP_HELPER_SLOW (typeof, instanceof, global PutVar/GetVar, PutScope).
// 5. Baseline shared stubs (STUB_GET_VAR, STUB_QUICK, STUB_LENGTH, STUB_CONSTRUCT_OWN,
//    OP_special_object, OP_put_loc_field_* setter fallback).

function Vec(x, y, z) {
  this.x = x;
  this.y = y;
  this.z = z;
}

function dotLoop(a, b, arr, n) {
  var sum = 0.0;
  var last = arr[0];
  for (var i = 0; i < n; i++) {
    // Monomorphic GetField + UnboxF64 + aliased field read + top-level PutField + GetLength with live XMMs.
    var vx = a.x;
    var vy = a.y;
    var vz = a.z;
    var d = vx * b.x + vy * b.y + vz * b.z + last;
    var len = arr.length;
    sum = sum + d + (len * 0.125);
    b.z = d * 0.25;
    last = (last + arr[i % len]) * 0.5;
  }
  return sum + last + b.z;
}

var va = new Vec(1.5, 2, 3.25);
var vb = new Vec(0.5, 1.25, 2.0);
var farr = [1.5, 2.5, 3, 4.5];
var r1 = 0;
for (var k = 0; k < 40; k++) {
  r1 += dotLoop(va, vb, farr, 12);
}
// Trigger non-number deopt out of fused GetField+UnboxF64.
var vStr = new Vec("1.5", 2, 3);
var rDeopt = dotLoop(vStr, new Vec(1, 1, 1), farr, 2);

// equalsFast + STEP_EQUALS_SLOW across all tag combos & flag branches.
function eqMix(a, b, c) {
  var s = 0;
  if (a === b) s += 1;
  if (a !== c) s += 2;
  if (a == b) s += 4;
  if (a != c) s += 8;
  var b1 = (a === b);
  var b2 = (a == c);
  return s + (b1 ? 16 : 0) + (b2 ? 32 : 0);
}
var obj1 = { k: 1 };
var obj2 = { k: 1 };
var eqSum = 0;
for (var i = 0; i < 40; i++) {
  eqSum += eqMix(i, i, i + 1);
  eqSum += eqMix(obj1, obj1, obj2);
  eqSum += eqMix(1.5, 1.5, "1.5");
  eqSum += eqMix("abc", "a" + "bc", null);
  eqSum += eqMix(null, undefined, false);
}

// STEP_HELPER_SLOW: typeof, instanceof, global PutVar/GetVar, PutScope.
var globalAcc = 0;
function helperOps(x, v) {
  var t = typeof x;
  var inst = v instanceof Vec;
  globalAcc = globalAcc + (inst ? 1 : 0) + (t === "number" ? 2 : 0);
  return globalAcc;
}
var hSum = 0;
for (var i = 0; i < 40; i++) {
  hSum += helperOps(i & 1 ? i : "s", i & 1 ? va : obj1);
}

// Baseline stubs: STUB_QUICK (object/array/closure/rest), STUB_LENGTH (array/string),
// STUB_CONSTRUCT_OWN, OP_special_object (arguments / this_func / new.target), setter fallback.
function stubMix(tag, ...rest) {
  var o = { a: tag, b: rest.length };
  var a = [o.a, o.b, "hello".length];
  var v = new Vec(a[0], a[1], a[2]);
  var fn = function (z) { return z + o.a; };
  return v.x + v.y + v.z + fn(arguments.length);
}
function NewTargetBox(x) {
  this.ok = new.target === NewTargetBox ? x + 1 : x - 1;
}
var setterAcc = 0;
var withSetter = {
  set val(v) { setterAcc += v; }
};
function setLocField(o, v) {
  o.val = v;
}
var sSum = 0;
for (var i = 0; i < 40; i++) {
  sSum += stubMix(i, 1, 2, 3);
  sSum += (new NewTargetBox(i)).ok;
  setLocField(withSetter, i);
}

print(Math.round(r1 * 100), Math.round(rDeopt * 100), eqSum, hSum, sSum, setterAcc);
