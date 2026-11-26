// Where the app's own files are: an address of the window's origin (`/x.wasm`) names the
// file `x.wasm` there. A bundle's are beside it; under the dev server they are the server's.
// `globalThis.__silkAppBase` set before the globals load names another place.
export function appBase() {
  const given = globalThis.__silkAppBase ?? globalThis.__silkWorkerBase;
  if (given) return String(given);
  try {
    const here = new URL(import.meta.url);
    if (here.protocol === "file:") return new URL(".", here).href;
    if (here.protocol === "http:" || here.protocol === "https:") return here.origin + "/";
  } catch {}
  return null;
}

/** The address of the app's file for `address`, an address of `origin`; else null. */
export function appFile(address, origin) {
  const base = appBase();
  if (!base || address.origin !== origin) return null;
  return new URL("." + decodeURIComponent(address.pathname), base);
}
