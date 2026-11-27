// Promise.resolve(v) answered without a native frame, checked against the
// cases that must take the full call.
var failures = 0;
var say = typeof print === "function" ? print : console.log;
function check(got, want, label) { if (got !== want) { failures++; say("FAIL", label, got, want); } }
var log = [];
var p0 = Promise.resolve(0);
for (var i = 0; i < 200; i++) {
  var p = Promise.resolve(i);
  if (!(p instanceof Promise) || p === p0) { check(String(p), "promise", "primitive " + i); break; }
  if (Promise.resolve(p0) !== p0) { check(false, true, "same promise " + i); break; }
}
Promise.resolve("s").then(function (v) { log.push("prim " + v); });
Promise.resolve(undefined).then(function (v) { log.push("undefined " + v); });
// A thenable runs its then in a later job.
var thenable = { then: function (ok) { log.push("then called"); ok(7); } };
var fromThenable = Promise.resolve(thenable);
check(fromThenable !== thenable, true, "thenable wrapped");
fromThenable.then(function (v) { log.push("thenable " + v); });
// A promise whose constructor property was replaced is wrapped.
var odd = Promise.resolve(1);
odd.constructor = function () {};
check(Promise.resolve(odd) !== odd, true, "replaced constructor wraps");
// A subclass: Sub.resolve makes a Sub, and Promise.resolve(sub) wraps it.
class Sub extends Promise {}
var sub = Sub.resolve(3);
check(sub instanceof Sub, true, "subclass resolve");
check(Promise.resolve(sub) !== sub && Promise.resolve(sub) instanceof Promise, true, "subclass instance wraps");
check(Sub.resolve(sub), sub, "subclass identity");
// Another receiver.
var called = 0;
function Fake(executor) { called++; executor(function () {}, function () {}); }
Promise.resolve.call(Fake, 1);
check(called, 1, "custom constructor");
var threw = false; try { Promise.resolve.call(1, 2); } catch (e) { threw = e instanceof TypeError; }
check(threw, true, "non-object receiver throws");
var resolve = Promise.resolve;
threw = false; try { resolve(1); } catch (e) { threw = e instanceof TypeError; }
check(threw, true, "detached call throws");
// Promise.reject is not answered here.
var rejected = Promise.reject(5);
rejected.catch(function (v) { log.push("rejected " + v); });
// A species getter on the constructor sends promises to the full call.
var species = Promise.resolve(2);
var speciesReads = 0;
Object.defineProperty(Promise, Symbol.species, { get: function () { speciesReads++; return Promise; }, configurable: true });
var again = Promise.resolve(species);
check(again === species, true, "species getter keeps identity");
Promise.resolve(9).then(function (v) { log.push("after species " + v); });
delete Promise[Symbol.species];
check(speciesReads > 0, true, "species getter read");
var last = Promise.resolve();
for (var k = 0; k < 8; k++) last = last.then(function () {});
last.then(function () {
  check(log.join(","), "prim s,undefined undefined,then called,rejected 5,after species 9,thenable 7", "jobs");
  if (failures) throw new Error(failures + " Promise.resolve checks failed");
  say("ok");
});
