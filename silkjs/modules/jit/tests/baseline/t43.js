// Equality answered in compiled code (objects, null, undefined) and array push and pop by name.
function P(n) { this.n = n; }
P.prototype.toString = function () { T.calls++; return "p" + this.n; };
P.prototype.valueOf = function () { T.calls++; return this.n; };
var T = {
  calls: 0,
  eq: function (a, b) { var n = 0; if (a == b) n += 1; if (a != b) n += 2; if (a === b) n += 4; if (a !== b) n += 8; return n; },
  nul: function (a) { var n = 0; if (a == null) n += 1; if (a != null) n += 2; if (a === null) n += 4; if (a !== undefined) n += 8; if (null == a) n += 16; if (undefined === a) n += 32; return n; },
  loop: function (list, x) { var n = 0; for (var i = 0; i < list.length; i++) { if (list[i] == x) n += i + 1; if (list[i] === x) n += 100; } return n; },
  same: function (a) { return (a == a ? 1 : 0) + (a === a ? 2 : 0) + (a != a ? 4 : 0); }
};
var a = new P(1), b = new P(1), sym = Symbol("s"), sym2 = Symbol("s"), f = function () {};
var values = [a, b, null, undefined, 0, 1, 1.5, 0 / 0, "", "1", "p1", true, false, sym, sym2, f, [1], [1], {}, -0, 10n, 10];
var total = 0, line = "";
for (var round = 0; round < 60; round++) {
  for (var i = 0; i < values.length; i++) {
    total += T.nul(values[i]) + T.same(values[i]);
    for (var j = 0; j < values.length; j++) {
      var r;
      try { r = T.eq(values[i], values[j]); } catch (e) { r = 1000; }
      total += r * (j + 1);
      if (round == 59) line += r.toString(16);
    }
  }
  total += T.loop(values, a) + T.loop(values, null) + T.loop(values, undefined) + T.loop(values, "1");
}
print(total, T.calls, line);

function Stack() { this.elms = new Array(); }
Stack.prototype.add = function (v) { this.elms.push(v); };
Stack.prototype.take = function () { return this.elms.pop(); };
Stack.prototype.size = function () { return this.elms.length; };
var A = {
  fill: function (n) { var v = []; for (var i = 0; i < n; i++) { v.push(i * 2); } return v; },
  len: function (v, x) { return v.push(x); },
  drain: function (v) { var s = 0; while (v.length > 0) { s += v.pop(); } return s; },
  pop: function (v) { return v.pop(); },
  objs: function (n) { var v = []; for (var i = 0; i < n; i++) { v.push({ k: i }); v.push("s" + i); v.push(i + 0.5); } var s = ""; while (v.length) { var x = v.pop(); s += typeof x == "object" ? x.k : x; } return s.length; },
  st: function (n) { var s = new Stack(); for (var i = 0; i < n; i++) { s.add(i); if (i % 3 == 0) s.take(); } var t = s.size(); while (s.size() > 0) t += s.take(); return t; },
  any: function (o, x) { return o.push(x); },
  anyPop: function (o) { return o.pop(); }
};
var out = 0;
for (var i = 0; i < 400; i++) {
  var v = A.fill(i % 37);
  out += A.len(v, i) + A.drain(v) + A.objs(i % 11) + A.st(i % 23);
  out += String(A.pop(v)).length + String(A.pop([])).length;
}
print(out);
// Receivers that are not plain arrays, under the same sites.
var like = { length: 2, push: Array.prototype.push, pop: Array.prototype.pop };
var own = { items: 0, push: function (x) { this.items += x; return "own"; }, pop: function () { return "mine" + this.items; } };
function Sub() {}
Sub.prototype = Object.create(Array.prototype);
Sub.prototype.push = function (x) { return Array.prototype.push.call(this, x, x); };
var sub = new Sub(), holes = [1, , 3], frozen = Object.freeze([1, 2]), sealed = Object.seal([4, 5]), typed = new Uint8Array(4);
var fixed = [1, 2, 3]; Object.defineProperty(fixed, "length", { writable: false });
var got = [];
for (var i = 0; i < 300; i++) {
  var targets = [like, own, sub, holes, frozen, sealed, fixed, [i], typed, "text", 5, null];
  for (var j = 0; j < targets.length; j++) {
    var r;
    try { r = A.any(targets[j], i); } catch (e) { r = e instanceof TypeError ? "T" : "E"; }
    if (i % 100 == 99) got.push(r);
    try { r = A.anyPop(targets[j]); } catch (e) { r = e instanceof TypeError ? "T" : "E"; }
    if (i % 100 == 99) got.push(r);
  }
}
print(got.join(","), like.length, own.items, sub.length, holes.length, frozen.length, sealed.length, fixed.length);
// The natives replaced while the code runs, then put back.
var push = Array.prototype.push, pop = Array.prototype.pop, seen = 0;
for (var i = 0; i < 300; i++) {
  if (i == 120) { Array.prototype.push = function (x) { seen++; return push.call(this, x + 1); }; Array.prototype.pop = function () { seen += 2; return pop.call(this); }; }
  if (i == 220) { Array.prototype.push = push; Array.prototype.pop = pop; }
  var w = A.fill(5); out += A.len(w, i) + A.drain(w) + A.st(7);
}
print(out, seen);
// Getters and setters on Array.prototype that a push or pop must honour.
var hits = 0;
for (var i = 0; i < 200; i++) {
  if (i == 100) Object.defineProperty(Array.prototype, 3, { get: function () { hits++; return 7; }, set: function (x) { hits += 10; }, configurable: true });
  var w = [1, 2, 3]; A.len(w, i); out += w.length + (w[3] | 0) + String(A.pop(w)).length;
}
delete Array.prototype[3];
print(out, hits);
