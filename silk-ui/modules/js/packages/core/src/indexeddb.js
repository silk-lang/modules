// IndexedDB over memory, for apps that keep caches and keys in it: databases, versions and
// upgrades, object stores with key paths and generators, indexes (compound and multiEntry),
// key ranges, cursors, and transactions that commit once their requests are done or undo
// their writes on abort. On the full runtime a database is saved to a file (with `node:v8`
// serialization) after each transaction that wrote; values that cannot be serialized keep
// the database in memory only. Requests run in microtasks, so promise code between requests
// keeps a transaction alive as browsers do.

import { storageDirectory } from "./storage.js";

const DOMError = (name, message) => {
  const DOMExceptionClass = globalThis.DOMException;
  if (typeof DOMExceptionClass === "function") return new DOMExceptionClass(message, name);
  const error = new Error(message);
  error.name = name;
  return error;
};

// Keys, as the spec orders them: numbers, then dates, strings, binary and arrays.
function keyType(key) {
  if (typeof key === "number") return Number.isNaN(key) ? null : 1;
  if (key instanceof Date) return Number.isNaN(key.getTime()) ? null : 2;
  if (typeof key === "string") return 3;
  if (key instanceof ArrayBuffer || ArrayBuffer.isView(key)) return 4;
  if (Array.isArray(key)) return 5;
  return null;
}

function validKey(key) {
  const type = keyType(key);
  if (type === null) return false;
  if (type === 5) return key.every(validKey);
  return true;
}

function checkKey(key) {
  if (!validKey(key)) throw DOMError("DataError", "the value is not a valid key");
  return key;
}

function bytesOf(key) {
  return key instanceof ArrayBuffer ? new Uint8Array(key) : new Uint8Array(key.buffer, key.byteOffset, key.byteLength);
}

export function cmp(a, b) {
  const ta = keyType(a);
  const tb = keyType(b);
  if (ta !== tb) return ta < tb ? -1 : 1;
  switch (ta) {
    case 1: return a === b ? 0 : a < b ? -1 : 1;
    case 2: return cmp(a.getTime(), b.getTime());
    case 3: return a === b ? 0 : a < b ? -1 : 1;
    case 4: {
      const x = bytesOf(a);
      const y = bytesOf(b);
      for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
      return cmp(x.length, y.length);
    }
    case 5: {
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        const order = cmp(a[i], b[i]);
        if (order !== 0) return order;
      }
      return cmp(a.length, b.length);
    }
  }
  return 0;
}

function copyKey(key) {
  if (Array.isArray(key)) return key.map(copyKey);
  if (key instanceof Date) return new Date(key.getTime());
  if (key instanceof ArrayBuffer || ArrayBuffer.isView(key)) return bytesOf(key).slice().buffer;
  return key;
}

function clone(value) {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch (error) {
      throw DOMError("DataCloneError", String(error?.message ?? error));
    }
  }
  return value;
}

function valueAtPath(value, path) {
  if (Array.isArray(path)) {
    const keys = [];
    for (const part of path) {
      const key = valueAtPath(value, part);
      if (key === undefined) return undefined;
      keys.push(key);
    }
    return keys;
  }
  if (path === "") return value;
  let at = value;
  for (const part of path.split(".")) {
    if (at === null || at === undefined || typeof at !== "object" && typeof at !== "string") return undefined;
    if (typeof at === "string" && part === "length") at = at.length;
    else if (!(part in Object(at))) return undefined;
    else at = at[part];
  }
  return at;
}

function setAtPath(value, path, key) {
  const parts = path.split(".");
  let at = value;
  for (const part of parts.slice(0, -1)) {
    if (at[part] === undefined) at[part] = {};
    at = at[part];
  }
  at[parts[parts.length - 1]] = key;
}

export class IDBKeyRange {
  constructor(lower, upper, lowerOpen, upperOpen) {
    this.lower = lower;
    this.upper = upper;
    this.lowerOpen = !!lowerOpen;
    this.upperOpen = !!upperOpen;
  }
  static only(value) { checkKey(value); return new IDBKeyRange(value, value, false, false); }
  static lowerBound(lower, open) { checkKey(lower); return new IDBKeyRange(lower, undefined, open, true); }
  static upperBound(upper, open) { checkKey(upper); return new IDBKeyRange(undefined, upper, true, open); }
  static bound(lower, upper, lowerOpen, upperOpen) {
    checkKey(lower);
    checkKey(upper);
    if (cmp(lower, upper) > 0 || (cmp(lower, upper) === 0 && (lowerOpen || upperOpen))) throw DOMError("DataError", "the range's lower bound is above its upper bound");
    return new IDBKeyRange(lower, upper, lowerOpen, upperOpen);
  }
  includes(key) {
    checkKey(key);
    if (this.lower !== undefined) {
      const order = cmp(key, this.lower);
      if (order < 0 || (order === 0 && this.lowerOpen)) return false;
    }
    if (this.upper !== undefined) {
      const order = cmp(key, this.upper);
      if (order > 0 || (order === 0 && this.upperOpen)) return false;
    }
    return true;
  }
}

function rangeOf(query) {
  if (query === undefined || query === null) return null;
  if (query instanceof IDBKeyRange) return query;
  return IDBKeyRange.only(checkKey(query));
}

// A small event target: listeners, `on<type>` handlers, and the event's target fields.
class Target {
  #listeners = new Map();
  addEventListener(type, listener, options) {
    if (!listener) return;
    let list = this.#listeners.get(type);
    if (!list) this.#listeners.set(type, (list = []));
    if (!list.some((entry) => entry.listener === listener)) list.push({ listener, once: !!options?.once });
  }
  removeEventListener(type, listener) {
    const list = this.#listeners.get(type);
    const index = list?.findIndex((entry) => entry.listener === listener) ?? -1;
    if (index >= 0) list.splice(index, 1);
  }
  dispatchEvent(event) {
    event.target ??= this;
    event.currentTarget = this;
    for (const entry of (this.#listeners.get(event.type) ?? []).slice()) {
      if (entry.once) this.removeEventListener(event.type, entry.listener);
      call(entry.listener, this, event);
      if (event._stopped) break;
    }
    const handler = this["on" + event.type];
    if (typeof handler === "function" && !event._stopped) call(handler, this, event);
    return !event.defaultPrevented;
  }
}

function call(listener, self, event) {
  try {
    if (typeof listener === "function") listener.call(self, event);
    else listener.handleEvent(event);
  } catch (error) {
    event._threw = true;
    globalThis.reportError?.(error) ?? console.error(error);
  }
}

class IDBEvent {
  constructor(type, fields = {}) {
    this.type = type;
    this.target = null;
    this.currentTarget = null;
    this.defaultPrevented = false;
    this._stopped = false;
    this.bubbles = type === "error";
    this.cancelable = type === "error";
    this.timeStamp = Date.now();
    Object.assign(this, fields);
  }
  preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
  stopPropagation() { this._stopped = true; }
  stopImmediatePropagation() { this._stopped = true; }
}

export class IDBVersionChangeEvent extends IDBEvent {
  constructor(type, init = {}) {
    super(type, { oldVersion: init.oldVersion ?? 0, newVersion: init.newVersion ?? null });
  }
}

export class IDBRequest extends Target {
  constructor(source, transaction) {
    super();
    this.source = source;
    this.transaction = transaction;
    this.readyState = "pending";
    this.onsuccess = null;
    this.onerror = null;
    this._result = undefined;
    this._error = null;
  }
  get result() {
    if (this.readyState !== "done") throw DOMError("InvalidStateError", "the request is not done");
    return this._result;
  }
  get error() {
    if (this.readyState !== "done") throw DOMError("InvalidStateError", "the request is not done");
    return this._error;
  }
}

export class IDBOpenDBRequest extends IDBRequest {
  constructor() {
    super(null, null);
    this.onupgradeneeded = null;
    this.onblocked = null;
  }
}

function names(list) {
  const sorted = [...list].sort();
  return Object.assign(sorted, {
    contains: (name) => sorted.includes(name),
    item: (index) => sorted[index] ?? null,
  });
}

// Stored data. A store keeps its records sorted by key.
class StoreData {
  constructor(name, keyPath, autoIncrement) {
    this.name = name;
    this.keyPath = keyPath;
    this.autoIncrement = autoIncrement;
    this.current = 1;
    this.records = [];
    this.indexes = new Map();
  }
  find(key) {
    let low = 0;
    let high = this.records.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (cmp(this.records[middle].key, key) < 0) low = middle + 1;
      else high = middle;
    }
    return low;
  }
  get(key) {
    const at = this.find(key);
    const record = this.records[at];
    return record && cmp(record.key, key) === 0 ? record : null;
  }
  inRange(range) {
    if (!range) return this.records;
    return this.records.filter((record) => range.includes(record.key));
  }
}

class DatabaseData {
  constructor(name) {
    this.name = name;
    this.version = 0;
    this.stores = new Map();
    this.connections = new Set();
  }
}

const databases = new Map();
let loaded = false;

// Saving to files, on a runtime with node:fs and node:v8.
const fs = globalThis.process?.getBuiltinModule?.("node:fs");
const v8 = globalThis.process?.getBuiltinModule?.("node:v8");
const directory = fs && v8 ? storageDirectory()?.concat("/indexeddb") : null;

function fileOf(name) {
  return directory + "/" + encodeURIComponent(name) + ".idb";
}

function loadAll() {
  if (loaded) return;
  loaded = true;
  if (!directory) return;
  let entries = [];
  try {
    entries = fs.readdirSync(directory).filter((entry) => entry.endsWith(".idb"));
  } catch {
    return;
  }
  for (const entry of entries) {
    try {
      const saved = v8.deserialize(fs.readFileSync(directory + "/" + entry));
      const data = new DatabaseData(saved.name);
      data.version = saved.version;
      for (const store of saved.stores) {
        const storeData = new StoreData(store.name, store.keyPath, store.autoIncrement);
        storeData.current = store.current;
        storeData.records = store.records;
        for (const index of store.indexes) storeData.indexes.set(index.name, index);
        data.stores.set(store.name, storeData);
      }
      databases.set(data.name, data);
    } catch (error) {
      console.warn("indexedDB: could not read " + entry + ": " + error.message);
    }
  }
}

const unsaveable = new Set();
function save(data) {
  if (!directory) return;
  try {
    const bytes = v8.serialize({
      name: data.name,
      version: data.version,
      stores: [...data.stores.values()].map((store) => ({
        name: store.name,
        keyPath: store.keyPath,
        autoIncrement: store.autoIncrement,
        current: store.current,
        records: store.records,
        indexes: [...store.indexes.values()],
      })),
    });
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(fileOf(data.name) + ".tmp", bytes);
    fs.renameSync(fileOf(data.name) + ".tmp", fileOf(data.name));
    unsaveable.delete(data.name);
  } catch (error) {
    if (!unsaveable.has(data.name)) console.warn("indexedDB: '" + data.name + "' stays in memory: " + error.message);
    unsaveable.add(data.name);
  }
}

function remove(name) {
  if (!directory) return;
  try {
    fs.rmSync(fileOf(name), { force: true });
  } catch {}
}

export class IDBDatabase extends Target {
  constructor(data) {
    super();
    this._data = data;
    this._closed = false;
    this._upgrade = null;
    this.onabort = null;
    this.onclose = null;
    this.onerror = null;
    this.onversionchange = null;
  }
  get name() { return this._data.name; }
  get version() { return this._data.version; }
  get objectStoreNames() { return names(this._data.stores.keys()); }

  transaction(storeNames, mode = "readonly") {
    if (this._closed) throw DOMError("InvalidStateError", "the database connection is closed");
    if (this._upgrade?._active) throw DOMError("InvalidStateError", "a version change transaction is running");
    const list = typeof storeNames === "string" ? [storeNames] : [...storeNames];
    if (list.length === 0) throw DOMError("InvalidAccessError", "a transaction needs a store");
    for (const name of list) if (!this._data.stores.has(name)) throw DOMError("NotFoundError", "no object store named '" + name + "'");
    if (mode !== "readonly" && mode !== "readwrite") throw new TypeError("a transaction's mode is readonly or readwrite");
    return new IDBTransaction(this, list, mode);
  }

  createObjectStore(name, options = {}) {
    const upgrade = this._needsUpgrade();
    name = String(name);
    if (this._data.stores.has(name)) throw DOMError("ConstraintError", "an object store named '" + name + "' exists");
    const keyPath = options.keyPath ?? null;
    const autoIncrement = !!options.autoIncrement;
    if (autoIncrement && (keyPath === "" || Array.isArray(keyPath))) throw DOMError("InvalidAccessError", "a key generator needs a key path of one name");
    const store = new StoreData(name, keyPath, autoIncrement);
    this._data.stores.set(name, store);
    upgrade._undo.push(() => this._data.stores.delete(name));
    upgrade._names.push(name);
    return upgrade.objectStore(name);
  }

  deleteObjectStore(name) {
    const upgrade = this._needsUpgrade();
    const store = this._data.stores.get(name);
    if (!store) throw DOMError("NotFoundError", "no object store named '" + name + "'");
    this._data.stores.delete(name);
    upgrade._undo.push(() => this._data.stores.set(name, store));
  }

  _needsUpgrade() {
    if (!this._upgrade?._active) throw DOMError("InvalidStateError", "object stores change only in a version change transaction");
    return this._upgrade;
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    this._data.connections.delete(this);
  }
}

export class IDBTransaction extends Target {
  constructor(db, storeNames, mode) {
    super();
    this.db = db;
    this.mode = mode;
    this.durability = "default";
    this.error = null;
    this.oncomplete = null;
    this.onerror = null;
    this.onabort = null;
    this._names = storeNames;
    this._requests = [];
    this._undo = [];
    this._active = true;
    this._finished = false;
    this._wrote = false;
    this._running = false;
    this._stores = new Map();
    schedule(this);
  }
  get objectStoreNames() { return names(this._names); }

  objectStore(name) {
    if (this._finished) throw DOMError("InvalidStateError", "the transaction has finished");
    if (!this._names.includes(name)) throw DOMError("NotFoundError", "the transaction does not cover '" + name + "'");
    let store = this._stores.get(name);
    if (!store) this._stores.set(name, (store = new IDBObjectStore(this, this.db._data.stores.get(name))));
    return store;
  }

  abort() {
    if (this._finished) throw DOMError("InvalidStateError", "the transaction has finished");
    this._abort(DOMError("AbortError", "the transaction was aborted"), true);
  }

  commit() {
    if (this._finished) throw DOMError("InvalidStateError", "the transaction has finished");
    this._commitAsked = true;
  }

  _request(source, operation) {
    if (this._finished || !this._active) throw DOMError("TransactionInactiveError", "the transaction is not active");
    const request = new IDBRequest(source, this);
    this._requests.push({ request, operation });
    schedule(this);
    return request;
  }

  _write(undo) {
    if (this.mode === "readonly") throw DOMError("ReadOnlyError", "the transaction is read only");
    this._wrote = true;
    this._undo.push(undo);
  }

  _abort(error, explicit) {
    if (this._finished) return;
    this._finished = true;
    this._active = false;
    this.error = explicit ? null : error;
    for (let i = this._undo.length - 1; i >= 0; i--) this._undo[i]();
    this._undo = [];
    for (const { request } of this._requests.splice(0)) {
      request.readyState = "done";
      request._error = DOMError("AbortError", "the transaction was aborted");
      request.dispatchEvent(new IDBEvent("error"));
    }
    queueMicrotask(() => {
      const event = new IDBEvent("abort", { target: this });
      this.dispatchEvent(event);
      this.db.dispatchEvent(Object.assign(new IDBEvent("abort"), { target: this }));
      this._done?.(false);
    });
  }

  _complete() {
    this._finished = true;
    this._active = false;
    if (this._wrote || this.mode === "versionchange") save(this.db._data);
    this.dispatchEvent(new IDBEvent("complete"));
    this._done?.(true);
  }
}

// A transaction runs its requests in order, in microtasks, and commits once a task passes
// with none left.
function schedule(transaction) {
  if (transaction._running) return;
  transaction._running = true;
  queueMicrotask(() => run(transaction));
}

function run(transaction) {
  transaction._running = false;
  while (transaction._requests.length && !transaction._finished) {
    const { request, operation } = transaction._requests.shift();
    let result;
    let error = null;
    try {
      result = operation();
    } catch (thrown) {
      error = thrown;
    }
    request.readyState = "done";
    if (error) {
      request._error = error;
      const event = new IDBEvent("error");
      request.dispatchEvent(event);
      if (!event._stopped) {
        event.currentTarget = null;
        transaction.dispatchEvent(event);
        if (!event._stopped) transaction.db.dispatchEvent(event);
      }
      if (!event.defaultPrevented || event._threw) transaction._abort(error, false);
    } else {
      request._result = result;
      const event = new IDBEvent("success");
      request.dispatchEvent(event);
      if (event._threw) transaction._abort(DOMError("AbortError", "a success listener threw"), false);
    }
  }
  if (transaction._finished) return;
  // Requests queued by promise code after this one keep the transaction going.
  setTimeout(() => {
    if (transaction._finished) return;
    if (transaction._requests.length) return run(transaction);
    transaction._complete();
  }, 0);
}

export class IDBObjectStore {
  constructor(transaction, data) {
    this.transaction = transaction;
    this._data = data;
  }
  get name() { return this._data.name; }
  get keyPath() { return this._data.keyPath; }
  get autoIncrement() { return this._data.autoIncrement; }
  get indexNames() { return names(this._data.indexes.keys()); }

  put(value, key) { return this._store(value, key, false); }
  add(value, key) { return this._store(value, key, true); }

  _store(value, key, add) {
    const store = this._data;
    const transaction = this.transaction;
    if (transaction.mode === "readonly") throw DOMError("ReadOnlyError", "the transaction is read only");
    if (store.keyPath !== null && key !== undefined) throw DOMError("DataError", "a store with a key path takes no key");
    if (store.keyPath === null && !store.autoIncrement && key === undefined) throw DOMError("DataError", "the store needs a key");
    const copy = clone(value);
    if (key !== undefined) checkKey(key);
    let inline = store.keyPath !== null ? valueAtPath(copy, store.keyPath) : undefined;
    if (store.keyPath !== null && inline !== undefined) checkKey(inline);
    if (store.keyPath !== null && inline === undefined && !store.autoIncrement) throw DOMError("DataError", "the value has no key at the store's key path");
    return transaction._request(this, () => {
      let primary = key ?? inline;
      if (primary === undefined) {
        primary = store.current++;
        if (store.keyPath !== null) setAtPath(copy, store.keyPath, primary);
        const current = store.current - 1;
        transaction._write(() => { if (store.current === current + 1) store.current = current; });
      } else if (store.autoIncrement && typeof primary === "number" && primary >= store.current) {
        const before = store.current;
        store.current = Math.floor(primary) + 1;
        transaction._write(() => { store.current = before; });
      }
      primary = copyKey(primary);
      const at = store.find(primary);
      const existing = store.records[at];
      const same = existing && cmp(existing.key, primary) === 0;
      if (same && add) throw DOMError("ConstraintError", "a record with the key exists");
      for (const index of store.indexes.values()) {
        if (!index.unique) continue;
        for (const indexKey of indexKeys(index, copy)) {
          const clash = store.records.find((record) => cmp(record.key, primary) !== 0 && indexKeys(index, record.value).some((other) => cmp(other, indexKey) === 0));
          if (clash) throw DOMError("ConstraintError", "the index '" + index.name + "' is unique");
        }
      }
      const record = { key: primary, value: copy };
      if (same) {
        store.records[at] = record;
        transaction._write(() => { store.records[store.find(primary)] = existing; });
      } else {
        store.records.splice(at, 0, record);
        transaction._write(() => store.records.splice(store.find(primary), 1));
      }
      return copyKey(primary);
    });
  }

  delete(query) {
    const store = this._data;
    const transaction = this.transaction;
    if (transaction.mode === "readonly") throw DOMError("ReadOnlyError", "the transaction is read only");
    const range = rangeOf(query);
    return transaction._request(this, () => {
      const kept = [];
      const removed = [];
      for (const record of store.records) (range.includes(record.key) ? removed : kept).push(record);
      if (removed.length) {
        const before = store.records;
        store.records = kept;
        transaction._write(() => { store.records = before; });
      }
      return undefined;
    });
  }

  clear() {
    const store = this._data;
    const transaction = this.transaction;
    if (transaction.mode === "readonly") throw DOMError("ReadOnlyError", "the transaction is read only");
    return transaction._request(this, () => {
      const before = store.records;
      store.records = [];
      transaction._write(() => { store.records = before; });
      return undefined;
    });
  }

  get(query) {
    const range = rangeOf(query);
    return this.transaction._request(this, () => {
      const record = this._data.inRange(range)[0];
      return record ? clone(record.value) : undefined;
    });
  }

  getKey(query) {
    const range = rangeOf(query);
    return this.transaction._request(this, () => copyKey(this._data.inRange(range)[0]?.key));
  }

  getAll(query, count) {
    const range = rangeOf(query);
    return this.transaction._request(this, () => limit(this._data.inRange(range), count).map((record) => clone(record.value)));
  }

  getAllKeys(query, count) {
    const range = rangeOf(query);
    return this.transaction._request(this, () => limit(this._data.inRange(range), count).map((record) => copyKey(record.key)));
  }

  count(query) {
    const range = rangeOf(query);
    return this.transaction._request(this, () => this._data.inRange(range).length);
  }

  openCursor(query, direction = "next") {
    return openCursor(this, () => this._data.inRange(rangeOf(query)).map((record) => ({ key: record.key, primaryKey: record.key, record })), direction, true);
  }

  openKeyCursor(query, direction = "next") {
    return openCursor(this, () => this._data.inRange(rangeOf(query)).map((record) => ({ key: record.key, primaryKey: record.key, record })), direction, false);
  }

  index(name) {
    const index = this._data.indexes.get(name);
    if (!index) throw DOMError("NotFoundError", "no index named '" + name + "'");
    return new IDBIndex(this, index);
  }

  createIndex(name, keyPath, options = {}) {
    const upgrade = this.transaction.db._needsUpgrade();
    if (this._data.indexes.has(name)) throw DOMError("ConstraintError", "an index named '" + name + "' exists");
    const index = { name: String(name), keyPath, unique: !!options.unique, multiEntry: !!options.multiEntry };
    this._data.indexes.set(index.name, index);
    upgrade._undo.push(() => this._data.indexes.delete(index.name));
    return new IDBIndex(this, index);
  }

  deleteIndex(name) {
    const upgrade = this.transaction.db._needsUpgrade();
    const index = this._data.indexes.get(name);
    if (!index) throw DOMError("NotFoundError", "no index named '" + name + "'");
    this._data.indexes.delete(name);
    upgrade._undo.push(() => this._data.indexes.set(name, index));
  }
}

function limit(records, count) {
  return count === undefined || count === 0 ? records : records.slice(0, count >>> 0);
}

function indexKeys(index, value) {
  const key = valueAtPath(value, index.keyPath);
  if (key === undefined) return [];
  if (index.multiEntry && Array.isArray(key)) {
    const keys = [];
    for (const each of key) if (validKey(each) && !keys.some((other) => cmp(other, each) === 0)) keys.push(each);
    return keys;
  }
  return validKey(key) ? [key] : [];
}

export class IDBIndex {
  constructor(store, data) {
    this.objectStore = store;
    this._data = data;
  }
  get name() { return this._data.name; }
  get keyPath() { return this._data.keyPath; }
  get unique() { return this._data.unique; }
  get multiEntry() { return this._data.multiEntry; }

  _entries(query) {
    const range = rangeOf(query);
    const entries = [];
    for (const record of this.objectStore._data.records) {
      for (const key of indexKeys(this._data, record.value)) {
        if (!range || range.includes(key)) entries.push({ key, primaryKey: record.key, record });
      }
    }
    return entries.sort((a, b) => cmp(a.key, b.key) || cmp(a.primaryKey, b.primaryKey));
  }

  get(query) {
    return this.objectStore.transaction._request(this, () => {
      const entry = this._entries(query)[0];
      return entry ? clone(entry.record.value) : undefined;
    });
  }
  getKey(query) {
    return this.objectStore.transaction._request(this, () => copyKey(this._entries(query)[0]?.primaryKey));
  }
  getAll(query, count) {
    return this.objectStore.transaction._request(this, () => limit(this._entries(query), count).map((entry) => clone(entry.record.value)));
  }
  getAllKeys(query, count) {
    return this.objectStore.transaction._request(this, () => limit(this._entries(query), count).map((entry) => copyKey(entry.primaryKey)));
  }
  count(query) {
    return this.objectStore.transaction._request(this, () => this._entries(query).length);
  }
  openCursor(query, direction = "next") {
    return openCursor(this, () => this._entries(query), direction, true);
  }
  openKeyCursor(query, direction = "next") {
    return openCursor(this, () => this._entries(query), direction, false);
  }
}

export class IDBCursor {
  constructor(source, request, entries, direction) {
    this.source = source;
    this.request = request;
    this.direction = direction;
    this._entries = entries;
    this._at = -1;
    this._entry = null;
  }
  get key() { return copyKey(this._entry?.key); }
  get primaryKey() { return copyKey(this._entry?.primaryKey); }

  _store() {
    return this.source instanceof IDBIndex ? this.source.objectStore : this.source;
  }

  _advance(count, until) {
    const transaction = this._store().transaction;
    const request = this.request;
    request.readyState = "pending";
    transaction._requests.push({
      request,
      operation: () => {
        let left = count;
        while (++this._at < this._entries.length) {
          const entry = this._entries[this._at];
          // A record deleted since the cursor opened is skipped.
          if (!this._store()._data.get(entry.primaryKey)) continue;
          if (until !== undefined && cmp(entry.key, until) * (this.direction.startsWith("prev") ? -1 : 1) < 0) continue;
          if (--left > 0) continue;
          this._entry = entry;
          return this;
        }
        this._entry = null;
        return null;
      },
    });
    schedule(transaction);
  }

  continue(key) {
    if (key !== undefined) checkKey(key);
    this._advance(1, key);
  }
  advance(count) {
    if (!(count > 0)) throw new TypeError("advance takes a count above 0");
    this._advance(count >>> 0);
  }
  continuePrimaryKey(key, primaryKey) {
    checkKey(key);
    checkKey(primaryKey);
    const transaction = this._store().transaction;
    this.request.readyState = "pending";
    transaction._requests.push({
      request: this.request,
      operation: () => {
        while (++this._at < this._entries.length) {
          const entry = this._entries[this._at];
          const order = cmp(entry.key, key) || cmp(entry.primaryKey, primaryKey);
          if ((this.direction.startsWith("prev") ? -order : order) < 0) continue;
          this._entry = entry;
          return this;
        }
        this._entry = null;
        return null;
      },
    });
    schedule(transaction);
  }
  update(value) {
    const store = this._store();
    if (store.keyPath !== null) return store.put(value);
    return store.put(value, this._entry.primaryKey);
  }
  delete() {
    return this._store().delete(this._entry.primaryKey);
  }
}

export class IDBCursorWithValue extends IDBCursor {
  get value() {
    return this._entry ? clone(this._entry.record.value) : undefined;
  }
}

function openCursor(source, list, direction, withValue) {
  const store = source instanceof IDBIndex ? source.objectStore : source;
  const transaction = store.transaction;
  const request = transaction._request(source, () => {
    let entries = list();
    if (direction.startsWith("prev")) entries = entries.reverse();
    if (direction.endsWith("unique")) entries = entries.filter((entry, i) => i === 0 || cmp(entry.key, entries[i - 1].key) !== 0);
    cursor._entries = entries;
    cursor._at = -1;
    return cursor._step();
  });
  const cursor = new (withValue ? IDBCursorWithValue : IDBCursor)(source, request, [], direction);
  cursor._step = () => {
    while (++cursor._at < cursor._entries.length) {
      const entry = cursor._entries[cursor._at];
      if (!store._data.get(entry.primaryKey)) continue;
      cursor._entry = entry;
      return cursor;
    }
    cursor._entry = null;
    return null;
  };
  return request;
}

export class IDBFactory {
  open(name, version) {
    if (version !== undefined && (!Number.isInteger(Number(version)) || Number(version) < 1)) throw new TypeError("a database version is a whole number above 0");
    name = String(name);
    const request = new IDBOpenDBRequest();
    setTimeout(() => openDatabase(request, name, version === undefined ? undefined : Number(version)), 0);
    return request;
  }

  deleteDatabase(name) {
    name = String(name);
    const request = new IDBOpenDBRequest();
    setTimeout(() => {
      loadAll();
      const data = databases.get(name);
      const oldVersion = data?.version ?? 0;
      if (data) for (const connection of [...data.connections]) connection.dispatchEvent(new IDBVersionChangeEvent("versionchange", { oldVersion, newVersion: null }));
      databases.delete(name);
      remove(name);
      request.readyState = "done";
      request._result = undefined;
      request.dispatchEvent(new IDBVersionChangeEvent("success", { oldVersion, newVersion: null }));
    }, 0);
    return request;
  }

  databases() {
    loadAll();
    return Promise.resolve([...databases.values()].map((data) => ({ name: data.name, version: data.version })));
  }

  cmp(a, b) {
    return cmp(checkKey(a), checkKey(b));
  }
}

function openDatabase(request, name, version) {
  loadAll();
  let data = databases.get(name);
  if (!data) databases.set(name, (data = new DatabaseData(name)));
  const oldVersion = data.version;
  const newVersion = version ?? (oldVersion || 1);
  if (newVersion < oldVersion) {
    request.readyState = "done";
    request._error = DOMError("VersionError", "the database is at version " + oldVersion);
    request.dispatchEvent(new IDBEvent("error"));
    return;
  }
  const db = new IDBDatabase(data);
  const succeed = () => {
    data.connections.add(db);
    request.readyState = "done";
    request._result = db;
    request.transaction = null;
    request.dispatchEvent(new IDBEvent("success"));
  };
  if (newVersion === oldVersion) return succeed();
  for (const connection of [...data.connections]) {
    connection.dispatchEvent(new IDBVersionChangeEvent("versionchange", { oldVersion, newVersion }));
  }
  const upgrade = new IDBTransaction(db, [...data.stores.keys()], "versionchange");
  db._upgrade = upgrade;
  data.version = newVersion;
  upgrade._undo.push(() => { data.version = oldVersion; });
  request.readyState = "done";
  request._result = db;
  request.transaction = upgrade;
  upgrade._done = (committed) => {
    db._upgrade = null;
    request.transaction = null;
    if (committed) succeed();
    else {
      if (oldVersion === 0 && data.stores.size === 0) databases.delete(name);
      request._result = undefined;
      request._error = DOMError("AbortError", "the version change transaction was aborted");
      request.dispatchEvent(new IDBEvent("error"));
    }
  };
  const event = new IDBVersionChangeEvent("upgradeneeded", { oldVersion, newVersion });
  request.dispatchEvent(event);
  if (event._threw) upgrade._abort(DOMError("AbortError", "an upgradeneeded listener threw"), false);
}

export function indexedDBModule() {
  return {
    indexedDB: new IDBFactory(),
    IDBFactory,
    IDBDatabase,
    IDBTransaction,
    IDBObjectStore,
    IDBIndex,
    IDBRequest,
    IDBOpenDBRequest,
    IDBKeyRange,
    IDBCursor,
    IDBCursorWithValue,
    IDBVersionChangeEvent,
  };
}
