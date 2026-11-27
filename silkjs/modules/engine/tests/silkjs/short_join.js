// `+` of short strings and Ints builds the result straight into one cell; each
// case checks the text against the spelled-out answer, including the edges of
// that path (16 and 17 bytes, wide strings, ropes, the most negative Int) and
// results used as keys, compared with literals and joined again.
var failures = 0;
var say = typeof print === "function" ? print : console.log;
function check(got, want, label) { if (got !== want) { failures++; say("FAIL", label, JSON.stringify(got), JSON.stringify(want)); } }

var ints = [0, 7, -3, 42, 100, 123456789, -2147483648, 2147483647, 99999999];
for (var round = 0; round < 3; round++) {
  check(ints.map(x => "k" + x).join(), "k0,k7,k-3,k42,k100,k123456789,k-2147483648,k2147483647,k99999999", "text + int");
  check(ints.map(x => x + "px").join(), "0px,7px,-3px,42px,100px,123456789px,-2147483648px,2147483647px,99999999px", "int + text");
  check("abcdefghijklmnop" + 5, "abcdefghijklmnop5", "16-byte text");
  check("abcdefghijklmnopq" + 5, "abcdefghijklmnopq5", "17-byte text");
  check(-2147483648 + "0123456789abcdef", "-21474836480123456789abcdef", "longest pair");
  var words = ["", "a", "bc", "def", "ghij", "klmnopqr", "0123456789abcdef", "é", "一x"];
  check(words.map(s => s + "!").join(), "!,a!,bc!,def!,ghij!,klmnopqr!,0123456789abcdef!,é!,一x!", "text + text");
  check(words.map(s => "<" + s).join(), "<,<a,<bc,<def,<ghij,<klmnopqr,<0123456789abcdef,<é,<一x", "text before");
  check(words.map(s => s + s).join("|"), "|aa|bcbc|defdef|ghijghij|klmnopqrklmnopqr|0123456789abcdef0123456789abcdef|éé|一x一x", "text twice");
  // Results that are the last reference to an operand.
  var chain = ""; for (var i = 0; i < 12; i++) chain = (chain + i) + "";
  check(chain, "01234567891011", "chain");
  var built = []; for (var i = 0; i < 300; i++) built.push(("n" + i) + "!");
  check(built[299], "n299!", "temporary operand");
  // Ropes and long strings take the general path.
  var long = "x".repeat(40);
  check((long + 1).length, 41, "long text");
  var rope = long + long;
  check((rope + 2).slice(-3), "xx2", "rope text");
  // Results used as keys and compared with literals.
  var m = new Map(); for (var i = 0; i < 5; i++) m.set("key" + i, i);
  check(m.get("key3"), 3, "map key");
  var o = {}; o["p" + 1] = 3; o["p" + 2] = 4;
  check(o.p1 + o.p2, 7, "property key");
  check("k" + 5 === "k5", true, "equal to literal");
  check(("k" + 5).length, 2, "length");
  check(("ab" + 12).charCodeAt(3), 50, "char code");
  check(("ab" + 12).indexOf("b1"), 1, "search");
  check(("q" + 7) + ("q" + 7), "q7q7", "joined again");
  // Store targets still grow in place.
  var grown = "s"; for (var i = 0; i < 50; i++) grown = grown + i;
  check(grown.length, 1 + 10 + 80, "store target");
  // Non-Int numbers and other types are untouched.
  check("f" + 1.5, "f1.5", "float");
  check("b" + true, "btrue", "bool");
  check("n" + null, "nnull", "null");
  check("o" + { toString() { return "!"; } }, "o!", "object");
  // Template literals call String.prototype.concat, joined the same way.
  check(ints.map(x => `${x}px`).join(), "0px,7px,-3px,42px,100px,123456789px,-2147483648px,2147483647px,99999999px", "template int");
  check(ints.slice(0, 3).map(x => `${x}-${x + 1}-${"z"}`).join(), "0-1-z,7-8-z,-3--2-z", "template pieces");
  check(`abcdefghijklmnop${1}abcdefghijklmnop`, "abcdefghijklmnop1abcdefghijklmnop", "template 16-byte pieces");
  check(`abcdefghijklmnopq${1}`, "abcdefghijklmnopq1", "template 17-byte piece");
  check(`a${1}b${2}c${3}d${4}e${5}f${6}g`, "a1b2c3d4e5f6g", "template many pieces");
  check(`${1.5}|${true}|${null}|${undefined}`, "1.5|true|null|undefined", "template other primitives");
  check(`${{ toString() { return "T"; }, valueOf() { return "V"; } }}`, "T", "template object uses toString");
  check(`${"\u00e9"}x${"\u4e00"}`, "\u00e9x\u4e00", "template wide");
  var q = "q"; check(`${q}${q}${q}${q}${q}${q}${q}${q}${q}`, "qqqqqqqqq", "template nine pieces");
  check(`${"x".repeat(20)}${1}`.length, 21, "template long piece");
}
if (failures) throw new Error(failures + " short join checks failed");
say("ok");
