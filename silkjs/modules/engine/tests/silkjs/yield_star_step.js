// yield* over a native iterator hands each stepped value on without the inner
// result object; each case checks the values, the sent values, and that throw,
// return and patched methods still reach the inner iterator as before.
var failures = 0;
var say = typeof print === "function" ? print : console.log;
function check(got, want, label) { if (got !== want) { failures++; say("FAIL", label, got, want); } }

function* inner(n) { for (var i = 0; i < n; i++) yield i; return "inner done"; }
function* outer(n) { var r = yield* inner(n); yield r; }
function* deep(n) { yield* outer(n); }
function* overArray(a) { yield* a; }
function* overMap(m) { yield* m.keys(); }
function* echo() { var got = []; for (var i = 0; i < 3; i++) got.push(yield i); return got.join(","); }
function* relay() { return yield* echo(); }

for (var round = 0; round < 3; round++) {
  var s = 0, count = 0;
  for (var v of outer(100)) { if (typeof v === "number") s += v; count++; }
  check(s, 4950, "outer sum");
  check(count, 101, "outer count");
  check([...outer(3)].join(","), "0,1,2,inner done", "return value of yield*");
  check([...deep(3)].join(","), "0,1,2,inner done", "nested yield*");
  check([...overArray([4, 5, 6])].join(","), "4,5,6", "array");
  check([...overArray("ab")].join(","), "a,b", "string");
  check([...overMap(new Map([[1, 0], [2, 0]]))].join(","), "1,2", "map keys");
  check([...overArray([])].length, 0, "empty array");

  // Manual steps: result objects, sent values, and the last result.
  var g = outer(2);
  var first = g.next();
  check(first.value === 0 && first.done === false && Object.keys(first).join() === "value,done", true, "first step result");
  check(Object.getPrototypeOf(first), Object.prototype, "result prototype");
  check(g.next().value, 1, "second step");
  var last = g.next();
  check(last.value === "inner done" && last.done === false, true, "after delegation");
  check(g.next().done, true, "finished");

  var r = relay();
  r.next("lost");
  r.next("a"); r.next("b");
  var end = r.next("c");
  check(end.value === "a,b,c" && end.done === true, true, "sent values reach the delegate");

  // throw and return go to the inner generator.
  var log = [];
  function* guarded() { try { yield 1; yield 2; } catch (e) { log.push("caught " + e); yield 3; } finally { log.push("finally"); } }
  function* wrap() { yield* guarded(); }
  var w = wrap();
  w.next();
  check(w.throw("x").value, 3, "throw forwarded");
  check(w.return(9).value, 9, "return forwarded");
  check(log.join(","), "caught x,finally", "inner saw throw and return");
  var w2 = wrap();
  w2.next(); w2.next();
  check(w2.return(5).done, true, "return during second step");

  // A throw from the delegate's step propagates through yield*.
  function* failing() { yield 1; throw new Error("boom"); }
  function* outerFailing() { try { yield* failing(); } catch (e) { yield "outer caught " + e.message; } }
  check([...outerFailing()].join(","), "1,outer caught boom", "delegate throws");

  // An array iterator stopped early is closed by for-of through the generator.
  var closed = 0;
  var it = [1, 2, 3][Symbol.iterator]();
  var proxyIt = { [Symbol.iterator]() { return this; }, next: function () { return it.next(); }, return: function () { closed++; return {}; } };
  for (var v of overArray(proxyIt)) { if (v === 2) break; }
  check(closed, 1, "user iterator closed");
}

// A user next sees its own result object passed through as it is.
var marker = { value: "m", done: false, extra: 1 };
var calls = 0;
var custom = { [Symbol.iterator]() { return this; }, next() { calls++; return calls > 2 ? { done: true, value: "end" } : marker; } };
function* overCustom() { return yield* custom; }
var c = overCustom();
check(c.next(), marker, "user result object handed on");
check(c.next().extra, 1, "user result extra field");
var cend = c.next();
check(cend.value === "end" && cend.done === true, true, "user iterator end");

// A patched array iterator next is called as it is.
var ArrayIteratorPrototype = Object.getPrototypeOf([][Symbol.iterator]());
var realNext = ArrayIteratorPrototype.next;
ArrayIteratorPrototype.next = function () { var r = realNext.call(this); if (!r.done) r.value *= 10; return r; };
check([...overArray([1, 2])].join(","), "10,20", "patched array next");
ArrayIteratorPrototype.next = realNext;
check([...overArray([1, 2])].join(","), "1,2", "restored array next");

// A patched generator next is called as it is.
var GeneratorPrototype = Object.getPrototypeOf(inner(0));
var GeneratorNext = Object.getPrototypeOf(GeneratorPrototype).next;
var patchedCalls = 0;
Object.getPrototypeOf(GeneratorPrototype).next = function (x) { patchedCalls++; return GeneratorNext.call(this, x); };
var n = 0;
for (var v of outer(3)) n++;
check(n, 4, "patched generator next values");
check(patchedCalls > 4, true, "patched generator next called");
Object.getPrototypeOf(GeneratorPrototype).next = GeneratorNext;

// A done getter on Object.prototype is not reached: results have their own.
Object.defineProperty(Object.prototype, "done", { get: function () { throw new Error("getter"); }, configurable: true });
check([...outer(2)].join(","), "0,1,inner done", "inherited done getter");
delete Object.prototype.done;

// A running generator stepped again through yield* throws.
var self;
function* reenter() { yield* self; }
self = reenter();
var threw = false;
try { self.next(); } catch (e) { threw = e instanceof TypeError; }
check(threw, true, "running generator");

if (failures) throw new Error(failures + " yield* checks failed");
say("ok");
