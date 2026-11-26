// An Array read from a field into a local, and read again on every turn of an outer loop
// around counted loops: the read borrows through the inner loops' polls
// (ssa_ownership.borrowFields), and the loops check the Array the local copies, not the
// object that holds it (ssa_opt_hoist.copied).

function keep(v) { return v; }
function Holder(n, seed) { this.t = n; this.array = []; for (var i = 0; i < n; i++) this.array[i] = (seed * (i + 5) + i) & 255; }
// The holder is an Array itself, and holds another under the name the loop reads.
function arrayHolder(inner, n) { var h = [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]; h.array = inner; h.t = n; return h; }

Holder.prototype.sum = function () { var a = this.array; var s = 0; for (var i = 0; i < this.t; i++) s = (s + a[i]) | 0; return keep(s); };
function sumOf(x) { var a = x.array; var s = 0; for (var i = 0; i < x.t; i++) s = (s + a[i]) | 0; return keep(s); }
function fill(x, v) { var a = x.array; for (var i = x.t - 1; i >= 0; --i) a[i] = v; return keep(a.length); }
// An outer loop that reads its Arrays on every turn, around two counted loops.
function square(x, r) {
  var xa = x.array, ra = r.array, n = x.t, s = 0;
  for (var i = 0; i < n; i++) {
    var c = 0;
    for (var j = 0; j < n; j++) { c = (c + xa[i] * xa[j] + ra[i + j]) | 0; ra[i + j] = c & 255; c = c >> 8; }
    for (var k = n - 1; k >= 0; --k) s = (s + ra[k] + xa[k]) | 0;
    if (c > 0) { ra[i + n] = (ra[i + n] + c) | 0; }
  }
  return keep(s);
}
// The same with the fields read inside the outer loop, through `this` and an argument.
Holder.prototype.mix = function (r) {
  var s = 0;
  for (var i = 0; i < this.t; i++) {
    for (var j = 0; j < r.t; j++) s = (s + this.array[i] + r.array[j]) | 0;
    for (var k = 0; k < this.t; k++) s = (s ^ this.array[k]) | 0;
  }
  return keep(s);
};
// The field is replaced inside the outer loop, after the inner loop read its old Array.
function swap(x, y, n) {
  var s = 0;
  for (var i = 0; i < n; i++) {
    var a = x.array;
    for (var j = 0; j < x.t; j++) s = (s + a[j] * (i + 1)) | 0;
    x.array = y.array; y.array = a;
    for (var k = 0; k < x.t; k++) s = (s + a[k]) | 0;
  }
  return keep(s);
}
// The last holder of the Array lets go of it inside the outer loop.
function drain(list) {
  var s = 0;
  for (var i = 0; i < list.length; i++) {
    var a = list[i].array;
    for (var j = 0; j < 4; j++) s = (s + a[j]) | 0;
    list[i].array = null;
    for (var k = 3; k >= 0; --k) s = (s + a[k] * 2) | 0;
  }
  return keep(s);
}

// An inner loop that some calls never enter, over what is no Array then: the outer loop's
// front block checks for it, and leaves.
function rows(g, n, m) { var s = 0; for (var i = 0; i < n; i++) { for (var j = 0; j < m; j++) s = (s + g[j] * (i + 1)) | 0; s = (s + i) | 0; } return keep(s); }

var out = 0;
for (var round = 0; round < 300; round++) {
  var n = 3 + (round % 5);
  var x = new Holder(n, round), y = new Holder(n, round + 3), r = new Holder(2 * n + 1, round + 7);
  out = (out + x.sum() + sumOf(y) + square(x, r) + x.mix(y) + swap(x, y, 3) + r.array[2 * n]) | 0;
  out = (out + drain([new Holder(4, round), new Holder(5, round + 1)]) + fill(y, round) + sumOf(y) + rows(x.array, n, n) + rows(x.array, n, round % 3)) | 0;
}
print(out);
print(rows("12345", 4, 0), rows("12345", 4, 3), rows(new Uint8Array([1, 2, 3]), 5, 0), rows(new Uint8Array([1, 2, 3]), 5, 3), rows([1, 2, 3], 3, 0), rows({ length: 0 }, 2, 0));
print(rows(null, 3, 0), rows(undefined, 2, 0), rows(7, 2, 0), rows([1, 2], 2, 4), rows([1.5, "2"], 2, 2));
// Holders that are Arrays: the loops read what they hold, an Array or not.
var inner = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
var h = arrayHolder(inner, 5);
print(sumOf(h), Holder.prototype.sum.call(h), square(h, arrayHolder([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 5)), Holder.prototype.mix.call(h, h), fill(h, 3), inner.join(), h.join());
var typed = arrayHolder(new Int32Array([5, 6, 7, 8, 9]), 5);
print(sumOf(typed), Holder.prototype.sum.call(typed), fill(typed, 2), typed.array.join(), Holder.prototype.mix.call(typed, h), square(typed, arrayHolder([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 5)));
var text = arrayHolder("abcdefgh", 4);
print(sumOf(text), Holder.prototype.sum.call(text), Holder.prototype.mix.call(text, text));
var plain = arrayHolder({ 0: 4, 1: 5, 2: 6, length: 3 }, 3);
print(sumOf(plain), fill(plain, 1), plain.array[0] + plain.array[2], Holder.prototype.mix.call(plain, h));
function args() { return arguments; }
var viaArgs = arrayHolder(args(3, 4, 5, 6), 4);
print(sumOf(viaArgs), Holder.prototype.sum.call(viaArgs), fill(viaArgs, 7), viaArgs.array[3], square(viaArgs, arrayHolder([0, 0, 0, 0, 0, 0, 0, 0, 0], 4)));
// A holder whose Array is itself, and one short of what `t` says.
var self = [1, 2, 3, 4]; self.array = self; self.t = 4;
print(sumOf(self), fill(self, 6), self.join(), square(self, self), self.join());
var lying = new Holder(3, 1); lying.t = 6;
print(sumOf(lying), Holder.prototype.sum.call(lying), lying.mix(lying), fill(lying, 4), lying.array.join());
// A getter under the name, an Array that changes between the outer loop's turns.
var getter = { t: 3, count: 0 };
Object.defineProperty(getter, "array", { get: function () { this.count++; return this.count & 1 ? [1, 2, 3] : [10, 20, 30]; } });
print(sumOf(getter), Holder.prototype.mix.call(getter, getter), getter.count, swap(new Holder(3, 2), new Holder(3, 4), 5));
var a1 = new Holder(4, 1), a2 = new Holder(4, 2);
print(swap(a1, a2, 4), a1.array.join(), a2.array.join(), swap(a1, a1, 3), drain([a1, a2, new Holder(4, 9)]), a1.array, a2.array);
