// A small function called in a loop.
var UNITS = 100000 * 100;
function add(a, b) { return a + b; }
function loop(n) { var s = 0; for (var i = 0; i < n; i++) s = add(s, i); return s; }
function kernel() { var t = 0; for (var k = 0; k < 100000; k++) t = (t + loop(100)) % 1000000007; return t; }
