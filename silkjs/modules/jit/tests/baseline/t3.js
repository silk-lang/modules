function f(n) { return n == 0 ? 0 : 1 + f(n - 1); }
var r = 0;
for (var i = 0; i < 100; i++) r += f(50);
print(r);
try { print(f(1e6)); } catch (e) { print(e instanceof RangeError, String(e).slice(0, 40)); }
function g(o) { if (o == null) return -1; if (o.v) return 1; return 0; }
var acc = 0;
for (var i = 0; i < 300; i++) acc += g(i % 3 == 0 ? null : { v: i % 2 });
print(acc);
function thrower(n) { if (n > 250) throw new Error("boom " + n); return n; }
function mid(n) { return thrower(n) + 1; }
var c = 0;
try { for (var i = 0; i < 300; i++) c += mid(i); } catch (e) { print(e.message, c); }
