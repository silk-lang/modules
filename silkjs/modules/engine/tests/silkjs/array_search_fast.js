// indexOf and includes on fast arrays: every kind of search value, fromIndex
// forms, and the cases that take the ordinary steps.
var failures = 0;
function check(got, want, label) { if (got !== want) { failures++; print("FAIL", label, got, want); } }

for (var round = 0; round < 3; round++) {
  var nums = [1, 2.5, 3, -0, NaN, 7];
  check(nums.indexOf(3), 2, "int");
  check(nums.indexOf(2.5), 1, "double");
  check(nums.indexOf(0), 3, "zero finds -0");
  check(nums.indexOf(-0), 3, "-0");
  check(nums.indexOf(NaN), -1, "indexOf NaN");
  check(nums.includes(NaN), true, "includes NaN");
  check(nums.includes(4), false, "includes missing");
  check([1.0, 3.0].indexOf(3), 1, "int target, stored double");
  check([0.5, 3].indexOf(3.0), 1, "double target that is an int");
  check([1, 2].indexOf("1"), -1, "no coercion");
  check(["a", "b", "c"].indexOf("b"), 1, "string");
  var rope = "ab"; rope += "cd" + round;
  check(["x", "abcd" + round].indexOf(rope), 1, "rope target");
  check(["x", rope].includes("abcd" + round), true, "rope element");
  check([true, false].indexOf(false), 1, "bool");
  check([1, null, undefined].indexOf(undefined), 2, "undefined");
  check([1, null, undefined].indexOf(null), 1, "null");
  check([1, 2].indexOf(), -1, "no argument");
  check([1, undefined].indexOf(), 1, "no argument finds undefined");
  check([1, 2].includes(), false, "includes no argument");
  var o = {}, sym = Symbol("s");
  check([1, o, sym].indexOf(o), 1, "object");
  check([1, o, sym].indexOf(sym), 2, "symbol");
  check([1, {}].indexOf({}), -1, "other object");
  check([1, 2n, 3].indexOf(2n), 1, "bigint");
  check([1, 2n, 3].includes(2n), true, "includes bigint");

  // fromIndex.
  var a = [5, 6, 5, 6];
  check(a.indexOf(5, 1), 2, "from 1");
  check(a.indexOf(5, 3), -1, "from 3");
  check(a.indexOf(6, -1), 3, "from -1");
  check(a.indexOf(5, -10), 0, "from -10");
  check(a.indexOf(5, 10), -1, "from past end");
  check(a.indexOf(5, undefined), 0, "from undefined");
  check(a.indexOf(5, 2.5), 2, "from 2.5");
  check(a.indexOf(5, "2"), 2, "from string");
  check(a.indexOf(5, Infinity), -1, "from Infinity");
  check(a.indexOf(5, -Infinity), 0, "from -Infinity");
  check(a.includes(5, 3), false, "includes from 3");
  check(a.includes(6, -1), true, "includes from -1");
  var calls = 0;
  check(a.indexOf(6, { valueOf: function () { calls++; return 2; } }), 3, "from object");
  check(calls, 1, "valueOf once");
  check([].indexOf(1, { valueOf: function () { throw new Error("no"); } }), -1, "empty skips fromIndex");

  // Length past the elements, holes, and other receivers.
  var longer = [1, 2]; longer.length = 4;
  check(longer.indexOf(undefined), -1, "holes past elements are absent");
  check(longer.includes(undefined), true, "includes sees holes as undefined");
  check([1, , 3].indexOf(undefined), -1, "hole");
  check(Array.prototype.indexOf.call({ length: 2, 0: "a", 1: "b" }, "b"), 1, "array-like");
  check(Array.prototype.indexOf.call("abc", "c"), 2, "string receiver");
  class Sub extends Array {}
  check(Sub.from([4, 5]).indexOf(5), 1, "subclass");
  var threw = false;
  try { Array.prototype.indexOf.call(null, 1); } catch (e) { threw = e instanceof TypeError; }
  check(threw, true, "null receiver");
}

// A getter on Array.prototype at an index past the dense elements is read.
var longer2 = [1]; longer2.length = 3;
Object.defineProperty(Array.prototype, 2, { get: function () { return "proto"; }, configurable: true });
check(longer2.indexOf("proto"), 2, "prototype getter");
delete Array.prototype[2];

if (failures) throw new Error(failures + " search checks failed");
