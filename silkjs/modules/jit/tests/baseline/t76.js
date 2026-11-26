// Regression tests for SROA Phase 2 (allocation elimination, Op.CheckConstruct,
// Op.KnownMethod, and SlotMode.Virtual cold-deopt materialization):
// 1. Virtualized Vector prototype-method chains (`a.subtract(b).dot(c)` and `.add(c).dot(d)`).
// 2. Virtualized Color with in-place own-slot `put.field` mutations (`multiplyScalar`).
// 3. Forced cold-deopt materialization with live aliased virtual objects (`v === w`),
//    post-mutation virtual objects, multiple simultaneous virtual objects, and mixed field types.
// 4. Prototype method mutation invalidating `Op.KnownMethod` (materializing receiver cleanly).
// 5. Constructor / prototype mutation invalidating `Op.CheckConstruct`.

function Vec(x, y) {
  this.x = x;
  this.y = y;
}

function Vector(x, y, z) {
  this.x = x || 0;
  this.y = y || 0;
  this.z = z || 0;
}
Vector.prototype.subtract = function(w) {
  return new Vector(this.x - w.x, this.y - w.y, this.z - w.z);
};
Vector.prototype.add = function(w) {
  return new Vector(this.x + w.x, this.y + w.y, this.z + w.z);
};
Vector.prototype.dot = function(w) {
  return this.x * w.x + this.y * w.y + this.z * w.z;
};

function Color(r, g, b) {
  this.red = r || 0;
  this.green = g || 0;
  this.blue = b || 0;
}
Color.prototype.multiplyScalar = function(f) {
  this.red = this.red * f;
  this.green = this.green * f;
  this.blue = this.blue * f;
  return this;
};

function Mixed(n, d, b, u, arg) {
  this.n = n;
  this.d = d;
  this.b = b;
  this.u = u;
  this.arg = arg;
}

// 1. Virtualized Vector prototype-method chains (Op.CheckConstruct + Op.KnownMethod).
function vecDotChain(a, b, c) {
  return a.subtract(b).dot(c);
}

function vecAddSubDot(a, b, c, d) {
  return a.subtract(b).add(c).dot(d);
}

// 2. Virtualized Color with put.field mutations on self.
function colorScaleSum(r, g, b, s) {
  var col = new Color(r, g, b);
  col.red = col.red * s + 0.5;
  col.green = col.green * s + 0.25;
  col.blue = col.blue * s + 0.125;
  return col.red + col.green + col.blue;
}

function colorMethodSum(r, g, b, s) {
  var col = new Color(r, g, b);
  col.multiplyScalar(s);
  return col.red + col.green + col.blue;
}

// 3a. Cold deopt materialization with aliased virtual object (`v === w`).
function deoptAliased(a, b, flag) {
  var v = new Vec(a, b);
  var w = v;
  var k = flag + 1;
  if (k === "deopt1") {
    return (v === w ? 10000 : 0) + (v instanceof Vec ? 1000 : 0) + v.x * 10 + w.y;
  }
  return v.x + w.y + k;
}

// 3b. Cold deopt materialization AFTER put.field mutations on aliased virtual object.
function deoptMutated(a, b, flag) {
  var v = new Vec(a, b);
  var w = v;
  v.x = a * 2 + 1;
  v.y = b * 3 + 2;
  var k = flag + 1;
  if (k === "boom1") {
    return (v === w ? 10000 : 0) + (w instanceof Vec ? 1000 : 0) + w.x * 10 + v.y;
  }
  return w.x + v.y + k;
}

// 3c. Cold deopt materialization with TWO distinct aliased virtual objects live together.
function deoptTwoVirtual(a, b, c, d, flag) {
  var v1 = new Vec(a, b);
  var w1 = v1;
  var v2 = new Vec(c, d);
  var w2 = v2;
  var k = flag + 1;
  if (k === "two1") {
    var ok = (v1 === w1 && v2 === w2 && v1 !== v2 && v1 instanceof Vec && v2 instanceof Vec) ? 100000 : 0;
    return ok + v1.x * 1000 + w1.y * 100 + v2.x * 10 + w2.y;
  }
  return v1.x + w1.y + v2.x + w2.y + k;
}

// 3d. Cold deopt materialization with mixed field types (i32, f64, bool, undefined, arg object).
function deoptMixed(n, d, b, arg, flag) {
  var m = new Mixed(n, d, b, undefined, arg);
  var m2 = m;
  var k = flag + 1;
  if (k === "mix1") {
    var ok = (m === m2 && m.u === undefined && m.arg === arg && m.b === b) ? 1000 : 0;
    return ok + m.n + m.d * 4 + m.arg.tag;
  }
  return m.n + m2.d + (m.b ? 1 : 0) + k;
}

// 5. Constructor invalidation target (Op.CheckConstruct).
function Point(x, y) {
  this.x = x;
  this.y = y;
}
function pointSum(x, y) {
  var p = new Point(x, y);
  return p.x + p.y;
}

function PointProto(x, y) {
  this.x = x;
  this.y = y;
}
PointProto.prototype.bias = function() {
  return this.x + this.y;
};
function pointProtoSum(x, y) {
  var p = new PointProto(x, y);
  return p.bias();
}

// Warm up all functions well past optimization threshold.
var va = new Vector(1.5, 2.5, 3.5);
var vb = new Vector(0.5, 1.0, 1.5);
var vc = new Vector(2.0, -1.0, 0.5);
var vd = new Vector(1.0, 2.0, 3.0);
var tagObj = { tag: 77 };

var dotAcc = 0;
var chainAcc = 0;
var colAcc = 0;
var colMethodAcc = 0;
var aliasAcc = 0;
var mutAcc = 0;
var twoAcc = 0;
var mixAcc = 0;
var ptAcc = 0;
var ptProtoAcc = 0;

for (var i = 0; i < 4000; i++) {
  dotAcc += vecDotChain(va, vb, vc);
  chainAcc += vecAddSubDot(va, vb, vc, vd);
  colAcc += colorScaleSum((i & 7) + 0.5, (i & 3) + 0.25, (i & 1) + 0.5, 2.0);
  colMethodAcc += colorMethodSum((i & 7) + 0.5, (i & 3) + 0.25, (i & 1) + 0.5, 0.5);
  aliasAcc += deoptAliased(i & 7, i & 3, i & 1);
  mutAcc += deoptMutated(i & 7, i & 3, i & 1);
  twoAcc += deoptTwoVirtual(i & 3, (i + 1) & 3, (i + 2) & 3, (i + 3) & 3, i & 1);
  mixAcc += deoptMixed(i & 7, 1.5, (i & 1) === 0, tagObj, i & 1);
  ptAcc += pointSum(i & 7, i & 3);
  ptProtoAcc += pointProtoSum(i & 7, i & 3);
}

print("warm:", dotAcc, chainAcc, colAcc, colMethodAcc);
print("warm2:", aliasAcc, mutAcc, twoAcc, mixAcc, ptAcc, ptProtoAcc);

// Trigger cold deopt materialization on aliased / mutated / multi / mixed virtual objects.
var d1 = deoptAliased(3, 7, "deopt");
var d2 = deoptMutated(4, 5, "boom");
var d3 = deoptTwoVirtual(1, 2, 3, 4, "two");
var d4 = deoptMixed(12, 2.25, true, tagObj, "mix");
var d5 = deoptMixed(5, 0.5, false, tagObj, "mix");
print("deopt:", d1, d2, d3, d4, d5);

// Verify hot paths continue working cleanly after cold deopt.
var postDeopt = deoptAliased(2, 3, 4) + deoptMutated(2, 3, 4) + deoptTwoVirtual(1, 1, 2, 2, 3);
print("postDeopt:", postDeopt);

// 4. Mutate Vector.prototype.dot to invalidate Op.KnownMethod and force receiver materialization.
var origDot = Vector.prototype.dot;
Vector.prototype.dot = function(w) {
  var isVec = (this instanceof Vector) ? 1000 : 0;
  return isVec + this.x * w.x - this.y * w.y + this.z * w.z;
};
var afterMutDot = vecDotChain(va, vb, vc);
var afterMutChain = vecAddSubDot(va, vb, vc, vd);
Vector.prototype.dot = origDot;
var afterRestoreDot = vecDotChain(va, vb, vc);
print("knownMethodInv:", afterMutDot, afterMutChain, afterRestoreDot);

// 5a. Mutate PointProto.prototype.bias to invalidate Op.KnownMethod.
PointProto.prototype.bias = function() {
  return (this instanceof PointProto ? 500 : 0) + this.x * 10 + this.y;
};
var afterPtProto = pointProtoSum(3, 4);
print("ptProtoInv:", afterPtProto);

// 5b. Replace Point constructor to invalidate Op.CheckConstruct.
Point = function(x, y) {
  this.x = x + 100;
  this.y = y + 200;
};
var afterPtCtor = pointSum(5, 6);
print("checkCtorInv:", afterPtCtor);
