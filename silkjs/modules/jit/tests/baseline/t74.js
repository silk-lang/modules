// Regression tests for RayTrace SROA Phase 1:
// 1. Unconditional Op.InitSlot + mixed I32/F64 -> F64 RECIPE_SELECT (`x || 0` with -0, NaN, 0, non-zero).
// 2. Folding Op.Truthy / Op.NotBool / Op.Branch on known construct-join objects (Vector.subtract),
//    while still throwing when passed null / undefined / falsy values.
// 3. Own-slot field forwarding from Op.InitSlot and Op.PutField (Color.multiplyScalar),
//    and proper invalidation at diamonds, loops, and escaping uses (calls, InitSlot into outer object).

var Class = {
  create: function() {
    return function() {
      this.initialize.apply(this, arguments);
    };
  }
};

var Vector = Class.create();
Vector.prototype = {
  x: 0.0,
  y: 0.0,
  z: 0.0,
  initialize: function(x, y, z) {
    this.x = x || 0;
    this.y = y || 0;
    this.z = z || 0;
  }
};
Vector.subtract = function(v, w) {
  if (!v || !w) throw "Vector.subtract requires two vectors";
  return new Vector(v.x - w.x, v.y - w.y, v.z - w.z);
};
Vector.dot = function(v, w) {
  return v.x * w.x + v.y * w.y + v.z * w.z;
};

var Color = Class.create();
Color.prototype = {
  red: 0.0,
  green: 0.0,
  blue: 0.0,
  initialize: function(r, g, b) {
    if (!r) r = 0.0;
    if (!g) g = 0.0;
    if (!b) b = 0.0;
    this.red = r;
    this.green = g;
    this.blue = b;
  }
};
Color.multiplyScalar = function(c, f) {
  var r = new Color(0, 0, 0);
  r.red = c.red * f;
  r.green = c.green * f;
  r.blue = c.blue * f;
  return r;
};

function Ray(pos, dir) {
  this.position = pos;
  this.direction = dir;
}

// 1. Mixed F64/I32 RECIPE_SELECT (`x || 0`) + immediate own-slot read forwarding.
function makeAndReadVec(x, y, z) {
  var v = new Vector(x, y, z);
  return v.x + v.y * 2.0 + v.z * 3.0;
}

function makeVecObj(x, y, z) {
  return new Vector(x, y, z);
}

// 2. Chained Vector.subtract: dead `!v` branch folded + own-slot forwarding across chain.
function chainSubtractDot(a, b, c) {
  var d1 = Vector.subtract(a, b);
  var d2 = Vector.subtract(d1, c);
  return Vector.dot(d2, d1);
}

function directSubtract(v, w) {
  return Vector.subtract(v, w);
}

// 3. Color.multiplyScalar store-to-load forwarding + diamond merge invalidation.
function scaledLuma(c, f) {
  var r = Color.multiplyScalar(c, f);
  return r.red * 0.3 + r.green * 0.59 + r.blue * 0.11;
}

function diamondColor(c, f, boost) {
  var r = new Color(0, 0, 0);
  r.red = c.red * f;
  r.green = c.green * f;
  r.blue = c.blue * f;
  if (boost) {
    r.red = r.red + 10.0;
  }
  return r.red + r.green + r.blue;
}

// 4. Escaping uses must stop forwarding (direct call, loop escape, nested InitSlot escape).
var sink = [];
function mutateVec(v) {
  sink[0] = v;
  v.x = v.x + 100.0;
  v.y = -7.5;
}

function mutateRay(r) {
  sink[1] = r;
  r.position.x = r.position.x + 50.0;
}

function escapeCallTest(a, b, c) {
  var v = new Vector(a, b, c);
  var before = v.x + v.y;
  mutateVec(v);
  var after = v.x + v.y + v.z;
  return before * 1000.0 + after;
}

function escapeLoopTest(a, b, c) {
  var v = new Vector(a, b, c);
  var sum = 0.0;
  for (var i = 0; i < 4; i++) {
    sum += v.x;
    if (i === 1) mutateVec(v);
  }
  return sum;
}

function escapeInitSlotTest(a, b, c) {
  var p = new Vector(a, b, c);
  var d = new Vector(1.0, 2.0, 3.0);
  var before = p.x;
  var r = new Ray(p, d);
  mutateRay(r);
  return before * 100.0 + p.x;
}

// Warm up past JIT optimization threshold.
var a0 = new Vector(5.5, -2.25, 3.75);
var b0 = new Vector(1.5, 0.75, -1.25);
var c0 = new Vector(0.5, -1.0, 2.0);
var col0 = new Color(0.25, 0.5, 0.75);

var sumVec = 0.0;
var sumChain = 0.0;
var sumLuma = 0.0;
var sumDiamond = 0.0;
var sumEscCall = 0.0;
var sumEscLoop = 0.0;
var sumEscInit = 0.0;

for (var i = 0; i < 3000; i++) {
  var vx = (i & 3) === 0 ? -0.0 : (i & 7) === 1 ? NaN : (i * 0.25);
  var vy = (i & 1) === 0 ? 0.0 : -1.5;
  var vz = (i & 3) === 2 ? -0.0 : 2.5;
  sumVec += makeAndReadVec(vx, vy, vz);
  sumChain += chainSubtractDot(a0, b0, c0);
  var ds = directSubtract(a0, b0);
  sumChain += ds.x;
  sumLuma += scaledLuma(col0, (i & 3) + 0.5);
  sumDiamond += diamondColor(col0, 2.0, (i & 1) === 0);
  sumEscCall += escapeCallTest(i * 0.5, 2.0, 3.0);
  sumEscLoop += escapeLoopTest(4.0, 1.0, 2.0);
  sumEscInit += escapeInitSlotTest(3.0, 4.0, 5.0);
}

// Verify -0.0, NaN, +0.0, undefined, missing args semantics bit-for-bit after optimization.
var z1 = makeVecObj(-0.0, NaN, undefined);
var z2 = makeVecObj(0.0, -0.0);
var z3 = makeVecObj(1.25, -2.5, 3.5);
print("negzero:", Object.is(z1.x, 0), Object.is(z1.y, 0), Object.is(z1.z, 0));
print("missing:", Object.is(z2.x, 0), Object.is(z2.y, 0), Object.is(z2.z, 0));
print("nonzero:", z3.x, z3.y, z3.z);

// Verify Vector.subtract still throws on null / undefined / falsy after optimization.
var caught = 0;
try { directSubtract(null, a0); } catch (e) { caught += 1; }
try { directSubtract(a0, undefined); } catch (e) { caught += 2; }
try { directSubtract(0, a0); } catch (e) { caught += 4; }
try { directSubtract(a0, false); } catch (e) { caught += 8; }
print("throws:", caught);

// Verify slow-path allocation (holding live objects so spare cells exhaust) gives identical results.
var live = [];
var slowAcc = 0.0;
for (var k = 0; k < 600; k++) {
  var lv = makeVecObj(k === 10 ? -0.0 : k * 0.5, k === 20 ? NaN : 1.5, -2.0);
  live.push(lv);
  slowAcc += lv.x + lv.y + lv.z;
}

print("sums:", sumVec, sumChain, sumLuma, sumDiamond);
print("escapes:", sumEscCall, sumEscLoop, sumEscInit, slowAcc);
