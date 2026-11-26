// Loop-invariant reads moved out of loops: a store of the same name through another
// reference, a length store, a getter or setter installed while the loop runs, a callee
// replaced while the loop runs, methods of inlined bodies, and a new kind of element.
var out = [];
function note(x) { out.push(String(x)); }

function Box(n) { this.items = []; this.n = n; this.scale = 2; }
Box.prototype.size = function () { return this.items.length; };
Box.prototype.at = function (i) { return this.items[i]; };
function Item(v) { this.value = v; this.weight = 1; }
Item.prototype.run = function () { this.value = this.value + this.weight; };
function Other(v) { this.value = v; this.weight = 3; }
Other.prototype.run = function () { this.value = this.value * 2 % 1000; };

function walk(box) {
  for (var i = 0; i < box.size(); i++) { var c = box.at(i); c.run(); }
  return box.size();
}
function sum(box) {
  var s = 0;
  for (var i = 0; i < box.size(); i++) s += box.at(i).value * box.scale;
  return s;
}
var box = new Box(0);
for (var i = 0; i < 40; i++) box.items.push(i % 3 ? new Item(i) : new Other(i));
for (var r = 0; r < 200; r++) { walk(box); if (r % 50 === 0) note(sum(box)); }

// The same name stored through another reference inside the loop.
function aliasing(a, b, n) { var s = 0; for (var i = 0; i < n; i++) { s += a.scale; b.scale = i; } return s; }
var shared = new Box(1);
for (var r = 0; r < 200; r++) note.r = aliasing(shared, r % 2 ? shared : new Box(2), 30);
note(aliasing(shared, shared, 50) + ":" + aliasing(shared, new Box(3), 50));

// A length shortened by a store of length inside the loop.
function shrink(list, n) { var s = 0; for (var i = 0; i < n; i++) { s += list.items.length; if (i === 5) list.items.length = 3; } return s; }
for (var r = 0; r < 200; r++) { var b2 = new Box(0); for (var j = 0; j < 10; j++) b2.items.push(j); note.r = shrink(b2, 20); }
note(note.r);

// A getter that changes another field the loop reads.
function reader(o, n) { var s = 0; for (var i = 0; i < n; i++) { s += o.scale + o.n; o.value = i; } return s; }
var plain = new Box(4);
for (var r = 0; r < 200; r++) note.r = reader(plain, 20);
note(note.r);
var tricky = new Box(4);
Object.defineProperty(tricky, "value", { set: function (v) { this.scale = v; }, get: function () { return 0; } });
note(reader(tricky, 20) + ":" + tricky.scale);
Object.defineProperty(Box.prototype, "n", { get: function () { this.scale = this.scale + 1; return 1; }, configurable: true });
var g = new Box(0); delete g.n;
note(reader(g, 20) + ":" + g.scale);

// A method replaced while the loop runs: the next iteration calls the new one.
function swapping(box, n) {
  var s = 0;
  for (var i = 0; i < n; i++) { s += box.size(); if (i === 7) box.size = function () { return 100; }; }
  return s;
}
for (var r = 0; r < 200; r++) note.r = swapping(new Box(0), 10);
note(note.r + ":" + swapping(new Box(0), 20));
function protoSwap(box, n) {
  var s = 0;
  for (var i = 0; i < n; i++) { s += box.size(); if (i === 3) Box.prototype.size = function () { return -1; }; }
  return s;
}
for (var r = 0; r < 100; r++) note.r = protoSwap(new Box(0), 6);
Box.prototype.size = function () { return this.items.length; };
note(note.r);

// A callee the dispatch never saw, then a run of many kinds.
function Third(v) { this.value = v; this.weight = 0; }
Third.prototype.run = function () { this.value = -this.value; };
box.items.push(new Third(5));
for (var r = 0; r < 100; r++) walk(box);
note(sum(box));
var kinds = [Item, Other, Third, function Fourth(v) { this.value = v; }];
kinds[3].prototype.run = function () { this.value = this.value + 7; };
var big = new Box(0);
for (var i = 0; i < 60; i++) big.items.push(new kinds[i % 4](i));
for (var r = 0; r < 100; r++) walk(big);
note(sum(big));
big.items.push({ value: 1, run: function () { throw new Error("thrown at " + this.value); } });
try { walk(big); } catch (e) { note(e.message); }
big.items.pop();
big.items[3] = { value: 2 };
try { walk(big); } catch (e) { note(e.constructor.name); }

// Globals and closure variables read in a loop that stores fields.
var Direction = { FORWARD: 1, BACKWARD: 0 };
function Link(d) { this.direction = d; this.a = 1; this.b = 2; }
Link.prototype.output = function () { return this.direction === Direction.FORWARD ? this.b : this.a; };
function links(list) { var s = 0; for (var i = 0; i < list.length; i++) { s += list[i].output(); list[i].a = i; } return s; }
var ls = [];
for (var i = 0; i < 30; i++) ls.push(new Link(i % 2));
for (var r = 0; r < 200; r++) note.r = links(ls);
note(note.r);
Direction = { FORWARD: 0, BACKWARD: 1 };
note(links(ls));
Direction.FORWARD = 1;
note(links(ls));
(typeof print === "function" ? print : console.log)(out.join("\n"));
