// Double arithmetic in inlined callees, mixed string concat vs double add on the same site,
// and double remainder (fmod) edge cases (-0, NaN, Infinity, negative operands).
function Vec(x, y, z) {
  this.x = x;
  this.y = y;
  this.z = z;
}
Vec.prototype.dot = function(w) {
  return this.x * w.x + this.y * w.y + this.z * w.z;
};
Vec.prototype.mag = function() {
  return Math.sqrt(this.dot(this));
};
function wrapUp(t) {
  t = t % 2.0;
  if (t < -1) t += 2.0;
  if (t >= 1) t -= 2.0;
  return t;
}
function addMaybe(a, b) {
  return a + b;
}
function runAll() {
  var v1 = new Vec(1.5, -2.25, 3.75);
  var v2 = new Vec(-0.5, 4.5, 1.25);
  var sum = 0;
  for (var i = 0; i < 80; i++) {
    sum += v1.dot(v2) + v1.mag() + wrapUp(i * 0.37 - 10.5);
  }
  var m1 = 0;
  for (var i = 0; i < 80; i++) m1 += addMaybe(i * 0.5, 1.25);
  var s1 = "";
  for (var i = 0; i < 80; i++) s1 = addMaybe("a", i);
  var edges = [
    wrapUp(-3.5), wrapUp(3.5), wrapUp(0.0), wrapUp(-0.0),
    Object.is((-0.0) % 2.0, -0),
    isNaN(1.5 % 0.0),
    isNaN(Infinity % 2.0),
    Math.min(1.5, 2.5), Math.max(1.5, 2.5),
    Object.is(Math.min(0, -0), -0), Object.is(Math.max(-0, 0), 0),
    isNaN(Math.max(1.0, NaN)), isNaN(Math.min(NaN, 1.0)),
    Math.pow(2.5, 3.0)
  ];
  return [Math.round(sum * 1000), Math.round(m1 * 1000), s1, edges.join(",")].join("|");
}
print(runAll());
