// `fetch` for a window with an address: a relative address resolves against `location`, and
// an address of the window's own origin reads the app's file (see base.js), as a page's server
// would serve it. `EventSource` reads a server-sent event stream with that `fetch`.
import { appFile } from "./base.js";

const TYPES = {
  wasm: "application/wasm", js: "text/javascript", mjs: "text/javascript", json: "application/json", css: "text/css",
  html: "text/html", txt: "text/plain", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", avif: "image/avif", ico: "image/x-icon", woff: "font/woff", woff2: "font/woff2",
  ttf: "font/ttf", otf: "font/otf", mp3: "audio/mpeg", wav: "audio/wav", mp4: "video/mp4", webm: "video/webm", pdf: "application/pdf",
};

export function windowFetch(fetch, location) {
  const fs = globalThis.process?.getBuiltinModule?.("node:fs");
  return function (input, init) {
    const RequestClass = globalThis.Request;
    const request = RequestClass && input instanceof RequestClass ? input : null;
    let address;
    try {
      address = new URL(request ? request.url : input instanceof URL ? input.href : String(input), location.href);
    } catch {
      return fetch(input, init);
    }
    const file = appFile(address, location.origin);
    if (!file) return fetch(request ?? address.href, init);
    if (file.protocol !== "file:") return fetch(request ? new RequestClass(file.href, request) : file.href, init);
    const method = String(init?.method ?? request?.method ?? "GET").toUpperCase();
    if (!fs || (method !== "GET" && method !== "HEAD")) return fetch(request ?? address.href, init);
    return fs.promises.readFile(file).then(
      (bytes) => served(method === "HEAD" ? null : bytes, 200, typeOf(file.pathname), address.href),
      (error) => served(null, error?.code === "ENOENT" || error?.code === "EISDIR" ? 404 : 500, "text/plain", address.href),
    );
  };
}

function typeOf(path) {
  return TYPES[/\.([^./]+)$/.exec(path)?.[1]?.toLowerCase()] ?? "application/octet-stream";
}

function served(body, status, type, url) {
  const response = new Response(body, { status, headers: { "content-type": type } });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 2;

export function eventSourceClass(fetch, location, Target) {
  return class EventSource extends Target {
    static CONNECTING = CONNECTING;
    static OPEN = OPEN;
    static CLOSED = CLOSED;
    CONNECTING = CONNECTING;
    OPEN = OPEN;
    CLOSED = CLOSED;
    onopen = null;
    onmessage = null;
    onerror = null;
    #controller = null;
    #lastId = "";
    #retry = 3000;
    #state = CONNECTING;

    constructor(url, options = {}) {
      super();
      this.url = new URL(String(url), location.href).href;
      this.withCredentials = Boolean(options.withCredentials);
      queueMicrotask(() => this.#connect());
    }

    get readyState() { return this.#state; }

    close() {
      this.#state = CLOSED;
      this.#controller?.abort();
    }

    #fire(event) {
      const handler = this["on" + event.type];
      if (typeof handler === "function") handler.call(this, event);
      this.dispatchEvent(event);
    }

    async #connect() {
      if (this.#state === CLOSED) return;
      this.#controller = new AbortController();
      const headers = { accept: "text/event-stream", "cache-control": "no-store" };
      if (this.#lastId) headers["last-event-id"] = this.#lastId;
      try {
        const response = await fetch(this.url, { headers, signal: this.#controller.signal, credentials: this.withCredentials ? "include" : "same-origin" });
        if (!response.ok || !/^text\/event-stream/i.test(response.headers.get("content-type") ?? "")) {
          this.#state = CLOSED;
          this.#fire(new Event("error"));
          return;
        }
        this.#state = OPEN;
        this.#fire(new Event("open"));
        await this.#read(response.body);
      } catch {
        if (this.#state === CLOSED) return;
      }
      if (this.#state === CLOSED) return;
      this.#state = CONNECTING;
      this.#fire(new Event("error"));
      setTimeout(() => this.#connect(), this.#retry);
    }

    async #read(stream) {
      const decoder = new TextDecoder();
      let buffer = "";
      let data = [];
      let type = "";
      for await (const chunk of stream) {
        buffer += decoder.decode(chunk, { stream: true });
        let end;
        while ((end = buffer.search(/\r\n|\r|\n/)) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + (buffer.startsWith("\r\n", end) ? 2 : 1));
          if (line === "") {
            if (data.length) {
              const MessageEventClass = globalThis.MessageEvent ?? Event;
              const event = new MessageEventClass(type || "message", { data: data.join("\n"), lastEventId: this.#lastId, origin: new URL(this.url).origin });
              this.#fire(event);
            }
            data = [];
            type = "";
            continue;
          }
          if (line.startsWith(":")) continue;
          const colon = line.indexOf(":");
          const field = colon < 0 ? line : line.slice(0, colon);
          const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
          if (field === "data") data.push(value);
          else if (field === "event") type = value;
          else if (field === "id" && !value.includes("\0")) this.#lastId = value;
          else if (field === "retry" && /^\d+$/.test(value)) this.#retry = Number(value);
        }
        if (this.#state === CLOSED) return;
      }
    }
  };
}
