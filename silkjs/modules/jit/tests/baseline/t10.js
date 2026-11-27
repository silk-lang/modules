function P(x, y) { this.x = x; this.y = y; }
P.prototype.sum = function () { return this.x + this.y; };
function Q(n) { this.n = n; var t = 0; for (var i = 0; i < 3; i++) t += i * n; this.t = t; if (n == 7) return { n: -1, t: -1 }; }
function R(a) { if (!(this instanceof R)) return 5; this.a = a; this.self = new.target === R; }
var Klass = { create: function () { return function () { this.initialize.apply(this, arguments); }; } };
var V = Klass.create();
V.prototype = { initialize: function (x, y, z) { this.x = x; this.y = y; this.z = z; }, dot: function (w) { return this.x * w.x + this.y * w.y + this.z * w.z; } };
function T(n) { if (n > 90) throw new RangeError('big ' + n); this.n = n; }
function drive(n) {
  var s = 0;
  for (var i = 0; i < n; i++) {
    var p = new P(i, 2 * i); s += p.sum();
    var q = new Q(i % 11); s += q.n + q.t;
    var r = new R(i); s += r.a + (r.self ? 1 : 0); s += R(i);
    var v = new V(i, 1, 2); s += v.dot(v);
    try { var t = new T(i % 100); s += t.n; } catch (e) { s -= e.message.length; }
  }
  return s;
}
var total = 0;
for (var k = 0; k < 40; k++) total += drive(120);
print(total);
