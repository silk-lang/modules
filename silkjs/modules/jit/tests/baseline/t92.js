// Products whose zero is or is not -0 to their one reader: a bit operation, a shift, a
// compare, a sum that takes the product first or second, a difference, two products added,
// a product kept in a local, passed to a function, and stored. 1 / x tells the zeros apart.
// Each function calls `keep`, for a leaf this small is never compiled on its own.

function keep(v) { return v; }
function bits(a, b) { return keep(((a * b) | 0) + ((a * b) & 255) + ((a * b) >> 1) + ((a * b) >>> 0) + ((a * b) ^ 3) + (7 << (a * b))); }
function less(a, b, c) { var n = 0; if (a * b < c) n += 1; if (a * b == 0) n += 2; if (c >= a * b) n += 4; if (a * b === c) n += 8; return keep(n); }
function second(x, a, b) { return keep(1 / (x + a * b)); }
function minus(x, a, b) { return keep(1 / (x - a * b)); }
function first(a, b, x) { return keep(1 / (a * b + x)); }
function firstMinus(a, b, x) { return keep(1 / (a * b - x)); }
function both(a, b, c, d) { return keep(1 / (a * b + c * d)); }
function three(a, b, c, d, e, f) { return keep(1 / (a * b + c * d + e * f)); }
function local(a, b) { var t = a * b; var u = t + 0; return keep(1 / t + 1 / u); }
function twice(a, b) { var t = a * b; return keep(1 / (t + t)); }
function inv(x) { return 1 / x; }
function passed(a, b) { return keep(inv(a * b)); }
function passedSum(a, b, c) { return keep(inv(c + a * b) + inv(a * b + c)); }
function stored(arr, a, b) { arr[0] = a * b; return keep(1 / arr[0]); }
function fromElement(arr, i, a, b) { return keep(1 / (a * b + arr[i])); }
function toElement(arr, i, a, b) { return keep(1 / (arr[i] + a * b)); }
function fromField(o, a, b) { return keep(1 / (a * b + o.v) + 1 / (o.v + a * b)); }
function chain(a, b, c) { var m = a * b + c * b; return keep((m & 16383) + (m >> 14) + 1 / m); }
function carry(l, m, xh, h) { return keep((l >> 28) + (m >> 14) + xh * h); }
function shifted(a, b) { return keep(1 / ((a * b) >> 0) + 1 / ((a * b) << 0) + 1 / (~(a * b))); }
function negated(a, b) { return keep(1 / -(a * b)); }
function rest(a, b) { return keep(1 / ((a * b) % 5)); }
function loop(arr, k) { var s = 0; for (var i = 0; i < arr.length; i++) s = (s + arr[i] * k) | 0; return keep(s); }
function loopSum(arr, k) { var s = 0; for (var i = 0; i < arr.length; i++) s = s + arr[i] * k; return keep(1 / s); }
function loopFirst(arr, k) { var s = 0; for (var i = 0; i < arr.length; i++) s = arr[i] * k + s; return keep(1 / s); }

// The products of the warm-up are never zero, so every site stays an int32 site.
var ints = [3, 1, -4, 7, 2, -1, 2, 5];
var out = 0;
for (var r = 0; r < 400; r++) {
  var a = ((r % 7) - 3) | 1, b = ((r % 5) - 2) | 1;
  out = (out + bits(a & 3, b & 1) + less(a, b, r % 3) + loop(ints, a) + carry(r << 20, r * 37, a, b) + chain(a, b, 3)) | 0;
  out = (out + (second(1, a, b) > 0 ? 1 : 2) + (first(a, b, 1) > 0 ? 1 : 2) + (minus(100, a, b) > 0 ? 1 : 2) + (both(a, b, a, b) > 0 ? 1 : 2)) | 0;
  out = (out + (local(a, b) > 0 ? 1 : 2) + (twice(a, b) > 0 ? 1 : 2) + (passed(a, b) > 0 ? 1 : 2) + (stored([1], a, b) > 0 ? 1 : 2)) | 0;
  out = (out + (fromElement(ints, 0, a, b) > 0 ? 1 : 2) + (toElement(ints, 0, a, b) > 0 ? 1 : 2) + (fromField({ v: 4 }, a, b) > 0 ? 1 : 2) + (passedSum(a, b, 9) > 0 ? 1 : 2)) | 0;
  out = (out + (firstMinus(a, b, 50) > 0 ? 1 : 2) + (three(a, b, 1, 1, 2, 2) > 0 ? 1 : 2) + (shifted(a, b) > 0 ? 1 : 2) + (negated(a, b) > 0 ? 1 : 2) + (rest(a, 7) > 0 ? 1 : 2)) | 0;
  out = (out + (loopSum(ints, a) > 0 ? 1 : 2) + (loopFirst(ints, a) > 0 ? 1 : 2)) | 0;
}
print(out);
// Every zero: 0 * negative and negative * 0 are -0.
var zeros = [[0, -5], [-5, 0], [0, 5], [5, 0], [0, 0], [-1, 1], [0, -2147483648], [-2147483648, 0], [65536, 65536], [-65536, 65536], [46341, 46341]];
for (var z = 0; z < zeros.length; z++) {
  var p = zeros[z][0], q = zeros[z][1];
  print(p, q, bits(p, q), less(p, q, 0), less(p, q, -1), shifted(p, q), negated(p, q), rest(p, q));
  print(second(0, p, q), second(5, p, q), minus(0, p, q), minus(-3, p, q), first(p, q, 0), first(p, q, 2), firstMinus(p, q, 0), firstMinus(p, q, 1));
  print(both(p, q, p, q), both(p, q, 0, 1), both(0, 1, p, q), both(p, q, 0, -1), both(0, -1, p, q), three(p, q, 0, -1, -1, 0), three(p, q, 1, 0, 0, -7), three(0, 1, p, q, q, p));
  print(local(p, q), twice(p, q), passed(p, q), passedSum(p, q, 0), stored([1], p, q), stored([0.5], p, q), chain(p, q, p), chain(p, q, 0), carry(0, 0, p, q), 1 / carry(0, 0, p, q));
  print(fromElement([0], 0, p, q), fromElement([-0], 0, p, q), fromElement(["x"], 0, p, q), fromElement([0.5], 0, p, q), fromElement([], 0, p, q), toElement([-0], 0, p, q), toElement([0], 0, p, q), toElement([null], 0, p, q));
  print(fromField({ v: -0 }, p, q), fromField({ v: 0 }, p, q), fromField({ w: 1, v: -0 }, p, q), fromField({ v: "" }, p, q), loopSum([0, -0, 0], p), loopSum([p, q], -1), loopFirst([p, q], -3), loopFirst([0, 0], q), loop([p, q, -0], q));
}
// A second operand the interpreter computes after the product was made.
var neg = { valueOf: function () { return -0; } };
print(first(0, -1, neg), first(0, -1, -0), first(-1, 0, "0"), first(0, -1, undefined), second(neg, 0, -1), second(-0, 0, -1), minus(-0, 0, 1), minus(-0, 0, -1), firstMinus(0, -1, neg), both(0, -1, neg, 1));
print(less(0, -1, neg), less(0, -1, "0"), less(-0, 5, -0), bits(0.5, 2), bits(-0, 3), bits("2", -0), shifted(0, -0.5), passed(0, -0.5), local(-0, 1), twice(0.5, -0));
