const QUERIES = [
  '(prefers-color-scheme: dark)', '(prefers-reduced-motion: reduce)', '(hover: hover)',
  '(pointer: coarse)', '(pointer: fine)', '(any-pointer: coarse)', '(any-pointer: fine)', '(any-hover: hover)',
  '(forced-colors: active)',
];

export class MediaPreferences {
  constructor(changed, match = query => globalThis.matchMedia(query)) {
    this.queries = QUERIES.map(match);
    this.value = this.read();
    this.changed = () => {
      const next = this.read();
      if (next === this.value) return;
      this.value = next;
      changed();
    };
    for (const query of this.queries) query.addEventListener('change', this.changed);
  }

  read() {
    return this.queries.reduce((bits, query, index) => bits | (query.matches ? 1 << index : 0), 0);
  }

  get bits() { return this.value; }

  close() {
    for (const query of this.queries) query.removeEventListener('change', this.changed);
  }
}
