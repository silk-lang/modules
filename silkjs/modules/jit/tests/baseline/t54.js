// Lengths of typed arrays, of objects with a length property or getter, and of strings and
// arrays at the same sites; strict functions whose `this` is undefined, a primitive or an
// object. Each phase warms the sites up, then changes what they see in the middle of a run.
'use strict';
function last(b) { return b[b.length - 1] + b.length; }
function size(o) { return o.length | 0; }
function self(k) { return (this === undefined ? 1 : typeof this === 'object' ? 2 : 3) + k; }
var bufs = [new Uint8Array([1, 2, 3]), new Uint8Array(7), new Int16Array([5, -5])];
var others = [[1, 2], 'abcd', { length: 9 }, bufs[0]];
var kinds = [undefined, 5, { a: 1 }, 'x'];
function turn(n) {
  var t = 0;
  for (var i = 0; i < 6; i++) {
    t += last(bufs[(n + i) % bufs.length]) + size(others[(n + i) % others.length]);
    t += self.call(kinds[(n + i) & 3], i) + self(i);
  }
  return t;
}
function phase(change, rounds) {
  var total = 0;
  for (var n = 0; n < rounds; n++) {
    var r;
    try { r = turn(n); } catch (e) { r = e instanceof TypeError ? 77 : 99; }
    total = (total * 7 + (r | 0)) % 1000003;
  }
  change();
  for (var n = 0; n < rounds; n++) {
    var r;
    try { r = turn(n); } catch (e) { r = e instanceof TypeError ? 77 : 99; }
    total = (total * 7 + (r | 0)) % 1000003;
  }
  return total;
}
var out = [];
out.push(phase(function () {}, 300));
out.push(phase(function () { var calls = 0; others[2] = { get length() { calls++; return calls & 15; } }; }, 300));
out.push(phase(function () { Object.defineProperty(Uint8Array.prototype.__proto__, 'length', { get: function () { return 4; }, configurable: true }); }, 300));
out.push(phase(function () { bufs[1] = [3, 4, 5, 6]; others[3] = null; }, 300));
out.push(phase(function () { kinds[0] = null; kinds[1] = Symbol('s'); }, 300));
print(out.join(" "));
