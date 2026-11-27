// A method call whose callee is a native with its own lean entry (Object.create,
// Object.assign, Object.keys, Promise.resolve, split, join, replace, JSON and
// RegExp methods) goes to that entry first. Each case checks the answer on the
// usual receivers, on primitive and boxed receivers, on methods moved to other
// objects, on declined calls that throw, and on subclass receivers.
"use strict";
var failures = 0;
var say = typeof print === "function" ? print : console.log;
function check(got, want, label) { if (got !== want) { failures++; say("FAIL", label, got, want); } }
var J = JSON.stringify;

for (var round = 0; round < 3; round++) {
  var p = { k: 1 };
  var s = 0;
  for (var i = 0; i < 300; i++) {
    var o = Object.assign(Object.create(p), { a: i });
    s += o.a + o.k + Object.keys(o).length;
  }
  check(s, 299 * 300 / 2 + 600, "create, assign and keys");
  // Object.create on null, on many prototypes (cached empty shapes evicted and
  // refilled) and on prototypes that are arrays, functions and frozen objects.
  check(Object.getPrototypeOf(Object.create(null)), null, "create with a null prototype");
  var protos = [];
  for (var j = 0; j < 40; j++) protos.push({ j: j });
  var seen = 0;
  for (var j = 0; j < 400; j++) { var made = Object.create(protos[j % 40]); seen += made.j + (Object.getPrototypeOf(made) === protos[j % 40] ? 1 : 0); }
  check(seen, 10 * (39 * 40 / 2) + 400, "create on many prototypes");
  check(Object.create([7]).length, 1, "create with an array prototype");
  check(Object.create(function f(a, b) {}).length, 2, "create with a function prototype");
  var frozen = Object.freeze({ z: 3 });
  var child = Object.create(frozen);
  check(child.z + Object.keys(child).length, 3, "create with a frozen prototype");
  check(Object.isExtensible(child), true, "create's object is extensible");
  // Declined calls throw the usual errors.
  var thrown = false;
  try { Object.create(5); } catch (e) { thrown = e instanceof TypeError; }
  check(thrown, true, "create with a number prototype throws");
  thrown = false;
  try { Object.assign(null, {}); } catch (e) { thrown = e instanceof TypeError; }
  check(thrown, true, "assign to null throws");
  thrown = false;
  try { Object.keys(undefined); } catch (e) { thrown = e instanceof TypeError; }
  check(thrown, true, "keys of undefined throws");
  // A lean native stored on an ordinary object and called as its method.
  var holder = { create: Object.create, keys: Object.keys, split: String.prototype.split };
  check(Object.getPrototypeOf(holder.create(p)), p, "create moved to another object");
  check(J(holder.keys({ x: 1, y: 2 })), "[\"x\",\"y\"]", "keys moved to another object");
  thrown = false;
  try { holder.split(","); } catch (e) { thrown = true; }
  check(thrown, false, "split on an object receiver");
  check(J(holder.split("object")), "[\"[\",\" Object]\"]", "split coerces the receiver");
  // String methods on strings, boxed strings and other primitives.
  var csv = "a,b,c";
  check(csv.split(",").length, 3, "split on a string");
  check(new String("x-y").split("-").join("+"), "x+y", "split on a String object");
  Number.prototype.splitAs = String.prototype.split;
  Boolean.prototype.splitAs = String.prototype.split;
  check(J((12.5).splitAs(".")), "[\"12\",\"5\"]", "split on a number receiver");
  check(J(true.splitAs("u")), "[\"tr\",\"e\"]", "split on a boolean receiver");
  delete Number.prototype.splitAs;
  delete Boolean.prototype.splitAs;
  check("aXbXc".replace("X", "-"), "a-bXc", "replace");
  check([1, 2, 3].join("|"), "1|2|3", "join");
  check(J(JSON.parse("{\"q\":[1,2]}")), "{\"q\":[1,2]}", "JSON.parse and stringify");
  check(/b+/.test("abbc"), true, "RegExp test");
  check(/b+/.exec("abbc")[0], "bb", "RegExp exec");
  // Promise.resolve on Promise, on a subclass and on a non-constructor.
  class Sub extends Promise {}
  check(Promise.resolve(1) instanceof Promise, true, "Promise.resolve");
  check(Sub.resolve(1) instanceof Sub, true, "Promise.resolve on a subclass");
  thrown = false;
  try { Promise.resolve.call({}, 1); } catch (e) { thrown = e instanceof TypeError; }
  check(thrown, true, "Promise.resolve on a non-constructor throws");
  var pr = { resolve: Promise.resolve };
  thrown = false;
  try { pr.resolve(1); } catch (e) { thrown = e instanceof TypeError; }
  check(thrown, true, "Promise.resolve moved to a plain object throws");
  // call and apply of a lean native still take their own path.
  check(J(Object.keys.call(null, { m: 1 })), "[\"m\"]", "keys through call");
  check(Object.getPrototypeOf(Object.create.apply(null, [p])), p, "create through apply");
  check([1, 2].map(String).join(), "1,2", "map with a native callback");
}
if (failures) throw new Error(failures + " lean dispatch checks failed");
say("ok");
