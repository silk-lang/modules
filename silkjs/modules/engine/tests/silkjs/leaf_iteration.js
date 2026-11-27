// map, forEach and filter run small callbacks (leaves) element after element
// without pushing call operands; each case checks results, refcounts of what
// the callbacks return, and the switch back to ordinary calls when a callback
// needs a slow path part way through, the array changes, or thisArg is used.
var failures = 0;
var say = typeof print === "function" ? print : console.log;
function check(got, want, label) { if (got !== want) { failures++; say("FAIL", label, got, want); } }
function collect() { if (typeof gc === "function") gc(); else if (typeof std === "object" && std.gc) std.gc(); }

var nums = []; for (var i = 0; i < 1200; i++) nums.push(i);
var objs = []; for (var i = 0; i < 1200; i++) objs.push({ w: i % 50, k: "n" + i, o: { i: i } });
for (var round = 0; round < 3; round++) {
  // Numbers in, numbers out.
  var plus = nums.map(x => x + 1);
  check(plus.length, 1200, "map length");
  check(plus[0] + plus[1199], 1201, "map values");
  check(nums.map((x, i) => i).join() === nums.join(), true, "map index");
  check(nums.map((x, i, a) => a === nums)[600], true, "map array argument");
  // Heap values returned, borrowed from the elements: they must stay alive.
  for (var r = 0; r < 4; r++) { var keys = objs.map(o => o.k); keys = null; }
  var keys2 = objs.map(o => o.k);
  collect();
  check(keys2[7] + objs[7].k, "n7n7", "map strings kept");
  var inner = objs.map(o => o.o);
  inner = null;
  collect();
  check(objs[9].o.i, 9, "map objects kept");
  // filter: numbers, objects, truthiness of non-booleans.
  check(objs.filter(o => o.w > 20).length, 1200 / 50 * 29, "filter objects");
  check(nums.filter(x => x % 3).length, 800, "filter int truthiness");
  check(objs.filter(o => o.k).length, 1200, "filter string truthiness");
  check(objs.filter(o => o.o)[5].o.i, 5, "filter object truthiness");
  var picked = objs.filter(o => o.w === 3);
  picked = null;
  collect();
  check(objs[3].o.i, 3, "filter kept elements alive");
  // forEach with a leaf that stores to a field.
  var box = { n: 0 };
  nums.forEach(x => { box.n = x; });
  check(box.n, 1199, "forEach field store");
  // thisArg read by a leaf.
  var scale = { f: 3 };
  check(nums.map(function (x) { return this.f; }, scale)[10], 3, "map thisArg");
  check(nums.filter(function (x) { return this.f > 2; }, scale).length, 1200, "filter thisArg");
  // A callback that needs a slow path for some elements only.
  var mixed = nums.map(x => x === 600 ? "s" : x); mixed[600] = "s" + 600;
  var joined = mixed.map(x => x + 1);
  check(joined[599], 600, "decline before");
  check(joined[600], "s6001", "decline at");
  check(joined[601], 602, "decline after");
  check(mixed.filter(x => x + 1).length, 1200, "filter decline");
  // Results that switch from leaf to ordinary calls and back.
  var flip = nums.map(x => x < 400 || x > 800 ? x : { v: x });
  check(flip.map(v => v.v)[500], 500, "map getter on mixed");
  // The array changing under a callback that is not a leaf.
  var grow = [1, 2, 3, 4, 5];
  var seen = grow.map(function (x) { if (x === 2) grow.length = 3; return x * 10; });
  check(seen.join(), "10,20,30,,", "map shrink");
  var trail = nums.slice(0, 50);
  var visited = 0;
  trail.forEach(function (x) { visited++; if (x === 10) trail.pop(); });
  check(visited, 49, "forEach shrink");
  // Holes and non-fast arrays.
  var holes = [1, , 3]; check(holes.map(x => x * 2).join(), "2,,6", "map holes");
  check(holes.filter(x => true).length, 2, "filter holes");
  var sparse = []; sparse[5000] = 1; sparse[2] = 4;
  check(sparse.map(x => x + 1)[2], 5, "map sparse");
  // A subclass result (species) is not a fast plain target.
  class Sub extends Array {}
  var sub = Sub.from(nums.slice(0, 20));
  var mapped = sub.map(x => x + 1);
  check(mapped instanceof Sub, true, "species map");
  check(mapped[19], 20, "species values");
  // Throwing callbacks leave the loop.
  var thrown = false;
  try { nums.map(x => x.missing.deep); } catch (e) { thrown = e instanceof TypeError; }
  check(thrown, true, "throw from callback");
}
collect();
if (failures) throw new Error(failures + " leaf iteration checks failed");
say("ok");
