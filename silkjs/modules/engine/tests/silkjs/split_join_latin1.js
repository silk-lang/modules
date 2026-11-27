// split on one Latin-1 unit (scanned eight bytes at a time) and join of flat
// Latin-1 strings (copied as bytes), checked against plain-loop references.
var failures = 0;
var say = typeof print === "function" ? print : console.log;
function check(got, want, label) { if (got !== want) { failures++; say("FAIL", label, got, want); } }

function refSplit(text, sep) {
  var parts = [], start = 0;
  for (var i = 0; i < text.length; i++) if (text[i] === sep) { parts.push(text.slice(start, i)); start = i + 1; }
  parts.push(text.slice(start));
  return parts;
}
function refJoin(items, sep) {
  if (sep === undefined) sep = ",";
  var out = "";
  for (var i = 0; i < items.length; i++) {
    if (i > 0) out += sep;
    if (items[i] !== undefined && items[i] !== null) out += items[i];
  }
  return out;
}
function show(a) { return JSON.stringify(a); }

var texts = ["a", ",", ",,", "a,b", ",a,", "abcdefgh,ijklmnop", "abcdefg,", ",abcdefgh", "abcdefgh,",
  "a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "x,y,,z,,,w,,,,v,,,,,",
  "ÿþ,ÿ", "1234567,1234567,", ",,,,,,,,,,,,,,,,,", "alpha,beta,gamma,delta,epsilon,zeta,eta,theta"];
var seps = [",", "a", "ÿ", "z", "\u0080", "\u007f"];
for (var round = 0; round < 3; round++) {
  for (var t = 0; t < texts.length; t++) {
    for (var s = 0; s < seps.length; s++) {
      check(show(texts[t].split(seps[s])), show(refSplit(texts[t], seps[s])), "split " + show(texts[t]) + " by " + show(seps[s]));
    }
  }
  // Bytes next to the separator differ in only the high bit or one low bit.
  check(show("¬,,­".split(",")), show(["¬", "", "­"]), "near separator bytes");
  check(show("a,b".split(",", 1)), show(["a"]), "limit 1");
  check(show("a,b".split(",", 0)), show([]), "limit 0");
  check(show("".split(",")), show([""]), "empty text");
  check(show("ab".split()), show(["ab"]), "no separator");
  var order = [];
  var lim = { valueOf: function () { order.push("limit"); return 5; } };
  var sep = { toString: function () { order.push("sep"); return ","; } };
  check(show("q,r".split(sep, lim)), show(["q", "r"]), "coerced arguments");
  check(order.join(","), "limit,sep", "coercion order");

  var items = [[], [""], ["a"], ["ab", "c"], ["abc", "defg", "hijklmno", "pqrstuvwxyz0123456", "x".repeat(40)],
    ["é", "ü"], [null, undefined, "z"], ["x".repeat(16), "y".repeat(17), "z".repeat(8), "w".repeat(7), "v".repeat(3)]];
  var separators = [undefined, ",", "", "--", "é", "中", "long separator here!"];
  for (var i = 0; i < items.length; i++) {
    for (var j = 0; j < separators.length; j++) {
      check(items[i].join(separators[j]), refJoin(items[i], separators[j]), "join " + show(items[i]) + " with " + show(separators[j]));
    }
  }
  // Ropes, wide text and numbers keep the general path.
  var rope = "ab".repeat(3) + "cd" + round;
  check([rope + rope, "x"].join("|"), refJoin([rope + rope, "x"], "|"), "rope piece");
  check(["a", 1, "b"].join("-"), "a-1-b", "number piece");
  check(["中", "a"].join(","), "中,a", "wide piece");
  var built = ""; for (var k = 0; k < 20; k++) built += "q" + k;
  check([built, built].join("/"), built + "/" + built, "built piece");
  var joined = texts.join(";");
  check(joined.split(";").length, texts.length, "round trip count");
  check(joined.split(";").join(";"), joined, "round trip");
}

if (failures) throw new Error(failures + " split/join checks failed");
say("ok");
