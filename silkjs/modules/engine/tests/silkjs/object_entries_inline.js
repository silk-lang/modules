// Object.values and Object.entries answer an ordinary object of plain data
// properties without a native frame. Each case checks that results match the
// full call: order, integer keys, getters, non-enumerable and symbol keys,
// proxies, primitives, a call through call_method, and heap values kept alive.
var failures = 0;
var say = typeof print === "function" ? print : console.log;
function check(got, want, label) { if (got !== want) { failures++; say("FAIL", label, got, want); } }
function collect() { if (typeof gc === "function") gc(); else if (typeof std === "object" && std.gc) std.gc(); }
var J = JSON.stringify;
var entries = Object.entries, values = Object.values;

for (var round = 0; round < 3; round++) {
  var o = { id: 1, name: "n", w: { k: 2 } };
  var t = 0;
  for (var i = 0; i < 300; i++) t += Object.entries(o).length + Object.values(o).length;
  check(t, 1800, "loop lengths");
  check(J(Object.entries(o)), "[[\"id\",1],[\"name\",\"n\"],[\"w\",{\"k\":2}]]", "entries");
  check(J(Object.values(o)), "[1,\"n\",{\"k\":2}]", "values");
  check(J(entries({})), "[]", "empty entries");
  check(J(values({})), "[]", "empty values");
  check(J(Object.entries({ b: 1, 2: "x", a: 3, 1: "y" })), "[[\"1\",\"y\"],[\"2\",\"x\"],[\"b\",1],[\"a\",3]]", "integer keys first");
  var g = { a: 1, get b() { return "got"; }, c: 3 };
  check(J(Object.entries(g)), "[[\"a\",1],[\"b\",\"got\"],[\"c\",3]]", "getter");
  check(J(Object.values(g)), "[1,\"got\",3]", "getter values");
  var hidden = { a: 1 };
  Object.defineProperty(hidden, "h", { value: 2, enumerable: false });
  hidden[Symbol("s")] = 3;
  hidden.z = 4;
  check(J(Object.entries(hidden)), "[[\"a\",1],[\"z\",4]]", "non-enumerable and symbol skipped");
  var p = new Proxy({ x: 1, y: 2 }, {});
  check(J(Object.entries(p)), "[[\"x\",1],[\"y\",2]]", "proxy");
  check(J(Object.entries("ab")), "[[\"0\",\"a\"],[\"1\",\"b\"]]", "string");
  check(J(Object.values([7, 8])), "[7,8]", "array");
  check(J(Object.entries(5)), "[]", "number");
  var thrown = false;
  try { Object.entries(null); } catch (e) { thrown = e instanceof TypeError; }
  check(thrown, true, "null throws");
  thrown = false;
  try { values(undefined); } catch (e) { thrown = e instanceof TypeError; }
  check(thrown, true, "undefined throws");
  var d = { a: 1, b: 2 }; delete d.a;
  check(J(Object.entries(d)), "[[\"b\",2]]", "after delete");
  function C() { this.q = 1; } C.prototype.r = 2;
  check(J(Object.entries(new C())), "[[\"q\",1]]", "own only");
  // Heap values in the result outlive the source.
  var kept = Object.entries({ s: "v" + round, o: { n: round } });
  var vs = Object.values({ a: [round], b: "w" + round });
  collect();
  check(kept[0][1] + kept[1][1].n, "v" + round + round, "kept entries");
  check(vs[0][0] + vs[1], round + "w" + round, "kept values");
  var e2 = entries.call(null, { m: 1 });
  check(J(e2), "[[\"m\",1]]", "through call");
}
collect();
if (failures) throw new Error(failures + " entries checks failed");
say("ok");
