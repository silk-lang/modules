// charCodeAt and charAt called from compiled code: the engine answers them with no call for a
// flat string and an index inside it, and the call is made for everything else (an index
// outside, one that is no integer, a string joined and not yet flat, units above Latin-1, a
// String object, another receiver under the same name, the method replaced part way).
function codes(s, n) { var t = 0; for (var i = 0; i < n; i++) t = (t * 31 + s.charCodeAt(i)) | 0; return t; }
function chars(s, n) { var t = ""; for (var i = n - 1; i >= 0; i--) t += s.charAt(i); return t; }
function codeAt(s, i) { return s.charCodeAt(i); }
function charAt(s, i) { return s.charAt(i); }
function digit(s, i) { var c = s.charCodeAt(i) - 48; return c >= 0 && c <= 9 ? c : -1; }
function number(s) { var v = 0; for (var i = 0; i < s.length; i++) { var d = digit(s, i); if (d < 0) break; v = v * 10 + d; } return v; }
var table = "0123456789abcdefghijklmnopqrstuvwxyz";
function hex(n) { var s = ""; do { s = table.charAt(n & 15) + s; n >>>= 4; } while (n != 0); return s; }
function other(o, i) { return o.charCodeAt(i) + "/" + o.charAt(i); }
function same(s, i) { return s.charAt(i) == "-" ? 1 : s.charAt(i) === s.charAt(i + 1) ? 2 : 0; }
function methods(s, x) { return s.indexOf(x) + "," + s.substring(x.length) + "," + s.concat(x) + "," + s.at(-1); }
// A method read from a string, a number and a boolean under one site, and a method that
// String.prototype gains and loses part way.
function shout(s) { return typeof s.shout == "function" ? s.shout() : s.length; }
function text(v) { return v.toString(); }
// A table read in a small function that is inlined: a slow Array (indices far apart), an
// ordinary object under index keys, a dense Array, a typed array; then an index outside,
// a key that is no index, an element with a getter, a table that is a proxy.
var slow = new Array();
for (var q = 48; q < 58; q++) slow[q] = q - 48;
for (q = 97; q < 123; q++) slow[q] = q - 87;
var plain = { 3: "three", 10: "ten", 250: "far" };
var dense = [5, 6, 7, 8];
var typed = new Uint8Array([9, 8, 7, 6]);
function lookup(t, i) { var c = t[i]; return c == null ? -1 : c; }
function value(s, i) { return lookup(slow, s.charCodeAt(i)); }
function parse(s) { var v = 0; for (var i = 0; i < s.length; i++) { var d = value(s, i); if (d < 0) return -v; v = v * 36 + d; } return v; }
function tables(t, n) { var r = ""; for (var i = 0; i < n; i++) r += lookup(t, i * 3) + ","; return r; }
var trapped = [1, 2, 3];
Object.defineProperty(trapped, 6, { get: function () { return "got" + this.length; } });
var proxied = new Proxy([4, 5], { get: function (t, k) { return typeof k == "string" && k >= 0 ? "p" + k : t[k]; } });
var fake = { charCodeAt: function (i) { return i * 2; }, charAt: function (i) { return "<" + i + ">"; } };
var wide = "aĀ€😀z";
var out = [];
for (var turn = 0; turn < 300; turn++) {
  var r = [];
  var joined = "left" + turn + "-" + "right";
  r.push(codes("The quick brown fox", 19), chars("stressed", 8), codes(joined, joined.length), chars(joined, 5));
  r.push(number("90817" + turn), number("12x"), hex(turn * 2654435 >>> 0), hex(0));
  r.push(codeAt("abc", 1), codeAt("abc", turn < 290 ? 2 : 3), codeAt("abc", turn < 280 ? 0 : -1), codeAt("abc", turn < 270 ? 1 : 1.5));
  r.push(codeAt("abc", turn < 260 ? 2 : "1"), codeAt("abc", turn < 250 ? 0 : undefined), codeAt(turn < 240 ? "xyz" : new String("xyz"), 1));
  r.push(charAt("abc", 1), "[" + charAt("abc", turn < 291 ? 2 : 3) + "]", "[" + charAt("abc", turn < 281 ? 0 : -1) + "]", charAt("abc", turn < 271 ? 1 : 1.5));
  r.push(charAt("abc", turn < 261 ? 2 : "1"), charAt("abc", turn < 251 ? 0 : undefined), charAt(turn < 241 ? "xyz" : new String("xyz"), 1));
  for (var k = 0; k < wide.length; k++) r.push(codeAt(wide, k), charAt(wide, k) == wide[k], charAt(wide, k).length);
  r.push(other(turn < 200 ? "str" : fake, turn % 3), other(turn % 2 ? "ab" : fake, 1));
  r.push(same("a-b", 1), same("aab", 0), same("abc", 0), same("x", 5), methods("needle in hay", "in"));
  r.push(parse("zz9" + turn), parse("silk"), parse("a b"), parse(joined), tables(slow, 40), tables(plain, 5), tables(dense, 3), tables(typed, 3));
  r.push(lookup(slow, turn < 285 ? 50 : 500), lookup(slow, turn < 275 ? 51 : -1), lookup(slow, turn < 265 ? 52 : "53"), lookup(slow, turn < 255 ? 53 : 53.5));
  r.push(lookup(plain, turn < 245 ? 10 : "ten"), tables(turn < 235 ? plain : trapped, 4), tables(turn < 225 ? slow : proxied, 3), lookup(turn < 215 ? dense : "text", 2));
  var built = "";
  for (k = 0; k < 40; k++) built += String.fromCharCode(97 + (k * 7 + turn) % 26);
  r.push(codes(built, 40), chars(built, 40) == built.split("").reverse().join(""));
  if (turn == 150) {
    var kept = String.prototype.charCodeAt;
    String.prototype.charCodeAt = function (i) { return -kept.call(this, i); };
    r.push(codes("patched", 7), codeAt("abc", 1), digit("7", 0));
    String.prototype.charCodeAt = kept;
    r.push(codes("patched", 7), codeAt("abc", 1), digit("7", 0));
  }
  if (turn == 160) {
    var keptAt = String.prototype.charAt;
    String.prototype.charAt = function (i) { return keptAt.call(this, i).toUpperCase(); };
    r.push(chars("patched", 7), hex(48879), same("a-b", 1));
    String.prototype.charAt = keptAt;
    r.push(chars("patched", 7), hex(48879), same("a-b", 1));
  }
  r.push(shout("abc"), shout(joined), text("s"), text(turn < 205 ? "t" : turn), text(turn < 195 ? "u" : 1.5), text(turn < 185 ? "v" : true));
  if (turn == 170) {
    String.prototype.shout = function () { return this.toUpperCase() + "!"; };
    r.push(shout("abc"), shout(joined), shout(new String("obj")));
  }
  if (turn == 180) {
    r.push(shout("abc"), shout(joined));
    delete String.prototype.shout;
    r.push(shout("abc"), shout(joined));
  }
  // The table changes under the sites that read it: an index deleted and put back, one
  // that becomes a getter, one found in the prototype, the table made dense.
  if (turn == 190) {
    delete slow[50];
    r.push(lookup(slow, 50), value("2", 0), parse("12"));
    slow[50] = 2;
    r.push(lookup(slow, 50), value("2", 0), parse("12"));
  }
  if (turn == 210) {
    Object.defineProperty(plain, 10, { get: function () { return "getter"; }, configurable: true });
    r.push(lookup(plain, 10), tables(plain, 5));
    Object.defineProperty(plain, 10, { value: "ten again", writable: true });
    r.push(lookup(plain, 10), tables(plain, 5));
  }
  if (turn == 220) {
    Array.prototype[40] = "inherited";
    r.push(lookup(slow, 40), lookup(dense, 40), lookup(plain, 40));
    delete Array.prototype[40];
    r.push(lookup(slow, 40), lookup(dense, 40));
  }
  if (turn == 230) {
    for (k = 0; k < 48; k++) slow[k] = -k;
    r.push(lookup(slow, 7), lookup(slow, 50), parse("zz"), tables(slow, 20));
    slow.length = 123;
  }
  if (turn == 150 || turn == 160 || turn == 170 || turn == 180 || turn == 190 || turn == 210 || turn == 220 || turn == 230 || turn == 299) out = out.concat(r);
}
print(out.join("\n"));
