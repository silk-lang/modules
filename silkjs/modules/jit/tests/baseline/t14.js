var G = 7, hits = 0;
function Outer(seed) {
  var k = seed, log = [];
  var useGlobal = function (a) { hits = hits + 1; return a + G + Math.max(a, 3); };
  var text = function (a) { return 'v' + a + ':' + k; };
  var fewer = function (a, b, c) { return (a | 0) + (b === undefined ? 10 : b) + (c === undefined ? 100 : c); };
  var fib = function (n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); };
  var loop = function (n) { var s = 0; for (var i = 0; i < n; i++) { s += i * k; if (s > 1e6) s = 0; } return s; };
  var thrower = function (n) { if (n % 7 == 3) throw new RangeError('bad ' + n); return n; };
  var guarded = function (n) { try { return thrower(n); } catch (e) { return -e.message.length; } finally { k = k + 1; } };
  var self = function () { return typeof this; };
  var keys = function (o) { var s = ''; for (var p in o) s += p; return s; };
  var writer = function (a) { a = a + 1; k = k + a; return a; };
  var deep = function (n) { return n == 0 ? 0 : 1 + deep(n - 1); };
  var obj = function (a) { return { a: a, b: [a, k], c: text(a) }; };
  var sw = function (x) { switch (x & 3) { case 0: return 'z'; case 1: return 'o'; default: return 't' + x; } };
  this.run = function (x) {
    var r = useGlobal(x) + fewer(x) + fewer(x, 1) + fewer(x, 1, 2) + fib(10) + loop(x & 31) + guarded(x) + writer(x) + deep(40);
    var o = obj(x);
    log.push(text(x).length + self().length + keys({ p: 1, q: 2 }).length + o.c.length + o.b[1] + sw(x).length);
    return r + log[log.length - 1];
  };
  this.unguarded = function (x) { return thrower(x); };
  this.over = function () { var d = function (n) { return d(n + 1) + 1; }; try { return d(0); } catch (e) { return e instanceof RangeError ? 'overflow' : 'other ' + e; } };
}
var o = new Outer(3), total = 0, caught = 0;
for (var i = 0; i < 400; i++) {
  total = (total + o.run(i)) % 1000000007;
  try { total += o.unguarded(i); } catch (e) { caught++; }
}
print(total, caught, hits, o.over());
