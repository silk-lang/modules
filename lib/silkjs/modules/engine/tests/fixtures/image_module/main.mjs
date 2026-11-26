// A module run from source and from a bytecode image (scripts/check.py) must print the same.
import Counter, { add, base } from './dep.mjs';
const counter = new Counter();
counter.bump();
function named() { return named.toString().length; }
console.log('module', add(2), base, counter.bump(), typeof import.meta.url, import.meta.main, named());
const lazy = await import('./dep.mjs');
console.log('dynamic', lazy.add(1), lazy.default === Counter);
try { null.x; } catch (error) { console.log('stack', /main\.mjs:\d+/.test(error.stack)); }
