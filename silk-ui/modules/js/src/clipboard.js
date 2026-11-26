// `navigator.clipboard` and `ClipboardItem`, as the W3C Clipboard API has them. The preludes
// evaluate this on first use; it needs only the host's `__ui` clipboard functions and a
// global `Blob`. The host reads and writes the system clipboard after the code that asked
// has run, then settles the promise. Items move through the host as a header of
// "<type> <byte length>" lines and a body that holds their bytes as a Latin-1 string.
// Edit it, then run `silk task embed-assets`.
(function (native) {
  // The types the system clipboard maps, as ClipboardItem.supports answers.
  const TYPES = ["text/plain", "text/html", "image/png"];
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  const domError = (name, message) => {
    if (typeof globalThis.DOMException === "function") return new globalThis.DOMException(message, name);
    const error = new Error(message);
    error.name = name;
    return error;
  };

  const calls = new Map();
  let nextCall = 0;
  const call = (kind, ask) => new Promise((resolve, reject) => {
    const id = ++nextCall;
    calls.set(id, { kind, resolve, reject });
    ask(id);
  });
  const settle = (id) => {
    const pending = calls.get(id);
    calls.delete(id);
    return pending;
  };

  const toBinary = (bytes) => {
    let text = "";
    for (let at = 0; at < bytes.length; at += 8192) text += String.fromCharCode.apply(null, bytes.subarray(at, at + 8192));
    return text;
  };
  const fromBinary = (text, start, end) => {
    const bytes = new Uint8Array(end - start);
    for (let i = start; i < end; i++) bytes[i - start] = text.charCodeAt(i);
    return bytes;
  };

  // A text read's answer: its text, undefined when the clipboard has none; a write's: nothing.
  native.clipboard = (id, text) => {
    const pending = settle(id);
    if (pending) pending.resolve(pending.kind === "readText" ? (text ?? "") : undefined);
  };
  // An item read's answer: the item the clipboard holds, an empty header when it holds none.
  native.clipboardItem = (id, header, body) => {
    const pending = settle(id);
    if (!pending) return;
    if (!header) return pending.resolve([]);
    const parts = {};
    let at = 0;
    for (const line of header.split("\n")) {
      const space = line.lastIndexOf(" ");
      const type = line.slice(0, space);
      const length = Number(line.slice(space + 1));
      parts[type] = new globalThis.Blob([fromBinary(body, at, at + length)], { type });
      at += length;
    }
    pending.resolve([new ClipboardItem(parts)]);
  };

  class ClipboardItem {
    #items;
    #presentationStyle;
    constructor(items, options = {}) {
      if (items === null || typeof items !== "object") throw new TypeError("ClipboardItem takes an object of types");
      const types = Object.keys(items);
      if (types.length === 0) throw new TypeError("ClipboardItem needs at least one type");
      this.#items = new Map(types.map((type) => [type, Promise.resolve(items[type])]));
      const style = options?.presentationStyle ?? "unspecified";
      if (!["unspecified", "inline", "attachment"].includes(style)) throw new TypeError("'" + style + "' is not a presentation style");
      this.#presentationStyle = style;
    }
    get types() {
      return Object.freeze([...this.#items.keys()]);
    }
    get presentationStyle() {
      return this.#presentationStyle;
    }
    async getType(type) {
      if (!this.#items.has(type)) throw domError("NotFoundError", "The type '" + type + "' was not found");
      const value = await this.#items.get(type);
      if (value instanceof globalThis.Blob) return value;
      return new globalThis.Blob([String(value)], { type });
    }
    static supports(type) {
      return TYPES.includes(String(type));
    }
  }
  Object.defineProperty(ClipboardItem.prototype, Symbol.toStringTag, { value: "ClipboardItem" });

  const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());

  const clipboard = {
    readText: () => call("readText", (id) => native.clipboardRead(id)),
    writeText: (text) => {
      const value = String(text);
      return call("write", (id) => native.clipboardWrite(id, value));
    },
    read: () => call("read", (id) => native.clipboardReadItem(id)),
    async write(data) {
      const items = [...data];
      if (items.length > 1) throw domError("NotAllowedError", "Writing more than one ClipboardItem is not supported");
      if (items.length === 0) return clipboard.writeText("");
      const item = items[0];
      if (!(item instanceof ClipboardItem)) throw new TypeError("write takes ClipboardItem objects");
      const header = [];
      let body = "";
      for (const type of item.types) {
        if (!ClipboardItem.supports(type)) throw domError("NotAllowedError", "Type " + type + " not supported on write");
        let blob;
        try {
          blob = await item.getType(type);
        } catch (error) {
          throw domError("NotAllowedError", "Reading the " + type + " data failed: " + (error?.message ?? error));
        }
        const bytes = await bytesOf(blob);
        if (type === "image/png" && !PNG.every((byte, i) => bytes[i] === byte)) throw domError("DataError", "The image/png data is not a PNG image");
        header.push(type + " " + bytes.length);
        body += toBinary(bytes);
      }
      return call("write", (id) => native.clipboardWriteItem(id, header.join("\n"), body));
    },
  };

  return { clipboard, ClipboardItem };
})
