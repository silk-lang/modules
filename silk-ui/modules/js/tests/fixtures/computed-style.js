// getComputedStyle on the tree: cascaded, inherited, typed, used and initial values, a read
// right after a write, and the names that answer nothing.
import { CSSStyleSheet, createBox, createText, mount } from "@silkui/core";

const check = (label, got, want) => {
  if (got !== want) throw new Error(label + ": got '" + got + "', want '" + want + "'");
};

const root = createBox({ width: "400px", fontSize: "10px", color: "rgb(0, 0, 255)", "--tone": "blue" });
const sheet = new CSSStyleSheet();
sheet.replaceSync(
  ".card { padding: 2em; margin-left: 5px; opacity: 0.5; cursor: pointer; border: 3px solid red;" +
    " box-sizing: border-box; transform: translateX(10px); z-index: 4; position: relative;" +
    " --inset: 0.75; --gap: calc(var(--inset) * 2) }",
);
root.adoptedStyleSheets.push(sheet);
const card = createBox({ height: "50px" });
card.className = "card";
const label = createText("hi");
card.appendChild(label);
root.appendChild(card);
mount(root);

const style = getComputedStyle(card);
check("cascaded em padding in pixels", style.paddingTop, "20px");
check("used border-box width", style.width, "395px");
check("used height", style.height, "50px");
check("margin-left", style.marginLeft, "5px");
check("opacity", style.opacity, "0.5");
check("cursor", style.cursor, "pointer");
check("inherited color", style.color, "rgb(0, 0, 255)");
check("border width from the shorthand", style.borderTopWidth, "3px");
check("border style from the shorthand", style.borderTopStyle, "solid");
check("border color", style.borderTopColor, "rgb(255, 0, 0)");
check("display", style.display, "block");
check("position", style.position, "relative");
check("z-index", style.zIndex, "4");
check("transform as a matrix", style.transform, "matrix(1, 0, 0, 1, 10, 0)");
check("getPropertyValue", style.getPropertyValue("font-size"), "10px");
check("initial value", style.fontStyle, "normal");
check("bracket kebab name", style["margin-left"], "5px");
check("shorthand", style.margin, "");
check("custom property", style.getPropertyValue("--inset"), "0.75");
check("custom property with var()", style.getPropertyValue("--gap"), "calc(0.75 * 2)");
check("inherited inline custom property", style.getPropertyValue("--tone"), "blue");
check("missing custom property", style.getPropertyValue("--none"), "");
check("unknown name", style.getPropertyValue("not-a-property"), "");
card.style.set({ whiteSpace: "pre-wrap" });
check("white-space from its computed longhands", style.whiteSpace, "pre-wrap");
check("white-space-collapse from the shorthand", style.whiteSpaceCollapse, "preserve");
check("text-wrap-mode from the shorthand", style.textWrapMode, "wrap");
card.style.set({ whiteSpace: "pre" });
check("pre", style.whiteSpace, "pre");
check("pre keeps lines whole", style.textWrapMode, "nowrap");
card.style.set({ whiteSpace: "normal" });
check("white-space initial", style.whiteSpace, "normal");
check("pseudo-element", getComputedStyle(card, "::before").width, "");

card.style.set({ height: "70px" });
check("a read after a write lays out again", style.height, "70px");
card.style.set({ opacity: 0.25 });
check("the declaration is live", style.opacity, "0.25");

let threw = false;
try { getComputedStyle({}); } catch (error) { threw = error instanceof TypeError; }
check("a non-node throws", threw, true);
globalThis.computedStyleChecked = true;
