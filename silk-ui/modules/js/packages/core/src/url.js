// `URL` and `URLSearchParams` as the WHATWG URL standard has them, for a realm without its
// own (the embedded engine): parsing against a base, the special schemes' default ports and
// path rules, percent-encoding by component, and a query list kept in step with its URL.
// Hosts are kept as written (lowercased for the special schemes); there is no IDNA mapping.

const SPECIAL = { "ftp:": "21", "file:": "", "http:": "80", "https:": "443", "ws:": "80", "wss:": "443" };
const isSpecial = (scheme) => Object.hasOwn(SPECIAL, scheme);

const C0 = (code) => code <= 0x1f || code > 0x7e;
const FRAGMENT = new Set(' "<>`');
const QUERY = new Set(' "#<>');
const SPECIAL_QUERY = new Set(" \"#<>'");
const PATH = new Set(' "#<>?`{}');
const USERINFO = new Set(' "#<>?`{}/:;=@[\\]^|');
const FORM = /[A-Za-z0-9*\-._]/;

// A character's UTF-8 bytes as `%XX` escapes (a lone surrogate as U+FFFD's).
function escape(char) {
  const code = char.codePointAt(0);
  if (code < 0x80) return "%" + code.toString(16).toUpperCase().padStart(2, "0");
  try { return encodeURIComponent(char); } catch { return "%EF%BF%BD"; }
}

function encode(text, set) {
  let out = "";
  for (const char of text) out += C0(char.codePointAt(0)) || set.has(char) ? escape(char) : char;
  return out;
}

// UTF-8 `bytes` as text, each bad sequence as U+FFFD.
function utf8(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length;) {
    const lead = bytes[i];
    const need = lead < 0x80 ? 0 : lead >= 0xc2 && lead < 0xe0 ? 1 : lead >= 0xe0 && lead < 0xf0 ? 2 : lead >= 0xf0 && lead < 0xf5 ? 3 : -1;
    if (need < 0) { out += "\uFFFD"; i++; continue; }
    let code = need === 0 ? lead : lead & (0x3f >> need);
    let j = 1;
    for (; j <= need; j++) {
      const next = bytes[i + j];
      if (next === undefined || (next & 0xc0) !== 0x80) break;
      code = (code << 6) | (next & 0x3f);
    }
    const shortest = need === 0 || code >= [0, 0x80, 0x800, 0x10000][need];
    if (j <= need || !shortest || (code >= 0xd800 && code < 0xe000) || code > 0x10ffff) { out += "\uFFFD"; i += Math.max(1, j); continue; }
    out += String.fromCodePoint(code);
    i += need + 1;
  }
  return out;
}

function percentDecode(text) {
  if (!text.includes("%")) return text;
  const bytes = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "%" && /^[0-9a-fA-F]{2}$/.test(text.slice(i + 1, i + 3))) {
      bytes.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      const code = text.charCodeAt(i);
      if (code < 0x80) bytes.push(code);
      else for (const piece of escape(text.codePointAt(i) > 0xffff ? text.slice(i, ++i + 1) : char).split("%").slice(1)) bytes.push(parseInt(piece, 16));
    }
  }
  return utf8(bytes);
}

function failure(input) {
  return new TypeError("Invalid URL: '" + input + "'");
}

const SINGLE_DOT = new Set([".", "%2e"]);
const DOUBLE_DOT = new Set(["..", ".%2e", "%2e.", "%2e%2e"]);

// Adds the segments of `path` to `segments`, resolving dot segments.
function pushPath(segments, path, special) {
  const parts = (special ? path.replace(/\\/g, "/") : path).split("/");
  parts.forEach((part, index) => {
    const lower = part.toLowerCase();
    const last = index === parts.length - 1;
    if (DOUBLE_DOT.has(lower)) {
      if (segments.length) segments.pop();
      if (last) segments.push("");
    } else if (SINGLE_DOT.has(lower)) {
      if (last) segments.push("");
    } else {
      segments.push(encode(part, PATH));
    }
  });
}

function parseHost(text, special, input) {
  if (text.startsWith("[")) {
    if (!text.endsWith("]") || !/^\[[0-9a-fA-F:.]+\]$/.test(text)) throw failure(input);
    return text.toLowerCase();
  }
  if (!special) {
    if (/[\0\t\n\r #/:<>?@[\\\]^|]/.test(text)) throw failure(input);
    return encode(text, new Set());
  }
  const host = percentDecode(text).toLowerCase();
  if (/[\0\t\n\r #%/:<>?@[\\\]^|]/.test(host)) throw failure(input);
  // A decimal IPv4 address as its dotted parts (`0x7f.1` and the like stay as written).
  if (/^\d+(\.\d+){0,3}\.?$/.test(host)) {
    const parts = host.replace(/\.$/, "").split(".").map(Number);
    const lastPart = parts.pop();
    if (parts.some((part) => part > 255) || lastPart >= 256 ** (4 - parts.length)) throw failure(input);
    let value = lastPart;
    parts.forEach((part, index) => { value += part * 256 ** (3 - index); });
    return [24, 16, 8, 0].map((shift) => Math.floor(value / 2 ** shift) % 256).join(".");
  }
  return host;
}

// The parts of `input`, resolved against `base` (parts too, or null).
function parse(input, base) {
  const original = input;
  input = String(input).replace(/^[\0- ]+|[\0- ]+$/g, "").replace(/[\t\n\r]/g, "");
  const record = { scheme: "", username: "", password: "", host: null, port: "", path: [], opaque: null, query: null, fragment: null };
  let rest = input;
  const scheme = /^[A-Za-z][A-Za-z0-9+.-]*:/.exec(rest);
  const hashAt = (text) => {
    const at = text.indexOf("#");
    if (at < 0) return [text, null];
    return [text.slice(0, at), encode(text.slice(at + 1), FRAGMENT)];
  };
  const queryAt = (text, special) => {
    const at = text.indexOf("?");
    if (at < 0) return [text, null];
    return [text.slice(0, at), encode(text.slice(at + 1), special ? SPECIAL_QUERY : QUERY)];
  };

  const authority = (text, special) => {
    const end = text.search(special ? /[/\\?#]/ : /[/?#]/);
    const part = end < 0 ? text : text.slice(0, end);
    const after = end < 0 ? "" : text.slice(end);
    const at = part.lastIndexOf("@");
    if (at >= 0) {
      const info = part.slice(0, at);
      const colon = info.indexOf(":");
      record.username = encode(colon < 0 ? info : info.slice(0, colon), USERINFO);
      record.password = colon < 0 ? "" : encode(info.slice(colon + 1), USERINFO);
    }
    const hostPort = part.slice(at + 1);
    const portAt = hostPort.search(/:[^\]]*$/);
    const hostText = portAt < 0 ? hostPort : hostPort.slice(0, portAt);
    const portText = portAt < 0 ? "" : hostPort.slice(portAt + 1);
    if (portText !== "") {
      if (!/^\d+$/.test(portText) || Number(portText) > 65535) throw failure(original);
      record.port = String(Number(portText));
      if (SPECIAL[record.scheme] === record.port) record.port = "";
    }
    if (hostText === "" && special && record.scheme !== "file:") throw failure(original);
    if (hostText === "" && (at >= 0 || portText !== "")) throw failure(original);
    record.host = parseHost(hostText, special, original);
    if (record.scheme === "file:" && record.host === "localhost") record.host = "";
    return after;
  };

  const finish = (text, special) => {
    let path;
    [text, record.fragment] = hashAt(text);
    [path, record.query] = queryAt(text, special);
    if (path.startsWith("/") || (special && path.startsWith("\\"))) path = path.slice(1);
    else if (path === "" && !special && record.host === null) return;
    pushPath(record.path, path, special);
  };

  if (scheme) {
    record.scheme = scheme[0].toLowerCase();
    rest = rest.slice(scheme[0].length);
    const special = isSpecial(record.scheme);
    if (special && base && base.scheme === record.scheme && !/^[/\\]/.test(rest) && record.scheme !== "file:") {
      return relative(rest, base, record, finish, authority);
    }
    if (special) {
      if (record.scheme === "file:") {
        if (/^[/\\]{2}/.test(rest)) rest = authority(rest.slice(2), true);
        else record.host = "";
      } else {
        rest = authority(rest.replace(/^[/\\]*/, ""), true);
      }
      finish(rest, true);
      if (record.path.length === 0) record.path.push("");
      return record;
    }
    if (rest.startsWith("//")) {
      rest = authority(rest.slice(2), false);
      finish(rest, false);
      return record;
    }
    if (rest.startsWith("/")) {
      finish(rest, false);
      return record;
    }
    let opaque;
    [rest, record.fragment] = hashAt(rest);
    [opaque, record.query] = queryAt(rest, false);
    record.opaque = encode(opaque, new Set());
    return record;
  }
  if (!base) throw failure(original);
  if (base.opaque !== null) {
    if (!rest.startsWith("#")) throw failure(original);
    return { ...base, path: [], fragment: encode(rest.slice(1), FRAGMENT) };
  }
  record.scheme = base.scheme;
  return relative(rest, base, record, finish, authority);
}

function relative(rest, base, record, finish, authority) {
  const special = isSpecial(record.scheme);
  const slash = special ? /^[/\\]{2}/ : /^\/\//;
  if (slash.test(rest)) {
    rest = authority(rest.slice(2), special);
    finish(rest, special);
    if (special && record.path.length === 0) record.path.push("");
    return record;
  }
  Object.assign(record, { username: base.username, password: base.password, host: base.host, port: base.port });
  if (rest === "") return { ...record, path: [...base.path], query: base.query, fragment: null };
  if (rest.startsWith("#")) return { ...record, path: [...base.path], query: base.query, fragment: encode(rest.slice(1), FRAGMENT) };
  if (rest.startsWith("?")) {
    finish(rest, special);
    record.path = [...base.path];
    return record;
  }
  if (rest.startsWith("/") || (special && rest.startsWith("\\"))) {
    finish(rest, special);
    return record;
  }
  // The reference's segments go after the base's directory, and its dot segments reach into it.
  record.path = base.path.slice(0, -1);
  finish(rest, special);
  return record;
}

function serialize(record, withFragment = true) {
  let out = record.scheme;
  if (record.host !== null) {
    out += "//";
    if (record.username || record.password) out += record.username + (record.password ? ":" + record.password : "") + "@";
    out += record.host + (record.port ? ":" + record.port : "");
  } else if (record.opaque === null && record.path.length > 1 && record.path[0] === "") {
    out += "/.";
  }
  out += pathOf(record);
  if (record.query !== null) out += "?" + record.query;
  if (withFragment && record.fragment !== null) out += "#" + record.fragment;
  return out;
}

const pathOf = (record) => (record.opaque !== null ? record.opaque : "/" + record.path.join("/"));

const parts = Symbol("parts");
const list = Symbol("list");
const owner = Symbol("owner");

function formEncode(text) {
  let out = "";
  for (const char of String(text)) {
    if (char === " ") out += "+";
    else if (FORM.test(char)) out += char;
    else out += escape(char);
  }
  return out;
}

function formDecode(text) {
  const pairs = [];
  for (const piece of text.split("&")) {
    if (piece === "") continue;
    const at = piece.indexOf("=");
    const name = at < 0 ? piece : piece.slice(0, at);
    const value = at < 0 ? "" : piece.slice(at + 1);
    pairs.push([percentDecode(name.replace(/\+/g, " ")), percentDecode(value.replace(/\+/g, " "))]);
  }
  return pairs;
}

const toUSV = (value) => String(value).toWellFormed?.() ?? String(value);

export class URLSearchParams {
  constructor(init = "") {
    this[list] = [];
    this[owner] = null;
    if (init instanceof URLSearchParams) this[list] = init[list].map(([name, value]) => [name, value]);
    else if (init !== null && typeof init === "object" && typeof init[Symbol.iterator] === "function") {
      for (const pair of init) {
        const items = [...pair];
        if (items.length !== 2) throw new TypeError("Each URLSearchParams pair needs a name and a value");
        this[list].push([toUSV(items[0]), toUSV(items[1])]);
      }
    } else if (init !== null && typeof init === "object") {
      for (const name of Object.keys(init)) this[list].push([toUSV(name), toUSV(init[name])]);
    } else {
      const text = toUSV(init);
      this[list] = formDecode(text.startsWith("?") ? text.slice(1) : text);
    }
  }

  #changed() {
    const url = this[owner];
    if (!url) return;
    const text = this.toString();
    url[parts].query = text === "" ? null : text;
  }

  get size() { return this[list].length; }
  append(name, value) { this[list].push([toUSV(name), toUSV(value)]); this.#changed(); }
  delete(name, value) {
    name = toUSV(name);
    this[list] = this[list].filter(([key, item]) => key !== name || (value !== undefined && item !== toUSV(value)));
    this.#changed();
  }
  get(name) { name = toUSV(name); return this[list].find(([key]) => key === name)?.[1] ?? null; }
  getAll(name) { name = toUSV(name); return this[list].filter(([key]) => key === name).map(([, value]) => value); }
  has(name, value) {
    name = toUSV(name);
    return this[list].some(([key, item]) => key === name && (value === undefined || item === toUSV(value)));
  }
  set(name, value) {
    name = toUSV(name);
    value = toUSV(value);
    const at = this[list].findIndex(([key]) => key === name);
    if (at < 0) this[list].push([name, value]);
    else {
      this[list][at][1] = value;
      this[list] = this[list].filter(([key], index) => key !== name || index === at);
    }
    this.#changed();
  }
  sort() {
    // Stable, by UTF-16 code units, as the standard says.
    this[list] = this[list].map((pair, index) => [pair, index])
      .sort(([a, i], [b, j]) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : i - j)).map(([pair]) => pair);
    this.#changed();
  }
  forEach(callback, thisArg) {
    for (let i = 0; i < this[list].length; i++) callback.call(thisArg, this[list][i][1], this[list][i][0], this);
  }
  *entries() { for (let i = 0; i < this[list].length; i++) yield [this[list][i][0], this[list][i][1]]; }
  *keys() { for (const [name] of this.entries()) yield name; }
  *values() { for (const [, value] of this.entries()) yield value; }
  [Symbol.iterator]() { return this.entries(); }
  toString() { return this[list].map(([name, value]) => formEncode(name) + "=" + formEncode(value)).join("&"); }
  get [Symbol.toStringTag]() { return "URLSearchParams"; }
}

export class URL {
  #search = null;

  constructor(url, base) {
    const baseParts = base === undefined ? null : parse(String(base), null);
    this[parts] = parse(String(url), baseParts);
  }

  static canParse(url, base) {
    try { new URL(url, base); return true; } catch { return false; }
  }

  static parse(url, base) {
    try { return new URL(url, base); } catch { return null; }
  }

  get searchParams() {
    if (!this.#search) {
      this.#search = new URLSearchParams(this[parts].query ?? "");
      this.#search[owner] = this;
    }
    return this.#search;
  }

  #query(text) {
    this[parts].query = text;
    if (this.#search) this.#search[list] = formDecode(text ?? "");
  }

  get href() { return serialize(this[parts]); }
  set href(value) {
    this[parts] = parse(String(value), null);
    this.#query(this[parts].query);
  }

  get origin() {
    const record = this[parts];
    if (record.scheme === "blob:") {
      try { return new URL(pathOf(record)).origin; } catch { return "null"; }
    }
    if (!isSpecial(record.scheme) || record.scheme === "file:") return "null";
    return record.scheme + "//" + record.host + (record.port ? ":" + record.port : "");
  }

  get protocol() { return this[parts].scheme; }
  set protocol(value) {
    const scheme = /^[A-Za-z][A-Za-z0-9+.-]*/.exec(String(value))?.[0]?.toLowerCase();
    if (!scheme) return;
    const next = scheme + ":";
    if (isSpecial(next) !== isSpecial(this[parts].scheme)) return;
    if (next === "file:" && (this[parts].username || this[parts].password || this[parts].port)) return;
    this[parts].scheme = next;
    if (SPECIAL[next] === this[parts].port) this[parts].port = "";
  }

  get username() { return this[parts].username; }
  set username(value) { if (this.#hasCredentials()) this[parts].username = encode(String(value), USERINFO); }
  get password() { return this[parts].password; }
  set password(value) { if (this.#hasCredentials()) this[parts].password = encode(String(value), USERINFO); }
  #hasCredentials() { return this[parts].host !== null && this[parts].host !== "" && this[parts].scheme !== "file:"; }

  get host() {
    const record = this[parts];
    if (record.host === null) return "";
    return record.host + (record.port ? ":" + record.port : "");
  }
  set host(value) {
    if (this[parts].opaque !== null) return;
    try {
      const next = parse(this[parts].scheme + "//" + String(value).split(/[/?#\\]/)[0], null);
      this[parts].host = next.host;
      if (/:/.test(String(value).replace(/^\[[^\]]*\]/, ""))) this[parts].port = next.port;
    } catch {}
  }
  get hostname() { return this[parts].host ?? ""; }
  set hostname(value) {
    if (this[parts].opaque !== null) return;
    try {
      this[parts].host = parse(this[parts].scheme + "//" + String(value).split(/[/?#:\\]/)[0], null).host;
    } catch {}
  }
  get port() { return this[parts].port; }
  set port(value) {
    const record = this[parts];
    if (record.host === null || record.host === "" || record.scheme === "file:") return;
    const text = String(value);
    if (text === "") { record.port = ""; return; }
    const digits = /^\d+/.exec(text)?.[0];
    if (digits === undefined || Number(digits) > 65535) return;
    record.port = SPECIAL[record.scheme] === String(Number(digits)) ? "" : String(Number(digits));
  }

  get pathname() { return pathOf(this[parts]); }
  set pathname(value) {
    const record = this[parts];
    if (record.opaque !== null) return;
    const special = isSpecial(record.scheme);
    let text = String(value);
    if (text.startsWith("/") || (special && text.startsWith("\\"))) text = text.slice(1);
    record.path = [];
    pushPath(record.path, text, special);
  }

  get search() {
    const query = this[parts].query;
    return query === null || query === "" ? "" : "?" + query;
  }
  set search(value) {
    let text = String(value);
    if (text === "") { this.#query(null); return; }
    if (text.startsWith("?")) text = text.slice(1);
    this.#query(encode(text, isSpecial(this[parts].scheme) ? SPECIAL_QUERY : QUERY));
  }

  get hash() {
    const fragment = this[parts].fragment;
    return fragment === null || fragment === "" ? "" : "#" + fragment;
  }
  set hash(value) {
    let text = String(value);
    if (text === "") { this[parts].fragment = null; return; }
    if (text.startsWith("#")) text = text.slice(1);
    this[parts].fragment = encode(text, FRAGMENT);
  }

  toString() { return this.href; }
  toJSON() { return this.href; }
  get [Symbol.toStringTag]() { return "URL"; }
}
