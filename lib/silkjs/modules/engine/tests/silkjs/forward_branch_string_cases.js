// SilkJS regression test for short forward branches over string `switch`
// cases (js_compiler_label_support.forwardDistance): each case on a string
// gains a five-byte fusion prefix in the final code, so the branch from an
// early case to the shared body spans more than the pre-label code says. Ten
// or more such cases sharing one body, at every body length near the one-byte
// limit, must still compile and take both edges.
let failures = 0;
for (let cases = 1; cases <= 16; cases++) {
  const labels = Array.from({ length: cases }, (_, i) => `case "k${i}":`).join(' ');
  for (let n = 0; n <= 40; n++) {
    const body = 's = i; '.repeat(n);
    const f = new Function('e', 's', 'i', `switch (e) { ${labels} ${body} return 1 } return 2`);
    if (f('k0', 0, 0) !== 1 || f(`k${cases - 1}`, 0, 0) !== 1 || f('other', 0, 0) !== 2) {
      failures++; console.log('FAIL cases ' + cases + ' body ' + n);
    }
  }
}
console.log(failures === 0 ? 'PASS forward branches over string cases' : 'FAIL ' + failures);
if (failures !== 0) throw new Error('forward branch string case regressions');
