// Rest parameters: the array of the arguments past the named ones, made without the interpreter.
(function () {
  function all(...xs) { return xs; }
  function after1(a, ...xs) { return xs.length * 100 + (a === undefined ? 0 : a) + (xs.length ? xs[xs.length - 1] : 0); }
  function after3(a, b, c, ...rest) { rest.push(a); return rest; }
  function sum(...xs) { var s = 0; for (var i = 0; i < xs.length; i++) s += xs[i]; return s; }
  function forward(...xs) { return sum(...xs) + sum.apply(null, xs) + xs.reduce(function (a, b) { return a + b; }, 0); }
  function keep(...xs) { return function () { return xs; }; }
  function Ctor(name, ...parts) { this.name = name; this.parts = parts; }
  Ctor.prototype.join = function (...extra) { return this.name + ":" + this.parts.concat(extra).join("|"); };
  class Sub extends Ctor { constructor(...xs) { super("sub", ...xs); this.count = xs.length; } }
  var arrow = (...xs) => xs.length;
  function mutate(a, ...xs) { a = 9; xs[0] = a; arguments[1] = 7; return xs.concat([arguments[1], arguments.length]); }
  function defaults(a = 1, ...xs) { return a + xs.length; }
  function objects(...xs) { return xs.map(function (x) { return x && x.v; }); }
  var total = 0;
  var log = [];
  var held = [];
  var many = [];
  for (var n = 0; n < 40; n++) many.push(n);
  for (var i = 0; i < 300; i++) {
    var xs = all(i, "s" + i, { v: i }, null, undefined, 1.5);
    total += xs.length + xs[0] + xs[1].length + xs[2].v + (xs[3] === null ? 1 : 0) + (xs[4] === undefined ? 1 : 0) + xs[5];
    total += all().length + after1() + after1(1) + after1(1, 2) + after1(1, 2, 3) + after3(1, 2).length + after3(1, 2, 3, 4, 5).join("").length;
    total += sum(1, 2, 3) + forward(i, 1, 2) + sum.apply(null, many) + all.apply(null, many).length + after1.apply(null, many);
    total += new Ctor("c", 1, 2).join(3, 4).length + new Sub(i, i + 1).count + new Sub().parts.length + arrow(1, 2, 3) + arrow();
    total += mutate(1, 2, 3).join("").length + defaults() + defaults(undefined, 1, 2) + defaults(5, 1);
    var o = { v: i };
    var got = objects(o, null, o);
    total += got[0] + (got[1] === null ? 1 : 0) + got[2];
    if ((i & 15) === 0) held.push(keep(o, i, "k" + i));
    if ((i & 63) === 0) log.push(total);
  }
  var kept = 0;
  for (var h = 0; h < held.length; h++) { var v = held[h](); kept += v[0].v + v[1] + v[2].length; }
  print("rest", total, kept, log.join(","), Array.isArray(all()), all(1, 2).constructor === Array, JSON.stringify(after3(1, 2, 3, [4], { five: 5 })));
})();
