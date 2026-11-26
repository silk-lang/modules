// `location` and `history` for an app in one window: a session history of entries in memory,
// as a page's is. There is no page to load, so a navigation to another address of the app
// changes the entry and sends `popstate`, the event routers follow.

import { URL as AppURL } from "./url.js";

export class PopStateEvent extends (globalThis.Event ?? class {}) {
  constructor(type, init = {}) {
    super(type, init);
    Object.defineProperty(this, "state", { value: init.state ?? null, enumerable: true });
  }
}

export class HashChangeEvent extends (globalThis.Event ?? class {}) {
  constructor(type, init = {}) {
    super(type, init);
    Object.defineProperty(this, "oldURL", { value: init.oldURL ?? "", enumerable: true });
    Object.defineProperty(this, "newURL", { value: init.newURL ?? "", enumerable: true });
  }
}

const URL = globalThis.URL ?? AppURL;

const url = Symbol("url");
const historyOf = Symbol("history");

export class Location {
  constructor(href, document) {
    this[url] = new URL(href);
    this[historyOf] = null;
    void document;
  }

  get href() { return this[url].href; }
  set href(value) { this.assign(value); }
  get origin() { return this[url].origin; }
  get protocol() { return this[url].protocol; }
  set protocol(value) { this.#with("protocol", value); }
  get host() { return this[url].host; }
  set host(value) { this.#with("host", value); }
  get hostname() { return this[url].hostname; }
  set hostname(value) { this.#with("hostname", value); }
  get port() { return this[url].port; }
  set port(value) { this.#with("port", value); }
  get pathname() { return this[url].pathname; }
  set pathname(value) { this.#with("pathname", value); }
  get search() { return this[url].search; }
  set search(value) { this.#with("search", value); }
  get hash() { return this[url].hash; }
  set hash(value) { this.#with("hash", value); }
  get ancestorOrigins() { return []; }

  #with(part, value) {
    const next = new URL(this[url].href);
    next[part] = value;
    this.assign(next.href);
  }

  assign(value) {
    this[historyOf]._navigate(new URL(String(value), this[url]), false);
  }

  replace(value) {
    this[historyOf]._navigate(new URL(String(value), this[url]), true);
  }

  reload() {
    console.warn("location.reload: a Silk UI window has no page to load again");
  }

  toString() { return this.href; }
  valueOf() { return this; }
}

export class History {
  #location;
  #window;
  #entries;
  #index = 0;
  // `navigation` hears every change of the current entry (see Navigation).
  _changed = null;

  constructor(location, windowTarget) {
    this.#location = location;
    this.#window = windowTarget;
    this.#entries = [{ url: location[url], state: null }];
    location[historyOf] = this;
  }

  get length() { return this.#entries.length; }
  get state() { return this.#entries[this.#index].state; }
  get scrollRestoration() { return "manual"; }
  set scrollRestoration(_) {}

  pushState(state, _title, address) {
    this.#add(state, address, false);
  }

  replaceState(state, _title, address) {
    this.#add(state, address, true);
  }

  back() { this.go(-1); }
  forward() { this.go(1); }

  go(delta = 0) {
    const index = this.#index + (Number(delta) | 0);
    if (delta === 0 || index < 0 || index >= this.#entries.length) return;
    const old = this.#location[url];
    this.#index = index;
    const entry = this.#entries[index];
    this.#location[url] = entry.url;
    this._changed?.("traverse", old);
    // As in a browser, the traversal's events come in a later task.
    setTimeout(() => this.#traversed(old, entry), 0);
  }

  #traversed(old, entry) {
    this.#window.dispatchEvent(new PopStateEvent("popstate", { state: entry.state }));
    if (old.hash !== entry.url.hash && sameDocument(old, entry.url)) this.#hashChanged(old, entry.url);
  }

  #hashChanged(old, next) {
    this.#window.dispatchEvent(new HashChangeEvent("hashchange", { oldURL: old.href, newURL: next.href }));
  }

  #add(state, address, replace) {
    const current = this.#location[url];
    const next = address == null ? current : new URL(String(address), current);
    if (next.origin !== current.origin) {
      throw new (globalThis.DOMException ?? Error)("a history entry must have the window's origin, not " + next.origin, "SecurityError");
    }
    const entry = { url: next, state: state === undefined ? null : structuredCopy(state) };
    if (replace) this.#entries[this.#index] = entry;
    else {
      this.#entries.length = this.#index + 1;
      this.#entries.push(entry);
      this.#index++;
    }
    this.#location[url] = next;
    this._changed?.(replace ? "replace" : "push", current);
  }

  get _entries() { return this.#entries; }
  get _index() { return this.#index; }

  // A navigation by `location`: a new hash only scrolls in a browser, which sends `hashchange`;
  // another address of the app becomes the entry, with `popstate` for the router.
  _navigate(next, replace) {
    const old = this.#location[url];
    if (next.origin !== old.origin) {
      globalThis.open?.(next.href);
      return;
    }
    if (next.href === old.href) return;
    this.#add(null, next.href, replace);
    if (sameDocument(old, next) && old.hash !== next.hash) {
      setTimeout(() => this.#hashChanged(old, next), 0);
    } else {
      setTimeout(() => this.#window.dispatchEvent(new PopStateEvent("popstate", { state: null })), 0);
    }
  }
}

function sameDocument(a, b) {
  return a.origin === b.origin && a.pathname === b.pathname && a.search === b.search;
}

function structuredCopy(value) {
  try {
    return typeof structuredClone === "function" ? structuredClone(value) : value;
  } catch {
    return value;
  }
}

// The Navigation API over the same session history: entries, canGoBack/canGoForward and
// `currententrychange` for every change, `navigate` before a navigation it starts.
export class NavigateEvent extends (globalThis.Event ?? class {}) {
  constructor(type, init = {}) {
    super(type, { cancelable: true, ...init });
    for (const name of ["navigationType", "destination", "canIntercept", "userInitiated", "hashChange", "signal", "formData", "downloadRequest", "info", "hasUAVisualTransition", "sourceElement"]) {
      Object.defineProperty(this, name, { value: init[name] ?? null, enumerable: true });
    }
  }
  intercept(options) { this._handler = options?.handler; }
  scroll() {}
}

export class NavigationCurrentEntryChangeEvent extends (globalThis.Event ?? class {}) {
  constructor(type, init = {}) {
    super(type, init);
    Object.defineProperty(this, "navigationType", { value: init.navigationType ?? null, enumerable: true });
    Object.defineProperty(this, "from", { value: init.from ?? null, enumerable: true });
  }
}

const EventTargetBase = globalThis.EventTarget ?? class {};
let nextKey = 0;

export class NavigationHistoryEntry extends EventTargetBase {
  #entry;
  #history;
  constructor(entry, history) {
    super();
    this.#entry = entry;
    this.#history = history;
    this.key = String(++nextKey);
    this.id = this.key;
    this.ondispose = null;
  }
  get url() { return this.#entry.url.href; }
  get index() { return this.#history._entries.indexOf(this.#entry); }
  get sameDocument() { return true; }
  getState() { return this.#entry.navigationState; }
}

export class Navigation extends EventTargetBase {
  #history;
  #location;
  #views = new WeakMap();
  oncurrententrychange = null;
  onnavigate = null;
  onnavigatesuccess = null;
  onnavigateerror = null;

  constructor(history, location) {
    super();
    this.#history = history;
    this.#location = location;
    history._changed = (navigationType) => this.#changed(navigationType);
    this.#from = this.currentEntry;
  }

  #view(entry) {
    let view = this.#views.get(entry);
    if (!view) this.#views.set(entry, (view = new NavigationHistoryEntry(entry, this.#history)));
    return view;
  }

  #fire(event) {
    const handler = this["on" + event.type];
    if (typeof handler === "function") handler.call(this, event);
    return this.dispatchEvent?.(event) ?? true;
  }

  #from = null;
  #changed(navigationType) {
    const from = this.#from;
    this.#from = this.currentEntry;
    this.#fire(new NavigationCurrentEntryChangeEvent("currententrychange", { navigationType, from }));
  }

  get currentEntry() {
    const entry = this.#history._entries[this.#history._index];
    return this.#view(entry);
  }
  entries() { return this.#history._entries.map((entry) => this.#view(entry)); }
  get canGoBack() { return this.#history._index > 0; }
  get canGoForward() { return this.#history._index < this.#history._entries.length - 1; }
  get transition() { return null; }
  get activation() { return null; }

  updateCurrentEntry({ state } = {}) {
    this.#history._entries[this.#history._index].navigationState = state;
  }

  // Runs a navigation: `navigate` first (a listener may cancel it), then the change.
  #run(navigationType, destinationUrl, info, change) {
    const destination = { url: destinationUrl, key: null, id: null, index: -1, sameDocument: true, getState: () => undefined };
    const event = new NavigateEvent("navigate", { navigationType, destination, canIntercept: true, userInitiated: false, info, hashChange: false });
    if (!this.#fire(event)) {
      const error = new (globalThis.DOMException ?? Error)("the navigation was cancelled", "AbortError");
      const failed = Promise.reject(error);
      failed.catch(() => {});
      return { committed: failed, finished: failed };
    }
    change();
    const entry = this.currentEntry;
    const finished = Promise.resolve(event._handler?.()).then(() => {
      this.#fire(new (globalThis.Event ?? class {})("navigatesuccess"));
      return entry;
    });
    return { committed: Promise.resolve(entry), finished };
  }

  navigate(address, options = {}) {
    const target = new URL(String(address), this.#location.href).href;
    const replace = options.history === "replace";
    return this.#run(replace ? "replace" : "push", target, options.info, () => {
      if (replace) this.#location.replace(target);
      else this.#location.assign(target);
      if ("state" in options) this.updateCurrentEntry({ state: options.state });
    });
  }

  reload(options = {}) {
    return this.#run("reload", this.#location.href, options.info, () => {
      if ("state" in options) this.updateCurrentEntry({ state: options.state });
    });
  }

  traverseTo(key, options = {}) {
    const index = this.entries().findIndex((entry) => entry.key === key);
    if (index < 0) {
      const error = new (globalThis.DOMException ?? Error)("no entry has the key " + key, "InvalidStateError");
      const failed = Promise.reject(error);
      failed.catch(() => {});
      return { committed: failed, finished: failed };
    }
    const entry = this.#history._entries[index];
    return this.#run("traverse", entry.url.href, options.info, () => this.#history.go(index - this.#history._index));
  }

  back(options) {
    if (!this.canGoBack) return this.traverseTo("", options);
    return this.traverseTo(this.entries()[this.#history._index - 1].key, options);
  }

  forward(options) {
    if (!this.canGoForward) return this.traverseTo("", options);
    return this.traverseTo(this.entries()[this.#history._index + 1].key, options);
  }
}
