function counter(seed) {
  let current = { n: seed };
  const get = () => current;
  const set = value => { current = value; };
  const measure = (value, mutate) => {
    const saved = current;
    mutate(value);
    return saved.n - current.n;
  };
  return { get, set, measure };
}

function deep(a) {
  return function(b) {
    return function(c) {
      return function(d) {
        return () => a + 3 * b + 5 * c + 7 * d;
      };
    };
  };
}

function temporal(before) {
  const read = () => binding.n;
  if (before) return read();
  let binding = { n: 11 };
  return read();
}

const zero = counter(0), one = counter(19);
const closures = [];
for (let i = 0; i < 7; i++) closures.push(deep(i)(i + 1)(i + 2)(i + 3));
let score = 0, tdz = 0, observed = 0;
for (let i = 0; i < 24000; i++) {
  const c = i % 2 ? one : zero;
  const value = { n: i % 257 };
  score += c.measure(value, c.set) + c.get().n + closures[i % 7]();
  if (c.get() !== value) throw new Error('lost identity');
  try {
    score += temporal(i % 683 === 0);
  } catch (e) {
    if (!(e instanceof ReferenceError)) throw e;
    tdz++;
  }
  if (i % 431 === 0) {
    const sentinel = new Error('mutator');
    try { c.measure(value, () => { throw sentinel; }); }
    catch (e) { if (e !== sentinel) throw e; observed++; }
  }
}
console.log(JSON.stringify({score, tdz, observed, last0:zero.get().n, last1:one.get().n}));
