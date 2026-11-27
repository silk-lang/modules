// Private field writes on the dispatch loop's quick path, and the cases it
// leaves to the full path: missing fields, methods, accessors, getters only,
// static fields and objects stamped through a returned override.
var failures = 0;
var say = typeof print === "function" ? print : console.log;
function check(got, want, label) { if (got !== want) { failures++; say("FAIL", label, got, want); } }
function throwsType(fn) { try { fn(); return false; } catch (e) { return e instanceof TypeError; } }

class Counter {
  #n = 0; #o = null; static #total = 0;
  bump() { this.#n++; Counter.#total += 1; return this.#n; }
  setObj(v) { this.#o = v; return this.#o; }
  static total() { return Counter.#total; }
  static poke(o) { o.#n = 5; return o.#n; }
}
var c = new Counter();
for (var i = 0; i < 1000; i++) c.bump();
check(c.bump(), 1001, "increments");
check(Counter.total(), 1001, "static field");
var held = { k: 1 };
check(c.setObj(held), held, "object value");
check(c.setObj("s" + 1), "s1", "string value");
for (var j = 0; j < 100; j++) c.setObj({ j: j });
check(c.setObj(null), null, "replaced values");
check(throwsType(function () { Counter.poke({}); }), true, "missing field throws");
check(Counter.poke(new Counter()), 5, "other instance");

class Methods {
  #m() { return 1; }
  get #g() { return 2; }
  set #s(v) { this.last = v; }
  writeMethod() { this.#m = 3; }
  writeGetter() { this.#g = 3; }
  writeSetter(v) { this.#s = v; return this.last; }
}
var m = new Methods();
check(throwsType(function () { m.writeMethod(); }), true, "method not writable");
check(throwsType(function () { m.writeGetter(); }), true, "getter only");
check(m.writeSetter(9), 9, "setter runs");

class Base { constructor(o) { return o; } }
class Stamp extends Base { #tag = 1; static set(o, v) { o.#tag = v; return o.#tag; } constructor(o) { super(o); } }
var plain = {};
new Stamp(plain);
check(Stamp.set(plain, 7), 7, "stamped object");
var target = {}; var proxy = new Proxy(target, {});
new Stamp(proxy);
check(Stamp.set(proxy, 8), 8, "stamped proxy");
check(throwsType(function () { Stamp.set(target, 1); }), true, "proxy target unstamped");
check(throwsType(function () { Stamp.set(null, 1); }), true, "null receiver");
check(throwsType(function () { Stamp.set(1, 1); }), true, "number receiver");

if (failures) throw new Error(failures + " private write checks failed");
say("ok");
