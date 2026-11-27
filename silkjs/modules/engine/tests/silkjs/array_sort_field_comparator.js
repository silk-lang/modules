// sort with `(a, b) => a.k - b.k`: the field difference computed without the
// call when both elements hold a number in an own data property, the call
// otherwise, and the same stable order either way.
var failures = 0;
function check(got, want, label) { if (got !== want) { failures++; print("FAIL", label, got, want); } }
function ids(a) { var out = []; for (var i = 0; i < a.length; i++) out.push(a[i].id); return out.join(","); }

for (var round = 0; round < 3; round++) {
  var objs = [];
  for (var i = 0; i < 30; i++) objs.push({ w: (i * 7) % 5, id: i });
  check(ids(objs.slice().sort(function (a, b) { return a.w - b.w; })),
    "0,5,10,15,20,25,3,8,13,18,23,28,1,6,11,16,21,26,4,9,14,19,24,29,2,7,12,17,22,27", "ascending stable");
  check(ids(objs.slice().sort((a, b) => b.w - a.w)),
    "2,7,12,17,22,27,4,9,14,19,24,29,1,6,11,16,21,26,3,8,13,18,23,28,0,5,10,15,20,25", "descending stable");

  // Doubles and -0 (equal to 0, so stable); NaN makes the order implementation-defined.
  var mixed = [{ w: 1.5, id: "a" }, { w: -0, id: "b" }, { w: 0, id: "d" }, { w: -2, id: "e" }];
  check(ids(mixed.slice().sort((a, b) => a.w - b.w)), "e,b,d,a", "doubles");
  check([{ w: NaN }, { w: 1 }, { w: 0 }].sort((a, b) => a.w - b.w).length, 3, "NaN");

  // Values that are not numbers go through the call: strings convert, objects run valueOf.
  var calls = 0;
  var odd = [{ w: "3", id: 1 }, { w: { valueOf: function () { calls++; return 1; } }, id: 2 }, { w: 2, id: 3 }];
  check(ids(odd.slice().sort((a, b) => a.w - b.w)), "2,3,1", "converted values");
  check(calls > 0, true, "valueOf ran");

  // A getter, an inherited field, a missing field, a proxy and a primitive element.
  var getterReads = 0;
  var withGetter = [{ id: 1, get w() { getterReads++; return 5; } }, { w: 1, id: 2 }];
  check(ids(withGetter.slice().sort((a, b) => a.w - b.w)), "2,1", "getter");
  check(getterReads > 0, true, "getter ran");
  var proto = { w: 4 };
  var inherited = [Object.create(proto), { w: 2 }];
  inherited[0].id = "i"; inherited[1].id = "o";
  check(ids(inherited.sort((a, b) => a.w - b.w)), "o,i", "inherited");
  check(ids([{ id: 1 }, { w: 1, id: 2 }].sort((a, b) => a.w - b.w)), "1,2", "missing is NaN");
  var proxyReads = 0;
  var proxied = new Proxy({ w: 9, id: "p" }, { get: function (t, k) { proxyReads++; return t[k]; } });
  check(ids([proxied, { w: 1, id: "q" }].sort((a, b) => a.w - b.w)), "q,p", "proxy");
  check(proxyReads > 0, true, "proxy trap ran");
  var threw = false;
  try { [{ w: 1 }, null].sort((a, b) => a.w - b.w); } catch (e) { threw = e instanceof TypeError; }
  check(threw, true, "null element throws");

  // Other shapes of comparator still call.
  var seen = 0;
  [{ w: 2 }, { w: 1 }].sort(function (a, b) { seen++; return a.w - b.w; });
  check(seen, 1, "comparator with side effect");
  check(ids([{ w: 2, v: 1, id: 1 }, { w: 1, v: 2, id: 2 }].sort((a, b) => a.v - b.w)), "1,2", "different fields");
  check(ids([{ w: 1, id: 1 }, { w: 2, id: 2 }].sort((a, b) => a.w - a.w)), "1,2", "same argument");

  // Shapes changing between compares: elements with the field in different slots.
  var shapes = [];
  for (var j = 0; j < 12; j++) { var o = {}; if (j % 2) o.pad = 0; o.w = 12 - j; o.id = j; shapes.push(o); }
  check(ids(shapes.sort((a, b) => a.w - b.w)), "11,10,9,8,7,6,5,4,3,2,1,0", "mixed shapes");

  // Class instances and a non-writable field.
  class P { constructor(w, id) { this.w = w; this.id = id; } }
  check(ids([new P(3, "x"), new P(1, "y"), new P(2, "z")].sort((a, b) => a.w - b.w)), "y,z,x", "class instances");
  var frozen = [Object.freeze({ w: 2, id: 1 }), Object.freeze({ w: 1, id: 2 })];
  check(ids(frozen.sort((a, b) => a.w - b.w)), "2,1", "frozen elements");
}

if (failures) throw new Error(failures + " field comparator checks failed");
