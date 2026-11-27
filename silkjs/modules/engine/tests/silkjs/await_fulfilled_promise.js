// An await of one of the realm's own promises that is already fulfilled queues
// its reaction without a reaction record; each case checks the value it gives
// and the order its continuation runs in against other jobs.
var failures = 0;
var say = typeof print === "function" ? print : console.log;
function check(got, want, label) { if (got !== want) { failures++; say("FAIL", label, got, want); } }

var log = [];
async function waits(p, tag) { log.push(tag + ":start"); var v = await p; log.push(tag + ":" + v); return v; }

async function main() {
  // Many awaits of fresh and shared fulfilled promises.
  var s = 0;
  for (var i = 0; i < 300; i++) s += await Promise.resolve(i);
  check(s, 44850, "fresh promises");
  var shared = Promise.resolve(2);
  s = 0;
  for (var i = 0; i < 100; i++) s += await shared;
  check(s, 200, "shared promise");
  var obj = { k: 1 };
  check(await Promise.resolve(obj), obj, "object result");

  // Order against then callbacks queued before and after the await.
  log = [];
  var p = Promise.resolve("v");
  p.then(function () { log.push("then1"); });
  var w = waits(p, "a");
  p.then(function () { log.push("then2"); });
  log.push("sync");
  await w;
  check(log.join(","), "a:start,sync,then1,a:v,then2", "order with then");

  // Same number of ticks as await of a primitive.
  log = [];
  var x = waits(Promise.resolve(1), "p");
  var y = waits(1, "q");
  await Promise.all([x, y]);
  check(log.join(","), "p:start,q:start,p:1,q:1", "ticks like a primitive");

  // A pending promise, fulfilled later.
  var settle;
  var pending = new Promise(function (r) { settle = r; });
  log = [];
  var z = waits(pending, "pending");
  Promise.resolve().then(function () { log.push("tick"); settle("late"); });
  await z;
  check(log.join(","), "pending:start,tick,pending:late", "pending promise");

  // A rejected promise throws into the body.
  var caught = null;
  try { await Promise.reject(new Error("no")); } catch (e) { caught = e.message; }
  check(caught, "no", "rejected promise");

  // An own then on a native promise is not called by await.
  var own = Promise.resolve(5);
  var ownCalls = 0;
  own.then = function (f) { ownCalls++; f(99); };
  check(await own, 5, "own then on the promise");
  check(ownCalls, 0, "own then not called");

  // A thenable that is not a promise.
  check(await { then: function (f) { f(7); } }, 7, "thenable");

  // A subclass promise.
  class Sub extends Promise { }
  check(await Sub.resolve(3), 3, "subclass promise");

  // A patched constructor on the prototype is read as the specification reads it.
  var reads = 0;
  var original = Object.getOwnPropertyDescriptor(Promise.prototype, "constructor");
  Object.defineProperty(Promise.prototype, "constructor", { get: function () { reads++; return Promise; }, configurable: true });
  check(await Promise.resolve(4), 4, "constructor getter value");
  check(reads > 0, true, "constructor getter runs");
  Object.defineProperty(Promise.prototype, "constructor", original);
  reads = 0;
  check(await Promise.resolve(6), 6, "constructor restored");
  check(reads, 0, "getter removed");

  // A promise whose constructor is replaced by another value.
  var other = Promise.resolve(8);
  other.constructor = function Fake(executor) { executor(function () {}, function () {}); };
  log = [];
  var o = (async function () { var v = await other; log.push("other:" + v); })();
  Promise.resolve().then(function () { log.push("t1"); }).then(function () { log.push("t2"); }).then(function () { log.push("t3"); });
  await o;
  await null; await null; await null;
  check(log.indexOf("other:8") >= 0, true, "replaced constructor still settles");
}

var done = false;
main().then(function () {
  done = true;
  if (failures) throw new Error(failures + " await checks failed");
  say("ok");
}, function (e) { say("FAIL", "threw", e && e.message); throw e; });
