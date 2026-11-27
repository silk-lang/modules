// Object.assign frees a dying source that holds only immediates (a literal
// such as { a: i, b: 2 }) at once; a source that is shared, holds heap values
// or is otherwise kept must keep working.
var failures = 0;
var say = typeof print === "function" ? print : console.log;
function check(got, want, label) { if (got !== want) { failures++; say("FAIL", label, got, want); } }
function collect() { if (typeof gc === "function") gc(); else if (typeof std === "object" && std.gc) std.gc(); }
var proto = { hello() { return 1; } };
for (var round = 0; round < 3; round++) {
  var s = 0;
  for (var i = 0; i < 2000; i++) { var o = Object.assign(Object.create(proto), { a: i, b: 2 }); s += o.a + o.b + o.hello(); }
  check(s, 1999 * 1000 + 6000, "literal sources");
  var kept = { a: 1, b: 2 };
  var t = Object.assign({}, kept);
  kept.a = 5;
  check(t.a + kept.a, 6, "kept source");
  var objs = [];
  for (var i = 0; i < 200; i++) objs.push(Object.assign({}, { k: "v" + i, o: { n: i } }));
  collect();
  check(objs[199].k + objs[3].o.n, "v1993", "heap values in source");
  var withNum = Object.assign({ z: 0 }, { x: 1.5, y: true, n: null, u: undefined });
  check(withNum.x + (withNum.y ? 1 : 0) + (withNum.n === null ? 1 : 0) + (withNum.u === undefined ? 1 : 0), 4.5, "immediates");
}
collect();
if (failures) throw new Error(failures + " assign leaf checks failed");
say("ok");
