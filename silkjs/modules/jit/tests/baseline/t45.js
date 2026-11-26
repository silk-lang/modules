// `new` from compiled code: the constructor's code runs on a receiver the engine makes, and
// the receiver is the result unless the function returns an object; `new Array()` is the
// engine's alone; every other kind of function is constructed as before.
function Point(x, y) { this.x = x; this.y = y; this.sum = x + y; }
Point.prototype.norm = function () { return this.x * this.x + this.y * this.y; };
function Box(v) { this.v = v; this.list = new Array(); this.inner = new Point(v, v + 1); }
function Returns(kind, v) {
  this.kind = kind;
  if (kind == 0) return { other: v };
  if (kind == 1) return v;
  if (kind == 2) return "text" + v;
  if (kind == 3) return null;
  if (kind == 4) return [v];
  if (kind == 5) return function () { return v; };
  if (kind == 6) throw new RangeError("no " + v);
}
function Target() { this.target = new.target === Target ? 1 : new.target === undefined ? 0 : 2; }
function Few(a, b, c) { this.a = a; this.b = b; this.c = c; this.n = arguments.length; if (c === undefined) c = 7; this.d = c; }
function Writes(a) { a = a + 1; this.a = a; }
function Deep(n) { this.n = n; this.next = n > 0 ? new Deep(n - 1) : null; }
function Empty() {}
var arrow = function (x) { return x; }.bind(null);
var K = {
  point: function (i) { var p = new Point(i, i + 0.5); return p.norm() + p.sum; },
  box: function (i) { var b = new Box(i); b.list.push(i); b.list.push(b); return b.inner.sum + b.list.length + b.v; },
  ret: function (kind, i) {
    var r;
    try { r = new Returns(kind, i); } catch (e) { return e instanceof RangeError ? 1000 + i : -1; }
    if (kind == 0) return r.other + (r.kind === undefined ? 1 : 0);
    if (kind == 4) return r[0] + r.length;
    if (kind == 5) return r() + 3;
    return r.kind * 10 + (r instanceof Returns ? 1 : 0);
  },
  target: function () { return new Target().target * 10 + (Target.call({}) === undefined ? 1 : 0); },
  few: function (i) { var f = new Few(i); var g = new Few(i, 2, 3, 4); return f.n + f.d + g.n + g.d + (f.b === undefined ? 1 : 0); },
  writes: function (i) { return new Writes(i).a; },
  deep: function (n) { var d = new Deep(n); var c = 0; while (d) { c += d.n; d = d.next; } return c; },
  empty: function () { var e = new Empty(); return (e instanceof Empty ? 1 : 0) + Object.keys(e).length; },
  arr: function (i) { var a = new Array(); var b = new Array(); a.push(i); return a.length * 10 + b.length + (a === b ? 100 : 0) + (Array.isArray(a) ? 1 : 0); },
  arrN: function (i) { var a = new Array(i % 5); var b = new Array(i, 2); var c = new Array("x"); return a.length + b.length * 10 + c.length * 100; },
  any: function (F, v) { return new F(v); }
};
var total = 0;
for (var i = 0; i < 2500; i++) {
  total += K.point(i) + K.box(i) + K.ret(i % 7, i) + K.target() + K.few(i) + K.writes(i) + K.deep(i % 9) + K.empty() + K.arr(i) + K.arrN(i);
}
print(total);
// One site, every kind of function: plain, a class, a derived class, bound, a Proxy, a
// native, an arrow function, no function at all.
class Base { constructor(v) { this.v = v; this.base = true; } }
class Derived extends Base { constructor(v) { super(v * 2); this.derived = true; } }
class Late extends Base { constructor(v) { if (v % 2) { super(v); } else { super(v + 1); this.even = 1; } } }
class NoSuper extends Base { constructor(v) { if (v > 1e9) super(v); } }
var Bound = Point.bind(null, 5);
var Proxied = new Proxy(Point, { construct: function (t, args) { return { proxied: args[0] }; } });
var kinds = [Point, Base, Derived, Late, NoSuper, Bound, Proxied, Date, Object, Array, Map, String, arrow, function (x) { return x; }, Math.max, (x) => x, 5, null, { }, Symbol];
var seen = [];
for (var i = 0; i < 300; i++) {
  for (var j = 0; j < kinds.length; j++) {
    var r;
    try { var o = K.any(kinds[j], i); r = typeof o + ":" + (o === null ? "null" : Object.keys(o).join("")) + ":" + (o instanceof Object ? Object.getPrototypeOf(o) === kinds[j].prototype : "-"); }
    catch (e) { r = e instanceof TypeError ? "T" : e instanceof ReferenceError ? "R" : "E"; }
    if (i == 299) seen.push(r);
  }
}
print(seen.join(" "));
// A constructor whose prototype property changes, is no object, or is deleted; a
// constructor replaced under its name; Array replaced under its name.
function Shifty(v) { this.v = v; }
function make(i) { return new Shifty(i); }
function list() { return new Array(); }
var protos = [];
var RealArray = Array;
for (var i = 0; i < 400; i++) {
  if (i == 100) Shifty.prototype = { tag: "second" };
  if (i == 200) Shifty.prototype = 5;
  if (i == 300) { Shifty = function (v) { this.w = v; }; Shifty.prototype.tag = "third"; }
  if (i == 250) Array = function () { this.fake = 1; };
  if (i == 350) Array = RealArray;
  var o = make(i), l = list();
  if (i % 50 == 49) protos.push(String(o.tag) + (Object.getPrototypeOf(o) === Object.prototype ? "O" : "") + Object.keys(o).join("") + (RealArray.isArray(l) ? "A" : "F"));
}
print(protos.join(" "));
// Deep recursion through `new` ends in a RangeError the caller can catch.
function Tower(n) { this.up = new Tower(n + 1); }
var depth = 0;
for (var i = 0; i < 3; i++) { try { new Tower(0); } catch (e) { depth += e instanceof RangeError ? 1 : 100; } }
print(depth);
