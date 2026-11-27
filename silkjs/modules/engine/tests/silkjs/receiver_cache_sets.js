// More constructors than the receiver cache holds, in a changing order and in alternating pairs: every way of a set hits, misses, is refilled and becomes the probe hint; prototype changes still reach new objects.
var out = [];
var ctors = [];
for (var i = 0; i < 200; i++) {
  ctors.push(new Function('a', 'b', 'this.a = a; this.b = b + ' + i + ';'));
  ctors[i].prototype.tag = (function (k) { return function () { return 'p' + k; }; })(i);
}
var sum = 0;
for (var round = 0; round < 40; round++) {
  for (var j = 0; j < 200; j++) {
    var k = (j * 37 + round) % 200;
    var o = new ctors[k](round, j);
    sum += o.a + o.b;
    if (o.tag() !== 'p' + k && !(k === 3 && round > 20)) out.push('tag ' + k + ' ' + o.tag());
    if (!(o instanceof ctors[k])) out.push('instanceof ' + k);
  }
  for (var t = 0; t < 100; t++) { var x = new ctors[t & 1](t, t); sum += x.b; }
  if (round === 20) { ctors[3].prototype = { tag: function () { return 'replaced'; } }; ctors[4].prototype.extra = 1; }
  if (round === 30) {
    Object.defineProperty(ctors[5].prototype, 'a', { set: function (v) { this._a = v * 2; }, get: function () { return this._a; }, configurable: true });
  }
}
function create() { return function () { this.initialize.apply(this, arguments); }; }
var P = create(); P.prototype = { initialize: function (x, y) { this.x = x; this.y = y; } };
var Q = create(); Q.prototype = { initialize: function (x) { this.x = x * 3; } };
for (var n = 0; n < 2000; n++) { var p = new P(n, 1), q = new Q(n); sum += p.x + p.y + q.x; }
Q.prototype.initialize = function (x) { this.x = -x; };
for (n = 0; n < 100; n++) { sum += new Q(n).x; }
var s5 = new ctors[5](4, 0);
out.push(sum, new ctors[3](1, 2).tag(), new ctors[4](0, 0).extra, s5.a, s5._a, Object.keys(s5).join());
var __result = out.join(' ');
var __expected = "9941365 replaced 1 8 8 _a,b";
if (__result !== __expected) throw new Error("expected " + __expected + ", got " + __result);
