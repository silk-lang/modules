// Small methods with several field stores run without a frame; a run that gives up after a store
// puts the old values back before the call runs again with a frame, so no store is seen twice.
let failures = 0;
function check(got, want, label) { if (got !== want) { failures++; console.log("FAIL", label, got, want); } }

function S() { this.pos = 0; this.col = 0; this.ch = 0; this.src = "hello world"; this.len = 11; this.obj = null; this.other = null; }
S.prototype.peek = function () { if (this.pos < this.len) return this.src.charCodeAt(this.pos); return -1; };
S.prototype.next = function () { this.pos++; this.col++; this.ch = this.peek(); };
S.prototype.swap = function (x) { var t = this.obj; this.obj = x; this.other = t; return t; };
// Throws after a store.
S.prototype.late = function (x) { this.pos = this.pos + 1; this.col = x.missing.deep; };
// x may be an object: the add leaves the fast path after a store.
S.prototype.conv = function (x) { this.pos = this.pos + 1; this.col = this.col + x; return this.col; };
// A property add first, then more stores than the undo log holds.
S.prototype.nine = function () { this.a1 = 1; this.pos++; this.pos++; this.pos++; this.pos++; this.pos++; this.pos++; this.pos++; this.pos++; this.pos++; this.col = 7; };
// The second store drops the last reference to the first store's value.
S.prototype.twice = function (x) { this.obj = x; this.obj = null; this.other = x; };

var s = new S(), sum = 0;
for (var i = 0; i < 2000; i++) { s.pos = i % 11; s.next(); sum += s.ch + s.pos + s.col; }
check(sum, 2196894, "next sum"); check(s.pos, 9, "next pos"); check(s.col, 2000, "next col"); check(s.ch, 108, "next ch");

var a = { n: 1 }, b = { n: 2 }, r = 0;
for (var i = 0; i < 300; i++) { var t = s.swap(i & 1 ? a : b); r += t ? t.n : 0; s.swap({ n: i }); }
check(r, 44551, "swap sum"); check(s.obj.n, 299, "swap obj"); check(s.other.n, 1, "swap other");

var thrown = 0; s.pos = 0;
for (var i = 0; i < 200; i++) { try { s.late({}); } catch (e) { thrown++; } }
check(thrown, 200, "late throws"); check(s.pos, 200, "late pos");

s.pos = 0; s.col = 0; var conversions = 0;
var odd = { valueOf: function () { conversions++; return 2; } };
for (var i = 0; i < 200; i++) s.conv(i % 3 == 0 ? odd : 1);
check(s.pos, 200, "conv pos"); check(s.col, 267, "conv col"); check(conversions, 67, "conv valueOf calls");

s.pos = 0; for (var i = 0; i < 100; i++) s.nine();
check(s.pos, 900, "nine pos"); check(s.col, 7, "nine col"); check(s.a1, 1, "nine a1");

for (var i = 0; i < 200; i++) { s.twice({ n: i }); if (s.obj !== null || s.other.n !== i) failures++; }
check(s.other.n, 199, "twice other");

var frozen = Object.freeze({ pos: 1, col: 1, ch: 1, src: "a", len: 1, peek: S.prototype.peek, next: S.prototype.next });
for (var i = 0; i < 100; i++) frozen.next();
check(frozen.pos, 1, "frozen pos"); check(frozen.col, 1, "frozen col"); check(frozen.ch, 1, "frozen ch");

var g = { get pos() { return 5; }, set pos(v) { this.w = (this.w | 0) + 1; }, col: 0, ch: 0, src: "abcdefgh", len: 8, peek: S.prototype.peek, next: S.prototype.next };
for (var i = 0; i < 100; i++) g.next();
check(g.pos, 5, "accessor pos"); check(g.col, 100, "accessor col"); check(g.ch, 102, "accessor ch"); check(g.w, 100, "accessor setter calls");

// A proxy receiver sees each store once, in order.
var seen = [];
var target = { pos: 0, col: 0, ch: 0, src: "xyz", len: 3, peek: S.prototype.peek, next: S.prototype.next };
var proxy = new Proxy(target, { set(t, key, value) { seen.push(key); t[key] = value; return true; } });
for (var i = 0; i < 3; i++) proxy.next();
check(seen.join(), "pos,col,ch,pos,col,ch,pos,col,ch", "proxy store order"); check(target.ch, -1, "proxy ch");

// The same method on objects of two shapes, and on one whose field moved to a setter midway.
function T() { this.col = 0; this.pos = 0; this.ch = 0; this.src = "ab"; this.len = 2; }
T.prototype.peek = S.prototype.peek; T.prototype.next = S.prototype.next;
var u = new T(), v = new S(), hits = 0;
for (var i = 0; i < 200; i++) {
  u.pos = 0; v.pos = 0; u.next(); v.next();
  if (i == 100) Object.defineProperty(v, "col", { get() { return 3; }, set(x) { hits++; }, configurable: true });
}
check(u.col, 200, "two shapes col"); check(u.ch, 98, "two shapes ch"); check(v.col, 3, "redefined col"); check(hits, 99, "redefined setter calls"); check(v.ch, 101, "redefined ch");

if (failures) throw new Error(failures + " failures");
