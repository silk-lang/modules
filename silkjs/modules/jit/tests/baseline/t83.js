// Phase 9 regression test:
// 1. Inline x64 Op.NewObject (alternating top-2 zeroStack recycle + heap-slot recycle)
// 2. Signed i64 interval range analysis for Mul/Add/Sub (including -0 and overflow edges)
// 3. Nested planned construction (Class.create -> inner ctor, new Array(), 2-level nested, and guard deopts)

// --- 1. Inline Op.NewObject alternating zeroStack recycle ---
function Vec(x, y, z) { this.x = x; this.y = y; this.z = z; }
function Col(r, g, b) {
  if (!r) r = 0.0;
  if (!g) g = 0.0;
  if (!b) b = 0.0;
  this.r = r; this.g = g; this.b = b;
}
function recycleChurn(n) {
  let acc = 0;
  for (let i = 0; i < n; i++) {
    let v = new Vec(i, i + 1, i + 2);
    let c = new Col(i & 7, (i + 1) & 7, (i + 2) & 7);
    acc += v.x + c.r;
  }
  return acc;
}
let r1 = recycleChurn(600);

// --- 2. Range-proven Mul/Add/Sub + -0 & overflow correctness ---
function am3Step(a, x) {
  let xl = x & 0x3fff;
  let xh = x >> 14;
  let l = a & 0x3fff;
  let h = a >> 14;
  let m = xh * l + h * xl;
  let s = xl * l + ((m & 0x3fff) << 14);
  let c = (s >> 28) + (m >> 14) + xh * h;
  return (s & 0xfffffff) ^ c;
}
let r2 = 0;
for (let i = 0; i < 400; i++) {
  r2 ^= am3Step((i * 1234567) & 0xfffffff, (i * 7654321) & 0xfffffff);
}

// -0 check when one operand is negative (h < 0, xl == 0) must still produce -0!
function mulSigned(a, x) {
  let xl = x & 0x3fff;
  let h = a >> 14;
  return h * xl;
}
let negZeroOk = 0;
for (let i = 0; i < 100; i++) {
  let prod = mulSigned(i === 95 ? -16384 : 16384, i === 95 ? 0 : 1);
  if (i === 95 && Object.is(prod, -0)) negZeroOk = 1;
}

// --- 3. Nested planned construction + guard deopts ---
var NS = {};
NS.Color = function(r, g, b) {
  if (!r) r = 0.0;
  if (!g) g = 0.0;
  if (!b) b = 0.0;
  this.r = r; this.g = g; this.b = b;
};
var Class = {
  create: function() {
    return function() {
      this.initialize.apply(this, arguments);
    };
  }
};
NS.Info = Class.create();
NS.Info.prototype = {
  isHit: false,
  color: null,
  initialize: function() {
    this.color = new NS.Color(0, 0, 0);
  }
};
function makeInfo(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    let info = new NS.Info();
    sum += info.color.r + info.color.g + info.color.b + (info.isHit ? 10 : 1);
  }
  return sum;
}
let r3a = makeInfo(300);
// Mutate NS.Color mid-flight: guard must fire and use the replacement constructor!
NS.Color = function(r, g, b) { this.r = 7; this.g = 8; this.b = 9; };
let r3b = makeInfo(5);

// OrderedCollection / Plan style nested new Array() and 2-level nesting
function Box() {
  this.elms = new Array();
}
function Outer() {
  this.b = new Box();
}
function makeBoxes(n) {
  let total = 0;
  for (let i = 0; i < n; i++) {
    let b = new Box();
    b.elms.push(i);
    let o = new Outer();
    o.b.elms.push(i + 1);
    total += b.elms.length + o.b.elms[0];
  }
  return total;
}
let r4a = makeBoxes(250);
// Mutate Box mid-flight: Outer's guard must fire!
var OrigBox = Box;
Box = function() { this.elms = [999]; };
let r4b = makeBoxes(3);
Box = OrigBox;

// --- 4. In-place nested child recycle edge cases (sphere-miss, escaped child, mutated child) ---
var NS2 = {};
NS2.Color = function(r, g, b) {
  if (!r) r = 0.0;
  if (!g) g = 0.0;
  if (!b) b = 0.0;
  this.r = r; this.g = g; this.b = b;
};
NS2.Info = Class.create();
NS2.Info.prototype = {
  isHit: false,
  shape: null,
  color: null,
  initialize: function() {
    this.color = new NS2.Color(0, 0, 0);
  }
};
var sharedHolder = { id: 42 };
var escapedColors = [];
function nestedRecycleEdges(n) {
  let acc = 0;
  for (let i = 0; i < n; i++) {
    let info = new NS2.Info();
    info.shape = sharedHolder; // adds 2nd slot (sphere-miss pattern)
    if (i === 50) {
      info.color.r = 123;
      escapedColors.push(info.color); // child rc == 2: next iter must NOT clobber escaped!
    } else if (i === 80) {
      info.color.extra = 77; // shape mutation on child
    } else if (i === 110) {
      info.color.r = { boxed: 9 }; // heap value in child slot
    } else if (i === 140) {
      info.extra = info.color; // self-aliased extra slot (child rc == 2)
    } else {
      info.color.r = i;
    }
    acc += (typeof info.color.r === "number" ? info.color.r : info.color.r.boxed) + info.shape.id;
  }
  return acc;
}
let r5 = nestedRecycleEdges(300);
let escapedOk = escapedColors[0].r === 123 ? 1 : 0;

// --- 5. Type.Bool strict equality (=== / !==) ---
function boolStrict(x, y, v) {
  let a = ((x === y) !== false) ? 1 : 0;
  let b = ((x === y) === false) ? 2 : 0;
  let c = ((x === y) === true) ? 4 : 0;
  let d = (false !== (x === y)) ? 8 : 0;
  let e = ((x === y) === 0) ? 16 : 0;
  let f = ((x === y) !== 0) ? 32 : 0;
  let g = (v !== false) ? 64 : 0;
  let h = (v === false) ? 128 : 0;
  return a + b + c + d + e + f + g + h;
}
let r6 = 0;
let vals = [false, true, 0, 1, null, "", undefined];
for (let i = 0; i < 200; i++) {
  r6 += boolStrict(i & 3, (i >> 1) & 3, vals[i % vals.length]);
}

print(r1, r2, negZeroOk, r3a, r3b, r4a, r4b, r5, escapedOk, r6);
