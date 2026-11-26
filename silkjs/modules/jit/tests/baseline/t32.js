// Instructions the optimizer has no template for run through the interpreter on the frame
// (a step), and the optimized code goes on: literals, typeof, in, delete, closures,
// iteration, constructor calls; and the same when the step throws.
function Point(x, y) { this.x = x; this.y = y; }
Point.prototype.sum = function () { return this.x + this.y; };
function make(i) { var p = new Point(i, i + 1); return p.sum(); }
function literal(i) { var o = { a: i, b: [i, i + 1, "s"], c: { d: i * 2 } }; return o.a + o.b[1] + o.c.d + o.b.length; }
function kinds(v, o) { var n = 0; if (typeof v === "number") n += 1; if ("a" in o) n += 2; if (v instanceof Point) n += 4; return n; }
function removes(i) { var o = { a: 1, b: i }; delete o.a; return ("a" in o ? 100 : 0) + o.b; }
function closes(i) { var f = function named() { return 7; }; return f() + f.name.length + i; }
function forIn(o) { var n = 0; for (var k in o) n += o[k]; return n; }
function forOf(a) { var n = 0; for (var v of a) n += v; return n; }
function power(a, b) { return a ** b; }
function match(s) { return /b+/.test(s) ? 1 : 0; }
var s = 0;
var obj = { a: 1, b: 2, c: 3 };
var arr = [1, 2, 3, 4];
for (var i = 0; i < 3000; i++) {
  s += make(i) + literal(i) + kinds(i, obj) + kinds(new Point(1, 2), {}) + removes(i) + closes(i) + forIn(obj) + forOf(arr) + power(2, i & 7) + match(i & 1 ? "abbc" : "ac");
}
print(s);
// A constructor that throws, caught in the caller and in the function itself.
function Bad(i) { if (i % 50 === 49) throw new RangeError("bad " + i); this.i = i; }
function tryMake(i) { try { return new Bad(i).i; } catch (e) { return -e.message.length; } }
function makeBad(i) { return new Bad(i).i; }
var t = 0;
for (var i = 0; i < 2000; i++) { t += tryMake(i); try { t += makeBad(i); } catch (e) { t -= 1; } }
print(t);
// Sites that left once and are stepped from then on: a getter, a setter, a getter that
// throws, a store that adds a property, an equality that coerces, with handlers in the
// function and outside it.
var hits = 0;
var plain = { v: 1 };
var withGetter = { get v() { hits++; return 2; }, set w(x) { hits += x; } };
var throwing = { get v() { throw new Error("no v"); } };
function read(o) { return o.v; }
function readSafe(o) { try { return o.v; } catch (e) { return -1; } }
function write(o, x) { o.w = x; return 1; }
function same(a, b) { return a == b ? 1 : 0; }
var five = { valueOf: function () { return 5; } };
var u = 0;
for (var i = 0; i < 500; i++) { u += read(plain) + readSafe(plain) + write(plain, i) + same(i, i); }
for (var i = 0; i < 3000; i++) {
  u += read(withGetter) + readSafe(withGetter) + readSafe(throwing) + write(withGetter, 1) + write({}, i) + same(five, 5) + same(5, five) + same("5", 5);
  try { u += read(throwing); } catch (e) { u += 3; }
  u += read("str") === undefined ? 1 : 0;
}
print(u, hits, plain.w);
