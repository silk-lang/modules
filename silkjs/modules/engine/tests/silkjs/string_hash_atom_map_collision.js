// Unregistered compact strings looked up as property keys (AtomTable.findString)
// and as Map/Set keys (js_map_storage.stringHash) must cache their hashes
// independently without corrupting each other in either order.
var names = [
  'http', 'fs', 'net', 'url', 'os', 'vm', 'path', 'module',
  'buffer', 'crypto', 'stream', 'events', 'timers', 'zlib',
  '_http_client', '_http_common', '_http_outgoing', 'worker_threads'
];
var set = new Set(names);
var map = new Map();
for (var i = 0; i < names.length; i++) map.set(names[i], i + 1);
var obj = Object.create(null);
obj.http = 100;
obj.net = 200;
obj.module = 300;
var bad1 = 0, bad2 = 0, bad3 = 0;
for (var round = 0; round < 3; round++) {
  for (var j = 0; j < names.length; j++) {
    // Property lookup first, then Set/Map lookup.
    var s1 = ('node:' + names[j]).slice(5);
    void obj[s1];
    if (!set.has(s1) || map.get(s1) !== j + 1) bad1++;
    // Set/Map lookup first, then property lookup.
    var s2 = ('node:' + names[j]).slice(5);
    if (!set.has(s2) || map.get(s2) !== j + 1) bad2++;
    var expected = names[j] === 'http' ? 100 : (names[j] === 'net' ? 200 : (names[j] === 'module' ? 300 : undefined));
    if (obj[s2] !== expected) bad3++;
  }
}
var __result = bad1 + ' ' + bad2 + ' ' + bad3;
var __expected = '0 0 0';
if (__result !== __expected) throw new Error('expected ' + __expected + ', got ' + __result);
