// Calls whose site calls several functions: each known target is tested in turn and its
// body inlined, a call is made for any other callee, and the results meet.
function Idle(n) { this.n = n; this.runs = 0; }
Idle.prototype.run = function (x) { this.runs++; return this.n + x; };
function Worker(n) { this.n = n; this.runs = 0; this.acc = 0; }
Worker.prototype.run = function (x) { this.runs++; this.acc = this.acc + x; return this.acc & 255; };
function Device(n) { this.n = n; this.runs = 0; this.held = null; }
Device.prototype.run = function (x) {
  this.runs++;
  if (this.held == null) { this.held = x; return -1; }
  var was = this.held;
  this.held = null;
  return was * 2 + this.n;
};
function Handler(n) { this.n = n; this.runs = 0; this.list = []; }
Handler.prototype.run = function (x) {
  this.runs++;
  var s = 0;
  for (var i = 0; i < this.list.length; i++) s += this.list[i];
  if (this.list.length < 4) this.list.push(x); else this.list.length = 0;
  return s;
};
function Block(task) { this.task = task; this.count = 0; }
Block.prototype.go = function (x) { this.count++; return this.task.run(x); };

// Two, three and four targets at one site, seen from the start.
function drive(blocks, n) {
  var s = 0;
  for (var i = 0; i < n; i++) s += blocks[i % blocks.length].go(i & 7);
  return s;
}
var two = [new Block(new Idle(1)), new Block(new Worker(2))];
var a = 0;
for (var r = 0; r < 300; r++) a += drive(two, 20);
print(a, two[0].count, two[0].task.runs, two[1].task.acc);

function Block3(task) { this.task = task; this.count = 0; }
Block3.prototype.go = function (x) { this.count++; return this.task.run(x) + 1; };
var three = [new Block3(new Idle(1)), new Block3(new Worker(2)), new Block3(new Device(3))];
var b = 0;
for (var r = 0; r < 300; r++) b += drive(three, 21);
print(b, three[2].count, three[2].task.runs, three[2].task.held);

function Block4(task) { this.task = task; this.count = 0; }
Block4.prototype.go = function (x) { this.count++; var r = this.task.run(x); return r === undefined ? 0 : r; };
var four = [new Block4(new Idle(1)), new Block4(new Worker(2)), new Block4(new Device(3)), new Block4(new Handler(4))];
var c = 0;
for (var r = 0; r < 300; r++) c += drive(four, 24);
print(c, four[3].count, four[3].task.runs, four[3].task.list.length);

// A fifth callee, one of another kind, and one that is no function arrive late: the
// call is made for them.
function Late(n) { this.n = n; this.runs = 0; }
Late.prototype.run = function (x) { this.runs++; return x - this.n; };
four.push(new Block4(new Late(5)));
for (var r = 0; r < 300; r++) c += drive(four, 25);
four.push(new Block4({ run: Math.abs }));
four.push(new Block4({ run: function (x) { return x * 100; } }));
for (var r = 0; r < 300; r++) c += drive(four, 28);
print(c, four[4].task.runs, four[0].task.runs);
four.push(new Block4({ run: 3 }));
var failed = 0;
for (var r = 0; r < 20; r++) { try { c += drive(four, 32); } catch (e) { failed += e instanceof TypeError ? 1 : 100; } }
print(c, failed, four[3].task.runs);

// The tested callee sits under operands and unboxed locals; an arm's guard fails after the
// arm stored (the body's rest runs in a frame of its own), and an arm throws.
function Cell(v) { this.v = v; this.gets = 0; }
function Wide(v) { this.pad = 0; this.gets = 0; this.v = v; }
function Reader(cell) { this.cell = cell; this.reads = 0; }
Reader.prototype.run = function (x) { this.reads++; var c = this.cell; c.gets = c.gets + 1; return c.v + x; };
function Thrower(limit) { this.limit = limit; this.tries = 0; }
Thrower.prototype.run = function (x) { this.tries++; if (x > this.limit) throw new RangeError("x" + x); return x; };
function Mixer(tasks) { this.tasks = tasks; this.sum = 0; }
Mixer.prototype.mix = function (n) {
  var total = 0;
  for (var i = 0; i < n; i++) {
    var k = i * 3 + 1;
    var t = this.tasks[i % this.tasks.length];
    total = total + k + t.run(i & 15) * 2;
  }
  this.sum = this.sum + total;
  return total;
};
var caught = 0;
function mixAll(mixer, n) { try { return mixer.mix(n); } catch (e) { caught += e instanceof RangeError ? 1 : 100; return -1; } }
var reader = new Reader(new Cell(7));
var thrower = new Thrower(99);
var mixer = new Mixer([reader, thrower, new Idle(2)]);
var d = 0;
for (var r = 0; r < 400; r++) d += mixAll(mixer, 12);
reader.cell = new Wide(9);
for (var r = 0; r < 400; r++) d += mixAll(mixer, 12);
thrower.limit = 9;
for (var r = 0; r < 50; r++) d += mixAll(mixer, 40);
thrower.limit = 99;
for (var r = 0; r < 100; r++) d += mixAll(mixer, 12);
print(d, caught, mixer.sum, reader.reads, reader.cell.gets, thrower.tries);

// A chain inside an inlined method inside an inlined method, and methods that are an own
// property for some receivers.
function Outer(block) { this.block = block; this.asks = 0; }
Outer.prototype.ask = function (x) { this.asks++; return this.block.go(x) + 1; };
function askAll(outers, n) {
  var s = 0;
  for (var i = 0; i < n; i++) s += outers[i % outers.length].ask(i & 3);
  return s;
}
var own = new Idle(10);
own.run = function (x) { this.runs += 2; return x; };
var outers = [new Outer(new Block(new Idle(1))), new Outer(new Block(new Worker(2))), new Outer(new Block(own))];
var e = 0;
for (var r = 0; r < 400; r++) e += askAll(outers, 15);
print(e, outers[0].asks, outers[1].block.task.acc, own.runs);
