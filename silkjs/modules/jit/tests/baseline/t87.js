// Loop temporaries, float compares and double-to-int32 conversions in optimized loops:
// 1. locals a loop writes before it reads them (dead at its header) must not be carried
//    around the loop, and must still be right in the interpreter after an exit mid-loop;
// 2. `<`, `<=`, `>`, `>=` of doubles fused with their branch, NaN on either side included;
// 3. `x | 0` of doubles: fractions, values past int32 and int64, NaN, the infinities, -0;
// 4. `x | 0` and `x ^ 0` of an int32, which are the operand.

function clampSum(a, n) {
  var s = 0;
  for (var i = 0; i < n; i++) {
    var x = a[i] * 2.5;
    if (x < 0.5) x = 0.5;
    else if (x > 7.5) x = 7.5;
    var i0 = x | 0;
    var i1 = i0 + 1;
    s += a[i0] + a[i1];
  }
  return s;
}
var a = [];
for (var i = 0; i < 100; i++) a[i] = i * 0.25;
var t = 0;
for (var k = 0; k < 2000; k++) t += clampSum(a, 90);
print(t);
// A turn that leaves compiled code between the writes of its temporaries.
var texts = a.slice();
texts[40] = "1.75";
texts[3] = { valueOf: function () { return 0.5; } };
print(clampSum(texts, 90), clampSum(texts, 41), clampSum(a, 90));

// The temporaries after the loop left compiled code in the middle of a turn: a string
// element makes the multiply leave with x, i0 and i1 of the turn before in their cells.
function lastTemporaries(a, n) {
  var x = -1, i0 = -2, i1 = -3, s = 0;
  for (var i = 0; i < n; i++) {
    x = a[i] * 2;
    i0 = x | 0;
    i1 = i0 + 1;
    s += i1;
  }
  return s + ":" + x + ":" + i0 + ":" + i1;
}
var plain = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5];
var out = "";
for (var k = 0; k < 300; k++) out = lastTemporaries(plain, 6);
print(out);
var odd = [1.5, 2.5, "7", 4.5, { valueOf: function () { return 9.25; } }, 6.5];
print(lastTemporaries(odd, 6), lastTemporaries(odd, 0), lastTemporaries(plain, 1));

// A local dead at a loop's header that the loop never writes keeps its value past the loop.
function keeps(a, n) {
  var h = a[0] * 3;
  var s = 0;
  for (var j = 0; j < n; j++) s += a[j] * h;
  var w = 0.5 * n;
  for (var j = 0; j < n; j++) { var c = a[j] - w; s -= c; }
  return s;
}
var u = 0;
for (var k = 0; k < 500; k++) u += keeps(plain, 6);
print(u);

function toInt(x) { return x | 0; }
function compares(a, n, lo, hi) {
  var s = 0, c = 0;
  for (var i = 0; i < n; i++) {
    var x = a[i];
    if (x < lo) c += 1;
    if (x <= lo) c += 2;
    if (x > hi) c += 4;
    if (x >= hi) c += 8;
    s = (s + (x | 0)) | 0;
  }
  return s * 16 + c;
}
var b = [];
var special = [NaN, Infinity, -Infinity, 4294967296.5, -4294967296.5, 2147483648, -2147483649, 1e300, -1e300, 9223372036854775808, -9223372036854775808, 1.5, -1.5, 0.5, -0.0, 3e10, -3e10, 1e19, 123456789012345680000, 2.5, 7.5];
for (var i = 0; i < 100; i++) b[i] = special[i % special.length] + 0.0;
b[50] = 0.25;
var v = 0;
for (var k = 0; k < 500; k++) v = (v + compares(b, 100, 2.5, 7.5)) | 0;
var w = 0;
for (var k = 0; k < 3000; k++) w = (w + toInt(special[k % special.length] * 1.0001)) | 0;
print(v, w, compares(b, 100, NaN, 7.5), compares(b, 100, 2.5, NaN), compares(b, 21, -Infinity, Infinity));
for (var i = 0; i < special.length; i++) out = (i ? out + "," : "") + toInt(special[i]);
print(out);

function mixes(n) {
  var s = 0;
  for (var i = 0; i < n; i++) { var p = (i * 3) | 0; var q = (i * 5) ^ 0; s = (s + p - q) | 0; }
  return s;
}
var m = 0;
for (var k = 0; k < 400; k++) m += mixes(50);
print(m);
