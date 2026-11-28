// Converting a plain object to a primitive skips the intrinsic Object.prototype
// valueOf and toString calls (PdfJS compares tokens with `v == EOF`): the same
// strings and Symbol.toStringTag reads as the full calls.
const got = [];
const EOF = {};
let reads = 0;
const tagged = { get [Symbol.toStringTag]() { reads++; return "Tagged"; } };
const tagNumber = { [Symbol.toStringTag]: 7 };
const own = { valueOf() { return 42; } };
const ownString = { toString() { return "mine"; } };
class Point { constructor(x) { this.x = x; } }
const proto = Object.create({ [Symbol.toStringTag]: "Inherited" });
const wide = { [Symbol.toStringTag]: "☃" };
for (let round = 0; round < 3; round++) {
  got.push("def" == EOF, EOF == "[object Object]", 5 == EOF, true == EOF, String(EOF), "" + EOF, `${EOF}`);
  got.push("" + tagged, `${tagged}`, tagged == "[object Tagged]", "" + tagNumber, "" + own, own == 42, "" + ownString, ownString == "mine");
  got.push("" + new Point(1), "" + proto, "" + wide, "" + [1, 2], [] == "", "" + function f() {}, null == EOF, undefined == EOF);
  try { got.push("" + Object.create(null)); } catch (e) { got.push(e.constructor.name); }
}
got.push(reads);
const expected = "false,true,false,false,[object Object],[object Object],[object Object],[object Tagged],[object Tagged],true,[object Object],42,true,mine,true,[object Object],[object Inherited],[object ☃],1,2,true,function f() {},false,false,TypeError,false,true,false,false,[object Object],[object Object],[object Object],[object Tagged],[object Tagged],true,[object Object],42,true,mine,true,[object Object],[object Inherited],[object ☃],1,2,true,function f() {},false,false,TypeError,false,true,false,false,[object Object],[object Object],[object Object],[object Tagged],[object Tagged],true,[object Object],42,true,mine,true,[object Object],[object Inherited],[object ☃],1,2,true,function f() {},false,false,TypeError,9";
if (got.join(",") !== expected) throw new Error("got " + got.join(",") + ", expected " + expected);
console.log("ok");
