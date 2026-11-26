// SilkJS regression test for js_json_parse's sibling hints and plain integers: an array's
// objects that repeat the previous one's keys in order are made with its shape at once,
// and short integers skip the general number scan. Objects whose keys depart (order,
// count, duplicates, escapes), nested arrays, later mutation, errors inside a hinted object,
// a reviver, and the number forms the fast path must leave to the lexer. Expected values
// come from Node 22.
var cases = [
  '[{"a":1,"b":2},{"a":3,"b":4},{"a":5,"b":6}]',
  '[{"a":1,"b":2},{"b":3,"a":4},{"a":5,"b":6}]',
  '[{"a":1,"b":2},{"a":3},{"a":5,"b":6,"c":7},{"a":8,"b":9}]',
  '[{"a":1,"b":2},{"a":3,"a":4},{"a":1,"b":2,"a":9}]',
  '[{"a":1,"b":2},{"a":3,"b\\u0041":4},{"\\u0061":5,"b":6}]',
  '[{"1":1,"b":2},{"1":3,"b":4}]',
  '[{"__proto__":1,"b":2},{"__proto__":{"x":1},"b":4}]',
  '[ {"a" : 1 , "b":2} , { "a":[{"a":1},{"a":2,"b":[{"q":1},{"q":2}]}], "b" :{"a":1,"b":2}} ]',
  '[{"a":1,"b":2},{"ab":3,"b":4},{"a":1,"bc":2}]',
  '[{},{},{"a":1},{}]',
  '[{"a":{"a":{"a":1}}},{"a":{"a":{"a":2}}}]',
  '[[{"x":1}],[{"x":2}],[{"x":3,"y":4}]]',
  '{"lines":[' + Array.from({length: 40}, (_, i) => '{"units":' + i + ',"price":' + (i * 7) + ',"note":"n' + i + '"}').join(',') + ']}',
  '[{"a":1,"b":2},{"a":3,"b":',
  '[{"a":1,"b":2},{"a":3,"b":4,}]',
  '[{"a":1,"b":2},{"a":3 "b":4}]',
  '[{"a":1,"b":2},{"a":3,"b":4]',
  '[{"a":1,"b":2},{"a":3,"b":tru}]',
  '[{"long key with spaces":1,"b":2},{"long key with spaces":3,"b":4}]',
  '[{"é":1,"b":2},{"é":3,"b":4}]',
];
var out = [];
for (var i = 0; i < cases.length; i++) {
  try {
    var v = JSON.parse(cases[i]);
    var keys = [];
    (function walk(x) { if (x && typeof x === 'object') { if (!Array.isArray(x)) keys.push(Object.keys(x).join('/') + ':' + (Object.getPrototypeOf(x) === Object.prototype)); for (var k in x) walk(x[k]); } })(v);
    out.push(i + ' ' + JSON.stringify(v) + ' ' + keys.join(','));
  } catch (e) { out.push(i + ' ' + e.name + ': ' + e.message); }
}
var big = JSON.parse(cases[12]); big.lines[3].units = 99; big.lines[4].extra = 1; delete big.lines[5].price;
out.push(JSON.stringify(big.lines.slice(2, 7)));

var numberCases = ['0','-0','1','-1','123456789','1234567890','-123456789','01','00','-01','1.5','1e3','1E3','-','--1','12a','[1,2 ,3\n]','{"a":5}','[ -0 ]','[999999999,1000000000]','  42  ','42x','[1}', '[1 2]', '1.', '-1.25e-3', '[0,0.0,-0.0]', '[12,]', '[\t7\r\n]'];

for (var i = 0; i < numberCases.length; i++) {
  try { var v = JSON.parse(numberCases[i]); out.push(i + ' ' + JSON.stringify(v) + ' ' + (Object.is(v, -0) ? 'neg0' : typeof v) + ' ' + (Array.isArray(v) ? v.map(function (x) { return Object.is(x, -0) ? 'n0' : x; }).join(':') : '')); }
  catch (e) { out.push(i + ' ' + e.name + ': ' + e.message); }
}


var revived = JSON.parse('[{"a":1,"b":2},{"a":3,"b":4}]', function (k, v) { return typeof v === 'number' ? v * 10 : v; });
out.push(JSON.stringify(revived));
var siblings = JSON.parse('[{"x":1,"y":2},{"x":3,"y":4}]'); siblings[0].z = 9; delete siblings[1].x;
out.push(JSON.stringify(siblings), Object.keys(siblings[0]).join(), Object.keys(siblings[1]).join());
const got = out.join('|');
const expected = "0 [{\"a\":1,\"b\":2},{\"a\":3,\"b\":4},{\"a\":5,\"b\":6}] a/b:true,a/b:true,a/b:true|1 [{\"a\":1,\"b\":2},{\"b\":3,\"a\":4},{\"a\":5,\"b\":6}] a/b:true,b/a:true,a/b:true|2 [{\"a\":1,\"b\":2},{\"a\":3},{\"a\":5,\"b\":6,\"c\":7},{\"a\":8,\"b\":9}] a/b:true,a:true,a/b/c:true,a/b:true|3 [{\"a\":1,\"b\":2},{\"a\":4},{\"a\":9,\"b\":2}] a/b:true,a:true,a/b:true|4 [{\"a\":1,\"b\":2},{\"a\":3,\"bA\":4},{\"a\":5,\"b\":6}] a/b:true,a/bA:true,a/b:true|5 [{\"1\":1,\"b\":2},{\"1\":3,\"b\":4}] 1/b:true,1/b:true|6 [{\"__proto__\":1,\"b\":2},{\"__proto__\":{\"x\":1},\"b\":4}] __proto__/b:true,__proto__/b:true,x:true|7 [{\"a\":1,\"b\":2},{\"a\":[{\"a\":1},{\"a\":2,\"b\":[{\"q\":1},{\"q\":2}]}],\"b\":{\"a\":1,\"b\":2}}] a/b:true,a/b:true,a:true,a/b:true,q:true,q:true,a/b:true|8 [{\"a\":1,\"b\":2},{\"ab\":3,\"b\":4},{\"a\":1,\"bc\":2}] a/b:true,ab/b:true,a/bc:true|9 [{},{},{\"a\":1},{}] :true,:true,a:true,:true|10 [{\"a\":{\"a\":{\"a\":1}}},{\"a\":{\"a\":{\"a\":2}}}] a:true,a:true,a:true,a:true,a:true,a:true|11 [[{\"x\":1}],[{\"x\":2}],[{\"x\":3,\"y\":4}]] x:true,x:true,x/y:true|12 {\"lines\":[{\"units\":0,\"price\":0,\"note\":\"n0\"},{\"units\":1,\"price\":7,\"note\":\"n1\"},{\"units\":2,\"price\":14,\"note\":\"n2\"},{\"units\":3,\"price\":21,\"note\":\"n3\"},{\"units\":4,\"price\":28,\"note\":\"n4\"},{\"units\":5,\"price\":35,\"note\":\"n5\"},{\"units\":6,\"price\":42,\"note\":\"n6\"},{\"units\":7,\"price\":49,\"note\":\"n7\"},{\"units\":8,\"price\":56,\"note\":\"n8\"},{\"units\":9,\"price\":63,\"note\":\"n9\"},{\"units\":10,\"price\":70,\"note\":\"n10\"},{\"units\":11,\"price\":77,\"note\":\"n11\"},{\"units\":12,\"price\":84,\"note\":\"n12\"},{\"units\":13,\"price\":91,\"note\":\"n13\"},{\"units\":14,\"price\":98,\"note\":\"n14\"},{\"units\":15,\"price\":105,\"note\":\"n15\"},{\"units\":16,\"price\":112,\"note\":\"n16\"},{\"units\":17,\"price\":119,\"note\":\"n17\"},{\"units\":18,\"price\":126,\"note\":\"n18\"},{\"units\":19,\"price\":133,\"note\":\"n19\"},{\"units\":20,\"price\":140,\"note\":\"n20\"},{\"units\":21,\"price\":147,\"note\":\"n21\"},{\"units\":22,\"price\":154,\"note\":\"n22\"},{\"units\":23,\"price\":161,\"note\":\"n23\"},{\"units\":24,\"price\":168,\"note\":\"n24\"},{\"units\":25,\"price\":175,\"note\":\"n25\"},{\"units\":26,\"price\":182,\"note\":\"n26\"},{\"units\":27,\"price\":189,\"note\":\"n27\"},{\"units\":28,\"price\":196,\"note\":\"n28\"},{\"units\":29,\"price\":203,\"note\":\"n29\"},{\"units\":30,\"price\":210,\"note\":\"n30\"},{\"units\":31,\"price\":217,\"note\":\"n31\"},{\"units\":32,\"price\":224,\"note\":\"n32\"},{\"units\":33,\"price\":231,\"note\":\"n33\"},{\"units\":34,\"price\":238,\"note\":\"n34\"},{\"units\":35,\"price\":245,\"note\":\"n35\"},{\"units\":36,\"price\":252,\"note\":\"n36\"},{\"units\":37,\"price\":259,\"note\":\"n37\"},{\"units\":38,\"price\":266,\"note\":\"n38\"},{\"units\":39,\"price\":273,\"note\":\"n39\"}]} lines:true,units/price/note:true,units/price/note:true,units/price/note:true,units/price/note:true,units/price/note:true,units/price/note:true,units/price/note:true,units/price/note:true,units/price/note:true,units/price/note:true,units/price/note:true,units/price/note:true,units/price/note:true,units/price/note:true,units/price/note:true,units/price/note:true,units/price/note:true,units/price/note:true,units/price/note:true,units/price/note:true,units/price/note:true,units/price/note:true,units/price/note:true,units/price/note:true,units/price/note:true,units/price/note:true,units/price/note:true,units/price/note:true,units/price/note:true,units/price/note:true,units/price/note:true,units/price/note:true,units/price/note:true,units/price/note:true,units/price/note:true,units/price/note:true,units/price/note:true,units/price/note:true,units/price/note:true,units/price/note:true|13 SyntaxError: Unexpected end of JSON input|14 SyntaxError: Expected double-quoted property name in JSON at position 28 (line 1 column 29)|15 SyntaxError: Expected ',' or '}' after property value in JSON at position 22 (line 1 column 23)|16 SyntaxError: Expected ',' or '}' after property value in JSON at position 27 (line 1 column 28)|17 SyntaxError: Unexpected token '}', ...\":3,\"b\":tru}]\" is not valid JSON|18 [{\"long key with spaces\":1,\"b\":2},{\"long key with spaces\":3,\"b\":4}] long key with spaces/b:true,long key with spaces/b:true|19 [{\"\u00e9\":1,\"b\":2},{\"\u00e9\":3,\"b\":4}] \u00e9/b:true,\u00e9/b:true|[{\"units\":2,\"price\":14,\"note\":\"n2\"},{\"units\":99,\"price\":21,\"note\":\"n3\"},{\"units\":4,\"price\":28,\"note\":\"n4\",\"extra\":1},{\"units\":5,\"note\":\"n5\"},{\"units\":6,\"price\":42,\"note\":\"n6\"}]|0 0 number |1 0 neg0 |2 1 number |3 -1 number |4 123456789 number |5 1234567890 number |6 -123456789 number |7 SyntaxError: Unexpected number in JSON at position 1 (line 1 column 2)|8 SyntaxError: Unexpected number in JSON at position 1 (line 1 column 2)|9 SyntaxError: Unexpected number in JSON at position 2 (line 1 column 3)|10 1.5 number |11 1000 number |12 1000 number |13 SyntaxError: No number after minus sign in JSON at position 1 (line 1 column 2)|14 SyntaxError: No number after minus sign in JSON at position 1 (line 1 column 2)|15 SyntaxError: Unexpected non-whitespace character after JSON at position 2 (line 1 column 3)|16 [1,2,3] object 1:2:3|17 {\"a\":5} object |18 [0] object n0|19 [999999999,1000000000] object 999999999:1000000000|20 42 number |21 SyntaxError: Unexpected non-whitespace character after JSON at position 2 (line 1 column 3)|22 SyntaxError: Expected ',' or ']' after array element in JSON at position 2 (line 1 column 3)|23 SyntaxError: Expected ',' or ']' after array element in JSON at position 3 (line 1 column 4)|24 SyntaxError: Unterminated fractional number in JSON at position 2 (line 1 column 3)|25 -0.00125 number |26 [0,0,0] object 0:0:n0|27 SyntaxError: Unexpected token ']', \"[12,]\" is not valid JSON|28 [7] object 7|[{\"a\":10,\"b\":20},{\"a\":30,\"b\":40}]|[{\"x\":1,\"y\":2,\"z\":9},{\"y\":4}]|x,y,z|y";
console.log(got === expected ? 'PASS json parse sibling shapes' : 'FAIL ' + got);
if (got !== expected) throw new Error('json parse sibling shape regressions');
