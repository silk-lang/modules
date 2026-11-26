// SilkJS regression test: a function whose source span is long (here an eval'd script of
// about 33 KB) keeps its line table pending. Its first stack capture scans the source;
// the second encodes the table, so later captures decode it instead of rescanning. Every
// capture must report the same line and column.
function assertEq(actual, expected, message) {
  if (actual !== expected) throw new Error(message + ": expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
}
const pad = "var p = 0;\n".repeat(3000);
const code = pad + "var stacks = []; for (var i = 0; i < 4; i++) stacks.push(new Error('x').stack); stacks";
const result = (0, eval)(code);
const frame = (stack) => stack.split("\n").find((line) => /:3001:\d+/.test(line));
assertEq(typeof frame(result[0]), "string", "the first capture names line 3001");
for (let i = 1; i < result.length; i++) assertEq(frame(result[i]), frame(result[0]), "capture " + i + " matches the first");
// A long function called later, after its table was encoded, still reports its own lines.
const later = (0, eval)(pad + "(function () {\n  return [new Error('a').stack, new Error('b').stack, new Error('c').stack];\n})");
const first = later(), second = later();
const inner = (stack) => stack.split("\n").find((line) => /:3002:\d+/.test(line));
for (let i = 0; i < 3; i++) {
  assertEq(typeof inner(first[i]), "string", "error " + i + " of the called function is on line 3002");
  assertEq(inner(second[i]), inner(first[i]), "error " + i + " has the same frame on the second call");
}
// A long span whose positions go back in the source (a loop's update runs after its
// body) encodes its table on the first capture instead of rescanning for each.
const looped = (0, eval)(pad + "for (var k = 0; k < 2; k++) { p += k; }\nnew Error('y').stack");
const straight = (0, eval)(pad + "p++;\nnew Error('y').stack");
const top = (stack) => stack.split("\n").find((line) => /:3002:\d+/.test(line));
assertEq(typeof top(looped), "string", "the looped span's first capture names line 3002");
assertEq(top(looped), top(straight), "the looped span's first capture has the scanned span's column");
