// Integer loop in a function called many times: what the JIT compiles today.
var UNITS = 200000 * 100;
function sum(n) { var s = 0; for (var i = 0; i < n; i++) s = s + i; return s; }
function kernel() { var t = 0; for (var k = 0; k < 200000; k++) t = (t + sum(100)) % 1000000007; return t; }
