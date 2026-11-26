// Borrowed fields: a value read from a field without a count, in one block and across the
// blocks of an inlined method, with stores and other owners around it.
var calls = 0;
function nop(x) { calls++; return x; }
function P(g) { this.g = g; this.pad = "p" + g; }
function O(f) { this.f = f; this.n = 0; }
// Another owner of the field's object lets go after a store took the field's count.
function swap(o, y) { var w = o.f; nop(w); var t = o.f; o.f = y; w = y; return t.g; }
var s = 0;
for (var i = 0; i < 3000; i++) { var o = new O(new P(i)); s += swap(o, null); s += new P(i + 1).g & 1; }
print(s, calls);

function Node(id, state, link) { this.id = id; this.state = state; this.link = link; }
Node.prototype.skipped = function () { return (this.state & 4) != 0 || this.state == 2; };
Node.prototype.bump = function () { this.state = this.state + 8; };
Node.prototype.unlink = function (list) { list.head = this.link; return this.id; };
function List() { this.head = null; this.current = null; this.seen = 0; }
List.prototype.push = function (id, state) { this.head = new Node(id, state, this.head); };
// An inlined method with two paths inside a loop: its receiver and closure are released
// where the paths meet.
List.prototype.walk = function () {
  var sum = 0;
  this.current = this.head;
  while (this.current != null) {
    if (this.current.skipped()) {
      this.current = this.current.link;
    } else {
      sum += this.current.id;
      this.current.bump();
      this.seen++;
      this.current = this.current.link;
    }
  }
  return sum;
};
// The inlined method stores over the field its receiver was read from.
List.prototype.drain = function () {
  var sum = 0;
  while (this.head != null) { sum += this.head.unlink(this); }
  return sum;
};
var total = 0;
for (var r = 0; r < 400; r++) {
  var list = new List();
  for (var k = 0; k < 24; k++) list.push(k + r, k % 7);
  total += list.walk() + list.walk();
  total += list.seen;
  total += list.drain();
  if (list.head !== null) total = -1;
}
print(total);
