function leaf(n) { if (n % 97 == 96) return new Error("at " + n).stack; return ""; }
function mid(n) { return leaf(n) + ""; }
function top(n) { var s = mid(n); return s.length ? s : ""; }
var out = "";
for (var i = 0; i < 400; i++) { var s = top(i); if (s) out = s; }
print(out);
function Node(v, next) { this.v = v; this.next = next; }
Node.prototype.sum = function () { var t = 0; for (var p = this; p != null; p = p.next) t += p.v; return t; };
Node.prototype.depth = function () { return this.next == null ? 1 : 1 + this.next.depth(); };
var list = null;
for (var i = 0; i < 200; i++) list = new Node(i, list);
var a = 0, b = 0;
for (var i = 0; i < 200; i++) { a += list.sum(); b += list.depth(); }
print(a, b);
function counter() { var n = 0; return function () { n++; return n; }; }
var c = counter(), z = 0;
for (var i = 0; i < 500; i++) z += c();
print(z);
function args() { return arguments.length + (arguments[1] | 0); }
var q = 0;
for (var i = 0; i < 300; i++) q += args(i, i, i);
print(q);
function thrower(n) { if (n % 50 == 49) throw new RangeError("r" + n); return n; }
function catcher(n) { try { return thrower(n); } catch (e) { return e.message.length; } finally { q++; } }
var w = 0;
for (var i = 0; i < 400; i++) w += catcher(i);
print(w, q);
function deep(n) { return n == 0 ? new Error("deep").stack.split("\n").length : deep(n - 1); }
var dd = 0;
for (var i = 0; i < 100; i++) dd += deep(30);
print(dd);
function getter(o) { return o.x; }
var og = { get x() { return new Error("g").stack.split("\n").length; } };
var gg = 0;
for (var i = 0; i < 200; i++) gg += getter(og);
print(gg);
