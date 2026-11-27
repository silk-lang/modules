// Regression test for Phase 3:
// 1. Known local inner functions (`shape.known && !shape.scoped`) reading enclosing
//    flat-scoped variables and calling sibling known local functions.
// 2. Live F64 values across virtualized `Op.CheckConstruct` (both epoch hit and
//    cold epoch-miss revalidation + cold deopt materialization).
// 3. Baseline split-code `OP_strict_eq_imm8` (int, float64, non-number) and `OP_define_field`.

function fluidKernel(n) {
  var scale = 1.5;
  var bias = 0.25;
  var arr = new Float64Array(n);
  for (var i = 0; i < n; i++) arr[i] = i + 1;

  function stepOne(a, k) {
    var s = 0;
    for (var i = 0; i < n; i++) {
      a[i] = a[i] * scale + bias * k;
      s += a[i];
    }
    return s;
  }

  function stepBoth(a, rounds) {
    var total = 0;
    for (var r = 1; r <= rounds; r++) {
      total += stepOne(a, r);
    }
    return total;
  }

  return stepBoth(arr, 4);
}

var fSum = 0;
for (var k = 0; k < 40; k++) {
  fSum += fluidKernel(12);
}

// Live F64 values in XMM registers across virtualized constructor + epoch bump.
function Vec(x, y) {
  this.x = x;
  this.y = y;
}
Vec.prototype.dot = function (o) {
  return this.x * o.x + this.y * o.y;
};

function xmmAcrossConstruct(a, b, c, d, bump) {
  var d0 = a * 1.125 + 0.5;
  var d1 = b * 2.25 - 0.25;
  var d2 = c * 0.75 + d;
  var v = new Vec(a + 0.5, b - 0.5);
  var w = new Vec(c + 1.5, d + 2.5);
  if (bump) {
    Vec.prototype.extra = 1;
    delete Vec.prototype.extra;
  }
  var p = v.dot(w);
  return d0 + d1 + d2 + p;
}

var xSum = 0;
for (var i = 0; i < 80; i++) {
  xSum += xmmAcrossConstruct(i + 0.1, i + 0.2, i + 0.3, i + 0.4, i === 60);
}

// Strict-eq imm8 across int, float64, string, null, object + define_field.
function eqAndDef(v, i) {
  var eq0 = (v === 0);
  var neq1 = (v !== 1);
  var obj = { a: i, b: v, c: eq0 ? 10 : 20, d: neq1 ? 30 : 40 };
  return obj.a + obj.c + obj.d;
}

var eSum = 0;
var vals = [0, 1, 0.0, -0.0, 1.5, "0", null, undefined, { x: 1 }];
for (var i = 0; i < 90; i++) {
  eSum += eqAndDef(vals[i % vals.length], i);
}

print(Math.round(fSum * 100), Math.round(xSum * 100), eSum);
