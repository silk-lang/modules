// JSON.parse(text) and JSON.stringify(value) method calls answered without a
// native frame, checked against the full calls for values the quick paths
// decline, throws, other receivers and replaced methods.
var failures = 0;
var say = typeof print === "function" ? print : console.log;
function check(got, want, label) { if (got !== want) { failures++; say("FAIL", label, got, want); } }
function throws(f, type) { try { f(); return false; } catch (e) { return e instanceof type; } }

for (var round = 0; round < 3; round++) {
  var s = 0;
  for (var i = 0; i < 200; i++) s += JSON.parse('{"a":' + i + '}').a;
  check(s, 19900, "parse loop");
  s = 0;
  for (var i = 0; i < 200; i++) s += JSON.stringify({ a: i, b: [i] }).length;
  check(s > 0, true, "stringify loop");
  check(JSON.parse("1"), 1, "parse number");
  check(JSON.parse('"s"'), "s", "parse string");
  check(JSON.parse("null"), null, "parse null");
  check(JSON.parse('"\\u00e9"'), "é", "parse escape");
  check(JSON.parse("\"é\""), "é", "parse non-ASCII");
  check(JSON.parse(12), 12, "parse number argument");
  check(JSON.parse(true), true, "parse boolean argument");
  check(JSON.parse({ toString: function () { return "[3]"; } })[0], 3, "parse object argument");
  check(throws(function () { JSON.parse("{bad"); }, SyntaxError), true, "parse throws");
  check(throws(function () { JSON.parse(undefined); }, SyntaxError), true, "parse undefined");
  check(JSON.stringify(undefined), undefined, "stringify undefined");
  check(JSON.stringify(function () {}), undefined, "stringify function");
  check(JSON.stringify(Symbol("x")), undefined, "stringify symbol");
  check(JSON.stringify("q\"\n"), '"q\\"\\n"', "stringify escapes");
  check(JSON.stringify("é一"), '"é一"', "stringify wide");
  check(JSON.stringify({ toJSON: function () { return 7; } }), "7", "stringify toJSON");
  check(JSON.stringify(new Date(0)), '"1970-01-01T00:00:00.000Z"', "stringify date");
  check(JSON.stringify([undefined, function () {}, NaN, -0]), "[null,null,null,0]", "stringify array holes");
  check(JSON.stringify({ u: undefined, n: null }), '{"n":null}', "stringify skips undefined");
  check(throws(function () { JSON.stringify(1n); }, TypeError), true, "stringify bigint throws");
  var cyclic = {}; cyclic.self = cyclic;
  check(throws(function () { JSON.stringify(cyclic); }, TypeError), true, "stringify cyclic throws");
  check(JSON.stringify(new Proxy({ p: 1 }, {})), '{"p":1}', "stringify proxy");
  check(JSON.stringify({ a: 1 }, null, 2), '{\n  "a": 1\n}', "stringify with space");
  check(JSON.stringify({ a: 1, b: 2 }, ["b"]), '{"b":2}', "stringify with replacer");
  // Other receivers and plain calls.
  var holder = { parse: JSON.parse, stringify: JSON.stringify };
  check(holder.parse("[1,2]").length, 2, "parse on another receiver");
  check(holder.stringify([1]), "[1]", "stringify on another receiver");
  var parse = JSON.parse, stringify = JSON.stringify;
  check(parse("5") + stringify(5), "55", "plain calls");
}
// Replaced methods are called as they are.
var realParse = JSON.parse, realStringify = JSON.stringify;
JSON.parse = function (t) { return "patched " + t; };
JSON.stringify = function (v) { return "patched"; };
check(JSON.parse("1"), "patched 1", "patched parse");
check(JSON.stringify(1), "patched", "patched stringify");
JSON.parse = realParse; JSON.stringify = realStringify;
check(JSON.parse("1"), 1, "restored parse");
// A getter on the prototype chain is read by stringify.
var reads = 0;
var proto = { get g() { reads++; return 1; } };
var child = Object.create(proto); child.own = 2;
check(JSON.stringify(child), '{"own":2}', "inherited getter skipped");
var withGetter = { get g() { reads++; return 3; } };
check(JSON.stringify(withGetter), '{"g":3}', "own getter");
check(reads, 1, "getter reads");

if (failures) throw new Error(failures + " JSON call checks failed");
say("ok");
