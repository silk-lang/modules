// Element reads and stores under Symbol keys, as Node keeps its streams' state
// (`this[kState] |= kFlag`): read and stored by key once baseline code has met them. Each
// phase warms the sites up, then in the middle of a run makes a property a setter or a
// getter, freezes an object, deletes the property (an add then), puts the key on a
// prototype, stores into an array under the same site, and uses a string key.
const kState = Symbol('kState');
const kOther = Symbol('kOther');
function Stream(n) { this[kState] = n; this[kOther] = 0; this.n = n; }
Stream.prototype.flag = function (bit, on) {
  if (on) this[kState] |= bit; else this[kState] &= ~bit;
  return this[kState];
};
Stream.prototype.bump = function (key) { this[key] = (this[key] | 0) + 1; return this[key]; };
function Socket(n) { Stream.call(this, n); this.extra = 1; }
Socket.prototype = Object.create(Stream.prototype);
var items = [];
for (var i = 0; i < 8; i++) items.push(i % 2 ? new Socket(i) : new Stream(i));
var logged = 0;
function turn(n) {
  var t = 0;
  for (var i = 0; i < items.length; i++) {
    var s = items[i];
    t += s.flag(1 << (n & 7), (n + i) & 1);
    t += s.bump(kOther) + s.bump(i & 1 ? kState : kOther);
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
  return total + ' ' + logged;
}
var out = [];
out.push(phase(function () {}, 300));
out.push(phase(function () {
  var hidden = 5;
  Object.defineProperty(items[2], kState, { get: function () { return hidden; }, set: function (v) { logged++; hidden = v & 255; }, configurable: true });
}, 300));
out.push(phase(function () { Object.freeze(items[3]); }, 300));
out.push(phase(function () { delete items[4][kOther]; delete items[5][kState]; }, 300));
out.push(phase(function () { Stream.prototype[kOther] = 1000; delete items[6][kOther]; }, 300));
out.push(phase(function () { var a = [1, 2, 3]; a.flag = Stream.prototype.flag; a.bump = Stream.prototype.bump; items[7] = a; }, 300));
out.push(phase(function () { Object.defineProperty(Stream.prototype, kOther, { set: function (v) { logged += 2; }, get: function () { return 3; }, configurable: true }); }, 300));
out.push(phase(function () { items[0] = { flag: Stream.prototype.flag, bump: Stream.prototype.bump }; }, 300));
print(out.join(" | "));
