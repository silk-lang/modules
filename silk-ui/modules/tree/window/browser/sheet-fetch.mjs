const MAX_BYTES = 64 * 1024 * 1024;

export class SheetFetch {
  constructor(wake, fetcher = (url, options) => fetch(url, options)) {
    this.wake = wake;
    this.fetcher = fetcher;
    this.next = 1;
    this.requests = new Map();
    this.closed = false;
  }

  start(url) {
    if (this.closed || this.next >= 0xffffffff || this.requests.size >= 4096) return 0;
    const id = this.next++;
    const entry = { controller: new AbortController(), bytes: null, state: -2 };
    this.requests.set(id, entry);
    this.readResponse(url, entry).then(bytes => {
      if (!this.requests.has(id)) return;
      entry.bytes = bytes;
      entry.state = bytes.length;
      this.wake();
    }, () => {
      if (!this.requests.has(id)) return;
      entry.state = -1;
      this.wake();
    });
    return id;
  }

  async readResponse(url, entry) {
    const response = await this.fetcher(url, { signal: entry.controller.signal });
    if (!response.ok) throw new Error('Stylesheet request failed');
    if (Number(response.headers.get('content-length')) > MAX_BYTES) {
      entry.controller.abort();
      throw new Error('Stylesheet exceeds size limit');
    }
    const reader = response.body?.getReader();
    if (!reader) return new Uint8Array();
    const chunks = [];
    let length = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > MAX_BYTES) throw new Error('Stylesheet exceeds size limit');
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  }

  length(id) { return this.requests.get(id)?.state ?? -1; }

  read(id, memory, pointer, length) {
    const bytes = this.requests.get(id)?.bytes;
    if (!bytes || length !== bytes.length) return -1;
    new Uint8Array(memory.buffer, pointer, length).set(bytes);
    return length;
  }

  forget(id) {
    this.requests.get(id)?.controller.abort();
    this.requests.delete(id);
  }

  close() {
    this.closed = true;
    for (const id of this.requests.keys()) this.forget(id);
  }
}
