// Keyed stores into a table filled past its end (put.key once the store left there), and
// loops whose counter starts from an argument copied into a local the code owns
// (bnpDRShiftTo: the counter is unboxed on the loop's entry edge, which releases the local's
// value), given ints, a fraction and a string.
function Box(v) { this.v = v; }
Box.prototype.twice = function () { return new Box(this.v * 2); };
function table(k, seed) {
  var g = new Array(), n = 3, km = (1 << k) - 1;
  g[1] = new Box(seed);
  if (k > 1) {
    var g2 = g[1].twice();
    while (n <= km) {
      g[n] = new Box(g2.v + g[n - 2].v);
      n += 2;
    }
  }
  var s = 0;
  for (var i = 1; i <= km; i += 2) s = (s + g[i].v) | 0;
  return s;
}
function shift(from, src, dst) {
  for (var i = from; i < src.length; ++i) dst[i - from] = src[i];
  return dst.length;
}
function Num(n) { this.array = []; for (var i = 0; i < n; i++) this.array.push(i * 3); this.t = n; this.s = 0; }
Num.prototype.drShiftTo = function (n, r) {
  var this_array = this.array;
  var r_array = r.array;
  for (var i = n; i < this.t; ++i) r_array[i - n] = this_array[i];
  r.t = Math.max(this.t - n, 0);
  r.s = this.s;
};
var out = [];
var total = 0;
for (var r = 0; r < 400; r++) total = (total + table(1 + (r % 5), r)) | 0;
out.push(total);
total = 0;
for (var r = 0; r < 400; r++) {
  var src = [], dst = [];
  for (var j = 0; j < 20; j++) { src.push(j * r); dst.push(0); }
  total = (total + shift(r % 7, src, dst) + dst[3]) | 0;
}
out.push(total);
total = 0;
for (var r = 0; r < 400; r++) {
  var a = new Num(12), b = new Num(12);
  a.drShiftTo(r % 5, b);
  total = (total + b.t + b.array[2]) | 0;
}
out.push(total);
out.push(shift(2, [1, 2, 3, 4], [9, 9, 9, 9, 9]), shift(1.5, [1, 2, 3], [0, 0, 0]), shift('1', [5, 6], [0]));
print(out.join(' | '));
