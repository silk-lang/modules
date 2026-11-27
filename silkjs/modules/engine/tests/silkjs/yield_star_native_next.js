// yield* and for-of stepping a built-in iterator's next directly, and the cases
// that must still call next through the ordinary call path.
var failures = 0;
var say = typeof print === "function" ? print : console.log;
function check(got, want, label) { if (got !== want) { failures++; say("FAIL", label, got, want); } }

for (var round = 0; round < 3; round++) {
  // Values sent with next(v) reach the inner generator; its return value is the
  // value of the yield* expression.
  var log = [];
  function* inner() { var a = yield 1; log.push("a=" + a); var b = yield 2; log.push("b=" + b); return "done"; }
  function* outer() { var r = yield* inner(); log.push("r=" + r); yield 3; }
  var g = outer();
  var steps = [g.next("x"), g.next("y"), g.next("z"), g.next("w")];
  check(steps.map(function (s) { return s.value + "/" + s.done; }).join(" "), "1/false 2/false 3/false undefined/true", "sent values");
  check(log.join(","), "a=y,b=z,r=done", "inner saw values");

  // Nested delegation passes inner result objects through.
  function* leaf() { yield "l1"; yield "l2"; return "leaf"; }
  function* middle() { var r = yield* leaf(); yield r; return "middle"; }
  function* top() { var r = yield* middle(); yield r; }
  var out = [];
  for (var v of top()) out.push(v);
  check(out.join(","), "l1,l2,leaf,middle", "nested");

  // throw and return are forwarded to the inner generator.
  var cleanup = [];
  function* guarded() { try { yield 1; yield 2; } catch (e) { cleanup.push("caught " + e); yield "after"; } finally { cleanup.push("finally"); } }
  function* wrap() { yield* guarded(); }
  var t = wrap();
  t.next();
  check(t.throw("boom").value, "after", "throw forwarded");
  check(t.next().done, true, "throw finished");
  var u = wrap();
  u.next();
  var ret = u.return("early");
  check(ret.value + "/" + ret.done, "early/true", "return forwarded");
  check(cleanup.join(","), "caught boom,finally,finally", "cleanup ran");

  // Arrays, strings, maps, sets and array iterators.
  function* many() { yield* [1, 2]; yield* "ab"; yield* new Map([["k", 1]]).keys(); yield* new Set([9]); yield* [7, 8].entries(); }
  var got = [];
  for (var m of many()) got.push(String(m));
  check(got.join("|"), "1|2|a|b|k|9|0,7|1,8", "built-in iterators");

  // A user iterator with its own next.
  var calls = [];
  var custom = { [Symbol.iterator]() { var i = 0; return { next(v) { calls.push(v); return i < 2 ? { value: i++, done: false } : { value: "end", done: true }; } }; } };
  function* overCustom() { var r = yield* custom; yield r; }
  var c = overCustom();
  var cs = [c.next("p"), c.next("q"), c.next("s"), c.next()];
  check(cs.map(function (s) { return s.value; }).join(","), "0,1,end,", "custom values");
  check(calls.map(String).join(","), "undefined,q,s", "custom next arguments");

  // A generator whose next was replaced on the instance.
  function* plain() { yield "real"; }
  var patched = plain();
  patched.next = function () { return { value: "patched", done: patched.count++ > 0 }; };
  patched.count = 0;
  patched[Symbol.iterator] = function () { return this; };
  var pv = [];
  for (var p of patched) pv.push(p);
  check(pv.join(","), "patched", "patched next");

  // A result object with a getter on value is read once, at the right time.
  var reads = 0;
  var lazy = { [Symbol.iterator]() { var n = 0; return { next() { n++; return { done: n > 2, get value() { reads++; return n; } }; } }; } };
  function* overLazy() { yield* lazy; }
  var lv = [];
  for (var l of overLazy()) lv.push(l);
  check(lv.join(","), "1,2", "lazy values");
  check(reads, 3, "lazy reads");

  // Errors thrown by the inner generator surface at the outer call.
  function* bad() { yield 1; throw new RangeError("inner"); }
  function* overBad() { yield* bad(); }
  var b = overBad();
  b.next();
  var threw = false;
  try { b.next(); } catch (e) { threw = e instanceof RangeError; }
  check(threw, true, "inner throw");

  // Long delegation.
  function* count(n) { for (var i = 0; i < n; i++) yield i; return n; }
  function* sum(n) { var total = 0; var last = yield* count(n); return last; }
  var total = 0;
  for (var k of count(1000)) total += k;
  check(total, 499500, "for-of over generator");
  var s = sum(500); var r;
  while (!(r = s.next()).done) {}
  check(r.value, 500, "yield* return value");
}

// A generator from another realm is not stepped directly but still works.
if (typeof createRealm === "function") {
  var other = createRealm();
  var foreign = other.evaluate("(function* () { yield 'f1'; yield 'f2'; })()");
  function* overForeign() { yield* foreign; }
  var fv = [];
  for (var f of overForeign()) fv.push(f);
  check(fv.join(","), "f1,f2", "foreign generator");
}

if (failures) throw new Error(failures + " yield* checks failed");
say("ok");
