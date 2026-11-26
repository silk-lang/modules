// Field sites compiled against one shape, then given another: the optimized code leaves at
// the shape test, is unlinked, and is compiled again with those sites general.
function getX(o) { return o.x; }
function setX(o, v) { o.x = v; return o.x; }
function bump(o) { o.n = o.n + 1; o.last = o; return o.n; }
var a = { x: 1, n: 0, last: null };
var b = { y: 2, x: 3, n: 0, last: null };
var s = 0;
for (var i = 0; i < 400; i++) { s += getX(a); s += setX(a, i); s += bump(a); }
for (var i = 0; i < 6000; i++) { s += getX(b); s += setX(b, i & 7); s += bump(b); }
for (var i = 0; i < 400; i++) { s += getX(a); s += getX(b); s += setX(a, 5); s += setX(b, 6); s += bump(a) + bump(b); }
print(s, a.x, b.x, a.n, b.n, a.last === a, b.last === b);
// A site that sees a number where it saw objects.
function len(o) { return o.length; }
function kind(o) { return o.kind; }
var k = { kind: 1 };
var t = 0;
for (var i = 0; i < 300; i++) t += kind(k);
for (var i = 0; i < 300; i++) { var r = kind(i); t += r === undefined ? 1 : 0; }
for (var i = 0; i < 300; i++) { var q = kind("s" + i); t += q === undefined ? 2 : 0; }
try { kind(null); } catch (e) { print(e instanceof TypeError); }
try { kind(undefined); } catch (e) { print(e instanceof TypeError); }
print(t);
