// Getters at field reads that optimized code calls itself: on the prototype and own, that
// read `this`, read other getters, recurse into the reading function, throw, return objects,
// and native getters. Each phase warms the reads up, then in the middle of a run replaces a
// getter, makes it a data property, makes it throw, and puts a primitive or a proxy where
// the object was.
var depth = 0;
function State(n) { this.n = n; this._flags = n & 3; }
Object.defineProperty(State.prototype, 'flags', { get: function () { return this._flags; }, configurable: true });
Object.defineProperty(State.prototype, 'double', { get: function () { return this.flags * 2 + this.n; }, configurable: true });
Object.defineProperty(State.prototype, 'deep', { get: function () { if (depth++ > 2) { depth = 0; return 1; } return read(this) & 15; }, configurable: true });
Object.defineProperty(State.prototype, 'box', { get: function () { return { v: this.n }; }, configurable: true });
var own = { get size() { return 4; }, n: 1, _flags: 2 };
Object.setPrototypeOf(own, State.prototype);
var items = [new State(1), new State(2), new State(7), own, new State(4)];
function read(s) { return s.flags + s.double + s.box.v; }
function turn(n) {
  var t = 0;
  for (var i = 0; i < items.length; i++) {
    var s = items[(i + n) % items.length];
    t += read(s) + (s.deep | 0) + (typeof s.size === 'number' ? s.size : 0);
    var m = new Map([[1, 2]]);
    t += m.size;
  }
  return t;
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
out.push(phase(function () { Object.defineProperty(State.prototype, 'flags', { get: function () { return 9; }, configurable: true }); }, 300));
out.push(phase(function () { Object.defineProperty(State.prototype, 'flags', { value: 3, writable: true, configurable: true }); }, 300));
out.push(phase(function () { var k = 0; Object.defineProperty(State.prototype, 'double', { get: function () { if (++k % 50 == 0) throw new RangeError('x'); return 1; }, configurable: true }); }, 300));
out.push(phase(function () { items[2] = 5; }, 300));
out.push(phase(function () { items[1] = new Proxy(new State(3), {}); }, 300));
out.push(phase(function () { Object.defineProperty(own, 'flags', { get: function () { throw new TypeError('own'); }, configurable: true }); }, 300));
print(out.join(" "));
try { var e = items[0]; Object.defineProperty(State.prototype, 'box', { get: function () { return new Error('trace').stack.split('\n').length > 1 ? { v: 1 } : { v: 0 }; }, configurable: true }); print(read(e)); } catch (x) { print('threw ' + x); }
