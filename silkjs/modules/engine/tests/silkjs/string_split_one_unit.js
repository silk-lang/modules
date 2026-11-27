// String.prototype.split by a one-unit separator, checked against a split
// written from the specification's steps (indexOf and slice).
var failures = 0;
function check(got, want, label) { if (got !== want) { failures++; print("FAIL", label, got, want); } }
function reference(text, separator, limit) {
  var out = [];
  var max = limit === undefined ? 4294967295 : limit >>> 0;
  if (max === 0) return out;
  if (separator === undefined) return [text];
  var s = String(separator);
  if (text.length === 0) return s.length === 0 ? [] : [text];
  if (s.length === 0) { for (var i = 0; i < text.length && out.length < max; i++) out.push(text[i]); return out; }
  var start = 0, at;
  while ((at = text.indexOf(s, start)) !== -1) { out.push(text.slice(start, at)); if (out.length === max) return out; start = at + s.length; }
  out.push(text.slice(start));
  return out;
}
var texts = ["a,b,c", ",", "", ",,", "a,", ",a", "abc", "héllo,wörld", "x".repeat(40) + "," + "y".repeat(3),
  "a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q,r,s,t,u,v,w,x,y,z", "ÿ,ÿ", "\u0000,\u0000", "a,b".repeat(100), "日本,語"];
var separators = [",", "x", "é", "ÿ", "\u0000", "ab", "", undefined, "語"];
for (var round = 0; round < 3; round++) {
  for (var t of texts) {
    for (var sep of separators) {
      var got = t.split(sep);
      check(Array.isArray(got) && Object.getPrototypeOf(got) === Array.prototype, true, "an Array " + JSON.stringify([t, sep]));
      check(JSON.stringify(got), JSON.stringify(reference(t, sep)), "split " + JSON.stringify([t, sep]));
      check(got.length, reference(t, sep).length, "length " + JSON.stringify([t, sep]));
    }
    check(JSON.stringify(t.split(",", 2)), JSON.stringify(reference(t, ",", 2)), "split with a limit " + JSON.stringify(t));
  }
  // A text built at run time (a rope until flattened) and one made of many pieces.
  var built = "a,b" + String(round) + ",c";
  check(JSON.stringify(built.split(",")), JSON.stringify(["a", "b" + round, "c"]), "a built text");
  var many = "w,".repeat(5000).split(",");
  check(many.length + "," + many[4999] + "," + JSON.stringify(many[5000]), '5001,w,""', "five thousand pieces");
  // The pieces are ordinary strings: equal pieces compare equal, and they outlive the text.
  var pieces = ("k" + round + ",").repeat(3).split(",");
  check(pieces[0] === pieces[1] && pieces[1] === "k" + round, true, "equal pieces");
  // An index setter on Object.prototype is not consulted: split defines its elements.
  var seen = 0;
  Object.defineProperty(Object.prototype, 1, { set: function () { seen++; }, configurable: true });
  var defined = "p,q,r".split(",");
  delete Object.prototype[1];
  check(seen + "," + Object.prototype.hasOwnProperty.call(defined, 1) + "," + defined[1], "0,true,q", "defines its elements");
  // A separator object is converted to a string once.
  var calls = 0;
  var sepObject = { toString: function () { calls++; return ","; } };
  check(JSON.stringify("1,2".split(sepObject)) + calls, '["1","2"]1', "separator object");
}
if (failures) throw new Error(failures + " string split checks failed");
