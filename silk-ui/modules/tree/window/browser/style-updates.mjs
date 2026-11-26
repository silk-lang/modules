const MAX_BYTES = 64 * 1024 * 1024;

export class StyleUpdates {
  constructor(url, { fetch: request = globalThis.fetch, interval = 300 } = {}) {
    this.url = url;
    this.request = request;
    this.version = null;
    this.pending = null;
    this.busy = false;
    this.closed = false;
    this.controller = new AbortController();
    this.timer = interval ? setInterval(() => this.poll(), interval) : null;
  }

  async poll() {
    if (this.busy || this.closed) return;
    this.busy = true;
    const options = { cache: 'no-store', signal: this.controller.signal };
    try {
      const response = await this.request('/__silkui/styles', options);
      if (!response.ok) return;
      const version = await response.text();
      if (version === this.version) return;
      const separator = this.url.includes('?') ? '&' : '?';
      const sheet = await this.request(`${this.url}${separator}silkui-style=${encodeURIComponent(version)}`, options);
      if (!sheet.ok || Number(sheet.headers.get('content-length')) > MAX_BYTES) return;
      const reader = sheet.body.getReader();
      const chunks = [];
      let length = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > MAX_BYTES) { await reader.cancel(); return; }
        chunks.push(value);
      }
      if (this.closed || length === 0) return;
      const bytes = new Uint8Array(length);
      let at = 0;
      for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
      this.pending = bytes;
      this.version = version;
    } catch {
      // Keep the last complete bundle through a failed fetch or server restart.
    } finally {
      this.busy = false;
    }
  }

  get length() { return this.pending?.length ?? 0; }

  read(memory, pointer, length) {
    if (!this.pending || length !== this.pending.length) return -1;
    new Uint8Array(memory.buffer, pointer, length).set(this.pending);
    this.pending = null;
    return length;
  }

  close() {
    this.closed = true;
    clearInterval(this.timer);
    this.controller.abort();
    this.pending = null;
  }
}
