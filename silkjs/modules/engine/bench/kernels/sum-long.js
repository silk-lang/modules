// One long integer loop per call, called a few times: needs on-stack replacement.
var UNITS = 4 * 5000000;
function count(n) { var s = 0; for (var i = 0; i < n; i++) { s = s + 3; if (s > 1000) s = s - 1000; } return s; }
function kernel() { var t = 0; for (var k = 0; k < 4; k++) t = t + count(5000000 + k); return t; }
