function P(x, y) { this.x = x; this.y = y; }
P.prototype.sum = function () { return this.x + this.y; };
P.prototype.bump = function (d) { this.x = this.x + d; return this; };
function run(p, n) { var t = 0; for (var i = 0; i < n; i++) { t = t + p.sum(); p.bump(1); } return t; }
var p = new P(1, 2);
var total = 0;
for (var k = 0; k < 50; k++) total += run(p, 20);
print(total, p.x);
