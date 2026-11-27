// natives called from baseline code: quick paths, callbacks, throws, bound and applied calls
function words(s) { return s.split(' ').map(function (w) { return w.toUpperCase(); }).join('-'); }
function rx(s) { var m = /(\d+)-(\d+)/.exec(s); return m ? m[1] + ':' + m[2] + ':' + m.index : 'none'; }
function rep(s) { return s.replace(/a/g, 'b').replace('x', function (m) { return '[' + m + ']'; }); }
function mathy(a, b) { return Math.max(a, b) + Math.floor(a / 3) + Math.abs(-b) + Math.sqrt(a * a) + Math.min(a, b, 2); }
function arr(n) { var a = []; for (var i = 0; i < n; i++) a.push(i * 2); a.pop(); a.sort(function (x, y) { return y - x; }); return a.indexOf(4) + ':' + a.length + ':' + a.slice(0, 3).join(','); }
function codes(s) { var t = 0; for (var i = 0; i < s.length; i++) t += s.charCodeAt(i); return t + String.fromCharCode(65 + s.length) + s.charAt(1) + s.indexOf('c') + s.substring(1, 3); }
function thrower(v) { try { return v.toFixed(200); } catch (e) { return e.name; } }
function bare(v) { return decodeURIComponent(v); }
function outer(v) { try { return bare(v); } catch (e) { return 'caught ' + e.name + ' ' + (e.stack.indexOf('bare') >= 0); } }
var bound = function (a, b) { return this.k + a + b; }.bind({ k: 10 }, 1);
function callsBound(x) { return bound(x); }
function applied(a, b) { return Math.max.apply(null, [a, b]) + Math.min.call(null, a, b); }
function keys(o) { return Object.keys(o).join('') + JSON.stringify(o) + parseInt('42px') + Number('7') + String(12) + [1, 2].concat([3]).length; }
function each(a) { var s = 0; a.forEach(function (v) { s += v; }); return s + a.reduce(function (p, c) { return p + c; }, 0); }
function has(o, k) { return o.hasOwnProperty(k) + ':' + Array.isArray(o) + ':' + (typeof o.toString()); }
function ctor(n) { return new Array(n).length + new Date(0).getTime() + new RegExp('a+').test('caat'); }
var out = [];
for (var i = 0; i < 40; i++) {
  out.push(words('ab cd ef' + i), rx('x' + i + '-' + (i * 2) + 'y'), rx('none'), rep('banana x' + i), mathy(i, 7), arr(i + 3),
    codes('abc' + i), thrower(i), outer(i % 5 == 0 ? '%' : 'a%20b'), callsBound(i), applied(i, 5), keys({ a: i, b: 'q' }), each([i, 1, 2]),
    has({ z: 1 }, i % 2 ? 'z' : 'y'), ctor(i));
}
print(out.join('|'));
function deep(n, s) { if (n == 0) return s.normalize('bad'); return deep(n - 1, s) + 1; }
for (var j = 0; j < 30; j++) { try { deep(j % 4, 'q'); } catch (e) { if (j == 29) print(e.name, e.message.length > 0); } }
