// A leaf method may store to a private field (`this.#x++; return this.#x`)
// without a frame. Each case checks the stored values, a heap value stored
// over and kept elsewhere, a store whose old value is the last reference,
// a run declined after its store (taken back), objects without the field,
// private methods and accessors, and static private fields.
"use strict";
var failures = 0;
var say = typeof print === "function" ? print : console.log;
function check(got, want, label) { if (got !== want) { failures++; say("FAIL", label, got, want); } }
function collect() { if (typeof gc === "function") gc(); else if (typeof std === "object" && std.gc) std.gc(); }

class Counter {
  #x = 1;
  #o = null;
  get() { return this.#x; }
  bump() { this.#x++; return this.#x; }
  set(v) { this.#x = v; return this.#x; }
  keep(o) { this.#o = o; return this.#o; }
  held() { return this.#o; }
  // Stores, then a read that needs the slow path part way (a getter).
  bumpThen(p) { this.#x++; return p.k; }
  static has(o) { return #x in o; }
}
class Statics {
  static #n = 0;
  static next() { Statics.#n++; return Statics.#n; }
}
class Methods {
  #m() { return 1; }
  get #a() { return 2; }
  set #a(v) { this.last = v; }
  write(v) { this.#a = v; return this.last; }
  call() { return this.#m(); }
}

for (var round = 0; round < 3; round++) {
  var c = new Counter();
  var s = 0;
  for (var i = 0; i < 2000; i++) s += c.bump() + c.get();
  check(s, 2001 * 2002 - 2, "bump and get");
  check(c.get(), 2001, "final value");
  check(c.set(7), 7, "set int");
  check(c.set("s" + round), "s" + round, "set string");
  // A heap value stored over while something else still holds it.
  var a = { id: 1 }, b = { id: 2 };
  check(c.keep(a), a, "keep a");
  var kept = 0;
  for (var i = 0; i < 100; i++) { kept += c.keep(i & 1 ? a : b).id; }
  check(kept, 150, "keep alternating");
  // The old value's last reference: the store must take the full path.
  c.keep({ id: 3 });
  check(c.keep({ id: 4 }).id, 4, "last reference stored over");
  collect();
  check(c.held().id, 4, "held after collect");
  // A declined run must take its store back, then the full call stores once.
  var getter = { get k() { return "g"; } };
  c.set(10);
  check(c.bumpThen({ k: "f" }), "f", "store then fast read");
  check(c.get(), 11, "one store");
  check(c.bumpThen(getter), "g", "store then getter");
  check(c.get(), 12, "store not doubled after decline");
  check(c.bumpThen(new Proxy({ k: "p" }, {})), "p", "store then proxy");
  check(c.get(), 13, "store not doubled after proxy");
  // Objects without the field throw.
  var thrown = false;
  try { Counter.prototype.bump.call({}); } catch (e) { thrown = e instanceof TypeError; }
  check(thrown, true, "missing field throws");
  thrown = false;
  try { Counter.prototype.set.call(null, 1); } catch (e) { thrown = e instanceof TypeError; }
  check(thrown, true, "null receiver throws");
  check(Counter.has(c), true, "brand check");
  var t = 0;
  for (var i = 0; i < 100; i++) t = Statics.next();
  check(t, 100 * (round + 1), "static private field");
  var m = new Methods();
  check(m.write(5), 5, "private setter");
  check(m.call(), 1, "private method");
  thrown = false;
  try { (function () { class W { #m() {} w() { this.#m = 1; } } new W().w(); })(); } catch (e) { thrown = e instanceof TypeError; }
  check(thrown, true, "write to private method throws");
}
collect();
if (failures) throw new Error(failures + " private leaf store checks failed");
say("ok");
