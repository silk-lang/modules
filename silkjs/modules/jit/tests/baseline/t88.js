// Counted loops whose element indexes the optimizer proves in front of the loop
// (ssa_opt_bounds): the ends of each index against the count once, then nothing in the loop.
// Every loop here also runs where the proof fails, and must then give what the interpreter
// gives: past the end, before the start, with an Array that grows or a limit above it.

function sum3(a, from, to) {
  var s = 0;
  for (var i = from; i <= to; i++) s += a[i - 1] + a[i] + a[i + 1];
  return s;
}
function sumBelow(a, n) {
  var s = 0;
  for (var i = 0; i < n; i++) s += a[i];
  return s;
}
function stride(a, n) {
  var s = 0, p = 0, q = 1;
  for (var i = 0; i < n; i++) { s += a[p] - a[q]; p += 2; q += 3; }
  return s;
}
function relax(x, x0, w, h) {
  var rowSize = w + 2;
  for (var j = 1; j <= h; j++) {
    var last = (j - 1) * rowSize, cur = j * rowSize, next = (j + 1) * rowSize;
    var lastX = x[cur];
    ++cur;
    for (var i = 1; i <= w; i++) lastX = x[cur] = (x0[cur] + 0.25 * (lastX + x[++cur] + x[++last] + x[++next])) * 0.5;
  }
}
function fill(a, n, v) {
  for (var i = 0; i < n; i++) a[i] = v + i;
  return a.length;
}
function once(a, i, n) {
  var s = 0;
  do { s += a[i]; i++; } while (i < n);
  return s;
}
function upTo(a, from, to) {
  var s = 0;
  for (var i = from; i <= to; i++) s += a[i] === undefined ? 1 : 2;
  return s;
}
function outer(a, w, h) {
  var s = 0;
  for (var j = 0; j < h; j++) {
    for (var i = 0; i < w; i++) s += a[j] * (i + 1);
  }
  return s;
}

var a = [];
for (var i = 0; i < 64; i++) a[i] = i * 0.5 + 1;
var ints = [];
for (var i = 0; i < 64; i++) ints[i] = i * 3;
var total = 0;
for (var k = 0; k < 300; k++) {
  total += sum3(a, 1, 62) + sumBelow(a, 64) + sumBelow(ints, 64) + stride(a, 21) + once(a, 3, 40) + outer(ints, 7, 9);
}
print(total);

// The same loops where an end is no index.
print(sum3(a, 0, 62));          // a[-1]
print(sum3(a, 1, 63));          // a[64]
print(sumBelow(a, 65));
print(sumBelow(ints, 70));
print(stride(a, 22));           // q reaches 64
print(once(a, 70, 40));         // one turn, past the end
print(once(a, 10, 5));          // one turn, the trip bound below zero
print(outer(ints, 3, 66));
function finite(v) { return v === v ? v : 0.5; }
for (var k = 0; k < 200; k++) total += finite(sum3(a, k & 1, 62));
for (var k = 0; k < 200; k++) total += finite(sumBelow(a, 60 + (k & 7)));
for (var k = 0; k < 200; k++) total += finite(stride(a, 20 + (k & 3)));
print(total);

// A loop that appends: the store past the count leaves compiled code each time.
var grown = [];
var lengths = 0;
for (var k = 0; k < 120; k++) { grown = [1, 2, 3]; lengths += fill(grown, 3 + (k % 5), k); }
print(lengths, grown.length, grown[grown.length - 1]);

// Counters at the top of the int32 range: the proved adds must not wrap.
print(upTo(a, 2147483640, 2147483646));
print(upTo(a, 2147483645, 2147483647));
for (var k = 0; k < 150; k++) total += upTo(a, 60, 66);
print(total, upTo(a, 2147483646, 2147483647));

// Elements that are not numbers, a hole, and an Array of another kind.
var mixed = [1, 2.5, "x", 4, , 6];
function join(a, n) { var s = ""; for (var i = 0; i < n; i++) s += a[i]; return s; }
var text = "";
for (var k = 0; k < 150; k++) text = join(mixed, 6);
print(text, join(mixed, 8));
var sparse = []; sparse[5] = 1; sparse[900] = 2;
print(sumBelow(sparse, 6), sumBelow({ 0: 4, 1: 5, length: 2 }, 2));

// The relaxation step of a fluid solver, on grids of two sizes and on one too small.
var w = 14, h = 9;
var x = [], x0 = [];
for (var i = 0; i < (w + 2) * (h + 2); i++) { x[i] = (i % 7) * 0.125; x0[i] = (i % 5) * 0.5; }
for (var k = 0; k < 120; k++) relax(x, x0, w, h);
var check = 0;
for (var i = 0; i < x.length; i++) check += x[i] * (i + 1);
print(check);
var small = x.slice(0, 100);
relax(small, x0, w, h);
check = 0;
for (var i = 0; i < small.length; i++) check += (small[i] === small[i] ? small[i] : -1) * (i + 1);
print(check, small.length);
for (var k = 0; k < 60; k++) relax(x, x0, w, h - (k & 1));
check = 0;
for (var i = 0; i < x.length; i++) check += x[i] * (i + 1);
print(check);
