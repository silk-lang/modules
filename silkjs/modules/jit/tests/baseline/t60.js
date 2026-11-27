// Setters at field stores that optimized code calls itself: on the prototype and own, that
// store into `this`, call other setters, throw, and return values that are dropped. Each
// phase warms the stores up, then in the middle of a run replaces a setter, makes it a data
// property, makes it throw, freezes an object and puts a proxy where the object was.
var log = 0;
function Stream(n) { this._n = n; this.hits = 0; }
Object.defineProperty(Stream.prototype, 'n', { set: function (v) { this._n = v & 1023; this.hits++; return { dropped: v }; }, get: function () { return this._n; }, configurable: true });
Object.defineProperty(Stream.prototype, 'both', { set: function (v) { this.n = v + 1; log++; }, get: function () { return this._n * 2; }, configurable: true });
var own = { set mark(v) { log += v & 3; }, get mark() { return log & 7; } };
Object.setPrototypeOf(own, Stream.prototype);
own._n = 1; own.hits = 0;
var items = [new Stream(1), new Stream(2), own, new Stream(3)];
function store(s, v) { s.n = v; s.both = v * 3; if (s === own) s.mark = v; return s.n + s.hits; }
function turn(n) {
  var t = 0;
  for (var i = 0; i < items.length; i++) t += store(items[(i + n) % items.length], n + i) | 0;
  return t + log;
}
function phase(change, rounds) {
  var total = 0;
  for (var n = 0; n < rounds; n++) {
    var r;
    try { r = turn(n); } catch (e) { r = e instanceof TypeError ? 77 : (e instanceof RangeError ? 55 : 99); }
    total = (total * 7 + (r | 0)) % 1000003;
  }
  change();
  for (var n = 0; n < rounds; n++) {
    var r;
    try { r = turn(n); } catch (e) { r = e instanceof TypeError ? 77 : (e instanceof RangeError ? 55 : 99); }
    total = (total * 7 + (r | 0)) % 1000003;
  }
  return total;
}
var out = [];
out.push(phase(function () {}, 300));
out.push(phase(function () { Object.defineProperty(Stream.prototype, 'n', { set: function (v) { this._n = -v; }, get: function () { return this._n; }, configurable: true }); }, 300));
out.push(phase(function () { var k = 0; Object.defineProperty(Stream.prototype, 'both', { set: function (v) { if (++k % 40 == 0) throw new RangeError('s'); }, get: function () { return 1; }, configurable: true }); }, 300));
out.push(phase(function () { Object.defineProperty(Stream.prototype, 'n', { value: 5, writable: true, configurable: true }); }, 300));
out.push(phase(function () { 'use strict'; Object.freeze(items[1]); }, 300));
out.push(phase(function () { items[3] = new Proxy(new Stream(4), { set: function (t, k, v) { log++; t[k] = v; return true; } }); }, 300));
print(out.join(" ") + ' ' + log);
