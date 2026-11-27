// flatMap and flat read fast arrays directly, skip the generic length and
// isArray checks for plain dense arrays, and free a mapped array as soon as
// it has been flattened when nothing else holds it. Each case checks that
// results match the generic path: holes, proxies, array-likes, arrays the
// callback shares or keeps, arrays changed during the walk, and subclasses.
var failures = 0;
var say = typeof print === "function" ? print : console.log;
function check(got, want, label) { if (got !== want) { failures++; say("FAIL", label, got, want); } }
function collect() { if (typeof gc === "function") gc(); else if (typeof std === "object" && std.gc) std.gc(); }
var J = JSON.stringify;

var a = [1, 2, 3];
for (var round = 0; round < 3; round++) {
  check(J(a.flatMap(x => [x, x * 10])), "[1,10,2,20,3,30]", "pairs");
  check(J(a.flatMap(x => x)), "[1,2,3]", "non-array results");
  check(J(a.flatMap(x => [[x]])), "[[1],[2],[3]]", "depth one only");
  check(J(a.flatMap(x => [])), "[]", "empty results");
  var holey = [1, , 3];
  check(J(holey.flatMap(x => [x])), "[1,3]", "holey source");
  var withHole = []; withHole[2] = 5;
  check(J(a.flatMap(x => withHole)), "[5,5,5]", "holey result");
  check(J(a.flatMap(x => new Proxy([x, "p"], {}))), "[1,\"p\",2,\"p\",3,\"p\"]", "proxy result");
  check(J(a.flatMap(x => ({ length: 2, 0: x, 1: "o" }))), "[{\"0\":1,\"1\":\"o\",\"length\":2},{\"0\":2,\"1\":\"o\",\"length\":2},{\"0\":3,\"1\":\"o\",\"length\":2}]", "array-like not spread");
  check(J(a.flatMap(x => [{ v: x }, "s" + x])), "[{\"v\":1},\"s1\",{\"v\":2},\"s2\",{\"v\":3},\"s3\"]", "heap elements");
  // A result the callback shares must survive being flattened.
  var shared = [9, 8];
  check(J(a.flatMap(x => shared)), "[9,8,9,8,9,8]", "shared result");
  check(J(shared), "[9,8]", "shared result intact");
  // Results kept elsewhere stay alive and unchanged.
  var kept = [];
  var flat = a.flatMap(x => { var r = [{ id: x }, "k" + x]; kept.push(r); return r; });
  collect();
  check(kept.length, 3, "kept count");
  check(kept[1][0].id + kept[2][1], "2k3", "kept results intact");
  check(flat[4].id, 3, "kept flattened");
  // The source shrinks during the walk.
  var m = [1, 2, 3, 4];
  check(J(m.flatMap((x, i, arr) => { if (i == 0) arr.pop(); return [x, i]; })), "[1,0,2,1,3,2]", "source shrinks");
  // A result whose length lies about its storage.
  var grow = [1, 2];
  check(J(a.slice(0, 1).flatMap(x => { grow.length = 4; return grow; })), "[1,2]", "result with trailing holes");
  check(J([[1, [2]], [3]].flat()), "[1,[2],3]", "flat");
  check(J([[1, [2, [3]]]].flat(2)), "[1,2,[3]]", "flat depth 2");
  check(J([[1, , 2], [, 3]].flat()), "[1,2,3]", "flat holes");
  class Sub extends Array {}
  var s = Sub.from([1, 2]).flatMap(x => [x]);
  check(s instanceof Sub, true, "subclass species");
  check(J(s), "[1,2]", "subclass values");
  var t = 0;
  for (var k = 0; k < 200; k++) t += a.flatMap(x => [x, x]).length;
  check(t, 1200, "loop length");
  // Objects inside freed mapped arrays must stay alive in the result.
  var objs = a.flatMap(x => [{ id: x, o: { n: x } }]);
  collect();
  check(objs[2].id + objs[0].o.n, 4, "elements of freed arrays kept");
  var big = [];
  for (var i = 0; i < 500; i++) big.push(i);
  var pairs = big.flatMap(x => [x, "v" + x]);
  collect();
  check(pairs.length, 1000, "big length");
  check(pairs[999] + pairs[0], "v4990", "big values");
  var thrown = false;
  try { a.flatMap(x => { if (x == 2) throw new Error("boom"); return [x]; }); } catch (e) { thrown = e.message == "boom"; }
  check(thrown, true, "throw from callback");
}
collect();
if (failures) throw new Error(failures + " flatMap checks failed");
say("ok");
