// map, filter and forEach over a fast Array with a leaf callback keep the
// previous result outside the operand stack between runs. Each case checks
// the results when a run declines part way (a getter, a proxy, a hole, a
// result that is a heap value, an overflow to a double, a throw) and when the
// array changes during the walk.
var failures = 0;
var say = typeof print === "function" ? print : console.log;
function check(got, want, label) { if (got !== want) { failures++; say("FAIL", label, got, want); } }
function collect() { if (typeof gc === "function") gc(); else if (typeof std === "object" && std.gc) std.gc(); }
var J = JSON.stringify;
for (var round = 0; round < 3; round++) {
  var a = []; for (var i = 0; i < 50; i++) a.push(i);
  check(J(a.map((x) => x + 1).slice(45)), "[46,47,48,49,50]", "map ints");
  check(a.map((x) => x * 2).reduce((s, v) => s + v, 0), 2450, "map sum");
  check(J([2147483647, 1].map((x) => x + 1)), "[2147483648,2]", "map overflow to double");
  check(J([1.5, 2].map((x) => x + 1)), "[2.5,3]", "map floats");
  check(J(["a", "b"].map((x) => x + "!")), "[\"a!\",\"b!\"]", "map strings");
  var objs = [{ k: 1 }, { k: 2 }, { get k() { return 30; } }, { k: 4 }, new Proxy({ k: 5 }, {})];
  check(J(objs.map((o) => o.k)), "[1,2,30,4,5]", "map with slow reads part way");
  check(J(objs.map((o) => o)), J(objs), "map heap results");
  var held = a.map((x) => ({ v: x }));
  collect();
  check(held[49].v + held[0].v, 49, "map object results kept");
  check(J([1, , 3].map((x) => x + 1)), "[2,null,4]", "map hole");
  check([1, , 3].map((x) => x + 1).hasOwnProperty(1), false, "map hole stays a hole");
  check(J(a.filter((x) => x % 7 == 0)), "[0,7,14,21,28,35,42,49]", "filter");
  check(J(objs.filter((o) => o.k > 2).map((o) => o.k)), "[30,4,5]", "filter with slow reads");
  var t = 0; a.forEach((x) => { t += x; });
  check(t, 1225, "forEach closure write");
  var u = 0; var o2 = { n: 0 }; a.forEach(function (x) { this.n = this.n + x; }, o2);
  check(o2.n, 1225, "forEach this field store");
  var thrown = false;
  try { a.map((x) => { if (x == 30) throw new Error("boom"); return x + 1; }); } catch (e) { thrown = e.message == "boom"; }
  check(thrown, true, "map throw");
  var b = [1, 2, 3, 4];
  check(J(b.map((x, i, arr) => { if (i == 1) arr.length = 2; return x + 1; })), "[2,3,null,null]", "map array shrinks");
  var c = [1, 2, 3];
  check(J(c.map((x, i, arr) => { if (i == 0) arr.push(9); return x * 10; })), "[10,20,30]", "map array grows");
  var s = 0;
  for (var k = 0; k < 100; k++) s += a.map((x) => x + 1).length;
  check(s, 5000, "map in a loop");
}
collect();
if (failures) throw new Error(failures + " leaf map checks failed");
say("ok");
