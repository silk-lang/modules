// Object.assign into an empty object whose prototype differs from the source's.
function check(label, actual, expected) {
  if (actual !== expected) throw new Error(label + ": got " + actual + ", expected " + expected);
}
function keys(o) { return Object.keys(o).join(","); }

for (var round = 0; round < 5; round++) {
  var proto = { hello() { return "hi"; } };
  var o = Object.assign(Object.create(proto), { a: round, b: 2 });
  check("proto", Object.getPrototypeOf(o), proto);
  check("a", o.a, round);
  check("b", o.b, 2);
  check("method", o.hello(), "hi");
  check("keys", keys(o), "a,b");
  check("own", o.hasOwnProperty("hello"), false);

  // Two objects of the same kind share behaviour; adding later still works.
  var p = Object.assign(Object.create(proto), { a: 7, b: 8 });
  p.c = 9;
  check("later add", keys(p), "a,b,c");
  check("first unchanged", keys(o), "a,b");
  delete p.a;
  check("after delete", keys(p), "b,c");
  check("other after delete", o.a, round);

  // Null prototype.
  var n = Object.assign(Object.create(null), { x: 1, y: "two" });
  check("null proto", Object.getPrototypeOf(n), null);
  check("null keys", Object.keys(n).join(","), "x,y");
  check("null y", n.y, "two");

  // A setter on the target's prototype runs instead of defining.
  var seen = [];
  var guarded = { set a(v) { seen.push(v); } };
  var g = Object.assign(Object.create(guarded), { a: 5, b: 6 });
  check("setter ran", seen.join(","), "5");
  check("setter own", g.hasOwnProperty("a"), false);
  check("setter b", g.b, 6);

  // A read-only property on the target's prototype makes the assignment throw.
  var frozen = Object.defineProperty({}, "a", { value: 1, writable: false });
  var threw = false;
  try { Object.assign(Object.create(frozen), { a: 2 }); } catch (e) { threw = e instanceof TypeError; }
  check("read-only throws", threw, true);

  // Non-extensible target stays untouched.
  var sealed = Object.preventExtensions(Object.create(proto));
  threw = false;
  try { Object.assign(sealed, { a: 1 }); } catch (e) { threw = e instanceof TypeError; }
  check("non-extensible throws", threw, true);
  check("non-extensible keys", keys(sealed), "");

  // Changing the prototype afterwards and holding heap values.
  var obj = { k: 1 };
  var h = Object.assign(Object.create(proto), { v: obj, s: "str" + round });
  Object.setPrototypeOf(h, null);
  check("heap value", h.v, obj);
  check("heap string", h.s, "str" + round);
  check("reproto keys", Object.keys(h).join(","), "v,s");

  // Spread with __proto__ in the literal.
  var src = { m: 1, n: 2 };
  var sp = { __proto__: proto, ...src };
  check("spread proto", Object.getPrototypeOf(sp), proto);
  check("spread keys", keys(sp), "m,n");
  check("spread method", sp.hello(), "hi");
}
