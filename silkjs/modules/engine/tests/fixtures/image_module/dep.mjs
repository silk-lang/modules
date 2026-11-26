export const base = 40;
export function add(value) { return base + value; }
export default class Counter { #count = 0; bump() { return ++this.#count; } }
