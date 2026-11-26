function add(a, b) { return a + b; }
var s = 0;
for (var i = 0; i < 200; i++) s = add(s, i);
print(s);
