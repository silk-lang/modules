// SilkJS regression test for js_json_parse's integer members (Lexer.jsonIntegerMember): an
// object whose keys a sibling named reads `"key": <integer>` members from the bytes without
// tokens. Whitespace in every gap, signs and -0, numbers the fast path leaves to the lexer,
// keys that differ from the sibling's, members of other types after integers, fewer and
// more members, and errors at each point of a member. Expected values come from Node 22.
var first = '{"units":1,"price":2}';
var cases = [
  first + ',{"units":3,"price":4}',
  first + ',{ "units" : 3 , "price" :\t4 }',
  first + ',{\n"units"\r\n:\n-3,\n"price":-0}',
  first + ',{"units":03,"price":4}',
  first + ',{"units":1234567890,"price":4}',
  first + ',{"units":3.5,"price":4}',
  first + ',{"units":3e2,"price":4}',
  first + ',{"units":3,"price":"x"}',
  first + ',{"units":"3","price":4}',
  first + ',{"unit":3,"price":4}',
  first + ',{"unitsx":3,"price":4}',
  first + ',{"units" 3,"price":4}',
  first + ',{"units":3,"price":4]',
  first + ',{"units":3,"price":4,"extra":5}',
  first + ',{"units":3}',
  first + ',{"units":3,}',
  first + ',{"units":3,"price":4,}',
  first + ',{"units":3,"price":}',
  first + ',{"units":-,"price":4}',
  first + ',{"units":3,"price":{"units":5,"price":6}}',
  first + ',{"units":3,"price":[7,8]}',
  first + ',{"units":3,"price":4}' + ',{"units":5,"price":6}'.repeat(20),
  first + ',{"units":3,"units":4}',
  first + ',{"units":999999999,"price":-999999999}',
  first + ',{"units":3,"price":4} ',
  first + ',{"units":3,"price":4}x',
  first + ',{"units":3,"price":4',
  first + ',{"units":3,"price"',
  first + ',{"units":3,"pri',
  first + ',{"units":true,"price":null}',
];
var out = [];
for (var i = 0; i < cases.length; i++) {
  try {
    var v = JSON.parse('[' + cases[i] + ']');
    var shapes = v.map(function (o) { return o && typeof o === 'object' ? Object.keys(o).join('/') : typeof o; }).join(',');
    out.push(i + ' ' + JSON.stringify(v) + ' ' + shapes + ' ' + v.map(function (o) { return o && Object.is(o.price, -0) ? 'n0' : ''; }).join(''));
  } catch (e) { out.push(i + ' ' + e.name + ': ' + e.message); }
}
var parsed = JSON.parse('[' + first + ',{"units":3,"price":4}]');
parsed[1].units = 'changed'; parsed[1].added = 1; delete parsed[0].price;
out.push(JSON.stringify(parsed), Object.keys(parsed[1]).join());
const got = out.join('|');
const expected = "0 [{\"units\":1,\"price\":2},{\"units\":3,\"price\":4}] units/price,units/price |1 [{\"units\":1,\"price\":2},{\"units\":3,\"price\":4}] units/price,units/price |2 [{\"units\":1,\"price\":2},{\"units\":-3,\"price\":0}] units/price,units/price n0|3 SyntaxError: Unexpected number in JSON at position 33 (line 1 column 34)|4 [{\"units\":1,\"price\":2},{\"units\":1234567890,\"price\":4}] units/price,units/price |5 [{\"units\":1,\"price\":2},{\"units\":3.5,\"price\":4}] units/price,units/price |6 [{\"units\":1,\"price\":2},{\"units\":300,\"price\":4}] units/price,units/price |7 [{\"units\":1,\"price\":2},{\"units\":3,\"price\":\"x\"}] units/price,units/price |8 [{\"units\":1,\"price\":2},{\"units\":\"3\",\"price\":4}] units/price,units/price |9 [{\"units\":1,\"price\":2},{\"unit\":3,\"price\":4}] units/price,unit/price |10 [{\"units\":1,\"price\":2},{\"unitsx\":3,\"price\":4}] units/price,unitsx/price |11 SyntaxError: Expected ':' after property name in JSON at position 32 (line 1 column 33)|12 SyntaxError: Expected ',' or '}' after property value in JSON at position 43 (line 1 column 44)|13 [{\"units\":1,\"price\":2},{\"units\":3,\"price\":4,\"extra\":5}] units/price,units/price/extra |14 [{\"units\":1,\"price\":2},{\"units\":3}] units/price,units |15 SyntaxError: Expected double-quoted property name in JSON at position 34 (line 1 column 35)|16 SyntaxError: Expected double-quoted property name in JSON at position 44 (line 1 column 45)|17 SyntaxError: Unexpected token '}', ...\"3,\"price\":}]\" is not valid JSON|18 SyntaxError: No number after minus sign in JSON at position 33 (line 1 column 34)|19 [{\"units\":1,\"price\":2},{\"units\":3,\"price\":{\"units\":5,\"price\":6}}] units/price,units/price |20 [{\"units\":1,\"price\":2},{\"units\":3,\"price\":[7,8]}] units/price,units/price |21 [{\"units\":1,\"price\":2},{\"units\":3,\"price\":4},{\"units\":5,\"price\":6},{\"units\":5,\"price\":6},{\"units\":5,\"price\":6},{\"units\":5,\"price\":6},{\"units\":5,\"price\":6},{\"units\":5,\"price\":6},{\"units\":5,\"price\":6},{\"units\":5,\"price\":6},{\"units\":5,\"price\":6},{\"units\":5,\"price\":6},{\"units\":5,\"price\":6},{\"units\":5,\"price\":6},{\"units\":5,\"price\":6},{\"units\":5,\"price\":6},{\"units\":5,\"price\":6},{\"units\":5,\"price\":6},{\"units\":5,\"price\":6},{\"units\":5,\"price\":6},{\"units\":5,\"price\":6},{\"units\":5,\"price\":6}] units/price,units/price,units/price,units/price,units/price,units/price,units/price,units/price,units/price,units/price,units/price,units/price,units/price,units/price,units/price,units/price,units/price,units/price,units/price,units/price,units/price,units/price |22 [{\"units\":1,\"price\":2},{\"units\":4}] units/price,units |23 [{\"units\":1,\"price\":2},{\"units\":999999999,\"price\":-999999999}] units/price,units/price |24 [{\"units\":1,\"price\":2},{\"units\":3,\"price\":4}] units/price,units/price |25 SyntaxError: Expected ',' or ']' after array element in JSON at position 44 (line 1 column 45)|26 SyntaxError: Expected ',' or '}' after property value in JSON at position 43 (line 1 column 44)|27 SyntaxError: Expected ':' after property name in JSON at position 41 (line 1 column 42)|28 SyntaxError: Unterminated string in JSON at position 39 (line 1 column 40)|29 [{\"units\":1,\"price\":2},{\"units\":true,\"price\":null}] units/price,units/price |[{\"units\":1},{\"units\":\"changed\",\"price\":4,\"added\":1}]|units,price,added";
console.log(got === expected ? 'PASS json parse integer members' : 'FAIL ' + got);
if (got !== expected) throw new Error('json parse integer member regressions');
