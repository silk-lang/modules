// Watched records: an ordinary object of numbers, booleans, null or undefined in a variable
// the code reads by its cell, read by inlined methods, is a constant while it is not
// changed. Each phase warms the reads up and then changes the record in the middle of a
// run: a write, a getter in a slot's place, a delete, an add, the variable set to another
// object.
var Mode = new Object();
Mode.A = 1;
Mode.B = 2;
Mode.C = -1;
var Flags = new Object();
Flags.on = true;
Flags.none = null;
Flags.unset = undefined;
function Item(m) { this.m = m; }
Item.prototype.pick = function () { return this.m == Mode.A ? 10 : (this.m == Mode.B ? 20 : 30); };
Item.prototype.third = function () { return Mode.C | 0; };
Item.prototype.flags = function () { return (Flags.on ? 1 : 0) + (Flags.none === null ? 2 : 0) + (Flags.unset === undefined ? 4 : 0); };
function Runner() { this.items = []; for (var i = 0; i < 6; i++) this.items.push(new Item(i % 3)); }
Runner.prototype.turn = function (k) {
  var s = 0;
  for (var i = 0; i < this.items.length; i++) { var it = this.items[i]; s += it.pick() + it.third() * k + it.flags(); }
  return s;
};
var runner = new Runner();

function phase(change, rounds) {
  var total = 0;
  for (var n = 0; n < rounds; n++) total = (total * 7 + runner.turn(n & 3)) % 1000003;
  change();
  for (var n = 0; n < rounds; n++) total = (total * 7 + runner.turn(n & 3)) % 1000003;
  return total;
}
var out = [];
out.push(phase(function () {}, 200));
out.push(phase(function () { Mode.A = 2; }, 200));
out.push(phase(function () { Object.defineProperty(Mode, "B", { get: function () { return 0; }, configurable: true }); }, 200));
out.push(phase(function () { delete Mode.C; }, 200));
out.push(phase(function () { Mode.D = 4; }, 200));
out.push(phase(function () { Flags.on = false; }, 200));
out.push(phase(function () { Flags.none = 0; }, 200));
out.push(phase(function () { var other = new Object(); other.A = 0; other.B = 1; other.C = 5; Mode = other; }, 200));
out.push(phase(function () { Mode.C = 6; }, 200));
print(out.join(" "));
