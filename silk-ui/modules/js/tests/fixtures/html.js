// HTML elements with @silkui/react's default stylesheet: what the tree lays out from tags,
// and what selectors see of HTML attributes.
import { CSSStyleSheet, createElement, mount } from "@silkui/core";
import css from "html-css";

const sheet = new CSSStyleSheet();
sheet.replaceSync(css);
const root = createElement("div");
root.style.set({ width: 400, fontSize: 16 });
root.innerHTML = '<p id="p">One <span id="s">two</span> three</p><div id="after">x</div><div hidden id="h">gone</div>'
  + '<input type="checkbox" id="c"><h1 id="h1">T</h1><h2 id="h2">T</h2>';
// React 19 renders hoistable styles with attributes the tree does not have; they stay on the element.
const hoisted = createElement("style");
hoisted.setAttribute("href", "base-ui-disable-scrollbar");
hoisted.setAttribute("precedence", "base-ui:low");
hoisted.setAttribute("blocking", "render");
root.appendChild(hoisted);
// An app's layered reset, as Tailwind's preflight in @layer base, beats the default sheet.
const app = new CSSStyleSheet();
app.replaceSync("@layer base { h2 { font-size: 10px; margin: 0 } }");
root.adoptedStyleSheets.push(sheet, app);
mount(root);

globalThis.htmlAfterFrame = () => {
  const by = (id) => root.querySelector("#" + id);
  const p = by("p").getBoundingClientRect();
  const s = by("s").getBoundingClientRect();
  const after = by("after").getBoundingClientRect();
  const fail = (message) => {
    throw new Error(message + " " + JSON.stringify({ p, s, after }));
  };
  if (Math.abs(s.top - p.top) > 2) fail("a span sits on its paragraph's line");
  if (s.left <= p.left + 5) fail("the span follows the text before it");
  if (s.width >= p.width / 2) fail("the span is inline");
  if (after.top < p.bottom) fail("a div after a paragraph is below it");
  if (p.top < 15) fail("a paragraph has its 1em top margin");
  if (by("h").getBoundingClientRect().height !== 0) fail("[hidden] hides");
  if (!by("c").matches("[type=checkbox]")) fail("attribute selectors see HTML attributes");
  if (!by("h1").matches("h1")) fail("type selectors see the tag");
  if (by("h1").getBoundingClientRect().height < 30) fail("h1 is 2em");
  if (by("h2").getBoundingClientRect().height > 20) fail("a layered app rule beats the default sheet");
  if (hoisted.getAttribute("precedence") !== "base-ui:low") fail("an attribute the tree does not have stays on the element");
  globalThis.htmlChecked = true;
};
