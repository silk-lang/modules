// Conditions made of several tests: `a || b` and `a && b` of comparisons, straight and
// through an inlined method that returns one, nested, as a loop's condition, with the
// answer also kept in a variable (it is a value then, not only a branch), with operands
// that are not booleans (`||` yields the operand), and with a test that leaves the code
// part way through (a field that turns into a string after warm-up).
function Task(state, id) { this.state = state; this.id = id; this.link = null; }
Task.prototype.held = function () { return (this.state & 4) != 0 || this.state == 2; };
Task.prototype.ready = function () { return this.state != 0 && this.id < 5 && (this.state & 1) == 1; };
Task.prototype.mixed = function () { return this.link || this.state; };
function both(t) { return t.held() && t.ready(); }
function either(t, n) { return t.held() || t.ready() || n > 7; }
function nested(t, n) { return (t.state == 1 || t.state == 3) && (n < 4 || (n & 1) == 0 || t.held()); }
function kept(t) { var r = t.state > 2 || t.id == 3; var c = r ? 5 : 7; return r ? c + 1 : c - 1; }
function walk(t, limit) {
  var n = 0;
  while (t != null && n < limit && !(t.state == 6 && t.id == 2)) { n++; t = t.link; }
  return n;
}
function sum(tasks, n) {
  var total = 0;
  for (var i = 0; i < tasks.length; i++) {
    var t = tasks[i];
    if (t.held()) total += 1; else total += 2;
    if (t.ready()) total += 4;
    if (both(t)) total += 8;
    if (either(t, n)) total += 16;
    if (nested(t, n)) total += 32;
    total += kept(t);
    var m = t.mixed();
    total += typeof m == 'number' ? m : 3;
    if (!(t.state < 3 || t.id > 2)) total += 64;
    if (t.state == 1 ? t.id > 1 || n == 3 : t.id < 2 && n != 5) total += 128;
  }
  return total;
}
var tasks = [];
for (var s = 0; s < 8; s++) for (var id = 0; id < 7; id++) tasks.push(new Task(s, id));
for (var i = 1; i < tasks.length; i++) if (i % 3) tasks[i].link = tasks[i - 1];
var total = 0;
for (var n = 0; n < 60; n++) total = (total * 3 + sum(tasks, n % 10) + walk(tasks[tasks.length - 1 - n % 9], 4 + n % 30)) % 1000003;
print(total);
// The same code meets values its tests did not see.
tasks[5].state = '4';
tasks[9].state = 2.5;
tasks[11].id = { valueOf: function () { return 3; } };
tasks[20].state = null;
for (var n = 0; n < 60; n++) total = (total * 3 + sum(tasks, n % 10) + walk(tasks[tasks.length - 1 - n % 9], 4 + n % 30)) % 1000003;
print(total);
