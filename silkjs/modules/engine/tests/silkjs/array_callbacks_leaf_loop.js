// Array.prototype every, some, forEach, map, filter, reduce and reduceRight run a
// small callback (a leaf: no frame of its own) in place, element after element.
// A function becomes a leaf only once it has run, so every case here runs
// several times and must agree with a plain loop each time. Whatever the leaf
// loop declines (a slow element, a result array that must grow, a callback that
// stopped being a leaf, a due interrupt poll) goes back to the ordinary loop.
let failures = 0;
function check(got, want, label) { if (got !== want) { failures++; console.log("FAIL", label, got, want); } }
function show(value) {
  return JSON.stringify(value, (key, item) => (item === undefined ? "<undefined>" : typeof item === "number" && item !== item ? "<NaN>" : item));
}
function rounds(label, run, want) {
  for (var round = 0; round < 5; round++) check(show(run()), show(want), label + " (round " + round + ")");
}

// Plain loops to agree with (holes skipped, length read once).
function refMap(a, f, t) { var r = new Array(a.length); for (var i = 0, n = a.length; i < n; i++) if (i in a) r[i] = f.call(t, a[i], i, a); return r; }
function refFilter(a, f, t) { var r = []; for (var i = 0, n = a.length; i < n; i++) if (i in a) { var v = a[i]; if (f.call(t, v, i, a)) r.push(v); } return r; }
function refEvery(a, f, t) { for (var i = 0, n = a.length; i < n; i++) if (i in a && !f.call(t, a[i], i, a)) return false; return true; }
function refSome(a, f, t) { for (var i = 0, n = a.length; i < n; i++) if (i in a && f.call(t, a[i], i, a)) return true; return false; }
function refReduce(a, f, start) { var acc = start; for (var i = 0, n = a.length; i < n; i++) if (i in a) acc = f(acc, a[i], i, a); return acc; }
function refReduceRight(a, f, start) { var acc = start; for (var i = a.length - 1; i >= 0; i--) if (i in a) acc = f(acc, a[i], i, a); return acc; }

function numbers(n) { var a = []; for (var i = 0; i < n; i++) a.push(i); return a; }
var sizes = [0, 1, 2, 3, 4, 7, 8, 9, 100, 1000];

// Every method over every size, with callbacks that are leaves.
for (var s = 0; s < sizes.length; s++) {
  var n = sizes[s];
  var a = numbers(n);
  var tag = " over " + n;
  rounds("map" + tag, () => a.map((x) => x + 1), refMap(a, (x) => x + 1));
  rounds("map with index" + tag, () => a.map((x, i) => x * i), refMap(a, (x, i) => x * i));
  rounds("map with the array" + tag, () => a.map((x, i, all) => all[all.length - 1 - i]), refMap(a, (x, i, all) => all[all.length - 1 - i]));
  rounds("map to undefined" + tag, () => a.map((x) => undefined), refMap(a, (x) => undefined));
  rounds("filter odd" + tag, () => a.filter((x) => x & 1), refFilter(a, (x) => x & 1));
  rounds("filter all" + tag, () => a.filter((x) => true), refFilter(a, (x) => true));
  rounds("filter none" + tag, () => a.filter((x) => 0), refFilter(a, (x) => 0));
  rounds("filter by index" + tag, () => a.filter((x, i) => i % 3 === 0), refFilter(a, (x, i) => i % 3 === 0));
  rounds("every true" + tag, () => a.every((x) => x >= 0), refEvery(a, (x) => x >= 0));
  rounds("every false midway" + tag, () => a.every((x) => x < 5), refEvery(a, (x) => x < 5));
  rounds("some false" + tag, () => a.some((x) => x < 0), refSome(a, (x) => x < 0));
  rounds("some true midway" + tag, () => a.some((x) => x === 6), refSome(a, (x) => x === 6));
  rounds("some true at the end" + tag, () => a.some((x) => x === n - 1), refSome(a, (x) => x === n - 1));
  rounds("reduce" + tag, () => a.reduce((acc, x) => acc + x, 0), refReduce(a, (acc, x) => acc + x, 0));
  rounds("reduce with index" + tag, () => a.reduce((acc, x, i) => acc + x * i, 10), refReduce(a, (acc, x, i) => acc + x * i, 10));
  rounds("reduceRight" + tag, () => a.reduceRight((acc, x) => acc * 2 + x, 0) % 1000003, refReduceRight(a, (acc, x) => acc * 2 + x, 0) % 1000003);
  rounds("forEach result" + tag, () => a.forEach((x) => x + 1), undefined);
  if (n > 0) {
    rounds("reduce without a start" + tag, () => a.reduce((acc, x) => acc + x), refReduce(a.slice(1), (acc, x) => acc + x, a[0]));
    rounds("reduceRight without a start" + tag, () => a.reduceRight((acc, x) => acc - x), refReduceRight(a.slice(0, n - 1), (acc, x) => acc - x, a[n - 1]));
  }
}

// How often and with what the callback runs: counted by a callback that writes
// a captured variable, and by one that writes a field.
var seen = 0, last = -1;
var box = { calls: 0, sum: 0 };
var hundred = numbers(100);
for (var round = 0; round < 5; round++) {
  seen = 0; hundred.forEach((x) => { seen = seen + 1; last = x; });
  check(seen, 100, "forEach calls"); check(last, 99, "forEach last element");
  box.calls = 0; box.sum = 0; hundred.forEach((x) => { box.sum = box.sum + x; box.calls = box.calls + 1; });
  check(box.calls, 100, "forEach field calls"); check(box.sum, 4950, "forEach field sum");
  seen = 0; check(hundred.every((x) => { seen = seen + 1; return x < 40; }), false, "every stops"); check(seen, 41, "every stops at the first false");
  seen = 0; check(hundred.some((x) => { seen = seen + 1; return x === 12; }), true, "some stops"); check(seen, 13, "some stops at the first true");
  seen = 0; check(hundred.filter((x) => { seen = seen + 1; return x % 10 === 0; }).length, 10, "filter keeps"); check(seen, 100, "filter calls");
  seen = 0; check(hundred.reduce((acc, x) => { seen = seen + 1; return acc + x; }), 4950, "reduce without a start"); check(seen, 99, "reduce calls without a start");
}

// The receiver: thisArg, and none.
var holder = { k: 10 };
rounds("map with thisArg", () => hundred.map(function (x) { return this.k + x; }, holder), refMap(hundred, function (x) { return this.k + x; }, holder));
rounds("filter with thisArg", () => hundred.filter(function (x) { return x > this.k; }, holder), refFilter(hundred, function (x) { return x > this.k; }, holder));
rounds("strict callback without thisArg", () => [1, 2, 3].map(function () { "use strict"; return this === undefined; }), [true, true, true]);
rounds("sloppy callback without thisArg", () => [1, 2, 3].map(function () { return this === globalThis; }), [true, true, true]);
rounds("sloppy callback with a primitive thisArg", () => [1, 2].map(function () { return typeof this; }, 5), ["object", "object"]);
rounds("arrow ignores thisArg", () => [1, 2].map((x) => typeof this, holder), [typeof this, typeof this]);

// What the elements are: objects kept, returned and read; strings; doubles; mixed.
var objects = []; for (var i = 0; i < 50; i++) objects.push({ id: i, v: i * 2, tag: "t" + i });
rounds("map to a field", () => objects.map((o) => o.v), refMap(objects, (o) => o.v));
rounds("map to the element", () => objects.map((o) => o).every((o, i) => o === objects[i]), true);
rounds("filter objects", () => objects.filter((o) => o.id % 7 === 0).map((o) => o.id), refFilter(objects, (o) => o.id % 7 === 0).map((o) => o.id));
rounds("reduce to an element", () => objects.reduce((best, o) => (o.v > best.v ? o : best)).id, 49);
rounds("some over fields", () => objects.some((o) => o.tag === "t49"), true);
var words = ["a", "bb", "", "dddd", "e"];
rounds("map string lengths", () => words.map((w) => w.length), [1, 2, 0, 4, 1]);
rounds("filter empty strings", () => words.filter((w) => w), ["a", "bb", "dddd", "e"]);
rounds("reduce strings", () => words.reduce((acc, w) => acc + w, ">"), ">abbdddde");
rounds("reduceRight strings", () => words.reduceRight((acc, w) => acc + w, ">"), ">eddddbba");
var doubles = [0.5, 1.5, -0, NaN, 1e300, 3];
rounds("map doubles", () => doubles.map((x) => x * 2), refMap(doubles, (x) => x * 2));
rounds("filter NaN and zero", () => doubles.filter((x) => x), [0.5, 1.5, 1e300, 3]);
var mixed = [1, "two", null, undefined, { v: 3 }, [4], true, 5.5];
rounds("map typeof", () => mixed.map((x) => typeof x), refMap(mixed, (x) => typeof x));
rounds("filter nullish", () => mixed.filter((x) => x == null).length, 2);
rounds("map more parameters than arguments", () => [1, 2].map((a, b, c, d, e) => d === undefined && e === undefined), [true, true]);

// Arrays whose elements are not plain fast elements: holes, accessors, a
// prototype that supplies holes, array-likes.
var holey = [1, , 3, , , 6];
rounds("map over holes", () => holey.map((x) => x * 2), refMap(holey, (x) => x * 2));
rounds("holes stay holes", () => 1 in holey.map((x) => x * 2), false);
rounds("filter over holes", () => holey.filter((x) => true), [1, 3, 6]);
rounds("reduce over holes", () => holey.reduce((acc, x) => acc + x), 10);
rounds("reduceRight over holes", () => holey.reduceRight((acc, x) => acc + "" + x, ""), "631");
seen = 0; holey.forEach((x) => { seen = seen + 1; }); check(seen, 3, "forEach skips holes");
var computed = [1, 2, 3, 4];
Object.defineProperty(computed, 2, { get() { return 30; }, enumerable: true, configurable: true });
rounds("map over an accessor element", () => computed.map((x) => x + 1), [2, 3, 31, 5]);
rounds("filter over an accessor element", () => computed.filter((x) => x > 2), [30, 4]);
var like = { length: 4, 0: "a", 1: "b", 3: "d" };
rounds("map over an array-like", () => Array.prototype.map.call(like, (x) => x + x), ["aa", "bb", , "dd"]);
rounds("filter over an array-like", () => Array.prototype.filter.call(like, (x) => x !== "b"), ["a", "d"]);
rounds("reduce over an array-like", () => Array.prototype.reduce.call(like, (acc, x) => acc + x), "abd");
rounds("every over a string", () => Array.prototype.every.call("abc", (c) => c < "d"), true);
rounds("map over arguments", () => (function () { return Array.prototype.map.call(arguments, (x) => x * 3); })(1, 2, 3), [3, 6, 9]);
var frozen = Object.freeze([1, 2, 3]);
rounds("map over a frozen array", () => frozen.map((x) => x + 1), [2, 3, 4]);
Array.prototype[1] = "from the prototype";
rounds("a hole the prototype fills", () => [0, , 2].map((x) => x), [0, "from the prototype", 2]);
delete Array.prototype[1];

// Results that are not a plain Array, or must grow.
class Sub extends Array {}
var sub = Sub.from([1, 2, 3]);
rounds("map keeps the species", () => { var r = sub.map((x) => x + 1); return [r instanceof Sub, r.length, r[2]]; }, [true, 3, 4]);
rounds("filter keeps the species", () => { var r = sub.filter((x) => x > 1); return [r instanceof Sub, r.length, r[1]]; }, [true, 2, 3]);
// A species constructor that ignores the length it is given: the result keeps
// the length its own elements gave it, trailing holes and all.
function shortSpecies(source) { source.constructor = {}; source.constructor[Symbol.species] = function () { return []; }; return source; }
rounds("map into a species array, source ends in a hole", () => { var r = shortSpecies([1, 2, , ]).map((x) => x); return [r.length, r[1]]; }, [2, 2]);
rounds("map into a species array, source shrunk on the way", () => { var b = shortSpecies([1, 2, 3, 4]); var r = b.map((x, i) => { if (i === 1) b.length = 2; return x; }); return [r.length, r[1]]; }, [2, 2]);
rounds("map over a hole at the end", () => { var r = [1, 2, , ].map((x) => x); return [r.length, 2 in r]; }, [3, false]);
var thousands = numbers(5000);
rounds("filter that grows its result", () => { var r = thousands.filter((x) => x % 3 !== 0); return [r.length, r[0], r[1], r[r.length - 1]]; }, [3333, 1, 2, 4999]);

// Long arrays: the loop gives way to the interrupt poll and comes back.
var long = numbers(35000);
rounds("map over a long array", () => { var r = long.map((x) => x + 1); return [r.length, r[0], r[9999], r[10000], r[10001], r[19999], r[20000], r[34999]]; }, [35000, 1, 10000, 10001, 10002, 20000, 20001, 35000]);
rounds("filter over a long array", () => { var r = long.filter((x) => x % 2); return [r.length, r[4999], r[5000], r[17499]]; }, [17500, 9999, 10001, 34999]);
rounds("reduce over a long array", () => long.reduce((acc, x) => acc + x, 0), 612482500);
rounds("reduceRight over a long array", () => long.reduceRight((acc, x) => (acc + x) % 1000003, 0), 612482500 % 1000003);
rounds("every over a long array", () => long.every((x) => x < 34999), false);
rounds("some over a long array", () => long.some((x) => x === 34999), true);
for (var round = 0; round < 3; round++) { seen = 0; long.forEach((x) => { seen = seen + 1; }); check(seen, 35000, "forEach over a long array"); }
// Longer than 65,536: a dense source still gets a dense result filled in place;
// a sparse one of the same length keeps its holes and its length.
var longer = numbers(70000);
rounds("map over more than 65,536 elements", () => { var r = longer.map((x) => x * 2); return [r.length, r[0], r[65535], r[65536], r[65537], r[69999]]; }, [70000, 0, 131070, 131072, 131074, 139998]);
rounds("map over more than 65,536 elements, shrunk on the way", () => { var a = numbers(70000); var r = a.map((x, i) => { if (i === 66000) a.length = 66010; return x; }); return [r.length, r[66009], 66010 in r, 69999 in r]; }, [70000, 66009, false, false]);
var sparse = []; sparse.length = 200000; sparse[5] = 5; sparse[150000] = 7;
rounds("map over a long sparse array", () => { var r = sparse.map((x) => x + 1); return [r.length, r[5], r[150000], 6 in r, Object.keys(r).length]; }, [200000, 6, 8, false, 2]);
rounds("filter over more than 65,536 elements", () => { var r = longer.filter((x) => x >= 65530 && x < 65540); return [r.length, r[0], r[9]]; }, [10, 65530, 65539]);

// A callback that stops being a leaf partway: an element whose field is a
// getter, an element the callback throws on, a callback that calls.
var plain = []; for (var i = 0; i < 40; i++) plain.push({ v: i });
var withGetter = plain.slice(); withGetter[17] = { get v() { return -17; } };
rounds("a getter among the elements", () => withGetter.map((o) => o.v), refMap(withGetter, (o) => o.v));
rounds("a getter among the elements, filter", () => withGetter.filter((o) => o.v < 3).length, 4);
rounds("a getter among the elements, reduce", () => withGetter.reduce((acc, o) => acc + o.v, 0), 780 - 17 - 17);
var withMissing = plain.slice(); withMissing[23] = null;
for (var round = 0; round < 5; round++) {
  var reached = -1, threw = false;
  try { withMissing.map((o, i) => { reached = i; return o.v; }); } catch (e) { threw = e instanceof TypeError; }
  check(threw, true, "callback throws on an element"); check(reached, 23, "the throwing element is the last one called");
  threw = false;
  try { withMissing.reduce((acc, o) => acc + o.v, 0); } catch (e) { threw = e instanceof TypeError; }
  check(threw, true, "reduce callback throws on an element");
  check(plain.map((o) => o.v).length, 40, "the same callback shape after a throw");
}
var getters = []; for (var i = 0; i < 300; i++) getters.push({ get v() { return 7; } });
rounds("a getter on every element", () => getters.map((o) => o.v).reduce((acc, v) => acc + v, 0), 2100);
rounds("the same callback over plain elements again", () => plain.map((o) => o.v)[39], 39);
function double(x) { return x * 2; }
rounds("a callback that calls", () => hundred.map((x) => double(x) + 1), refMap(hundred, (x) => x * 2 + 1));
rounds("a callback that allocates", () => hundred.map((x) => ({ x })).length, 100);
rounds("a callback with a loop", () => [3, 4].map((x) => { var t = 0; for (var i = 0; i < x; i++) t += i; return t; }), [3, 6]);
var conditional = (x) => (x === 77 ? String(x) : x);
rounds("a callback that calls for one element", () => hundred.map(conditional), refMap(hundred, conditional));

// Callbacks that change the array while it is walked.
rounds("elements appended while walked are not visited", () => { var a = [1, 2, 3]; var n = 0; a.forEach((x) => { n = n + 1; if (a.length < 10) a.push(x); }); return [n, a.length]; }, [3, 6]);
rounds("elements removed while walked are skipped", () => { var a = [1, 2, 3, 4, 5]; return a.map((x, i) => { if (i === 1) a.length = 3; return x; }); }, [1, 2, 3, , ,]);
rounds("elements replaced while walked are seen", () => { var a = [1, 2, 3, 4]; return a.map((x, i, all) => { if (i + 1 < all.length) all[i + 1] = x * 10; return x; }); }, [1, 10, 100, 1000]);
rounds("elements deleted while walked are skipped", () => { var a = [1, 2, 3, 4]; return a.filter((x, i) => { delete a[i + 1]; return true; }); }, [1, 3]);
rounds("an array turned slow while walked", () => { var a = [1, 2, 3, 4]; return a.map((x, i) => { if (i === 1) Object.defineProperty(a, 3, { get() { return 40; }, configurable: true }); return x; }); }, [1, 2, 3, 40]);
rounds("field writes through the array argument", () => { var a = [{ n: 0 }, { n: 0 }]; a.forEach((o, i, all) => { all[i].n = i + 1; }); return a.map((o) => o.n); }, [1, 2]);

// Callbacks that are not bytecode leaves at all, and nested walks.
rounds("native callback", () => [1.5, -2.5].map(Math.abs), [1.5, 2.5]);
rounds("native constructor callback", () => ["1", "2"].map(Number), [1, 2]);
rounds("bound callback", () => [1, 2].map(function (x) { return this.k + x; }.bind(holder)), [11, 12]);
rounds("generator callback", () => [1, 2].map(function* (x) { yield x; }).map((g) => g.next().value), [1, 2]);
rounds("nested walks", () => [1, 2, 3].map((x) => [10, 20].map((y) => x + y).reduce((acc, v) => acc + v, 0)), [32, 34, 36]);
rounds("a leaf walk inside a full callback", () => hundred.filter(function (x) { return [x, x + 1].some((y) => y % 50 === 0); }), [0, 49, 50, 99]);
for (var round = 0; round < 3; round++) {
  var threwType = false;
  try { [1].map(null); } catch (e) { threwType = e instanceof TypeError; }
  check(threwType, true, "a callback that is not callable");
  threwType = false;
  try { [1].map(class A {}); } catch (e) { threwType = e instanceof TypeError; }
  check(threwType, true, "a class as the callback");
  check([].reduce((acc, x) => acc + x, "start"), "start", "reduce of nothing with a start");
  threwType = false;
  try { [].reduce((acc, x) => acc + x); } catch (e) { threwType = e instanceof TypeError; }
  check(threwType, true, "reduce of nothing without a start");
}

// One callback function shared by several methods and walks.
var isEven = (x) => x % 2 === 0;
for (var round = 0; round < 5; round++) {
  check(hundred.filter(isEven).length, 50, "shared callback, filter");
  check(hundred.every(isEven), false, "shared callback, every");
  check(hundred.some(isEven), true, "shared callback, some");
  check(hundred.map(isEven)[98], true, "shared callback, map");
  check(holey.filter(isEven).length, 1, "shared callback over holes");
  check(Array.prototype.filter.call(like, isEven).length, 0, "shared callback over an array-like");
}

if (failures) throw new Error(failures + " array callback leaf loop checks failed");
