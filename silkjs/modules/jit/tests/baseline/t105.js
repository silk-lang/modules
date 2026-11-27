// Integers read where they are used: `a.x & b` reads both operands before it unboxes either
// (a field, a variable of the closure), and `a.x == b` after `a.x & c` knows a.x is an Int.
// Then the same code meets a field that is a double, a string, null, an object with valueOf,
// and variables that change kind.
var HELD = 4, RUNNABLE = 2, MASK = 0xff, LIMIT = 9, OTHER = 3;
function Task(state, count) { this.state = state; this.count = count; this.next = null; }
Task.prototype.held = function () { return (this.state & HELD) != 0 || this.state == RUNNABLE; };
Task.prototype.same = function (o) { return (this.state & MASK) == o.state && this.count === o.count; };
Task.prototype.strict = function () { return (this.count | 0) > 1 && this.count === LIMIT; };
Task.prototype.step = function () { this.count = (this.count + this.state) & MASK; return this.count < LIMIT; };
Task.prototype.pick = function () { var s = this.state | 0; if (this.state == OTHER) return s + 1; if (this.state != RUNNABLE) return s; return -s; };
function run(tasks) {
  var total = 0;
  for (var i = 0; i < tasks.length; i++) {
    var t = tasks[i];
    if (t.held()) total += 1;
    if (t.same(tasks[(i + 3) % tasks.length])) total += 2;
    if (t.strict()) total += 4;
    if (t.step()) total += 8;
    total += t.pick();
    total += (t.count & HELD) + (t.state & t.count) + (t.count ^ LIMIT);
  }
  return total;
}
var tasks = [];
for (var s = 0; s < 8; s++) for (var c = 0; c < 12; c++) tasks.push(new Task(s, c));
var total = 0;
for (var n = 0; n < 80; n++) total = (total * 7 + run(tasks)) % 1000003;
print(total);
tasks[3].state = 2.5;
tasks[4].state = 2.0;
tasks[7].state = '2';
tasks[9].count = null;
tasks[12].state = { valueOf: function () { return 4; } };
tasks[15].count = 9.5;
tasks[16].state = undefined;
tasks[18].state = true;
for (var n = 0; n < 80; n++) total = (total * 7 + run(tasks)) % 1000003;
print(total);
RUNNABLE = 2.5;
for (var n = 0; n < 40; n++) total = (total * 7 + run(tasks)) % 1000003;
print(total);
RUNNABLE = '2'; HELD = 4.5; LIMIT = '9';
for (var n = 0; n < 40; n++) total = (total * 7 + run(tasks)) % 1000003;
print(total);
OTHER = null; MASK = { valueOf: function () { return 15; } };
for (var n = 0; n < 40; n++) total = (total * 7 + run(tasks)) % 1000003;
print(total);
