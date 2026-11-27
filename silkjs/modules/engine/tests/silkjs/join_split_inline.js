// arr.join(sep) and s.split(sep) answered without a native frame, checked
// against the cases that must take the full call.
var failures = 0;
var say = typeof print === "function" ? print : console.log;
function check(got, want, label) { if (got !== want) { failures++; say("FAIL", label, got, want); } }
for (var round = 0; round < 3; round++) {
  check(["a", "b", "c"].join("-"), "a-b-c", "strings");
  check(["a", "b", "c"].join(), "a,b,c", "default separator");
  check(["a", "b"].join(undefined), "a,b", "undefined separator");
  check([1, 2, 30].join("+"), "1+2+30", "integers");
  check(["x", 1, null, undefined, "y"].join("."), "x.1...y", "mixed");
  check([].join("-"), "", "empty");
  check(["a", "b"].join(""), "ab", "empty separator");
  check(["a", "b"].join("::"), "a::b", "long separator");
  check(["ā", "b"].join("-"), "ā-b", "wide element");
  check(["a", "b"].join("ā"), "aāb", "wide separator");
  check([1.5, 2].join("-"), "1.5-2", "double element");
  check([{ toString: function () { return "o"; } }, "p"].join("-"), "o-p", "object element");
  check([[1, 2], 3].join("-"), "1,2-3", "nested array");
  check(["a", "b"].join(5), "a5b", "number separator");
  check(["a", "b"].join({ toString: function () { return "*"; } }), "a*b", "object separator");
  var holes = [1, , 3];
  check(holes.join("-"), "1--3", "holes");
  var sparse = []; sparse[3] = "z";
  check(sparse.join("-"), "---z", "sparse");
  check(Array.prototype.join.call({ length: 2, 0: "q", 1: "r" }, "-"), "q-r", "array-like");
  check(Array.prototype.join.call("st", "-"), "s-t", "string receiver");
  check("a,b,,c".split(",").join("|"), "a|b||c", "split join");
  check("abc".split("").join("|"), "a|b|c", "empty split separator");
  check("a b".split(" ", 1).join("|"), "a", "split limit");
  check("a1b1c".split(1).join("|"), "a|b|c", "number split separator");
  check("aāb".split("ā").join("|"), "a|b", "wide split separator");
  check("".split(",").length, 1, "empty text");
  check(String.prototype.split.call(12321, 2).join("|"), "1|3|1", "number receiver");
  var re = /,/;
  check("a,b".split(re).join("|"), "a|b", "regexp separator");
  var custom = { [Symbol.split]: function (s) { return ["custom", s]; } };
  check("a,b".split(custom).join("|"), "custom|a,b", "Symbol.split separator");
}
// A getter for an index on Array.prototype is not read for a dense array.
var reads = 0;
Object.defineProperty(Array.prototype, "1", { get: function () { reads++; return "g"; }, configurable: true });
check(["a", "b"].join("-"), "a-b", "own elements win");
check([ "a", , "c"].join("-"), "a-g-c", "hole reads the prototype");
delete Array.prototype[1];
check(reads, 1, "getter reads");
// join on a subclass and an array with a changed length.
class List extends Array {}
var list = List.from(["m", "n"]);
check(list.join("-"), "m-n", "subclass");
var shrunk = ["a", "b", "c"]; shrunk.length = 2;
check(shrunk.join("-"), "a-b", "shrunk");
var frozen = Object.freeze(["f", "g"]);
check(frozen.join("-"), "f-g", "frozen");
if (failures) throw new Error(failures + " join/split checks failed");
say("ok");
