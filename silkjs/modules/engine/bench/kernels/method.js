// A method call on an object in a loop, reading this.x and this.y.
var UNITS = 100000 * 100;
function Point(x, y) { this.x = x; this.y = y; }
Point.prototype.dot = function (k) { return this.x * k + this.y; };
function loop(p, n) { var s = 0; for (var i = 0; i < n; i++) s = s + p.dot(i); return s; }
function kernel() { var p = new Point(3, 4); var t = 0; for (var k = 0; k < 100000; k++) t = (t + loop(p, 100)) % 1000000007; return t; }
