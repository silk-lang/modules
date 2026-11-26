// UTF-8 for the development module runner and dependencies evaluated before tree shaking.
// Release hosts still report encoding APIs as unsupported. Other encodings fail explicitly.
export class TextEncoder {
  get encoding() { return "utf-8"; }
  encode(input = "") {
    const text = String(input);
    const buffer = new Uint8Array(text.length * 3);
    const { written } = this.encodeInto(text, buffer);
    return buffer.slice(0, written);
  }
  encodeInto(input, destination) {
    const text = String(input);
    if (!(destination instanceof Uint8Array)) throw new TypeError("Expected a Uint8Array");
    let read = 0, written = 0;
    for (const character of text) {
      let code = character.codePointAt(0);
      if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
      const size = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
      if (written + size > destination.length) break;
      if (size === 1) destination[written++] = code;
      else {
        destination[written++] = (size === 2 ? 0xc0 : size === 3 ? 0xe0 : 0xf0) | (code >> (6 * (size - 1)));
        for (let shift = 6 * (size - 2); shift >= 0; shift -= 6) destination[written++] = 0x80 | ((code >> shift) & 0x3f);
      }
      read += character.length;
    }
    return { read, written };
  }
}

export class TextDecoder {
  #fatal;
  #ignoreBOM;
  #streaming = false;
  #bomSeen = false;
  #needed = 0;
  #seen = 0;
  #code = 0;
  #lower = 0x80;
  #upper = 0xbf;
  constructor(label = "utf-8", options = {}) {
    const encoding = String(label).replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, "").toLowerCase();
    if (!["utf-8", "utf8", "unicode-1-1-utf-8", "unicode11utf8", "unicode20utf8", "x-unicode20utf8"].includes(encoding)) throw new RangeError("The native dev runner supports only UTF-8");
    this.#fatal = Boolean(options?.fatal);
    this.#ignoreBOM = Boolean(options?.ignoreBOM);
  }
  get encoding() { return "utf-8"; }
  get fatal() { return this.#fatal; }
  get ignoreBOM() { return this.#ignoreBOM; }
  #reset() {
    this.#needed = this.#seen = this.#code = 0;
    this.#lower = 0x80;
    this.#upper = 0xbf;
  }
  decode(input, options = {}) {
    let bytes;
    if (input === undefined) bytes = new Uint8Array();
    else if (ArrayBuffer.isView(input)) bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    else if (input instanceof ArrayBuffer || (typeof SharedArrayBuffer !== "undefined" && input instanceof SharedArrayBuffer)) bytes = new Uint8Array(input);
    else throw new TypeError("Expected an ArrayBuffer or view");
    if (!this.#streaming) {
      this.#reset();
      this.#bomSeen = false;
    }
    this.#streaming = Boolean(options?.stream);
    let text = "";
    const emit = (code) => {
      if (!this.#bomSeen) {
        this.#bomSeen = true;
        if (code === 0xfeff && !this.#ignoreBOM) return;
      }
      text += String.fromCodePoint(code);
    };
    const error = () => {
      if (this.#fatal) throw new TypeError("The encoded data was not valid UTF-8");
      emit(0xfffd);
    };
    for (let index = 0; index < bytes.length; index++) {
      const byte = bytes[index];
      if (this.#needed === 0) {
        if (byte <= 0x7f) emit(byte);
        else if (byte >= 0xc2 && byte <= 0xdf) { this.#needed = 1; this.#code = byte & 0x1f; }
        else if (byte >= 0xe0 && byte <= 0xef) {
          this.#needed = 2; this.#code = byte & 0x0f;
          if (byte === 0xe0) this.#lower = 0xa0;
          if (byte === 0xed) this.#upper = 0x9f;
        } else if (byte >= 0xf0 && byte <= 0xf4) {
          this.#needed = 3; this.#code = byte & 0x07;
          if (byte === 0xf0) this.#lower = 0x90;
          if (byte === 0xf4) this.#upper = 0x8f;
        } else error();
      } else if (byte < this.#lower || byte > this.#upper) {
        this.#reset();
        error();
        index--; // The invalid continuation can start the next character.
      } else {
        this.#lower = 0x80; this.#upper = 0xbf;
        this.#code = (this.#code << 6) | (byte & 0x3f);
        if (++this.#seen === this.#needed) {
          emit(this.#code);
          this.#reset();
        }
      }
    }
    if (!this.#streaming && this.#needed !== 0) {
      this.#reset();
      error();
    }
    return text;
  }
}
