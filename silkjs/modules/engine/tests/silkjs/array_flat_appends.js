// flat and flatMap appending straight to the result's storage, and the cases
// that must keep the ordinary Has, Get and CreateDataProperty steps.
var failures = 0;
function check(got, want, label) { if (got !== want) { failures++; print("FAIL", label, got, want); } }
function show(a) {
  var out = "";
  for (var i = 0; i < a.length; i++) out += (i ? "," : "") + (Object.prototype.hasOwnProperty.call(a, i) ? String(a[i]) : "hole");
  return a.length + ":" + out;
}

for (var round = 0; round < 3; round++) {
  var base = [];
  for (var i = 0; i < 40; i++) base.push(i);
  var doubled = base.flatMap(function (x) { return [x, x * 10]; });
  check(doubled.length, 80, "flatMap length");
  check(doubled[0] + "," + doubled[1] + "," + doubled[78] + "," + doubled[79], "0,0,39,390", "flatMap values");
  check(show([1, [2, 3], 4, [], [5]].flat()), "5:1,2,3,4,5", "flat mixed");
  check(show([[1, [2, [3]]]].flat(2)), "3:1,2,3", "flat depth 2");
  check(show([[1, [2]]].flat()), "2:1,2", "flat keeps inner arrays at depth");
  check(Array.isArray([[1, [2]]].flat()[1]), true, "inner array kept");

  // Holes and a length past the elements read as absent.
  check(show([[1, , 3]].flat()), "2:1,3", "inner hole skipped");
  var longer = [7]; longer.length = 3;
  check(show([longer, [8]].flat()), "2:7,8", "length past elements");
  check(show([, [1]].flat()), "1:1", "outer hole");

  // The same array returned for every element.
  var shared = ["s"];
  check(show([1, 2, 3].flatMap(function () { return shared; })), "3:s,s,s", "shared inner");

  // A proxy of an array is flattened through its traps.
  var gets = 0;
  var proxy = new Proxy([5, 6], { get: function (t, k) { if (k === "0" || k === "1") gets++; return t[k]; } });
  check(show([proxy].flat()), "2:5,6", "proxy inner");
  check(gets, 2, "proxy traps");

  // Species: a constructor returning an array with elements already in place.
  class Pre extends Array { static get [Symbol.species]() { return function () { return [9, 9, 9]; }; } }
  var pre = Pre.from([[1], [2]]);
  check(show(pre.flat()), "3:1,2,9", "species target with elements");
  class Sub extends Array {}
  var sub = Sub.from([[1, 2], 3]).flat();
  check(sub instanceof Sub, true, "subclass result");
  check(show(sub), "3:1,2,3", "subclass values");

  // A frozen species target makes the definitions throw.
  class Frozen extends Array { static get [Symbol.species]() { return function () { return Object.freeze([]); }; } }
  var threw = false;
  try { Frozen.from([[1]]).flat(); } catch (e) { threw = e instanceof TypeError; }
  check(threw, true, "frozen target");
}

// A setter on Array.prototype at an index stops direct appends.
var stored = [];
Object.defineProperty(Array.prototype, 1, { set: function (v) { stored.push(v); }, get: function () { return "proto"; }, configurable: true });
var result = [[1, 2], [3]].flat();
check(result.length, 3, "setter length");
check(Object.prototype.hasOwnProperty.call(result, 1), true, "own index defined");
check(stored.length, 0, "CreateDataProperty runs no setter");
delete Array.prototype[1];

if (failures) throw new Error(failures + " flat checks failed");
