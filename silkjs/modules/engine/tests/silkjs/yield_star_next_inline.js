// yield* calls its delegate's next in the generator's own dispatch loop when next is a
// bytecode function, and built-in iterator next methods take the lean native call.
let failures = 0;
function check(got, want, label) { if (got !== want) { failures++; console.log("FAIL", label, got, want); } }
function drain(it, send) { var out = [], step = it.next(); while (!step.done) { out.push(step.value); step = send ? it.next(send(step.value)) : it.next(); } out.push("=" + step.value); return out.join(); }

// A one-shot object iterator, as generator-based effect libraries use.
class Once {
  constructor(v) { this.v = v; this.called = false; }
  next(a) { return this.called ? { value: a, done: true } : (this.called = true, { value: this.v, done: false }); }
  [Symbol.iterator]() { return new Once(this.v); }
}
function* program(n) { let s = 0; for (let i = 0; i < n; i++) s += yield* new Once(i); return s; }
check(drain(program(4), (v) => v * 10), "0,1,2,3,=60", "one-shot delegate");
var total = 0, it = program(5000), st = it.next(); while (!st.done) st = it.next(st.value); check(st.value, 12497500, "long run");

// next sees the iterator as this, the sent value as its one argument, and exactly one argument.
var seen = [];
var plain = { i: 0, next: function (a) { seen.push(this === plain, a, arguments.length); return { value: this.i, done: this.i++ >= 2 }; }, [Symbol.iterator]() { return this; } };
function* through() { return yield* plain; }
check(drain(through(), (v) => "s" + v), "0,1,=2", "plain delegate");
check(seen.join(), "true,,1,true,s0,1,true,s1,1", "receiver and arguments");

// A next small enough to run without a frame, a closure, a bound function, and a native one.
var done = { value: "end", done: true }, more = { value: "tick", done: false };
var tiny = { n: 0, next() { return this.n++ < 3 ? more : done; }, [Symbol.iterator]() { return this; } };
function* a1() { return yield* tiny; } check(drain(a1()), "tick,tick,tick,=end", "frameless next");
function counter(k) { var i = 0; return { next: () => ({ value: i, done: i++ >= k }), [Symbol.iterator]() { return this; } }; }
function* a2() { return yield* counter(3); } check(drain(a2()), "0,1,2,=3", "closure next");
var boundTarget = { i: 0 }, bound = { next: function () { return { value: this.i, done: this.i++ >= 2 }; }.bind(boundTarget), [Symbol.iterator]() { return this; } };
function* a3() { return yield* bound; } check(drain(a3()), "0,1,=2", "bound next");
function* a4() { yield* [1, 2, 3]; yield* new Map([[1, 2]]).keys(); yield* "ab"; return yield* (function* () { yield 9; return 10; })(); }
check(drain(a4()), "1,2,3,1,a,b,9,=10", "native delegates");

// The method is read once; replacing it later changes nothing.
var swapped = { i: 0, next() { this.next = function () { return { value: "wrong", done: true }; }; return { value: this.i, done: this.i++ >= 2 }; }, [Symbol.iterator]() { return this; } };
function* a5() { return yield* swapped; } check(drain(a5()), "0,1,=2", "next read once");

// Failures: a throw inside next, and a result that is not an object.
var thrower = { n: 0, next() { if (this.n++ == 1) throw new RangeError("boom"); return { value: 1, done: false }; }, [Symbol.iterator]() { return this; } };
function* a6() { try { yield* thrower; } catch (e) { return "caught " + e.message; } }
check(drain(a6()), "1,=caught boom", "throw in next is catchable in the generator");
function* a7() { yield* thrower; }
var g7 = (thrower.n = 0, a7()); g7.next(); var escaped = ""; try { g7.next(); } catch (e) { escaped = e.constructor.name + ":" + e.message; }
check(escaped, "RangeError:boom", "throw in next reaches the caller"); check(g7.next().done, true, "generator finished after the throw");
var notObject = { next() { return 5; }, [Symbol.iterator]() { return this; } };
function* a8() { yield* notObject; } var kind = ""; try { a8().next(); } catch (e) { kind = e.constructor.name; } check(kind, "TypeError", "non-object result");
var frames = { next() { return { value: new Error("where").stack, done: false }; }, [Symbol.iterator]() { return this; } };
function* a9() { yield* frames; }
var trace = a9().next().value; check(/next/.test(trace) && /a9/.test(trace), true, "stack shows next under the generator");

// return and throw are forwarded; a deep operand stack around the yield*.
var log = [];
var full = { i: 0, next(v) { log.push("n" + v); return { value: this.i++, done: false }; }, return(v) { log.push("r" + v); return { value: "ret" + v, done: true }; },
  throw(e) { log.push("t" + e); return { value: "thr", done: true }; }, [Symbol.iterator]() { return this; } };
function* a10() { var r = [1, 2, 3, [4, 5, yield* full, 7], 8]; return r; }
var g10 = a10(); g10.next(); g10.next("x"); check(g10.return("q").value, "retq", "return forwarded");
full.i = 0; var g11 = a10(); g11.next(); check(JSON.stringify(g11.throw("E").value), "[1,2,3,[4,5,\"thr\",7],8]", "throw forwarded");
check(log.join(), "nundefined,nx,rq,nundefined,tE", "delegate call order");

// Delegation through several generators, and recursion inside next.
function* leaf(k) { return yield* new Once(k); }
function* mid(k) { return (yield* leaf(k)) + (yield* leaf(k + 1)); }
function* top() { return (yield* mid(1)) + (yield* mid(10)); }
check(drain(top(), (v) => v), "1,2,10,11,=24", "nested delegation");
var recursive = { d: 0, next() { return this.d++ < 3 ? { value: drain((function* () { yield* new Once(this.d); }).call(this)), done: false } : { value: 0, done: true }; }, [Symbol.iterator]() { return this; } };
function* a12() { return yield* recursive; } check(drain(a12()), "1,=undefined,2,=undefined,3,=undefined,=0", "generators run inside next");

// next as a generator function or an async function: its call returns an object with no done.
var genNext = { next: function* () { yield 1; }, [Symbol.iterator]() { return this; } };
function* a13() { yield* genNext; } var first13 = a13().next();
check(first13.done === undefined && typeof first13.next === "function", true, "generator function as next");
var asyncNext = { next: async function () { return 1; }, [Symbol.iterator]() { return this; } };
function* a14() { yield* asyncNext; } check(a14().next() instanceof Promise, true, "async function as next");
// A next that needs the arguments object, default parameters and rest parameters.
var fancy = { n: 0, next(a = "d", ...rest) { return { value: a + arguments.length + rest.length, done: this.n++ > 1 }; }, [Symbol.iterator]() { return this; } };
function* a15() { return yield* fancy; } check(drain(a15(), () => "s"), "d10,s10,=s10", "default and rest parameters");

// Manual stepping of built-in iterators.
var ai = [5, 6][Symbol.iterator](), mi = new Map([["k", 1]]).entries(), si = new Set([7]).values(), ti = "hi"[Symbol.iterator]();
check(JSON.stringify([ai.next(), ai.next(), ai.next(), mi.next(), mi.next(), si.next(), ti.next(), ti.next(), ti.next()]),
  '[{"value":5,"done":false},{"value":6,"done":false},{"done":true},{"value":["k",1],"done":false},{"done":true},{"value":7,"done":false},{"value":"h","done":false},{"value":"i","done":false},{"done":true}]', "built-in next");
var gi = (function* (x) { var y = yield x; try { yield y; } finally { yield "cleanup"; } })(1);
check(JSON.stringify([gi.next(), gi.next(2), gi.return(3), gi.next(), gi.next()]),
  '[{"value":1,"done":false},{"value":2,"done":false},{"value":"cleanup","done":false},{"value":3,"done":true},{"done":true}]', "generator next and return");
var gt = (function* () { try { yield 1; } catch (e) { yield "got " + e; } })(); gt.next();
check(gt.throw("x").value, "got x", "generator throw");
var wrong = ""; try { ai.next.call({}); } catch (e) { wrong = e.constructor.name; } check(wrong, "TypeError", "next on a wrong receiver");
var running = (function* () { running.next(); })(); var busy = ""; try { running.next(); } catch (e) { busy = e.constructor.name; } check(busy, "TypeError", "next on a running generator");
check(typeof new Error("x").stack, "string", "stack available");
function* tracer() { yield new Error("in generator").stack; }
var genTrace = tracer().next().value; check(/tracer/.test(genTrace), true, "generator frame in its stack");

if (failures) throw new Error(failures + " failures");
