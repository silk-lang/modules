// Small objects and array literals holding only numbers die at once when the
// container holding their last reference dies; each case checks that the
// cells they leave behind start fresh, and that dying objects with anything
// more than numbers in them (or watched by weak references) still die right.
var failures = 0;
var say = typeof print === "function" ? print : console.log;
function check(got, want, label) { if (got !== want) { failures++; say("FAIL", label, got, want); } }
function collect() { if (typeof gc === "function") gc(); else if (typeof std === "object" && std.gc) std.gc(); }

var base = []; for (var i = 0; i < 600; i++) base.push(i);
var proto = { tag: "p" };
for (var round = 0; round < 4; round++) {
  // Leaves: pairs, points, frozen points, arrays with an extra numeric property.
  var pairs = base.map(function (x) { return [x, x + 1]; });
  var points = base.map(function (x) { return { x: x, y: -x }; });
  var frozen = base.map(function (x) { return Object.freeze({ f: x }); });
  var tagged = base.map(function (x) { var a = [x]; a.n = 2; return a; });
  var sum = 0;
  for (var k = 0; k < base.length; k++) sum += pairs[k][1] + points[k].y + frozen[k].f + tagged[k].n;
  check(sum, 600 * 601 / 2 + 1200, "leaf values");
  pairs = points = frozen = tagged = null;
  // Fresh objects made right after must not see the dead ones.
  var fresh = base.map(function (x) { return [x]; });
  var objs = base.map(function (x) { return {}; });
  var bad = 0;
  for (var m = 0; m < base.length; m++) {
    if (fresh[m].length !== 1 || fresh[m][0] !== m || "n" in fresh[m]) bad++;
    if (Object.keys(objs[m]).length !== 0 || Object.isFrozen(objs[m]) || "x" in objs[m]) bad++;
  }
  check(bad, 0, "fresh cells");
  fresh = objs = null;
  // Not leaves: holding strings, objects, accessors, a prototype.
  var strings = base.map(function (x) { return ["s" + x, x]; });
  var nested = base.map(function (x) { return { inner: [x, x] }; });
  var getters = base.map(function (x) { return { get v() { return x; } }; });
  var protod = base.map(function (x) { var o = Object.create(proto); o.v = x; return o; });
  var t = 0;
  for (var n = 0; n < base.length; n++) t += strings[n][0].length + nested[n].inner[1] + getters[n].v + protod[n].v;
  check(t > 0, true, "non-leaf values");
  strings = nested = getters = protod = null;
  check(proto.tag, "p", "prototype alive");
  // A weakly referenced leaf in a dying container.
  var watched = base.map(function (x) { return { w: x }; });
  var ref = new WeakRef(watched[7]);
  var seen = 0;
  var registry = new FinalizationRegistry(function () { seen++; });
  registry.register(watched[8], "eight");
  watched = null;
  collect();
  var held = ref.deref();
  check(held === undefined || held.w === 7, true, "weak ref to leaf");
  // Cons cells of leaves (destroyed through the small-object path).
  var list = null;
  for (var c = 0; c < 500; c++) list = { car: [c, c], cdr: list };
  var len = 0; for (var p = list; p; p = p.cdr) len += p.car[0] - p.car[1] + 1;
  check(len, 500, "cons list");
  list = null;
  // Many temporaries dying one by one.
  var acc = 0;
  base.forEach(function (x) { acc += [x, x].length + { a: x }.a; });
  check(acc, 600 * 2 + 600 * 599 / 2, "temporaries");
}
collect();
if (failures) throw new Error(failures + " leaf death checks failed");
say("ok");
