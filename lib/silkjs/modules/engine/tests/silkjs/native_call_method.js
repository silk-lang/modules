// native.call(thisArg, ...args) reaches the native function directly; what scripts see
// must be Function.prototype.call's behavior exactly.
const r = [];
const has = Object.prototype.hasOwnProperty, str = Object.prototype.toString, slice = Array.prototype.slice;
function run(o, k) { return has.call(o, k); }
let hits = 0;
for (let i = 0; i < 100; i++) { if (run({ a: 1, ['k' + i]: 2 }, 'k' + i)) hits++; if (run({ a: 1 }, 'b')) hits++; }
r.push(hits, has.call('abc', 'length'), has.call([1, 2], 1), has.call([1, 2], 2));
r.push(str.call(null), str.call(), str.call(undefined), str.call(1), str.call([]), str.call(function () {}));
r.push((function () { return slice.call(arguments, 1).join(); })(1, 2, 3), slice.call('abc').join(''));
r.push(Math.max.call(null, 1, 5, 3), Math.max.call(), String.prototype.toUpperCase.call('abc'), Array.prototype.join.call({ length: 2, 0: 'x', 1: 'y' }, '-'));
r.push(Function.prototype.call.call(has, { z: 1 }, 'z'), Function.prototype.call.call(Function.prototype.call, has, { z: 1 }, 'q'));
// Errors come from the native as usual, and are catchable.
function fails(f) { try { f(); return 'no error'; } catch (e) { return e instanceof TypeError ? 'TypeError' : String(e); } }
r.push(fails(() => has.call(null, 'a')), fails(() => Map.prototype.get.call({}, 1)), fails(() => Object.defineProperty.call(null, 1)));
// Callbacks called by the native see the right arguments and can throw through it.
r.push(Array.prototype.map.call([1, 2, 3], (v, i) => v * i).join(), fails(() => Array.prototype.forEach.call([1], () => { throw new TypeError('x'); })));
// A getter the native triggers, a Proxy receiver, a bound native and a constructor.
let got1 = 0;
r.push(has.call(new Proxy({ a: 1 }, { getOwnPropertyDescriptor(t, k) { got1++; return Reflect.getOwnPropertyDescriptor(t, k); } }), 'a'), got1);
const bound = has.bind({ b: 1 });
r.push(bound.call({ c: 1 }, 'b'), bound.call({ c: 1 }, 'c'));
r.push(fails(() => Map.call({})), Object.call(null, 5) instanceof Number, typeof String.call(null, 5), Array.call(null, 3).length);
// The method replaced: the shortcut must not apply to a user's `call`.
const fake = { call() { return 'fake'; } };
r.push(fake.call(has, {}, 'a'));
has.call = function () { return 'own'; };
r.push(has.call({ a: 1 }, 'a'));
delete has.call;
r.push(has.call({ a: 1 }, 'a'));
const got = r.join('|');
const expected = '100|true|true|false|[object Null]|[object Undefined]|[object Undefined]|[object Number]|[object Array]|[object Function]|'
  + '2,3|abc|5|-Infinity|ABC|x-y|true|false|TypeError|TypeError|TypeError|0,2,6|TypeError|true|1|true|false|TypeError|true|string|3|fake|own|true';
console.log(got === expected ? 'PASS native call method' : 'FAIL ' + got);
if (got !== expected) throw new Error('native call method regressions');
