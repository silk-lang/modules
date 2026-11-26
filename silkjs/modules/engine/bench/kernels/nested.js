// Nested integer loops in a function called many times.
var UNITS = 20000 * 30 * 30;
function grid(n) { var s = 0; for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) s = s + i * j; return s; }
function kernel() { var t = 0; for (var k = 0; k < 20000; k++) t = (t + grid(30)) % 1000000007; return t; }
