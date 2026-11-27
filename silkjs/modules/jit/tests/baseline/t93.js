// Loops that fill an Array past its end: the front block grows the Array when the loop
// stores to every index and cannot leave (grow.bound), and leaves it alone when an index
// would stay without a store, when the Array may not grow, or when the loop does more.

function keep(v) { return v; }
// From the top down, as a big number's digits are cleared and copied.
function zero(a, n) { var i = n; while (--i >= 0) a[i] = 0; return keep(a); }
function copyDown(r, s, n) { for (var i = n - 1; i >= 0; --i) r[i] = s[i]; return keep(r); }
function shiftDown(r, s, n, k) { for (var i = n - 1; i >= 0; --i) r[i + k] = s[i]; return keep(r); }
function fillDown(a, n, v) { for (var i = n - 1; i >= 0; --i) a[i] = v; return keep(a); }
// Down to an index that is not 0: the ones below stay missing.
function downTo(a, n, low) { for (var i = n - 1; i >= low; --i) a[i] = i; return keep(a); }
// From the bottom up.
function fillUp(a, from, n, v) { for (var i = from; i < n; i++) a[i] = v; return keep(a); }
function copyUp(r, s, n) { for (var i = 0; i < n; i++) r[i] = s[i]; return keep(r); }
// Two counters: one counts the turns, the other the index.
function twoDown(a, n, j) { while (--n >= 0) a[j++] = n; return keep(a); }
// Loops that do more than fill: the length read in the loop, a store on every other turn,
// a second way out, a second Array.
function lengths(a, n) { var s = 0; var i = n; while (--i >= 0) { s += a.length; a[i] = 0; } return keep(s); }
function sometimes(a, n) { for (var i = n - 1; i >= 0; --i) { if (i & 1) a[i] = i; } return keep(a); }
function leavesEarly(a, n, stop) { for (var i = n - 1; i >= 0; --i) { if (i == stop) break; a[i] = i; } return keep(a); }
function two(a, b, n) { for (var i = n - 1; i >= 0; --i) { a[i] = i; b[i] = -i; } return keep(a); }
function sums(a, n) { var s = 0; for (var i = n - 1; i >= 0; --i) { a[i] = i; s = (s + i * 3) | 0; } return keep(s); }

function show(a) {
  var holes = 0;
  for (var i = 0; i < a.length; i++) if (!(i in a)) holes++;
  return a.length + ":" + holes + ":" + Object.keys(a).length + ":" + JSON.stringify(a.length > 12 ? [a[0], a[1], a[a.length - 2], a[a.length - 1]] : a);
}

var src = [];
for (var i = 0; i < 40; i++) src[i] = i * 7 + 1;
var sum = 0;
function round(r) {
  var n = 8 + (r % 9);
  var a = zero([], n);
  var b = copyDown([], src, n);
  var c = shiftDown([], src, n, 0);
  var d = fillDown([], n, r);
  var e = fillUp([], 0, n, r);
  var f = copyUp([], src, n);
  var g = twoDown([], n, 0);
  var h = [];
  var s = lengths(h, n) + sums([], n);
  var m = two([], [], n);
  sum = (sum + a.length + b[n - 1] + c[0] + d[n - 1] + e[0] + f[n - 1] + g[0] + h.length + s + m[n - 1]) | 0;
  // Arrays that hold something already: shorter, as long, longer.
  var p = [1, 2, 3];
  zero(p, n); copyDown(p, src, 2); copyDown(p, src, n + 4); fillUp(p, p.length, p.length + 3, "x");
  sum = (sum + p.length + p[n + 3] + p[1]) | 0;
}
for (var r = 0; r < 300; r++) round(r);
print(sum);
print(show(zero([], 5)), show(zero([], 0)), show(zero([], 1)), show(zero([9, 9, 9], 2)), show(zero([9, 9, 9], 3)), show(zero([9, 9, 9], 7)));
print(show(copyDown([], src, 6)), show(copyDown([5], src, 1)), show(copyDown([], src, 0)), show(copyDown([], src, -3)));
print(show(fillDown([], 4, "s")), show(fillDown([], 3, { a: 1 })), show(fillDown([], 3, 1.5)), show(fillDown([], 2, undefined)), show(fillDown([1], 3, null)));
// A shift leaves the indexes below it missing on a fresh Array, and none on one long enough.
print(show(shiftDown([], src, 4, 3)), show(shiftDown([1, 2, 3], src, 4, 3)), show(shiftDown([1, 2], src, 4, 3)), show(shiftDown([1, 2, 3, 4], src, 4, 3)));
print(show(downTo([], 6, 2)), show(downTo([1, 2], 6, 2)), show(downTo([1], 6, 2)), show(downTo([], 6, 0)), show(downTo([], 2, 5)));
print(show(fillUp([], 0, 5, 1)), show(fillUp([], 2, 5, 1)), show(fillUp([7, 7], 2, 5, 1)), show(fillUp([7, 7], 1, 5, 1)), show(fillUp([7], 3, 5, 1)), show(fillUp([], 3, 3, 1)), show(fillUp([], 5, 3, 1)));
print(show(copyUp([], src, 5)), show(copyUp([1, 2, 3, 4, 5, 6, 7], src, 5)), show(twoDown([], 4, 0)), show(twoDown([], 4, 2)), show(twoDown([1, 2], 4, 2)), show(twoDown([], 0, 0)));
// One Array as both sides: the reads are of the elements it had.
var same = [1, 2, 3, 4];
print(show(copyDown(same, same, 4)), show(shiftDown(same, same, 4, 2)), show(shiftDown(same, same, 6, 1)), show(copyUp(same, same, 7)));
var over = [1, 2, 3];
print(show(shiftDown(over, over, 3, 5)), show(copyDown(over, src, 12)));
// Loops that are no fill keep what the stores themselves make.
print(lengths([], 5), lengths([1, 2, 3, 4, 5, 6], 5), show(sometimes([], 6)), show(leavesEarly([], 6, 2)), show(leavesEarly([], 6, -1)), show(two([], [1, 2, 3, 4, 5, 6], 4)), sums([], 6));
// Arrays that may not grow, or not that way.
var sealed = Object.preventExtensions([1, 2]);
print(show(zero(sealed, 5)), show(fillUp(sealed, 2, 4, 1)));
var frozen = Object.freeze([1, 2]);
print(show(zero(frozen, 5)));
var fixed = [1, 2];
Object.defineProperty(fixed, "length", { writable: false });
print(show(zero(fixed, 5)), show(zero(fixed, 2)));
var named = [1];
named.extra = "e";
print(show(zero(named, 4)), named.extra);
var long = [];
long.length = 10;
print(show(zero(long, 4)), show(zero(long, 12)));
var sparse = [];
sparse[20] = 1;
print(show(zero(sparse, 6)), show(fillUp(sparse, 21, 24, 2)));
function Sub() {}
Sub.prototype = [];
var sub = new Sub();
zero(sub, 3);
print(sub.length, sub[2], Object.keys(sub).join());
var typed = new Int32Array(4);
print(zero(typed, 6).join(), fillDown({ length: 0 }, 3, 1)[2], zero("text", 2));
// A setter and a value on the prototype chain take the stores of missing indexes.
var seen = [];
Object.defineProperty(Array.prototype, 3, { set: function (v) { seen.push(v); }, get: function () { return "g"; }, configurable: true });
var proto = zero([], 6);
print(show(proto), seen.join(), proto[3], show(fillUp([], 0, 5, 4)), seen.join(), show(copyDown([], src, 5)), seen.join());
delete Array.prototype[3];
Object.prototype[2] = "o";
var inherited = downTo([], 6, 3);
print(show(inherited), inherited[2], 2 in inherited, show(zero([], 4)));
delete Object.prototype[2];
print(show(zero([], 6)), show(copyDown([], src, 6)), seen.join());
