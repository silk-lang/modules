// Dead promises, await handlers and async frames are kept and reused for the
// next ones; each case checks that a reused one starts as a fresh one would,
// whatever was done to the one before it.
var failures = 0;
var say = typeof print === "function" ? print : console.log;
function check(got, want, label) { if (got !== want) { failures++; say("FAIL", label, got, want); } }
function collect() { if (typeof gc === "function") gc(); else if (typeof std === "object" && std.gc) std.gc(); }

async function plain(x) { return x; }
async function awaiting(x) { await null; return x + 1; }
async function wide(a, b, c, d, e, f, g, h) { var l1 = a, l2 = b, l3 = c, l4 = d; await null; return l1 + l2 + l3 + l4 + e + f + g + h; }
async function capturing(x) { var local = x; var get = function () { return local; }; await null; local = local * 2; return get; }
async function throwing(x) { await null; throw new Error("e" + x); }
function* gen(n) { var t = 0; for (var i = 0; i < n; i++) t += yield i; return t; }

(async function () {
  for (var round = 0; round < 4; round++) {
    // Promises: changed ones die, then fresh ones must not show the changes.
    for (var i = 0; i < 20; i++) {
      var p = plain(i);
      if (i % 4 === 0) p.extra = i;
      else if (i % 4 === 1) Object.freeze(p);
      else if (i % 4 === 2) Object.setPrototypeOf(p, null);
      check(await Promise.prototype.then.call(p, function (v) { return v; }), i, "changed promise value");
    }
    for (var j = 0; j < 20; j++) {
      var q = plain(j);
      check(Object.getPrototypeOf(q), Promise.prototype, "fresh promise prototype");
      check(Object.isExtensible(q), true, "fresh promise extensible");
      check(Object.keys(q).length, 0, "fresh promise keys");
      check("extra" in q, false, "fresh promise extra");
      check(await q, j, "fresh promise value");
    }
    // A promise with a weak reference and a registered finalizer dies normally.
    var held = new WeakRef(plain(1));
    var registry = new FinalizationRegistry(function () {});
    registry.register(plain(2), "x");
    // Subclass promises and their then() results.
    class Sub extends Promise {}
    var s = Sub.resolve(5);
    check(s instanceof Sub, true, "subclass");
    check(await s.then(function (v) { return v * 2; }), 10, "subclass then");
    check(Object.getPrototypeOf(plain(0)), Promise.prototype, "after subclass");

    // Await handlers and frames of different sizes, interleaved.
    var total = 0;
    for (var k = 0; k < 30; k++) {
      total += await awaiting(k);
      total += await wide(k, 1, 2, 3, 4, 5, 6, 7);
      total += await awaiting(k, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12);
    }
    check(total, (435 + 30) + (435 + 28 * 30) + (435 + 30), "frame values");
    // Arguments beyond the declared ones are kept in a reused frame too.
    async function argsOf() { await null; return Array.prototype.join.call(arguments, ","); }
    check(await argsOf(1, 2, 3), "1,2,3", "arguments");
    check(await argsOf(), "", "no arguments");
    check(await argsOf("a", "b", "c", "d", "e", "f", "g", "h", "i"), "a,b,c,d,e,f,g,h,i", "many arguments");
    // A closure over a finished frame's local keeps its own value.
    var getters = [];
    for (var m = 0; m < 10; m++) getters.push(await capturing(m));
    for (var m2 = 0; m2 < 10; m2++) await wide(m2, 0, 0, 0, 0, 0, 0, 0);
    for (var n = 0; n < 10; n++) check(getters[n](), n * 2, "captured local " + n);
    // Rejections from reused frames.
    for (var r = 0; r < 10; r++) {
      try { await throwing(r); failures++; say("FAIL no throw"); } catch (e) { check(e.message, "e" + r, "rejection"); }
    }
    // Several frames suspended at once, settled out of order.
    var pending = [];
    for (var t = 0; t < 12; t++) pending.push(awaiting(t));
    var settled = await Promise.all(pending);
    check(settled.join(","), "1,2,3,4,5,6,7,8,9,10,11,12", "concurrent frames");
    // Generators share the frame cells.
    var it = gen(4); it.next();
    check(it.next(1).value, 1, "generator step");
    var all = 0; for (var v of gen(5)) all += v;
    check(all, 10, "generator sum");
    var done = gen(3); done.next(); done.next(1); done.next(2);
    check(done.next(3).value, 6, "generator sent total");
    collect();
    check(held.deref() === undefined || held.deref() instanceof Promise, true, "weak ref");
  }
  collect();
  if (failures) throw new Error(failures + " reuse checks failed");
  say("ok");
})().catch(function (e) { say("FAIL", e && e.stack || e); throw e; });
