// Async functions whose bodies never await run as plain calls: results,
// rejections, thenables, arguments, closures, this, super and new.target, call
// order and deep recursion stay as with a suspendable frame.
var failures = 0;
var say = typeof print === "function" ? print : console.log;
function check(got, want, label) { if (got !== want) { failures++; say("FAIL", label, got, want); } }

async function f(x) { return x + 1; }
async function g(x) { if (x > 1) throw new Error("big " + x); return { v: x }; }
async function h() { return Promise.resolve(7); }
async function k() { return { then(r) { r(9); } }; }
async function args(a, b) { a = 10; arguments[1] = 20; return [a, b, arguments.length].join(); }
async function clos(n) { var c = 0; var inc = () => ++c; inc(); inc(); return () => c + n; }
async function plain() {}
const arrow = async (x) => x * 3;
var obj = { async m() { return this.tag; }, tag: "T" };
class C { async m() { return super.toString === Object.prototype.toString; } static async s() { return new.target; } }
async function nested() { return await f(1); }
async function rec(n) { return n === 0 ? 0 : rec(n - 1); }
async function thrower() { throw 5; }
(async () => {
  check(await f(1), 2, "return value");
  try { await g(5); check(true, false, "should throw"); } catch (e) { check(e.message, "big 5", "rejection"); }
  check((await g(1)).v, 1, "object result");
  check(await h(), 7, "returned promise");
  check(await k(), 9, "returned thenable");
  check(await args(1, 2), "10,20,2", "arguments");
  check((await clos(5))(), 7, "closure");
  check(await plain(), undefined, "no return");
  check(await arrow(3), 9, "arrow");
  check(await obj.m(), "T", "this");
  check(await new C().m(), true, "super");
  check(await C.s(), undefined, "new.target");
  check(await nested(), 2, "awaiting caller");
  check(await rec(100), 0, "recursion");
  var p = f(2);
  check(p instanceof Promise && Object.getPrototypeOf(p) === Promise.prototype, true, "promise kind");
  check(f(1) !== f(1), true, "fresh promises");
  var order = [];
  f(1).then(function () { order.push("a"); });
  Promise.resolve().then(function () { order.push("b"); });
  order.push("s");
  await null; await null; await null;
  check(order.join(""), "sab", "reaction order");
  var r = thrower(); var reason;
  r.catch(function (e) { reason = e; });
  await null; await null;
  check(reason, 5, "thrown primitive");
  check(await f.call(null, 41), 42, "call");
  check(await f.apply(null, [99]), 100, "apply");
  check(await Reflect.apply(f, null, [0]), 1, "Reflect.apply");
  var big = [1, 2, 3];
  async function writes(a) { a = 0; return a; }
  check(await writes.apply(null, big), 0, "written parameter");
  check(big.join(), "1,2,3", "apply array untouched");
  var caught = false;
  try { await rec(1e6); } catch (e) { caught = e instanceof RangeError; }
  check(caught, true, "stack overflow rejects");
  if (failures) throw new Error(failures + " async direct body checks failed");
  say("ok");
})();
