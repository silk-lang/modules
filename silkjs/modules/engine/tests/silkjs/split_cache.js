// Repeated one-byte splits of the same text come from a cached copy of the
// pieces; each result must still be a fresh array with the right elements.
var failures = 0;
var say = typeof print === "function" ? print : console.log;
function check(got, want, label) { if (got !== want) { failures++; say("FAIL", label, got, want); } }
var csv = "alpha,beta,gamma,delta";
var first = csv.split(",");
for (var i = 0; i < 100; i++) {
  var parts = csv.split(",");
  if (parts === first || parts.length !== 4 || parts.join("|") !== "alpha|beta|gamma|delta") { check(parts.join("|"), "alpha|beta|gamma|delta", "repeat " + i); break; }
  parts[0] = "changed"; parts.push("extra"); parts.length = 2;
}
check(csv.split(",").join("|"), "alpha|beta|gamma|delta", "after mutating results");
check(csv.split(",") !== csv.split(","), true, "fresh arrays");
check(Array.isArray(csv.split(",")) && Object.getPrototypeOf(csv.split(",")) === Array.prototype, true, "plain array");
// Another separator on the same text.
check(csv.split("a").length, 7, "other separator");
check(csv.split(",").length, 4, "back to comma");
check(csv.split("e").join("|"), "alpha,b|ta,gamma,d|lta", "e separator");
check(csv.split("e").join("|"), "alpha,b|ta,gamma,d|lta", "e separator again");
// Limits and other forms keep their own paths.
check(csv.split(",", 2).join("|"), "alpha|beta", "limit");
check(csv.split(",", 0).length, 0, "zero limit");
check(csv.split(",").join("|"), "alpha|beta|gamma|delta", "after limit");
// Texts built at run time, equal content but other strings.
var built = ["alpha", "beta", "gamma", "delta"].join(",");
check(built.split(",").join("|") + built.split(",").join("|"), "alpha|beta|gamma|deltaalpha|beta|gamma|delta", "built text");
// Edge pieces.
check(JSON.stringify(",a,,b,".split(",")), '["","a","","b",""]', "empty pieces");
check(JSON.stringify(",a,,b,".split(",")), '["","a","","b",""]', "empty pieces again");
check(JSON.stringify("x".split(",")), '["x"]', "no separator");
check(JSON.stringify("x".split(",")), '["x"]', "no separator again");
// Long and wide texts.
var long = new Array(3000).join("ab,");
check(long.split(",").length, 3000, "long text");
check(long.split(",").length, 3000, "long text again");
var wide = "ā,Ă,ă";
check(wide.split(",").join("") + wide.split(",").join(""), "āĂăāĂă", "wide text");
// Results survive collections and outlive the cache.
var kept = [];
for (var i = 0; i < 50; i++) { kept.push(csv.split(",")); if (typeof gc === "function" && i % 10 === 0) gc(); }
check(kept[49].join("|") + kept[0].join("|"), "alpha|beta|gamma|deltaalpha|beta|gamma|delta", "kept results");
// Pieces are equal strings either way.
var a = csv.split(","), b = csv.split(",");
check(a[1] === b[1] && a[1] === "beta", true, "equal pieces");
if (failures) throw new Error(failures + " split cache checks failed");
say("ok");
