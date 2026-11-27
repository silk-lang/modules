// Symbol-keyed reads and stores through the element site cache: one site under many shapes,
// symbols and kinds of property, and what must leave the cached path.
(function () {
  const kA = Symbol("a");
  const kB = Symbol("b");
  const kC = Symbol("c");
  function get(o, k) { return o[k]; }
  function set(o, k, v) { o[k] = v; }
  function getA(o) { return o[kA]; }
  function setA(o, v) { o[kA] = v; }
  function bump(o) { o[kA]++; o[kB] += 2; return o[kA] + o[kB]; }
  function callC(o, x) { return o[kC](x); }
  function local(o, k) { var a = o; var b = k; return a[b] + a[b]; }
  function Plain(i) { this[kA] = i; this[kB] = -i; }
  Plain.prototype[kC] = function (x) { return this[kA] + x; };
  function Wide(i) { this.x = 1; this.y = 2; this[kB] = i; this.z = 3; this[kA] = i * 2; this[kC] = function (x) { return x - 1; }; }
  class Fields { [kA] = 5; [kB] = 6; static [kA] = 7; [kC](x) { return x * 2; } }
  var sum = 0;
  var log = [];
  var holder = { [kA]: null };
  var accessor = {};
  var hits = 0;
  Object.defineProperty(accessor, kA, { get: function () { hits++; return 11; }, set: function (v) { hits += v; }, configurable: true });
  var readOnly = Object.defineProperty({}, kA, { value: 13, writable: false, configurable: true });
  var frozen = Object.freeze({ [kA]: 17 });
  var inherited = Object.create({ [kA]: 19, [kB]: 23 });
  var setterBelow = Object.create(accessor);
  var array = [1, 2, 3];
  array[kA] = 29;
  var typed = new Uint8Array(4);
  typed[kA] = 31;
  var fn = function () {};
  fn[kA] = 37;
  var proxy = new Proxy({ [kA]: 41 }, { get: function (t, k) { hits++; return t[k]; }, set: function (t, k, v) { hits += 3; t[k] = v; return true; } });
  var shapes = [new Plain(1), new Wide(2), new Fields(), holder, accessor, readOnly, frozen, inherited, setterBelow, array, typed, fn, proxy, Fields];
  for (var i = 0; i < 400; i++) {
    var p = new Plain(i);
    var w = new Wide(i);
    var f = new Fields();
    sum += getA(p) + getA(w) + getA(f) + get(p, kB) + get(w, kB) + get(f, kB);
    sum += bump(p) + bump(w) + bump(f) + callC(p, 1) + callC(w, 2) + callC(f, 3) + local(p, kA) + local(w, kB);
    // A value whose only count is the slot's is displaced, then one that stays alive.
    setA(holder, { n: i });
    setA(holder, { n: i + 1 });
    var kept = getA(holder);
    setA(holder, kept);
    setA(holder, kA);
    if (getA(holder) !== kA) sum += 1000000;
    setA(holder, "text" + i);
    sum += getA(holder).length + kept.n;
    // One site, every kind of object and property.
    var o = shapes[i % shapes.length];
    var before = getA(o);
    try { (function () { "use strict"; setA(o, typeof before === "number" ? before + 1 : 1); })(); } catch (e) { sum += 3; }
    var after = getA(o);
    sum += (typeof after === "number" ? after : 0) + (get(o, kB) === undefined ? 1 : 2);
    // Fresh symbols and fresh shapes at one site: an entry never outlives what it names.
    var k = Symbol("fresh" + (i & 7));
    var fresh = {};
    set(fresh, k, i);
    sum += get(fresh, k) + (get(fresh, kA) === undefined ? 1 : 0) + (get(p, k) === undefined ? 1 : 0);
    set(fresh, k, i + 1);
    sum += get(fresh, k);
    // The property changes kind under the site.
    if ((i & 31) === 7) {
      Object.defineProperty(p, kA, { get: function () { return 1000; }, configurable: true });
      sum += getA(p);
      setA(p, 5);
      sum += getA(p);
      delete p[kA];
      sum += getA(p) === undefined ? 1 : 0;
      setA(p, 6);
      sum += getA(p);
      Object.defineProperty(p, kA, { value: 9, writable: false });
      setA(p, 10);
      sum += getA(p);
      Object.setPrototypeOf(w, { [kA]: 1 });
      delete w[kA];
      sum += getA(w);
      setA(w, 2);
      sum += getA(w) + getA(Object.getPrototypeOf(w));
    }
    if ((i & 63) === 0) log.push(sum);
  }
  print("sum", sum, hits, log.join(","));
  print(array[kA], typed[kA], fn[kA], readOnly[kA], frozen[kA], inherited[kA], Object.getPrototypeOf(inherited)[kA], Fields[kA], String(holder[kA].length));
})();
