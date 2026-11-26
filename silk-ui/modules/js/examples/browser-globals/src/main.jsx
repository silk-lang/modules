// React rendered into `document.body`, written as for a browser page: a keydown listener on
// `document`, the count in `localStorage` and in the hash, `:root` styled through
// `documentElement`, a MutationObserver that sees React's commits, and a page taller than the
// window, which the window scrolls.
import "@silkui/core/globals";
import { useEffect, useState } from "react";
import { createRoot } from "@silkui/react";

function App() {
  const [keys, setKeys] = useState(() => Number(localStorage.getItem("keys") ?? 0));
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onKey = () => setKeys((count) => count + 1);
    const onHash = () => setHash(location.hash);
    document.addEventListener("keydown", onKey);
    window.addEventListener("hashchange", onHash);
    window.addEventListener("popstate", onHash);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("popstate", onHash);
    };
  }, []);
  useEffect(() => {
    if (keys === 0) return;
    localStorage.setItem("keys", String(keys));
    history.pushState({ keys }, "", "#/keys/" + keys);
    setHash(location.hash);
    document.documentElement.classList.toggle("odd", keys % 2 === 1);
    document.documentElement.style.setProperty("--keys", String(keys));
  }, [keys]);
  const body = document.body instanceof HTMLElement ? "body is an element" : "body is not an element";
  return (
    <box style={{ padding: 24, gap: 8, display: "flex", flexDirection: "column" }}>
      <box>{"keys " + keys}</box>
      <box>{"hash " + (hash || "none")}</box>
      <box>{"root " + (document.documentElement.className || "even")}</box>
      <box>{body}</box>
      <box style={{ height: 2000 }}>tall</box>
    </box>
  );
}

let commits = 0;
new MutationObserver((records) => {
  commits += records.length;
  if (commits > 0) document.title = "mutations seen";
}).observe(document.body, { childList: true, subtree: true, characterData: true });

// What a page reads at startup, answered by the realm: ECMA-402, URLs and the form elements.
globalThis.platformChecks = () => {
  const fieldset = document.createElement("fieldset");
  fieldset.disabled = true;
  const item = document.createElement("div");
  item.tabIndex = -1;
  return [
    new Intl.NumberFormat("de-DE").format(1234.5) === "1.234,5",
    new Intl.DateTimeFormat("en-US", { timeZone: "UTC" }).format(new Date(0)) === "1/1/1970",
    [...new Intl.Segmenter("en", { granularity: "word" }).segment("hi there")].length === 3,
    new URL("../b?x=1", "https://example.com/a/c").href === "https://example.com/b?x=1",
    new URLSearchParams(location.search + "&q=a+b").get("q") === "a b",
    fieldset instanceof HTMLFieldSetElement && fieldset.disabled && document.createElement("meter") instanceof HTMLMeterElement,
    item.hasAttribute("tabindex") && item.tabIndex === -1,
  ].map((ok, index) => (ok ? "" : index)).join("");
};

createRoot(document.body).render(<App />);
