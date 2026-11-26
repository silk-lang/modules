// Loops that count down with indexes proved in front of them, locals that are dead where
// compiled code leaves (the exit names undefined for them), a loop with more values than
// registers, and stores to an element the same turn read as a number.

// The multiply step of a big number: `while (--n >= 0)` with two indexes that step up.
function am(a, i, x, w, j, c, n) {
  var xl = x & 0x3fff, xh = x >> 14;
  while (--n >= 0) {
    var l = a[i] & 0x3fff;
    var h = a[i++] >> 14;
    var m = xh * l + h * xl;
    l = xl * l + ((m & 0x3fff) << 14) + w[j] + c;
    c = (l >> 28) + (m >> 14) + xh * h;
    w[j++] = l & 0xfffffff;
  }
  return c;
}
function down(a, b, n) { for (var i = n - 1; i >= 0; --i) a[i] = b[i]; }
function zero(a, n) { var i = n; while (--i >= 0) a[i] = 0; }
function above(a, n) { var s = 0; for (var i = n; i > 0; --i) s += a[i]; return s; }
function shift(a, b, n, k) { for (var i = n - 1; i >= 0; --i) a[i + k] = b[i]; }
function byTwo(a, n) { var s = 0; for (var i = n - 2; i >= 0; i -= 2) s = (s * 3 + a[i] + a[i + 1]) | 0; return s; }

var N = 24;
var a = [], w = [];
for (var i = 0; i < N; i++) a[i] = (i * 2654435761) & 0xfffffff;
for (var i = 0; i < 2 * N + 2; i++) w[i] = 0;
var sum = 0;
for (var r = 0; r < 200; r++) {
  zero(w, 2 * N);
  for (var k = 0; k < N; k++) w[k + N] = am(a, 0, a[k], w, k, 0, N);
  sum = (sum + w[r % (2 * N)] + above(w, N) + byTwo(a, N)) | 0;
}
print(sum, w[0], w[N], w[2 * N - 1]);
var c = [];
for (var i = 0; i < 40; i++) c[i] = i;
for (var r = 0; r < 200; r++) { down(c, w, 30); shift(c, w, 30, 7); sum = (sum + c[r % 37]) | 0; }
// Empty and single counts, then one past the end and an Array that grows.
down(c, w, 0); down(c, w, 1); zero(c, 0); zero(c, 1); shift(c, w, 0, 3); print(above(c, 0), byTwo(c, 1), byTwo(c, 0));
var d = [1, 2, 3];
down(d, w, 6); zero(d, 9);
print(sum, c[0], c[36], d.length, d[8], above(d, 12));
// Elements that are no int32 part of the way: the loop leaves with dead temporaries.
var mixed = a.slice();
mixed[5] = 1.5; mixed[9] = "7"; mixed[11] = { valueOf: function () { return 3; } };
var into = w.slice();
print(am(mixed, 0, 12345, into, 3, 1, N), into[4], into[9], into[13], into[20]);
into[14] = 2.25;
print(am(a, 2, 99999, into, 10, 0, 12), into[14], into[15]);
print(above(mixed, 12), byTwo(mixed, 12));

// Locals that die before a guard fails: each call leaves at another instruction.
function dies(x, y, arr) {
  var p = x * 3;
  var q = p + y;
  var e = arr[q & 7];
  var s = e + q;
  var t = s * 2;
  return t + e;
}
function sides(x, flag) {
  var t = x + 1;
  var r;
  if (flag) { r = t * 2; } else { r = x - 1; }
  return r + x;
}
function carried(arr) {
  var prev = 0, total = 0;
  for (var i = 0; i < arr.length; i++) {
    var cur = arr[i];
    var gap = cur - prev;
    total += gap * 2 + i;
    prev = cur;
  }
  return total + prev;
}
function kept(n, arr) {
  let k = n * 2;
  var get = function () { return k; };
  var s = 0;
  for (var i = 0; i < arr.length; i++) { let q = arr[i] + k; s += q; k = k + 1; }
  return s + get();
}
var ints = [3, 1, 4, 1, 5, 9, 2, 6];
var out = 0;
for (var r = 0; r < 300; r++) {
  out = (out + dies(r, r & 3, ints) + sides(r, (r & 1) === 0) + carried(ints) + kept(r & 15, ints)) | 0;
}
print(out);
var odd = [3, 1.5, "4", 1, { valueOf: function () { return 5; } }, 9, null, undefined];
for (var x = 0; x < 8; x++) print(dies(x, 1, odd), dies(715827882, x, ints), dies(x, 2147483647, ints), dies(x, x, [1073741823, 1073741823, 1073741823, 1073741823, 1073741823, 1073741823, 1073741823, 1073741823]));
print(sides(2147483647, true), sides(2147483647, false), sides(-2147483648, false), sides(-2147483648, true), sides(1073741823, true), sides(0.5, true), sides("a", false));
print(carried(odd), carried([1, 2, 2147483647, -2147483648, 5]), carried([1, "2", 3]), kept(7, odd), kept(1073741823, ints), kept(0.5, ints));

// An inlined body whose locals die, leaving after its store.
function inner(o, v) { var t = v * 2; o.count = o.count + 1; var u = t + o.extra; var z = u - v; return z + t; }
function outer(o, n) { var s = 0; for (var i = 0; i < n; i++) { s += inner(o, i); } return s; }
var box = { count: 0, extra: 5 };
for (var r = 0; r < 200; r++) out = (out + outer(box, 9)) | 0;
box.extra = 0.25; print(outer(box, 5), box.count);
box.extra = "x"; print(outer(box, 3), box.count);
box.extra = 2147483647; print(outer(box, 4), box.count);

// More values across a loop than registers: twelve sums, four Arrays, three factors.
function wide(p, q, r, s, n, f, g, h) {
  var a0 = 0, a1 = 1, a2 = 2, a3 = 3, a4 = 4, a5 = 5, a6 = 6, a7 = 7, a8 = 8, a9 = 9, a10 = 10, a11 = 11;
  for (var i = 0; i < n; i++) {
    var x = p[i], y = q[i], z = r[i];
    a0 = (a0 + x * f) | 0; a1 = (a1 + y * g) | 0; a2 = (a2 ^ (z * h)) | 0; a3 = (a3 + x - y) | 0;
    a4 = (a4 + (x & y)) | 0; a5 = (a5 + (y | z)) | 0; a6 = (a6 + a0 - a1) | 0; a7 = (a7 ^ a2) | 0;
    a8 = (a8 + (a3 >> 1)) | 0; a9 = (a9 + a4 * 3) | 0; a10 = (a10 - a5) | 0; a11 = (a11 + a6 + a7) | 0;
    s[i] = (a8 + a9 + a10 + a11) | 0;
  }
  return a0 + a1 + a2 + a3 + a4 + a5 + a6 + a7 + a8 + a9 + a10 + a11;
}
var p = [], q = [], rr = [], ss = [];
for (var i = 0; i < 32; i++) { p[i] = i * 7 + 1; q[i] = 100 - i * 3; rr[i] = (i * i) & 255; ss[i] = 0; }
for (var r = 0; r < 200; r++) out = (out + wide(p, q, rr, ss, 32, 3, 5, 7)) | 0;
print(out, ss[0], ss[31]);
q[17] = 0.5; print(wide(p, q, rr, ss, 32, 3, 5, 7), ss[17], ss[31]);
q[17] = 4; rr[30] = "9"; print(wide(p, q, rr, ss, 32, 2000000, 5, 7), ss[30], ss[31]);

// Stores to the element just read: numbers stay plain, anything counted is let go.
function bump(arr, n) { for (var i = 0; i < n; i++) arr[i] = arr[i] + 1; }
function half(arr, n) { for (var i = 0; i < n; i++) arr[i] = arr[i] * 0.5; }
function alias(x, y, i, v) { var e = x[i]; y[i] = v; x[i] = e + 1; return x[i]; }
var counts = [1, 2, 3, 4, 5, 6], halves = [1.5, 2.5, 3.5, 4, 5, 6.25];
for (var r = 0; r < 200; r++) { bump(counts, 6); half(halves, 6); alias(counts, halves, r % 6, r); }
print(counts.join(), halves.join());
var texts = [1, "two", { id: 3, toString: function () { return "o"; } }, 4, null, 6];
bump(texts, 6); bump(texts, 6); print(texts.join());
var same = [1, 2, 3];
print(alias(same, same, 1, "s"), alias(same, same, 2, { id: 1 }), alias(same, same, 0, 0.5), same.join());
half(texts, 6); print(texts.join());
