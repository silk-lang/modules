// Array.from({ length: n }, mapper): the array-like path when reads of the
// items run no code, and every way that stops being so.
var failures = 0;
function check(got, want, label) { if (got !== want) { failures++; print("FAIL", label, got, want); } }
function show(a) {
  // String building only: an index getter on Object.prototype would catch push.
  var out = "";
  for (var i = 0; i < a.length; i++) out += (i ? "," : "") + (Object.prototype.hasOwnProperty.call(a, i) ? String(a[i]) : "hole");
  return a.length + ":" + out;
}

for (var round = 0; round < 3; round++) {
  check(show(Array.from({ length: 4 }, function (_, k) { return k * 2; })), "4:0,2,4,6", "mapped");
  check(show(Array.from({ length: 3 })), "3:undefined,undefined,undefined", "unmapped");
  check(show(Array.from({ length: 0 }, function () { throw new Error("no"); })), "0:", "empty");
  check(Array.isArray(Array.from({ length: 2 })), true, "is array");
  check(Object.getPrototypeOf(Array.from({ length: 2 })), Array.prototype, "prototype");

  // Arguments the mapper sees, and thisArg.
  var seen = [];
  var self = { tag: "t" };
  Array.from({ length: 3, other: 1 }, function (v, k) { seen.push(String(v) + "/" + k + "/" + this.tag); }, self);
  check(seen.join(" "), "undefined/0/t undefined/1/t undefined/2/t", "mapper arguments");

  // The mapper adds an index property to the items: later reads see it.
  var items = { length: 4 };
  check(show(Array.from(items, function (v, k) { if (k === 0) items[2] = "late"; return v; })), "4:undefined,undefined,late,undefined", "mapper adds index");
  var other = { length: 3 };
  check(show(Array.from(other, function (v, k) { if (k === 0) { other.extra = 1; other[1] = "b"; } return v; })), "3:undefined,b,undefined", "mapper adds names");

  // Own index properties and non-plain lengths take the ordinary path.
  check(show(Array.from({ length: 3, 1: "x" })), "3:undefined,x,undefined", "own index");
  check(show(Array.from({ length: 2.5 })), "2:undefined,undefined", "fractional length");
  check(show(Array.from({ length: "2" })), "2:undefined,undefined", "string length");
  check(show(Array.from({ length: -3 })), "0:", "negative length");
  var gets = 0;
  check(show(Array.from({ get length() { gets++; return 2; } })), "2:undefined,undefined", "getter length");
  check(gets, 1, "getter once");
  check(Array.from({ length: 70000 }).length, 70000, "long length");
  check(show(Array.from(Object.assign(Object.create(null), { length: 2 }))), "2:undefined,undefined", "null prototype");
  var protoItems = Object.create({ 0: "inherited" }); protoItems.length = 2;
  check(show(Array.from(protoItems)), "2:inherited,undefined", "inherited index");

  // A subclass receiver constructs through the ordinary path.
  class Sub extends Array {}
  var made = Sub.from({ length: 2 }, function (_, k) { return k; });
  check(made instanceof Sub, true, "subclass");
  check(show(made), "2:0,1", "subclass values");

  // Errors.
  var threw = false;
  try { Array.from({ length: 2 }, 5); } catch (e) { threw = e instanceof TypeError; }
  check(threw, true, "non-callable mapper");
  threw = false;
  try { Array.from({ length: 3 }, function (_, k) { if (k === 1) throw new RangeError("stop"); return k; }); } catch (e) { threw = e instanceof RangeError; }
  check(threw, true, "mapper throws");
}

// An index getter on Object.prototype is read for every index.
var reads = 0;
Object.defineProperty(Object.prototype, 1, { get: function () { reads++; return "proto"; }, configurable: true });
check(show(Array.from({ length: 3 })), "3:undefined,proto,undefined", "Object.prototype index");
check(reads, 1, "Object.prototype getter once");
delete Object.prototype[1];

// Symbol.iterator on Object.prototype makes every object iterable.
Object.prototype[Symbol.iterator] = function* () { yield "it"; };
check(show(Array.from({ length: 3 })), "1:it", "Object.prototype iterator");
delete Object.prototype[Symbol.iterator];
check(show(Array.from({ length: 2 })), "2:undefined,undefined", "after delete");

if (failures) throw new Error(failures + " Array.from checks failed");
