// Inlined planned construction (Op.NewObject + Op.InitSlot) edge cases:
// CONSTRUCT_STORES, CONSTRUCT_EVAL (0, -0, NaN, missing args), CONSTRUCT_FORWARD
// (both eval and stores), zeroStack recycling + interrupt polls, and deopt on
// prototype / initialize / apply / setter / new.target mutations.

var Class = {
  create: function() {
    return function() {
      this.initialize.apply(this, arguments);
    };
  }
};

function Pair(a, b) {
  this.a = a;
  this.b = b;
}

function Vec(x, y, z) {
  this.x = x ? x : 0;
  this.y = y ? y : 0;
  this.z = z ? z : 1.5;
}

var FwdVec = Class.create();
FwdVec.prototype = {
  x: 0.0,
  y: 0.0,
  z: 0.0,
  initialize: function(x, y, z) {
    this.x = x ? x : 0;
    this.y = y ? y : 0;
    this.z = z ? z : 0;
  }
};

var FwdRay = Class.create();
FwdRay.prototype = {
  position: null,
  direction: null,
  initialize: function(pos, dir) {
    this.position = pos;
    this.direction = dir;
  }
};

function makePair(a, b) {
  return new Pair(a, b);
}

function makeVec(x, y, z) {
  return new Vec(x, y, z);
}

function makeFwdVec(x, y, z) {
  return new FwdVec(x, y, z);
}

function makeFwdRay(a, b, c) {
  var p = new FwdVec(a, b, c);
  var d = new FwdVec(c, b, a);
  return new FwdRay(p, d);
}

// 1. Warm up past optimization threshold and stress recycling + interrupt polls (> 20k allocs).
var acc = 0;
for (var i = 0; i < 25000; i++) {
  var pr = makePair(i, i + 1);
  var v = makeVec(i & 3, (i & 1) ? -0.0 : 0.5, (i & 7) === 0 ? NaN : 2.5);
  var r = makeFwdRay(i * 0.5, (i & 3) ? i : 0.0, (i & 1) ? -1.25 : -0.0);
  acc += pr.a + pr.b + v.x + v.y + v.z + r.position.x + r.direction.z;
}
print("loop:", acc);

// 2. Verify -0, NaN, undefined, missing args semantics bit-for-bit.
var z1 = makeVec(-0.0, NaN);
print("negzero:", Object.is(z1.x, 0), Object.is(z1.y, 0), z1.z);
var z2 = makeFwdVec(-0.0, NaN, undefined);
print("fwdneg:", Object.is(z2.x, 0), Object.is(z2.y, 0), Object.is(z2.z, 0));

// 3. Mutate C.prototype after optimization.
var origProto = Pair.prototype;
Pair.prototype = { tag: 99 };
var pMut = makePair(3, 4);
print("proto:", pMut.a, pMut.b, pMut.tag);
Pair.prototype = origProto;

// 4. Mutate FwdVec.prototype.initialize after optimization.
var origInit = FwdVec.prototype.initialize;
FwdVec.prototype.initialize = function(x, y, z) {
  this.x = 777;
  this.y = y + 1;
  this.z = z + 2;
};
var fvMut = makeFwdVec(1, 2, 3);
print("init:", fvMut.x, fvMut.y, fvMut.z);
FwdVec.prototype.initialize = origInit;

// 5. Add a setter on prototype after optimization.
var setterHits = 0;
Object.defineProperty(Vec.prototype, "x", {
  configurable: true,
  set: function(v) { setterHits += v; },
  get: function() { return -42; }
});
var vSet = makeVec(5, 6, 7);
print("setter:", setterHits, vSet.x, vSet.y, vSet.z);
delete Vec.prototype.x;

// 6. Mutate Function.prototype.apply temporarily after optimization.
var applyHits = 0;
var origApply = Function.prototype.apply;
Function.prototype.apply = function(t, args) {
  applyHits++;
  return origApply.call(this, t, args);
};
var fvApp = makeFwdVec(9, 8, 7);
Function.prototype.apply = origApply;
print("apply:", applyHits, fvApp.x, fvApp.y, fvApp.z);

// 7. new.target !== C via Reflect.construct.
function Sub() {}
Sub.prototype = { subTag: 123 };
var rc = Reflect.construct(Pair, [10, 20], Sub);
print("reflect:", rc.a, rc.b, rc.subTag);
