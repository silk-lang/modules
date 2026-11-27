// Field reads that a getter answers: bytecode getters on prototypes and classes, native ones
// (typed array views, Map and Set sizes), getters that throw, read deep in an expression.
(function () {
  var calls = 0;
  function State() { this.bits = 5; this.length = 0; }
  Object.defineProperties(State.prototype, {
    ended: { configurable: true, get: function () { calls++; return (this.bits & 1) !== 0; } },
    flowing: { get: function () { calls++; return (this.bits & 2) !== 0; }, set: function (v) { if (v) this.bits |= 2; else this.bits &= ~2; } },
    self: { get: function () { return this; } },
    bad: { get: function () { throw new RangeError("bad " + this.bits); } },
    none: { set: function (v) { } },
    deep: { get: function () { return this.ended ? this.self.self.bits : -1; } }
  });
  class Stream {
    constructor(n) { this._state = new State(); this._state.bits = n; this.n = n; }
    get destroyed() { return this._state.ended; }
    get readable() { var s = this._state; return !s.ended && s.flowing; }
    get strict() { "use strict"; return this === undefined ? -1 : this.n; }
    static get limit() { return 10; }
  }
  class Sub extends Stream { get destroyed() { return !super.destroyed; } }
  function top(s) { return s.ended; }
  function local(s) { var t = s; return t.flowing; }
  function arg(a, s) { return s.deep + a; }
  function nested(st) { return st._state.self.self.ended; }
  function sum(a, b, c, d, st) { return a + b + c + d + (st.destroyed ? 1 : 0) + (st.readable ? 2 : 0) + st.strict + st.constructor.limit; }
  function throws(s) { try { return s.bad; } catch (e) { return e.message; } }
  function views(v, m, st, str) { return v.byteLength + v.byteOffset + v.buffer.byteLength + m.size + st.size + str.length + v.length; }
  function primitive(x) { return x.constructor.name; }
  function missing(s) { return s.none === undefined && s.absent === undefined; }
  var buffer = new ArrayBuffer(64), view = new Uint8Array(buffer, 8, 40), map = new Map([[1, 2], [3, 4]]), set = new Set([1]);
  var fakeView = Object.create(Uint8Array.prototype);
  var out = 0, text = "";
  for (var i = 0; i < 400; i++) {
    var s = new State(); s.bits = i & 7;
    var st = (i & 8) ? new Sub(i & 3) : new Stream(i & 3);
    out += (top(s) ? 1 : 0) + (local(s) ? 2 : 0) + arg(i, s) + (nested(st) ? 4 : 0) + sum(1, 2, 3, 4, st);
    out += views(view, map, set, "abc") + (missing(s) ? 1 : 0);
    s.flowing = (i & 1) === 0;
    out += s.flowing ? 16 : 0;
    if ((i & 31) === 0) text += throws(s) + "," + primitive(i) + primitive("s") + ";";
    if ((i & 63) === 0) { try { views(fakeView, map, set, ""); text += "no throw;"; } catch (e) { text += e.constructor.name + ";"; } }
    if (i === 300) Object.defineProperty(State.prototype, "ended", { get: function () { calls += 2; return false; } });
    if (i === 350) s = Object.create(s);
    if (i === 350) out += top(s) ? 100 : 200;
  }
  print("getters", out, calls, text);
})();
