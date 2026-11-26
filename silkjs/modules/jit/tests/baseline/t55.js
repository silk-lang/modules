// Symbol-keyed reads whose key lives in the function's own scope because an inner function
// captures it (`obj[kState]` as get_scope0_el), in a function the optimizer compiles. Each
// phase warms the reads up, then changes what they see in the middle of a run: a getter, a
// missing property, a prototype's property, a proxy, a primitive receiver.
function make() {
  const kState = Symbol('kState');
  const kName = Symbol('kName');
  function tag(o, n) { o[kState] = n; o[kName] = 'n' + n; return o; }
  var items = [];
  for (var i = 0; i < 6; i++) items.push(tag(i & 1 ? { a: i } : { b: i, c: 1 }, i));
  function turn(n) {
    var t = 0;
    for (var i = 0; i < items.length; i++) {
      var o = items[(i + n) % items.length];
      var s = o[kState];
      var name = o[kName];
      t += (s | 0) + (typeof name === 'string' ? name.length : 7);
    }
    return t;
  }
  return { items: items, turn: turn, kState: kState, kName: kName };
}
var m = make();
function phase(change, rounds) {
  var total = 0;
  for (var n = 0; n < rounds; n++) {
    var r;
    try { r = m.turn(n); } catch (e) { r = e instanceof TypeError ? 77 : 99; }
    total = (total * 7 + (r | 0)) % 1000003;
  }
  change();
  for (var n = 0; n < rounds; n++) {
    var r;
    try { r = m.turn(n); } catch (e) { r = e instanceof TypeError ? 77 : 99; }
    total = (total * 7 + (r | 0)) % 1000003;
  }
  return total;
}
var out = [];
out.push(phase(function () {}, 300));
out.push(phase(function () { var c = 0; Object.defineProperty(m.items[1], m.kState, { get: function () { return ++c & 7; } }); }, 300));
out.push(phase(function () { delete m.items[2][m.kName]; }, 300));
out.push(phase(function () { Object.prototype[m.kName] = 'proto'; delete m.items[3][m.kName]; }, 300));
out.push(phase(function () { m.items[4] = new Proxy({}, { get: function (t, k) { return typeof k === 'symbol' ? 3 : undefined; } }); }, 300));
out.push(phase(function () { m.items[5] = 'str'; }, 300));
out.push(phase(function () { m.items[0] = null; }, 300));
print(out.join(" "));
