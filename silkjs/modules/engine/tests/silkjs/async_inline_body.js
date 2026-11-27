// An async function whose body never awaits runs inline in the caller's
// dispatch loop; each case checks its promise, its settlement order against
// other jobs, and its errors as a call through a native frame would give them.
var failures = 0;
var say = typeof print === "function" ? print : console.log;
function check(got, want, label) { if (got !== want) { failures++; say("FAIL", label, got, want); } }
var log = [];

async function value(x) { return x; }
async function nothing() { }
async function object(x) { return { x: x }; }
async function thenable(x) { return { then: function (resolve) { log.push("then " + x); resolve(x * 10); } }; }
async function promised(x) { return Promise.resolve(x + 100); }
async function thrower(x) { throw new Error("thrown " + x); }
async function caught(x) { try { throw x; } catch (e) { return "caught " + e; } }
async function finallyReturn(x) { try { return x; } finally { log.push("finally " + x); } }
async function nested(x) { var p = value(x); var q = thrower(x); q.catch(function () {}); return [p instanceof Promise, q instanceof Promise]; }
async function deepThrow(x) { function inner() { throw new TypeError("inner " + x); } inner(); return 1; }
async function args() { return Array.prototype.join.call(arguments, "|"); }
async function self() { return this; }
async function capture(x) { var f = function () { return x * 2; }; return f; }
var counter = 0;
async function bump() { counter++; }
class Box { constructor(v) { this.v = v; } async get() { return this.v; } async fail() { throw new RangeError("box " + this.v); } }

(async function () {
  for (var round = 0; round < 3; round++) {
    log = [];
    check(await value(1), 1, "value");
    check(await nothing(), undefined, "undefined");
    check((await object(2)).x, 2, "object");
    check(await thenable(3), 30, "thenable");
    check(await promised(4), 104, "promise result");
    check(await caught("e"), "caught e", "caught inside");
    check(await finallyReturn(5), 5, "finally return");
    check(log.join(","), "then 3,finally 5", "log");
    var pair = await nested(6);
    check(pair[0] && pair[1], true, "nested promises");
    check(await args(1, 2, 3), "1|2|3", "arguments");
    check(await args(), "", "no arguments");
    var receiver = { k: 1 };
    check(await self.call(receiver), receiver, "call receiver");
    check(await self.apply(receiver, []), receiver, "apply receiver");
    check(await self.bind(receiver)(), receiver, "bound receiver");
    check((await capture(7))(), 14, "closure");
    var box = new Box(8);
    check(await box.get(), 8, "method");
    try { await box.fail(); failures++; say("FAIL method no throw"); } catch (e) { check(e instanceof RangeError && e.message, "box 8", "method rejection"); }
    // Rejections, caught by await, then and catch.
    try { await thrower(9); failures++; say("FAIL no throw"); } catch (e) { check(e.message, "thrown 9", "rejection"); }
    try { await deepThrow(10); failures++; say("FAIL no deep throw"); } catch (e) { check(e instanceof TypeError && e.message, "inner 10", "deep rejection"); }
    check(await thrower(11).then(function () { return "no"; }, function (e) { return e.message; }), "thrown 11", "then rejection");
    var p = thrower(12);
    check(p instanceof Promise, true, "rejected promise");
    check(await p.catch(function (e) { return e.message; }), "thrown 12", "catch rejection");
    // A call statement drops its promise; the body still ran.
    bump(); bump();
    check(counter, (round + 1) * 2, "dropped calls ran");
    // Each call makes its own promise.
    check(value(1) === value(1), false, "distinct promises");
    check(Object.getPrototypeOf(value(1)), Promise.prototype, "promise prototype");
    // Settlement order: an inline body's promise is already settled when the call returns.
    var order = [];
    var a = value("a"); var b = Promise.resolve("b");
    a.then(function (v) { order.push(v); });
    b.then(function (v) { order.push(v); });
    value("c").then(function (v) { order.push(v); });
    await null; await null; await null;
    check(order.join(""), "abc", "settle order");
    // Thenable resolution takes its extra jobs.
    var steps = [];
    thenable(1).then(function () { steps.push("thenable"); });
    value(1).then(function () { steps.push("value"); });
    await null; await null; await null; await null;
    check(steps.join(","), "value,thenable", "thenable order");
    // Stack traces name the async function.
    try { await thrower(13); } catch (e) { check(/thrower/.test(e.stack), true, "stack names thrower"); }
    // Many calls in a loop.
    var sum = 0;
    for (var i = 0; i < 1000; i++) sum += await value(i);
    check(sum, 499500, "loop sum");
    var rejected = 0;
    for (var j = 0; j < 100; j++) { try { await thrower(j); } catch (e) { rejected++; } }
    check(rejected, 100, "loop rejections");
  }
  if (failures) throw new Error(failures + " inline async checks failed");
  say("ok");
})().catch(function (e) { say("FAIL", e && e.stack || e); throw e; });
