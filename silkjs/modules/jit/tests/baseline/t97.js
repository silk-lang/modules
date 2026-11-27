// Element accesses that run on some turns of a loop only (a carry that is passed on, a
// store under a test): trusted with the loop's others when an access that runs on every
// turn checks their Array already (ssa_opt_hoist, `sometimes`). An index past the count
// leaves and the interpreter appends, or makes the gap. A store to an Array that only the
// branch names ends the loop's trust.

function keep(v) { return v; }
// The carry of a big number's square: r[i] on every turn, r[i + t] and r[i + t + 1] on some.
function carry(r, x, n, t) {
  for (var i = 0; i < n; i++) {
    r[i] = (r[i] + x[i]) | 0;
    if (r[i] >= 100) { r[i + t] -= 100; r[i + t + 1] = 1; }
  }
  return keep(r.join());
}
// Only a read under the test.
function pick(r, x, n, t) {
  var s = 0;
  for (var i = 0; i < n; i++) { s = (s + r[i]) | 0; if (x[i] > 5) s = (s + r[i + t]) | 0; }
  return keep(s);
}
// A second Array that only the branch stores to, and one it only reads.
function aside(r, q, x, n) {
  for (var i = 0; i < n; i++) { r[i] = (r[i] + 1) | 0; if (x[i] > 5) q[i] = r[i]; }
  return keep(r.join() + "/" + q.join());
}
function asideRead(r, q, x, n) {
  var s = 0;
  for (var i = 0; i < n; i++) { s = (s + r[i]) | 0; if (x[i] > 5) s = (s + q[i]) | 0; }
  return keep(s);
}
// Both arms store, one of them to the Array the loop reads on every turn.
function arms(r, q, x, n) {
  for (var i = 0; i < n; i++) { var v = x[i]; if (v & 1) r[i] = v; else q[i] = v; r[n - 1 - i] = (r[n - 1 - i] + 1) | 0; }
  return keep(r.join() + "/" + q.join());
}
// The test inside an inner loop of a nest: the outer loop's own accesses run on every turn.
function nest(r, x, n, t) {
  for (var i = 0; i < n; i++) {
    var c = x[i];
    for (var j = 0; j < t; j++) { r[i + j] = (r[i + j] + c) | 0; if (r[i + j] > 50) { r[i + j] -= 50; c = 1; } else c = 0; }
    if (c > 0) { r[i + t] = (r[i + t] + c) | 0; }
  }
  return keep(r.join());
}

function ints(n, seed, mod) { var a = []; for (var i = 0; i < n; i++) a[i] = (seed * (i + 3) + i * 7) % mod; return a; }

var out = 0;
for (var round = 0; round < 300; round++) {
  var n = 4 + (round % 6);
  var x = ints(n, round, 11);
  var r = ints(2 * n + 2, round + 1, 120);
  var q = ints(n, round + 2, 9);
  out = (out + carry(r, x, n, n).length + pick(r, x, n, n) + aside(r, q, x, n).length + asideRead(r, q, x, n)) | 0;
  out = (out + arms(r, q, x, n).length + nest(r, x, n, 3).length + r[0] + r[2 * n + 1] + q[n - 1]) | 0;
}
print(out);
// The branch on no turn, on every turn.
print(carry([1, 2, 3, 4, 5, 6, 7], [1, 1, 1], 3, 3), carry([99, 99, 99, 4, 5, 6, 7], [1, 1, 1], 3, 3), carry([200, 300, 400, 1, 2, 3, 4], [0, 0, 0], 3, 3));
// Too short: the store under the test appends, then leaves a gap; the Array is slow the next time.
var short = [99, 99, 99, 0];
print(carry(short, [1, 1, 1], 3, 3), short.length, carry(short, [1, 1, 1], 3, 3), carry(short, [100, 100, 100], 3, 8), short.length);
var gap = [150, 1];
print(carry(gap, [1], 1, 5), gap.length, 3 in gap, 5 in gap, carry(gap, [1], 1, 5));
print(pick([1, 2, 3], [9, 9, 9], 3, 2), pick([1, 2, 3], [9, 0, 9], 3, 5), pick([1, 2, 3, 4, 5, 6], [9, 0, 9], 3, 3));
// One Array under both names, and under all three.
var same = [10, 60, 99, 3, 4, 5, 6, 7, 8];
print(carry(same, same, 3, 3), aside(same, same, same, 4), asideRead(same, same, same, 9), arms(same, same, same, 5));
// No Arrays: typed arrays, a string, arguments, an object with indexes, a frozen Array.
print(carry(new Int32Array([99, 99, 99, 0, 0, 0, 0, 0]), [1, 1, 1], 3, 3), pick("123456", [9, 9, 9], 3, 3), pick(new Float64Array([1.5, 2.5, 3.5, 4.5]), [9, 0], 2, 2));
print(aside([1, 2, 3], new Uint8Array(3), [9, 0, 9], 3), asideRead([1, 2, 3], "789", [9, 9, 9], 3), asideRead([1, 2, 3], { 0: 4, 2: 6 }, [9, 9, 9], 3));
function viaArguments() { return pick(arguments, [9, 9], 2, 2); }
print(viaArguments(1, 2, 3, 4), arms([1, 2, 3], { length: 3, join: Array.prototype.join }, [1, 2, 3], 3));
var frozen = Object.freeze([99, 99, 0, 0, 0]);
print(carry(frozen, [1, 1], 2, 2), pick(frozen, [9, 9], 2, 2));
// Elements that are no Int, holes, and a getter in front of a hole.
print(carry([99.5, "99", 1, 2, 3, 4], [1, 1], 2, 2), carry([99, , 99, 1, , 3, 4], [1, 1, 1], 3, 3), pick([1, , 3, , 5], [9, 9, 9], 3, 2));
Object.defineProperty(Array.prototype, 4, { get: function () { return 1000; }, set: function (v) { out = v; }, configurable: true });
print(carry([99, 99, 0, 0], [1, 1], 2, 2), out, pick([1, 2, 3, 4], [9, 9, 9], 3, 2), nest([49, 49, 49], [1, 1, 1], 3, 2), out);
delete Array.prototype[4];
print(nest([49, 49, 49, 0, 0, 0], [1, 1, 1], 3, 2), nest([49, 49, 49], [1, 1, 1], 3, 2), nest([1, 2, 3, 4, 5], [100, 100], 2, 3));
