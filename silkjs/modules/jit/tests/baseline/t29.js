// Natives called from baseline code (answers without a frame, natives with a frame, natives
// that throw or call back), small local functions that only baseline code calls, field
// stores that grow an object, empty literals before a local read, to_object, and strict
// receivers of every type.
(function () {
  // A leaf the interpreter runs without a frame: it gets code once baseline code calls it.
  function twice(x) { return x + x; }
  function half(x) { return x / 2; }
  function callers(n) {
    var total = 0;
    for (var i = 0; i < n; i++) total += twice(i) - half(i);
    return total;
  }
  function natives(n) {
    var text = "abcdefgh", list = [3, 1, 2], seen = [], map = new Map([["k", 7]]), o = { a: 1, b: 2 };
    var total = 0;
    for (var i = 0; i < n; i++) {
      total += Math.floor(i / 3) + Math.max(i, 5) + Math.abs(-i);
      total += text.charCodeAt(i & 7) + text.indexOf("d") + text.slice(1, 4).length;
      total += list.indexOf(2) + (Array.isArray(list) ? 1 : 0) + map.get("k");
      total += Object.keys(o).length + (o.hasOwnProperty("a") ? 1 : 0);
      total += text.toUpperCase().length + String(i).length + parseInt("12", 10);
      seen.push(i);
      if (seen.length > 10) seen.length = 0;
      total += seen.length;
    }
    return total;
  }
  // Natives that call back into functions, and callbacks that throw through them.
  function callbacks(n) {
    var list = [];
    for (var i = 0; i < n; i++) list.push((i * 7) % 11);
    var doubled = list.map(function (x) { return x * 2; });
    var sum = doubled.reduce(function (a, b) { return a + b; }, 0);
    var sorted = list.slice().sort(function (a, b) { return a - b; });
    var caught = "none";
    try { list.forEach(function (x) { if (x === 3) throw new Error("three " + x); }); } catch (e) { caught = e.message; }
    return [sum, sorted.join(","), caught, list.filter(function (x) { return x > 5; }).length].join("|");
  }
  // Natives that throw: the error and its stack name the baseline frames.
  function thrower(kind) {
    if (kind === 0) return null.x;
    if (kind === 1) return new Array(-1);
    if (kind === 2) return "x".repeat(-1);
    if (kind === 3) return JSON.parse("{bad");
    if (kind === 4) return Object.defineProperty(1, "a", {});
    return decodeURIComponent("%");
  }
  function throwing(n) {
    var out = [];
    for (var i = 0; i < n; i++) {
      try { thrower(i % 6); out.push("no"); }
      catch (e) { out.push(e.constructor.name + ":" + (e.stack.indexOf("thrower") >= 0) + ":" + (e.stack.indexOf("throwing") >= 0)); }
    }
    return out.slice(-6).join(" ");
  }
  // Stores that add fields past an object's first slots, and overwrite them.
  function Wide(i) {
    this.a = i; this.b = i + 1; this.c = i + 2; this.d = i + 3; this.e = i + 4; this.f = i + 5;
    this.g = i + 6; this.h = i + 7; this.i = i + 8; this.j = i + 9; this.k = i + 10; this.l = i + 11;
  }
  function grow(n) {
    var total = 0;
    for (var i = 0; i < n; i++) {
      var w = new Wide(i);
      w.m = i; w.n = w.m + 1; w.a = w.n;
      var plain = {};
      plain.x = i; plain.y = i + 1; plain.z = i + 2; plain.w = i + 3; plain.v = i + 4; plain.u = i + 5;
      total += w.a + w.l + w.m + w.n + plain.x + plain.u;
    }
    return total;
  }
  function frozen(n) {
    var hits = 0;
    for (var i = 0; i < n; i++) {
      var o = Object.freeze({ a: 1 });
      o.b = i;
      var s = { set v(x) { hits += x; } };
      s.v = 2;
      if (o.b === undefined) hits++;
    }
    return hits;
  }
  // An empty literal followed by a local read is no spread; a spread still copies.
  function pair(a, b) { return [a, b]; }
  function literals(n) {
    var out = 0, source = { p: 1, q: 2 };
    for (var i = 0; i < n; i++) {
      var x = i;
      var made = pair({}, x);
      var copy = { ...source };
      var other = { ...made[0] };
      copy.r = x;
      out += made[1] + Object.keys(copy).length + Object.keys(other).length + Object.keys(made[0]).length;
    }
    return out;
  }
  // to_object: destructuring and for-in over objects and primitives; null throws.
  function shapes(v) {
    var keys = [];
    for (var k in v) keys.push(k);
    var { length } = v;
    return keys.length + ":" + length;
  }
  function destructure(n) {
    var out = [];
    var inputs = [{ length: 4, a: 1 }, "abc", [1, 2], 5, true, null, undefined];
    for (var i = 0; i < n; i++) {
      try { out.push(shapes(inputs[i % inputs.length])); } catch (e) { out.push(e.constructor.name); }
    }
    return out.slice(-7).join(" ");
  }
  // Strict code reads its receiver as passed; sloppy code converts it.
  function strictThis() { "use strict"; return this; }
  function strictKeep() { "use strict"; var self = this; return typeof self + ":" + (self === undefined ? "u" : self === null ? "n" : String(self)); }
  function sloppyThis() { return typeof this; }
  function receivers(n) {
    var out = [];
    var values = [undefined, null, 1, "s", true, { toString: function () { return "obj"; } }, Symbol.iterator, 1.5];
    for (var i = 0; i < n; i++) {
      var v = values[i % values.length];
      out.push((strictThis.call(v) === v) + "/" + strictKeep.call(v) + "/" + sloppyThis.call(v) + "/" + typeof strictThis());
    }
    return out.slice(-8).join(" ");
  }
  var results = [];
  for (var round = 0; round < 70; round++) {
    results = [callers(30), natives(20), callbacks(40), throwing(12), grow(20), frozen(10), literals(20), destructure(14), receivers(16)];
  }
  for (var r = 0; r < results.length; r++) print(results[r]);
})();
// Field stores that setters take (bytecode setters on the object and on a prototype, a
// setter that throws, a native setter), and Array lengths.
(function () {
  function Temp() { this.c = 0; this.sets = 0; }
  Object.defineProperty(Temp.prototype, "f", {
    get: function () { return this.c * 9 / 5 + 32; },
    set: function (v) { this.sets++; this.c = (v - 32) * 5 / 9; }
  });
  function Strict() { this.v = 1; }
  Object.defineProperty(Strict.prototype, "v2", { set: function (x) { if (x < 0) throw new RangeError("negative " + x); this.v = x; } });
  function stores(n) {
    var t = new Temp(), s = new Strict(), own = { set w(x) { this.seen = x; }, seen: 0 }, list = [1, 2, 3, 4, 5, 6], out = 0, caught = 0;
    for (var i = 0; i < n; i++) {
      t.f = i;
      own.w = i + 1;
      try { s.v2 = (i % 5) - 1; } catch (e) { caught += e.message.length; }
      list.length = 3 + (i % 3);
      list.push(i);
      out += t.c + own.seen + s.v + list.length;
    }
    var date = new Date(0);
    var re = /a/g;
    re.lastIndex = n;
    return [Math.round(out), t.sets, caught, list.length, re.lastIndex, date.getTime()].join("|");
  }
  var last = "";
  for (var round = 0; round < 70; round++) last = stores(20);
  print(last);
})();
// Literals with a prototype: null, an object, and values that are no prototype.
(function () {
  var base = { greet: function () { return "hi " + this.name; } };
  function make(i) {
    var bare = { __proto__: null, k: i };
    var child = { __proto__: base, name: "n" + i };
    var plain = { __proto__: i, v: 1 };
    var text = { __proto__: "s" };
    return child.greet() + ":" + (Object.getPrototypeOf(bare) === null) + ":" + ("toString" in bare) + ":" + bare.k
      + ":" + (Object.getPrototypeOf(plain) === Object.prototype) + ":" + (Object.getPrototypeOf(text) === Object.prototype) + ":" + (Object.getPrototypeOf(child) === base);
  }
  var last = "";
  for (var i = 0; i < 300; i++) last = make(i);
  print(last);
})();
