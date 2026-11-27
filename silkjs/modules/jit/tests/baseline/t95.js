// Loops that read an element and store a number to the same one: the store writes where
// the read found the element and reads no index of its own (a plain store), so the index
// may be counted up in place before it. Around it: stores that are not plain, values that
// are no Int, and ways out between the read and the store.

function keep(v) { return v; }
// A carry through digits, as a big number's multiply has it.
function carry(w, n, c) { var j = 0; while (--n >= 0) { var l = w[j] + c; c = l >> 4; w[j++] = l & 15; } return keep(c); }
function carryFor(w, n, c) { for (var j = 0; j < n; j++) { var l = (w[j] * 3 + c) | 0; c = l >> 6; w[j] = l & 63; } return keep(c); }
function down(w, n) { var s = 0; for (var j = n - 1; j >= 0; j--) { var l = w[j]; w[j] = (l ^ j) & 255; s = (s + l) | 0; } return keep(s); }
// The index is read again after the store, and after the loop.
function after(w, n) { var s = 0; var j = 0; while (j < n) { var l = w[j]; w[j] = (l + 1) & 1023; s = (s + j * l) | 0; j++; } return keep(s + j); }
// The sum may overflow after the index was counted up: the store's index is the old one.
function late(w, n, c) { var j = 0; while (--n >= 0) { var l = w[j]; w[j++] = (l + c) + 1; } return keep(j); }
// The sum may overflow after the store: the index the interpreter goes on with is the new one.
function later(w, n, c) { var j = 0; var s = 0; while (--n >= 0) { var l = w[j]; w[j++] = l & 7; s = s + c + l; } return keep(s + j); }
// Not plain: another index, another Array read between, two Arrays that may be one.
function next(w, n) { for (var j = 0; j + 1 < n; j++) { var l = w[j]; w[j + 1] = (l + w[j + 1]) & 255; } return keep(w[n - 1]); }
function between(w, x, n) { var i = n; for (var j = 0; j < n; j++) { var l = w[j]; var m = x[--i]; w[j] = (l + m) & 255; } return keep(w[0] + w[n - 1]); }
function crossed(w, x, n) { for (var j = 0; j < n; j++) { var l = w[j]; x[j] = (l + 1) & 255; w[j] = (l + x[j]) & 255; } return keep(w[0] + x[n - 1]); }
// Values that are no Int: a double, a boolean, a double made of the Int.
function halves(w, n) { for (var j = 0; j < n; j++) { var l = w[j]; w[j] = l * 0.5; } return keep(w[0] + w[n - 1]); }
function flags(w, n) { var s = 0; for (var j = 0; j < n; j++) { var l = w[j]; w[j] = l > 4; s += l; } return keep(s); }
function grows(w, n) { for (var j = 0; j < n; j++) { var l = w[j]; w[j] = l * 65536; } return keep(w[n - 1]); }

function digits(n, seed) { var a = []; for (var i = 0; i < n; i++) a[i] = (seed * (i + 3) + i * i) & 15; return a; }
function show(a) { return a.length + ":" + a.join(); }

var sum = 0;
for (var r = 0; r < 300; r++) {
  var n = 6 + (r % 7);
  var a = digits(n, r);
  sum = (sum + carry(a, n, r & 31) + a[0] + a[n - 1]) | 0;
  sum = (sum + carryFor(a, n, r & 7) + a[1]) | 0;
  sum = (sum + down(a, n) + a[2]) | 0;
  sum = (sum + after(a, n) + a[3]) | 0;
  sum = (sum + late(a, n, r) + a[4]) | 0;
  sum = (sum + later(a, n, r) + a[5]) | 0;
  sum = (sum + next(a, n)) | 0;
  sum = (sum + between(a, digits(n, r + 1), n)) | 0;
  sum = (sum + crossed(a, digits(n, r + 2), n) + crossed(a, a, n)) | 0;
  sum = (sum + halves(digits(n, r), n) * 2 + flags(digits(n, r), n) + grows(digits(n, r), n)) | 0;
}
print(sum);
var b = digits(9, 5);
print(show(b), carry(b, 9, 77), show(b), carry(b, 0, 3), carry(b, 1, 1000000), show(b));
print(carryFor(b, 9, 5), show(b), down(b, 9), show(b), after(b, 9), show(b));
// Elements that are no Int at the read: a double, a string, undefined, an object.
var mixed = [1, 2.5, 3, "4", 5, undefined, 7, { valueOf: function () { return 2; } }, 9];
print(carry(mixed.slice(), 9, 1), show(mixed), carryFor(mixed.slice(), 9, 1), after(mixed.slice(), 5));
var m2 = mixed.slice();
print(carry(m2, 9, 3), show(m2));
var m3 = mixed.slice();
print(down(m3, 9), show(m3), after(m3, 9), show(m3));
// The sum overflows part of the way: what was stored before stays, the rest goes on.
var big = [1, 2, 2147483646, 4, 5, 6];
print(late(big, 6, 0), show(big), late(big, 6, 2147483000), show(big));
var big2 = [1, 2, 3, 4, 5, 6];
print(later(big2, 6, 2147483640), show(big2), later(big2, 6, 1073741823.5), show(big2));
// A missing element, an Array too short, a count below zero.
var holes = [1, 2, , 4, 5];
print(carry(holes, 5, 0), show(holes), carry([1, 2], 4, 9), carry([1, 2], -1, 9));
// One Array on both sides, and Arrays that are not: a typed array, an object with indexes.
var one = [3, 1, 4, 1, 5, 9, 2, 6];
print(next(one, 8), show(one), between(one, one, 8), show(one), crossed(one, one, 8), show(one));
var typed = new Int32Array([5, 6, 7, 8]);
print(carry(typed, 4, 2), typed.join(), carry({ 0: 9, 1: 9, length: 2 }, 2, 1));
// Doubles and booleans stored where Ints were, then read again.
var h = [2, 4, 5, 8];
print(halves(h, 4), show(h), halves(h, 4), show(h), flags(h, 4), show(h), flags(h, 4), show(h));
var g = [1, 2, 3];
print(grows(g, 3), show(g), grows(g, 3), show(g), grows(g, 3), show(g));
// A setter on the prototype chain is not asked for an index the Array has.
var seen = [];
Object.defineProperty(Array.prototype, 2, { set: function (v) { seen.push(v); }, get: function () { return 1; }, configurable: true });
var p = digits(6, 2);
print(carry(p, 6, 4), show(p), seen.length);
delete Array.prototype[2];
var frozen = Object.freeze([1, 2, 3]);
print(carry(frozen, 3, 5), show(frozen));
