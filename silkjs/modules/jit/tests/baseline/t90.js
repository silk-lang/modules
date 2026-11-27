// Counted loops whose accesses read their Array's elements as a value loaded in front of the
// loop: copies of numbers, strings and objects (the read borrows up to the store), an Array
// copied onto itself and shifted within itself, moves that leave a constant behind, constants
// over counted values, indexes made by additions next to counted accesses, and differences
// whose operands end at them.

function copy(a, b, n) {
  for (var i = 0; i < n; i++) a[i] = b[i];
}
function shiftDown(a, n) {
  for (var i = 0; i < n; i++) a[i] = a[i + 1];
}
function shiftUp(a, n) {
  for (var i = 0; i < n; i++) a[i + 1] = a[i];
}
function move(a, b, n) {
  for (var i = 0; i < n; i++) { a[i] = b[i]; b[i] = 0; }
}
function fill(a, n) {
  for (var i = 0; i < n; i++) a[i] = 0;
}
function fillBelow(a, n) {
  for (var i = 0; i < n; i++) a[i] = -7;
}
function fillTwo(a, b, n) {
  for (var i = 0; i < n; i++) { a[i] = 1073741824; b[i] = a[i] + i; }
}
function add(x, s, dt, n) {
  for (var i = 0; i < n; i++) x[i] += dt * s[i];
}
function same(a, b, n) {
  var k = 0;
  for (var i = 0; i < n; i++) { a[i] = b[i]; if (a[i] === b[i]) k++; }
  return k;
}
function show(a) {
  var s = "";
  for (var i = 0; i < a.length; i++) {
    var v = a[i];
    s += (typeof v === "object" && v !== null ? "{" + v.id + "}" : String(v)) + (i + 1 < a.length ? "," : "");
  }
  return s;
}
function texts(n, tag) {
  var a = [];
  for (var i = 0; i < n; i++) a[i] = tag + i * 3;
  return a;
}
function things(n) {
  var a = [];
  for (var i = 0; i < n; i++) a[i] = { id: i * 2 };
  return a;
}
function numbers(n, by) {
  var a = [];
  for (var i = 0; i < n; i++) a[i] = i * by + 0.5;
  return a;
}

// Bilinear reads: four indexes made by additions, between two reads through elements.
function blend(d, d0, u, w, h) {
  var rowSize = w + 2, miss = 0;
  for (var j = 1; j <= h; j++) {
    var pos = j * rowSize;
    for (var i = 1; i <= w; i++) {
      var x = i - 0.75 * u[++pos];
      var y = j - 0.5 * u[pos];
      if (x < 0.5) x = 0.5; else if (x > w + 0.5) x = w + 0.5;
      if (y < 0.5) y = 0.5; else if (y > h + 0.5) y = h + 0.5;
      var i0 = x | 0, i1 = i0 + 1, j0 = y | 0, j1 = j0 + 1;
      var s1 = x - i0, s0 = 1 - s1, t1 = y - j0, t0 = 1 - t1;
      var row1 = j0 * rowSize, row2 = j1 * rowSize;
      d[pos] = s0 * (t0 * d0[i0 + row1] + t1 * d0[i0 + row2]) + s1 * (t0 * d0[i1 + row1] + t1 * d0[i1 + row2]);
    }
  }
  return miss;
}
// Differences and quotients whose operands end at them, either side.
function differences(a, b, n) {
  var total = 0;
  for (var i = 0; i < n; i++) {
    var p = a[i], q = b[i];
    var x = i - p * q;
    var y = 3 - x;
    var z = (p - q) - (q - x);
    var w = x / (y - z + 0.125);
    var m = (i - n) - (n - i) * 2;
    total += x + y * 2 + z * 3 + w * 5 + m;
  }
  return total;
}

var out = 0;
for (var round = 0; round < 150; round++) {
  var a = numbers(9, 1), b = numbers(9, 2.5);
  copy(a, b, 9); add(a, b, 0.5, 9); add(a, a, 0.25, 9); out += a[8] + a[0];
  fill(b, 9); fillBelow(a, 4); fillTwo(a, b, 3); out += a[2] + b[2] + a[3] + b[8];
}
print(out);
var last = "";
for (var round = 0; round < 150; round++) {
  var s = texts(8, "s" + round + "_"), o = things(8), n = numbers(8, 1);
  copy(n, s, 8);                 // strings over numbers
  copy(s, s, 8);                 // onto itself: the Array owns each string alone
  copy(o, n, 5);                 // strings over objects
  shiftDown(s, 7);               // a[i] = a[i + 1]
  shiftUp(o, 7);                 // a[i + 1] = a[i]
  var t = texts(8, "t" + round + "_"), u = things(8);
  move(u, t, 8);                 // the strings change owner, zeros stay behind
  var k = same(n, u, 8);
  fill(o, 3); fillBelow(s, 2);   // constants over objects and strings
  last = show(s) + " | " + show(o) + " | " + show(t) + " | " + show(n) + " | " + k;
}
print(last);
// Mixed Arrays: numbers, strings, objects, undefined and null.
var mixed = [1, "two", { id: 3 }, undefined, null, 4.5, "six" + last.length, { id: 7 }];
var into = things(8);
for (var round = 0; round < 120; round++) { copy(into, mixed, 8); copy(mixed, into, 8); shiftDown(into, 7); }
print(show(into), "|", show(mixed), same(into, mixed, 8));

var w = 10, h = 7, size = (w + 2) * (h + 2);
var d = numbers(size, 0), d0 = numbers(size, 0.25), u = [];
for (var i = 0; i < size; i++) u[i] = ((i * 7) % 11) * 0.5 - 2;
for (var round = 0; round < 150; round++) { blend(d, d0, u, w, h); blend(d0, d, u, w, h); }
var sum = 0;
for (var i = 0; i < size; i++) sum += d[i] * (i % 5) + d0[i];
print(sum);
// A field that does not hold doubles everywhere, and one too short for its last row.
d0[40] = "2.5"; d0[41] = { valueOf: function () { return 1.5; } };
blend(d, d0, u, w, h);
print(d[40], d[53], d[30]);
var short = numbers(size - w, 0.5);
blend(d, short, u, w, h);
print(String(d[size - w - 4]), d[20]);

var p = numbers(40, 0.75), q = numbers(40, -1.25);
var total = 0;
for (var round = 0; round < 150; round++) total += differences(p, q, 40);
print(total);
q[11] = "4"; p[12] = null;
print(differences(p, q, 40));
