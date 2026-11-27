function three(a, b) { return 'k' + a + ' tail'; }
function threeLoc(a, b) { var x = a, y = b; return x + y + '!' ; }
function four(a, b) { return a + b + '-' + b + '+'; }
function mixed(a, n) { return 'n' + n + ' mid' + a + ' end'; }
function acc(a, n) { var s = ''; for (var i = 0; i < n; i++) { s = s + a + ','; s += a + ';'; } return s; }
function intKey(a) { return a + 1 + ' is'; }
function cached(tag) { var out = []; for (var i = 0; i < 6; i++) out.push('String for key ' + tag + ' in leaf node'); return out.join('|').length; }
function tern(a, b, c) { return (c ? a + b : b + a) + (c ? ' yes' : ' no'); }
var total = 0, t = '';
for (var i = 0; i < 300; i++) {
  var k = String(i % 7), u = 'é' + i;
  t = three(k) + three(i) + three(1.5) + threeLoc(k, 'z') + threeLoc(u, k) + threeLoc(i, k) + four(k, u) + mixed(k, i) + mixed(u, 2.5) + acc(k, 5) + intKey(i) + intKey(k) + tern(k, u, i & 1);
  total = (total * 31 + t.length + cached(k) + cached(u) + t.charCodeAt(i % t.length)) % 1000000007;
}
print(total, t);
