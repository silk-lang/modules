// `localStorage` and `sessionStorage`, as the Web Storage spec has them. Session storage lasts
// as long as the realm. Local storage is kept in a JSON file when the runtime has `node:fs`
// (the full SilkJS runtime), else it lasts as long as the realm too.
//
// The file is `$SILKUI_STORAGE_DIR/localStorage.json`, or `globalThis.__silkStorageDir` set
// before the globals load, else `~/.silkui/storage/<app>/localStorage.json` named by the
// program.

const areas = new WeakMap();
const items = Symbol("items");

export class Storage {
  constructor(key, area) {
    if (key !== items) throw new TypeError("Illegal constructor");
    areas.set(this, area);
  }

  get [items]() {
    return areas.get(this);
  }

  get length() {
    return this[items].map.size;
  }

  key(index) {
    return [...this[items].map.keys()][index >>> 0] ?? null;
  }

  getItem(key) {
    return this[items].map.get(String(key)) ?? null;
  }

  setItem(key, value) {
    const area = this[items];
    key = String(key);
    value = String(value);
    if (area.map.get(key) === value) return;
    area.map.set(key, value);
    area.changed();
  }

  removeItem(key) {
    const area = this[items];
    if (area.map.delete(String(key))) area.changed();
  }

  clear() {
    const area = this[items];
    if (area.map.size === 0) return;
    area.map.clear();
    area.changed();
  }
}

// `storage.foo` and `storage.foo = "1"` are items, as in a browser.
const traps = {
  get(target, key, receiver) {
    if (typeof key === "symbol" || key in target) return Reflect.get(target, key, receiver);
    return target[items].map.get(key) ?? undefined;
  },
  set(target, key, value) {
    if (typeof key === "symbol" || key in target) return Reflect.set(target, key, value);
    target.setItem(key, value);
    return true;
  },
  has(target, key) {
    return typeof key === "string" && target[items].map.has(key) ? true : key in target;
  },
  deleteProperty(target, key) {
    if (typeof key === "string" && target[items].map.has(key)) target.removeItem(key);
    return true;
  },
  ownKeys(target) {
    return [...target[items].map.keys()];
  },
  getOwnPropertyDescriptor(target, key) {
    if (typeof key !== "string" || !target[items].map.has(key)) return undefined;
    return { value: target[items].map.get(key), writable: true, enumerable: true, configurable: true };
  },
};

function storage(area) {
  const proxy = new Proxy(new Storage(items, area), traps);
  areas.set(proxy, area);
  return proxy;
}

export function sessionStorageArea() {
  return storage({ map: new Map(), changed() {} });
}

export function localStorageArea() {
  const file = storageFile();
  const fs = file && globalThis.process?.getBuiltinModule?.("node:fs");
  const map = new Map();
  if (fs) {
    try {
      const saved = JSON.parse(fs.readFileSync(file, "utf8"));
      for (const key of Object.keys(saved)) map.set(key, String(saved[key]));
    } catch {}
  }
  let pending = false;
  const write = () => {
    pending = false;
    try {
      fs.mkdirSync(dirname(file), { recursive: true });
      const temporary = file + ".tmp";
      fs.writeFileSync(temporary, JSON.stringify(Object.fromEntries(map)));
      fs.renameSync(temporary, file);
    } catch (error) {
      console.warn("localStorage could not be saved: " + error.message);
    }
  };
  if (fs) globalThis.process?.on?.("exit", () => pending && write());
  return storage({
    map,
    // Writes are joined into one per task.
    changed() {
      if (!fs || pending) return;
      pending = true;
      setTimeout(write, 0);
    },
  });
}

function dirname(path) {
  const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return at > 0 ? path.slice(0, at) : ".";
}

export function storageDirectory() {
  const process = globalThis.process;
  if (globalThis.__silkStorageDir) return String(globalThis.__silkStorageDir);
  if (process?.env?.SILKUI_STORAGE_DIR) return process.env.SILKUI_STORAGE_DIR;
  const os = process?.getBuiltinModule?.("node:os");
  const home = os?.homedir?.();
  if (!home) return null;
  const program = String(process.argv?.[1] ?? process.execPath ?? "app").split(/[\\/]/).pop().replace(/\.[^.]*$/, "") || "app";
  return home + "/.silkui/storage/" + program;
}

function storageFile() {
  const directory = storageDirectory();
  return directory ? directory + "/localStorage.json" : null;
}
