// regexp natives from baseline code: exec states, replace forms, wrong receivers
var g = /(\w)(\d)?/g, y = /ab/y, named = /(?<a>x)(y)/, idx = /a(b)/d;
function all(s) { var out = [], m; g.lastIndex = 0; while ((m = g.exec(s)) !== null) { out.push(m[0] + '@' + m.index + '/' + g.lastIndex + (m[2] === undefined ? 'u' : m[2])); } return out.join(','); }
function sticky(s, at) { y.lastIndex = at; var m = y.exec(s); return (m ? m.index : -1) + ':' + y.lastIndex; }
function groups(s) { var m = named.exec(s); return m ? m.groups.a + m[2] + m.length : 'no'; }
function indices(s) { var m = idx.exec(s); return m ? m.indices[1].join('-') : 'no'; }
function odd(re, v) { try { return String(re.exec(v)); } catch (e) { return e.name; } }
function wrong(o, s) { try { return String(RegExp.prototype.exec.call(o, s)); } catch (e) { return e.name; } }
function tests(s) { return /^a+$/.test(s) + ':' + /b/.test(s) + ':' + g.test(s); }
function reps(s) { return s.replace(/(a)(b)?/g, '[$1$2$&]') + s.replace(/z/, 'q') + s.replace('a', '$&$&') + s.replace(/b/g, function (m, o) { return o; }) + s.replace(/a/gi, ''); }
function splits(s) { return s.split(/,\s*/).length + s.match(/\d+/g).join('+') + s.search(/\d/) + s.matchAll ? 1 : 0; }
var li = { valueOf: function () { return 1; } };
function coerced(s) { var r = /b/g; r.lastIndex = li; var m = r.exec(s); return (m ? m.index : -1) + ':' + r.lastIndex; }
var out = [];
for (var i = 0; i < 40; i++) {
  out.push(all('a1b c' + i + ' d'), sticky('abab' + i, i % 3), groups(i % 2 ? 'xy' : 'yx'), indices('zab' + i), odd(/q/, i), odd(/1/, { toString: function () { return 'x1'; } }),
    odd(/u/, undefined), wrong({}, 'a'), wrong(/a/, 'cat'), wrong(null, 'a'), tests(i % 2 ? 'aaa' : 'aab'), reps('abAb a' + i), splits('1, 2,3 ' + i), coerced('abab'));
}
print(out.join('|'));
