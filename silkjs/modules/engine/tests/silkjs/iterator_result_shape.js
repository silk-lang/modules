// Iterator results from built-in iterators are born with one shared shape (own value, then done).
// Each must still behave as an ordinary object of its own.
let failures = 0;
function check(got, want, label) { if (got !== want) { failures++; console.log("FAIL", label, got, want); } }
function* gen() { yield 1; yield 2; return 3; }

var it = gen(), a = it.next(), b = it.next(), c = it.next(), d = it.next();
check(JSON.stringify([a, b, c, d]), '[{"value":1,"done":false},{"value":2,"done":false},{"value":3,"done":true},{"done":true}]', "generator results");
check(Object.keys(a).join(), "value,done", "key order");
check(Object.getPrototypeOf(a), Object.prototype, "prototype");
var dv = Object.getOwnPropertyDescriptor(a, "value"), dd = Object.getOwnPropertyDescriptor(a, "done");
check(dv.writable && dv.enumerable && dv.configurable, true, "value attributes");
check(dd.writable && dd.enumerable && dd.configurable, true, "done attributes");
check("value" in d && d.value === undefined && d.hasOwnProperty("value"), true, "undefined value is own");

// Changing one result leaves the others, and later ones, alone.
a.extra = 7; delete b.done; Object.freeze(c); a.value = "changed";
Object.defineProperty(d, "value", { get() { return 42; } });
var e = gen().next();
check(Object.keys(e).join(), "value,done", "later result keys");
check(e.extra, undefined, "later result has no extra"); check(e.value, 1, "later result value"); check(e.done, false, "later result done");
check(Object.isFrozen(e), false, "later result not frozen");
e.value = 5; check(e.value, 5, "later result writable");
check(Object.keys(a).join(), "value,done,extra", "extended keys"); check(Object.keys(b).join(), "value", "deleted keys");
check(c.value, 3, "frozen value"); check(d.value, 42, "accessor value");

// Object.prototype setters named value or done are not run (the properties are defined, not assigned).
var ran = 0;
// (Null-prototype descriptors: an ordinary one would inherit the accessors being installed.)
function accessor() { var descriptor = Object.create(null); descriptor.set = function (v) { ran++; }; descriptor.get = function () { return "proto"; }; descriptor.configurable = true; return descriptor; }
var first = accessor(), second = accessor();
Object.defineProperty(Object.prototype, "value", first);
Object.defineProperty(Object.prototype, "done", second);
var f = gen().next(), g = [10][Symbol.iterator]().next(), h = new Map([[1, 2]]).entries().next(), k = "x"[Symbol.iterator]().next();
delete Object.prototype.value; delete Object.prototype.done;
check(ran, 0, "prototype setters not run"); check(f.value, 1, "own value over prototype"); check(f.done, false, "own done over prototype");
check(g.value, 10, "array iterator value"); check(h.value.join(), "1,2", "map iterator value"); check(k.value, "x", "string iterator value");
check(Object.keys(g).join() + "|" + Object.keys(h).join() + "|" + Object.keys(k).join(), "value,done|value,done|value,done", "built-in iterator keys");

// Manual stepping in a loop, results kept and dropped.
function* count(n) { for (let i = 0; i < n; i++) yield i; }
var kept = [], sum = 0, step, steps = count(1000);
while (!(step = steps.next()).done) { sum += step.value; if (step.value % 100 == 0) kept.push(step); }
check(sum, 499500, "manual loop sum"); check(kept.length, 10, "kept count"); check(kept[3].value, 300, "kept value"); check(step.value, undefined, "final value");

if (failures) throw new Error(failures + " failures");
