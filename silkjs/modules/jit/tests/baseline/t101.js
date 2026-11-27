// Locals that are dead where control goes: an object, a string or a number a local held is
// let go on the edge to a block that never reads it, on one arm of a branch and not the
// other, in front of a loop and behind one; a number is let go at a call whose body is
// inlined. The code that follows leaves compiled code part way (a number turns into a
// string, an index runs past its Array), writes the local again and reads it; a getter
// counts the objects still held.
var made = 0;
function Box(n) { this.n = n; made++; }
Box.prototype.twice = function () { return this.n * 2; };
function arms(k, x) {
  var t = new Box(k);
  var u = "s" + k;
  var r = 0;
  if (k & 1) { r = t.n + x; } else { r = u.length + x; t = null; }
  // t and u are dead here; r may be a string now.
  r = r + x;
  if (k % 7 == 0) { t = new Box(r); r = t.twice(); }
  return r;
}
function oneArm(k, a) {
  var t = new Box(k), s = 0;
  if (k % 3 == 0) return a[k % a.length] + s;
  s = t.n;
  if (k % 5 == 0) s += t.twice();
  return s + a[k % a.length];
}
function around(a, n) {
  var t = new Box(n), keep = new Box(n + 1), s = 0;
  var first = t.n;
  // t is dead in the loop and behind it; keep is read behind it.
  for (var i = 0; i < n; i++) {
    var e = new Box(a[i]);
    s += e.n;
    if (s > 1000) { s = s - 1000; e = null; }
  }
  return s + first + keep.n;
}
function carry(a, j, limit) {
  var s = 0;
  for (var i = 0; i < a.length; i++) {
    var low = a[i] & 15;
    var at = (i + j) % a.length;
    a[at] += low;
    while (a[at] >= limit) { a[at] -= limit; at = (at + 1) % a.length; a[at]++; }
    s += low;
  }
  return s;
}
function add(a, i, w, j) { var v = a[i] + w[j]; w[j] = v; return v; }
function inlined(a, w) {
  var s = 0;
  for (var i = 0; i < a.length; i++) {
    var t = new Box(a[i]);
    var c = t.n + 1;
    // t and c are dead at the second call and after it.
    var d = add(a, i, w, i) + c;
    s += add(a, i, w, i + 1) + d;
  }
  return s;
}
function deep(a, w) {
  var s = 0, last = null;
  for (var i = 0; i < a.length; i++) {
    var t = new Box(i);
    s += inlined(a, w) + t.n;
    last = new Box(s);
  }
  return s + (last ? last.n : 0);
}
function reused(k) {
  var t = [k];
  var n = t.length;
  if (k > 2) { t = "str"; n += t.length; } else { n += 1; }
  t = { v: n };
  if (k > 4) n = n * 2;
  return t.v + n;
}
function captured(k) {
  var t = new Box(k);
  var f = function () { return t.n; };
  if (k & 1) k += 1;
  return f() + k;
}
function caught(k, a) {
  var t = new Box(k), r = 0;
  try { if (k & 1) r = a[k].n; else r = 1; } catch (e) { r = t.n; }
  return r + t.n;
}
function counted(o) {
  var t = new Box(1), n = 0;
  if (o.flag) n = 1; else n = 2;
  return n + o.count;
}
// A local read from a field, the field cleared, the local handed to an inlined call as its
// last use: the local's count is the object's last from the store on.
function Dev() { this.v1 = null; this.q = []; }
Dev.prototype.queue = function (p) { this.q.push(p.n); p.n = -p.n; return this.q.length; };
Dev.prototype.run = function (p) {
  if (p == null) {
    var v = this.v1;
    if (v == null) return -1;
    this.v1 = null;
    return this.queue(v);
  }
  this.v1 = p;
  return 0;
};
var holder = { flag: true };
Object.defineProperty(holder, "count", { get: function () { return made; } });
var out = [];
for (var turn = 0; turn < 300; turn++) {
  var r = [];
  for (var k = 0; k < 16; k++) r.push(arms(k, k < 12 || turn < 250 ? k : "z"), oneArm(k, k == 13 && turn > 280 ? [1.5, "q"] : [1, 2, 3, 4]));
  var a = [3, 9, 27, 81, 243, 729, 2187];
  r.push(around(a, 7), around(a, 0), around(a, turn > 290 ? 9 : 3));
  var c = [17, 250, 3, 255, 255, 90];
  r.push(carry(c, 1, 256), c.join(), carry(c, turn % 5, 256), c.join());
  var w = [1, 2, 3, 4, 5, 6, 7, 8];
  r.push(inlined(a, w), w.join(), inlined(turn > 295 ? [1, "x", 2.5] : [4, 5], w), w.join(), deep([1, 2], [3, 4, 5]));
  for (k = 0; k < 7; k++) r.push(reused(k), captured(k), caught(k, [0, null, 0, { n: 5 }]));
  var dev = new Dev(), kept = new Box(turn);
  r.push(dev.run(new Box(turn)), dev.run(null), dev.run(null), dev.run(kept), dev.run(null), kept.n, dev.q.join());
  holder.flag = (turn & 1) == 0;
  made = 0;
  r.push(counted(holder));
  if (turn == 299) out = r;
}
print(out.join("\n"));
