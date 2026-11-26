// typeof and ! of every kind of value.
(function () {
  function type(x) { return typeof x; }
  function not(x) { return !x; }
  function both(x) { return (typeof x) + (!x ? "-" : "+") + (!!x ? "t" : "f"); }
  function guard(x) { if (typeof x !== "function" && !x) return 1; return typeof x === "object" ? 2 : 3; }
  var rope = "ab";
  for (var r = 0; r < 4; r++) rope = rope + rope + r;
  var values = [0, 1, -1, 0.5, -0, NaN, Infinity, "", "a", rope, rope.slice(0, 0), true, false, null, undefined, Symbol("s"), Symbol.iterator,
    0n, 1n, 12345678901234567890n, {}, [], function () {}, () => 1, class A {}, new Proxy({}, {}), new Proxy(function () {}, {}), new Date(0), /x/,
    Math.max, Object.create(null), new String(""), new Number(0), new Boolean(false), new Map(), new Uint8Array(0)];
  var out = [];
  var count = 0;
  for (var i = 0; i < 200; i++) {
    for (var j = 0; j < values.length; j++) {
      var v = values[j];
      var t = type(v) + (not(v) ? "!" : "") + both(v) + guard(v);
      count += t.length;
      if (i === 199) out.push(t);
    }
  }
  print(count, out.join(" "));
})();
