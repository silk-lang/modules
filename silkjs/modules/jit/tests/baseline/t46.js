// Function.prototype.call from compiled code: f.call(x, ...) calls f itself when f has
// code; everything else (natives, bound functions, classes, a replaced call, no
// arguments) stays the engine's call.
var out = [];
function note(x) { out.push(String(x)); }

function sloppy(a, b) { return typeof this + ":" + (this === undefined ? "u" : this === null ? "n" : typeof this === "object" && this !== globalThis ? "o" : this === globalThis ? "g" : this) + ":" + a + ":" + b + ":" + arguments.length; }
function strict(a, b) { "use strict"; return typeof this + ":" + String(this) + ":" + a + ":" + b + ":" + arguments.length; }
function viaCall(f, t, a, b) { return f.call(t, a, b); }
function viaCall0(f) { return f.call(); }
function viaCall1(f, t) { return f.call(t); }
function viaCall4(f, t, a, b, c) { return f.call(t, a, b, c); }

var things = [undefined, null, 1, "s", true, { toString: function () { return "obj"; } }, 2.5];
for (var round = 0; round < 80; round++) {
  var acc = "";
  for (var i = 0; i < things.length; i++) {
    acc += viaCall(sloppy, things[i], round, i) + "|" + viaCall(strict, things[i], round, i) + "|";
    acc += viaCall1(sloppy, things[i]) + "|" + viaCall1(strict, things[i]) + "|" + viaCall4(strict, things[i], 1, 2, 3) + "|";
  }
  acc += viaCall0(strict) + "|" + viaCall0(sloppy);
  if (round % 20 === 0 || round === 79) note(acc);
}

// Super constructors called as functions, as DeltaBlue does.
function Base(name) { this.name = name; this.kind = "base"; }
Base.prototype.describe = function () { return this.kind + ":" + this.name + ":" + this.extra; };
function Mid(name, extra) { Mid.superConstructor.call(this, name); this.extra = extra; }
Mid.superConstructor = Base;
Mid.prototype = Object.create(Base.prototype);
function Leaf(name, extra, more) { Leaf.superConstructor.call(this, name, extra); this.more = more; this.kind = "leaf"; }
Leaf.superConstructor = Mid;
Leaf.prototype = Object.create(Mid.prototype);
var total = 0;
for (var i = 0; i < 300; i++) {
  var m = new Mid("m" + (i & 3), i);
  var l = new Leaf("l" + (i & 3), i * 2, i);
  total += m.extra + l.extra + l.more;
  if (i % 100 === 0) note(m.describe() + " " + l.describe());
}
note(total);

// One site, many kinds of callee.
class Klass { constructor() { this.x = 1; } static make() { return 7; } }
var bound = sloppy.bind({ toString: function () { return "bound" } }, "pre");
var arrow = (a, b) => "arrow:" + a + ":" + b;
function* gen(a) { yield a; yield this.v; }
async function asy(a) { return a; }
var proxy = new Proxy(strict, {});
var callees = [strict, sloppy, bound, arrow, Math.max, String, proxy, Klass.make, Array.prototype.join, gen, Object];
function site(f, t, a, b) { return f.call(t, a, b); }
for (var round = 0; round < 60; round++) {
  var acc = "";
  for (var i = 0; i < callees.length; i++) {
    var r;
    try { r = site(callees[i], [3, 4], 5, 6); } catch (e) { r = "threw " + e.constructor.name; }
    if (r && typeof r.next === "function") r = "gen:" + r.next().value;
    acc += String(r) + "|";
  }
  try { acc += site(Klass, {}, 1, 2); } catch (e) { acc += "threw " + e.constructor.name; }
  try { acc += site(null, {}, 1, 2); } catch (e) { acc += "|threw " + e.constructor.name; }
  try { acc += site({ call: function (t, a, b) { return "own call " + a + b; } }, {}, 1, 2); } catch (e) { acc += "|threw " + e.constructor.name; }
  if (round % 20 === 0 || round === 59) note(acc);
}

// A replaced call on one function, then on Function.prototype, then restored.
function plain(a) { return "plain:" + this.tag + ":" + a; }
function caller(f, t, a) { return f.call(t, a); }
var t = { tag: "T" };
for (var i = 0; i < 100; i++) caller(plain, t, i);
note(caller(plain, t, 1));
plain.call = function (x, a) { return "own:" + a; };
note(caller(plain, t, 2));
delete plain.call;
note(caller(plain, t, 3));
var saved = Function.prototype.call;
Function.prototype.call = function (x, a) { return "replaced:" + a; };
note(caller(plain, t, 4));
Function.prototype.call = saved;
note(caller(plain, t, 5));
note(caller.call.call(plain, t, 6));
note(Function.prototype.call.call(plain, t, 7));

// Exceptions and results through call.
function thrower(n) { if (n % 7 === 3) throw new RangeError("r" + n + this.tag); return n * 2; }
function guarded(n) { try { return thrower.call(t, n); } catch (e) { return e.message; } }
var acc = "";
for (var i = 0; i < 120; i++) acc += guarded(i) + ",";
note(acc.length + ":" + acc.slice(0, 60));

// Recursion through call, and the stack running out there.
function down(n) { return n === 0 ? 0 : 1 + down.call(this, n - 1); }
for (var i = 0; i < 50; i++) down.call(null, 50);
note(down.call(null, 500));
function forever(n) { return forever.call(this, n + 1) + 1; }
try { forever.call(null, 0); note("no overflow"); } catch (e) { note(e.constructor.name); }
try { forever.call(null, 0); note("no overflow"); } catch (e) { note(e.constructor.name); }

// The callee changes while the site is hot, and a callee that becomes hot later.
function one(a) { return "one" + a + this.tag; }
function two(a, b, c) { return "two" + a + b + c + this.tag; }
var acc = "";
for (var i = 0; i < 200; i++) acc += caller(i % 3 === 0 ? one : two, t, i).length;
note(acc.length);
function late(a) { return (this.n | 0) + a; }
var holder = { n: 5 };
var sum = 0;
for (var i = 0; i < 300; i++) sum += caller(late, holder, i);
note(sum);
(typeof print === "function" ? print : console.log)(out.join("\n"));
