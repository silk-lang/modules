// Sums and differences that take an Array element's number where the element is: the
// add after the read of an element nothing else reads (x64_regalloc.foldedUnbox). An
// overflow leaves with the number written to its slot and the sum undone; an element
// that is no Int leaves at the read.

function keep(v) { return v; }
function total(a, n) { var s = 0; for (var i = 0; i < n; i++) s = s + a[i]; return keep(s); }
function totalFirst(a, n) { var s = 0; for (var i = 0; i < n; i++) s = a[i] + s; return keep(s); }
function less(a, n, s) { for (var i = 0; i < n; i++) s = s - a[i]; return keep(s); }
function lessFirst(a, n, s) { for (var i = 0; i < n; i++) s = a[i] - s; return keep(s); }
// The sum goes to another value, so the first operand lives on.
function pairs(a, n, k) { var s = 0; for (var i = 0; i < n; i++) { var t = k + a[i]; s = (s ^ t) + (k & 3); k = (k + 1) | 0; } return keep(s + k); }
// Two elements in one sum, an element twice, an element and a constant, an element read twice.
function both(a, b, n) { var s = 0; for (var i = 0; i < n; i++) s = (s + a[i] + b[i]) | 0; return keep(s); }
function twice(a, n) { var s = 0; for (var i = 0; i < n; i++) { var v = a[i]; s = (s + v + v) | 0; } return keep(s); }
function plusOne(a, n) { var s = 0; for (var i = 0; i < n; i++) s = (s + (a[i] + 1)) | 0; return keep(s); }
function doubled(a, n) { var s = 0; for (var i = 0; i < n; i++) s = (s + (a[i] + a[i])) | 0; return keep(s); }
// A carry, as a big number's add has it: the element is added to and stored back.
function carry(r, a, n) { var c = 0; for (var i = 0; i < n; i++) { c = c + a[i]; c = c + r[i]; r[i] = c & 255; c = c >> 8; } return keep(c); }
// Many values at once, so that some live in slots.
function crowd(a, n, p, q, r, t) {
  var s = 0, u = 1, v = 2, w = 3, x = 4;
  for (var i = 0; i < n; i++) { u = (u + p) | 0; v = (v ^ q) | 0; w = (w + r) | 0; x = (x ^ t) | 0; s = s + a[i]; s = (s + (u & v) + (w & x)) | 0; }
  return keep(s + u + v + w + x);
}

function ints(n, seed) { var a = []; for (var i = 0; i < n; i++) a[i] = (seed * (i + 7) + i * i * 3) & 1023; return a; }

var sum = 0;
for (var r = 0; r < 300; r++) {
  var n = 5 + (r % 9);
  var a = ints(n, r);
  var b = ints(n, r + 5);
  sum = (sum + total(a, n) + totalFirst(a, n) + less(a, n, r) + lessFirst(a, n, r)) | 0;
  sum = (sum + pairs(a, n, r) + both(a, b, n) + twice(a, n) + plusOne(a, n) + doubled(a, n)) | 0;
  sum = (sum + carry(b, a, n) + b[0] + b[n - 1] + crowd(a, n, r, 3, 5, r + 1)) | 0;
}
print(sum);
var big = [2147483000, 600, 47, 1, 2147483647, -5];
print(total(big, 6), totalFirst(big, 6), total(big, 3), total(big, 2), totalFirst(big, 3));
print(less(big, 6, -10), less(big, 2, -2147483000), lessFirst(big, 6, 3), less([1, -2147483648, 2], 3, 0));
print(pairs(big, 6, 2147483000), pairs(big, 6, 646), both(big, big, 6), twice(big, 6), plusOne(big, 6), doubled(big, 6));
var neg = [-2147483648, -1, -2147483648, 5];
print(total(neg, 4), totalFirst(neg, 4), less(neg, 4, 0), crowd(big, 6, 1, 2, 3, 4), crowd(neg, 4, 2147483647, 1, 2147483647, 1));
// Elements that are no Int: the read leaves and the interpreter adds.
var mixed = [1, 2.5, "3", 4, undefined, 5, null, true, { valueOf: function () { return 7; } }, -0];
print(total(mixed, 4), totalFirst(mixed, 4), total(mixed, 10), totalFirst(mixed, 10), less(mixed, 4, 100), lessFirst(mixed, 3, 1));
print(1 / total([-0], 1), 1 / totalFirst([-0], 1), 1 / less([0], 1, -0), 1 / total([0, -0], 2), pairs(mixed, 2, 1), both(mixed, big, 2));
var holes = [1, , 3];
print(total(holes, 3), total([1, 2], 5), total([], 0), total([7], 1), totalFirst([7, 8], -1));
var r1 = [250, 250, 250, 250];
print(carry(r1, [10, 10, 10, 10], 4), r1.join(), carry(r1, [2147483647, 1, 2, 3], 4), r1.join(), carry(r1, [1.5, 1, "2", 3], 4), r1.join());
// One Array on both sides, a typed array, a string.
var same = [1, 2, 3, 4, 5];
print(both(same, same, 5), carry(same, same, 5), same.join(), total(new Int32Array([5, 6, 7]), 3), total("abc", 3), total(new Float64Array([1.5, 2.5]), 2));
