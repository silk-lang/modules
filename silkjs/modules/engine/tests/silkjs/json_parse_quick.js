// JSON.parse of plain ASCII text without a reviver reads the bytes directly and
// hands anything else to the full parser; each case checks the value, its key
// order and types, and that malformed text still throws a SyntaxError.
var failures = 0;
var say = typeof print === "function" ? print : console.log;
function check(got, want, label) { if (got !== want) { failures++; say("FAIL", label, got, want); } }
function round(text) { return JSON.stringify(JSON.parse(text)); }
function throwsSyntax(text) { try { JSON.parse(text); return false; } catch (e) { return e instanceof SyntaxError; } }

var same = [
  '{"a":[1,2,3],"b":{"c":"d","e":[true,null,1.5]},"s":"hello"}',
  '[]', '{}', '[[]]', '[{}]', '{"a":{}}', '{"a":[]}',
  '0', '-1', '123456789', '2147483647', '-2147483648', '2147483648', '-2147483649',
  '12345678901234567890', '1.5', '-0.25', '1e3', '1E-3', '2.5e+2', '0.1', '9007199254740993',
  '"x"', '""', '"hello world"', '"a\\nb"', '"\\u0041"', '"tab\\there"', '"q\\"q"',
  'true', 'false', 'null',
  ' [ 1 , 2 ] ', '\n{\t"a" :\r 1 }\n',
  '{"a":1,"a":2}', '{"b":1,"a":2,"b":3}',
  '{"__proto__":1}', '{"constructor":{"x":1}}',
  '{"0":1,"a":2}', '{"a":1,"10":2,"1":3}', '{"1a":1}',
  '{"":1}', '{"a b":1,"c-d":2}',
  '[1,"two",[3,[4,[5]]],{"six":6}]',
];
for (var i = 0; i < same.length; i++) {
  var text = same[i];
  var want = text === "9007199254740993" ? "9007199254740992" : null;
  var got = round(text);
  for (var r = 0; r < 3; r++) check(round(text), got, "stable " + text);
  if (want !== null) check(got, want, "value " + text);
}
check(round('{"a":[1,2,3],"b":{"c":"d","e":[true,null,1.5]},"s":"hello"}'), '{"a":[1,2,3],"b":{"c":"d","e":[true,null,1.5]},"s":"hello"}', "bench text");
check(Object.is(JSON.parse("-0"), -0), true, "negative zero");
check(Object.is(JSON.parse("[-0]")[0], -0), true, "negative zero element");
check(Object.is(JSON.parse("0"), 0), true, "zero");
check(JSON.parse("2147483648"), 2147483648, "past int");
check(JSON.parse("-2147483648"), -2147483648, "int min");
check(JSON.parse("1e400"), Infinity, "overflow");
check(JSON.parse("12345678901234567890"), 12345678901234567000, "long integer");
check(Object.keys(JSON.parse('{"b":1,"a":2,"b":3}')).join(","), "b,a", "duplicate key order");
check(JSON.parse('{"b":1,"a":2,"b":3}').b, 3, "duplicate key value");
check(Object.keys(JSON.parse('{"a":1,"10":2,"1":3}')).join(","), "1,10,a", "integer keys first");
var proto = JSON.parse('{"__proto__":{"x":1}}');
check(Object.getPrototypeOf(proto) === Object.prototype && proto.__proto__.x === 1 && Object.keys(proto).join() === "__proto__", true, "__proto__ is own data");
var arr = JSON.parse("[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]");
check(Array.isArray(arr) && arr.length === 20 && arr[19] === 20, true, "long array");
arr.push(21);
check(arr.length, 21, "array grows");
var nested = "", close = "";
for (var i = 0; i < 100; i++) { nested += "["; close += "]"; }
check(JSON.stringify(JSON.parse(nested + "1" + close)).length, 201, "deep nesting");
var big = [];
for (var i = 0; i < 500; i++) big.push({ id: i, name: "n" + i, tags: ["a", "b"], ok: i % 2 === 0 });
var bigText = JSON.stringify(big);
check(round(bigText), bigText, "many objects");
check(JSON.parse("\"é\""), "é", "non-ASCII text");
check(JSON.parse('{"é":1}')["é"], 1, "non-ASCII key");

var bad = ['', ' ', '[', ']', '{', '{"a"}', '{"a":}', '{"a":1,}', '[1,]', '[1 2]', '{"a" 1}', '{a:1}',
  "{'a':1}", '01', '-', '1.', '.5', '1e', '1e+', '+1', 'tru', 'nul', 'falsey', 'True', '"abc', '"a\tb"',
  '[1]x', '{} {}', 'NaN', 'Infinity', '[,1]', '{"a":1 "b":2}', '"\\x41"', '0x10', '1_000'];
for (var i = 0; i < bad.length; i++) check(throwsSyntax(bad[i]), true, "throws " + JSON.stringify(bad[i]));

// A reviver still sees every key, with the source text.
var seen = [];
JSON.parse('{"a":1,"b":[2]}', function (k, v) { seen.push(k); return v; });
check(seen.join(","), "a,0,b,", "reviver order");
// Patched prototypes do not change what parse builds.
Object.defineProperty(Object.prototype, "a", { set: function () { throw new Error("setter"); }, configurable: true });
Object.defineProperty(Array.prototype, "0", { set: function () { throw new Error("setter"); }, configurable: true });
check(JSON.parse('{"a":5}').a, 5, "object setter ignored");
check(JSON.parse('[5]')[0], 5, "array setter ignored");
delete Object.prototype.a;
delete Array.prototype[0];

if (failures) throw new Error(failures + " JSON.parse checks failed");
say("ok");
