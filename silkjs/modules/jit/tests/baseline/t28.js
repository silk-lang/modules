// Functions with a scope of their own: parameters and locals that inner functions capture,
// scopes that escape and scopes that die with the frame, throws, constructions, recursion,
// known local functions inside them, and missing or extra arguments.
(function () {
  function counter(start, step) {
    var n = start;
    return function () { n += step; return n; };
  }
  function adder(a) { return function (b) { return a + b; }; }
  // The scope never escapes: the inner function is called and dropped.
  function local(a, b) {
    var total = 0;
    var add = function (x) { total += x + a; };
    add(b); add(b + 1);
    return total;
  }
  // Captured parameter written after capture, and a parameter that was not passed.
  function late(a, b) {
    var get = function () { return [a, b]; };
    a = a + 1;
    if (b === undefined) b = "none";
    return get();
  }
  function Box(v) {
    this.get = function () { return v; };
    this.set = function (x) { v = x; return this; };
  }
  function thrower(n) {
    var seen = [];
    var note = function (x) { seen.push(x); };
    try {
      note(n);
      if (n % 3 === 0) throw new Error("t" + n);
      note("ok");
    } catch (e) {
      note(e.message);
    } finally {
      note("f");
    }
    return seen.join("|");
  }
  function escapes(n) {
    var inner = function () { if (n > 5) throw new RangeError("r" + n); return n; };
    return inner();
  }
  function recurse(n, acc) {
    var push = function () { acc.push(n); };
    push();
    if (n > 0) recurse(n - 1, acc);
    return acc.length;
  }
  function lexical(n) {
    let out = [];
    for (let i = 0; i < 3; i++) { out.push(function () { return i + n; }); }
    const k = n * 2;
    out.push(function () { return k; });
    return out;
  }
  function withArguments(a) {
    var f = function () { return a; };
    return arguments.length + f() + (arguments[1] === undefined ? 0 : arguments[1]);
  }
  function known(a) {
    var helper = function (x) { return x * 2 + a; };
    var keep = function () { return a; };
    return helper(1) + helper(2) + keep();
  }
  function nested(a) {
    return function (b) {
      var c = a + b;
      return function (d) { c += d; return a + b + c; };
    };
  }
  function loop(n) {
    var total = 0;
    var bump = function (x) { total += x; };
    for (var i = 0; i < n; i++) bump(i);
    return total;
  }
  function self(n) {
    var again = function (m) { return m <= 0 ? 0 : m + again(m - 1); };
    return again(n);
  }
  function uninitialized(flag) {
    var read = function () { return late; };
    if (flag) { try { read(); } catch (e) { return e.name; } }
    let late = 4;
    return read();
  }
  var sum = 0;
  var log = [];
  var kept = [];
  for (var i = 0; i < 300; i++) {
    var c = counter(i, 2);
    c(); c();
    sum += c() + adder(i)(3) + local(i, 1);
    var l = late(i);
    var l2 = late(i, i + 1, i + 2);
    sum += l[0] + l2[0] + l2[1] + (l[1] === "none" ? 1 : 100);
    var box = new Box(i);
    sum += box.set(box.get() + 1).get();
    log.push(thrower(i));
    try { sum += escapes(i % 9); } catch (e) { sum += e.message.length; }
    sum += recurse(i % 7, []);
    var fs = lexical(i);
    sum += fs[0]() + fs[1]() + fs[2]() + fs[3]();
    if ((i & 15) === 0) kept.push(fs[2], c);
    sum += withArguments(i) + withArguments(i, 5) + known(i);
    sum += nested(i)(1)(2) + loop(i % 20) + self(i % 10);
    var u = uninitialized((i & 1) === 0);
    sum += typeof u === "string" ? u.length : u;
  }
  var tail = 0;
  for (var j = 0; j < kept.length; j++) tail += kept[j]();
  print("sum", sum, tail, log.length, log[0], log[1], log[299]);
  // Deep recursion through scoped frames ends in the stack overflow, and the frames unwind.
  function deep(n) { var f = function () { return n; }; return deep(n + 1) + f(); }
  try { deep(0); } catch (e) { print(e instanceof RangeError); }
  print(loop(1000), counter(1, 1)(), new Box(7).get());
})();
