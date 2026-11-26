// Layout reads, scrolling, CSS.supports and the observers on the tree. The host runs this,
// then lays out a frame and runs the observers, then `geometryAfterFrame`.
import {
  IntersectionObserver, ResizeObserver, createBox, createRange, createText, elementFromPoint, elementsFromPoint, mount, supports,
} from "@silkui/core";

const check = (label, got, want) => {
  if (got !== want) throw new Error(label + ": got '" + got + "', want '" + want + "'");
};

const root = createBox({ width: "400px", height: "300px" });
const card = createBox({ width: "100px", height: "40px", marginLeft: "10px", padding: "5px", borderWidth: "2px", borderStyle: "solid" });
const scroller = createBox({ width: "100px", height: "100px", overflow: "auto", marginTop: "10px" });
const items = [];
for (let i = 0; i < 10; i++) {
  const item = createBox({ height: "50px", flexShrink: 0 });
  items.push(item);
  scroller.appendChild(item);
}
root.appendChild(card);
root.appendChild(scroller);
mount(root);

const rect = card.getBoundingClientRect();
check("rect x", rect.x, 10);
check("rect y", rect.y, 0);
check("rect width (content-box plus padding and border)", rect.width, 114);
check("rect height", rect.height, 54);
check("rect right", rect.right, 124);
check("client rects", card.getClientRects().length, 1);
check("clientWidth", card.clientWidth, 110);
check("clientTop", card.clientTop, 2);
check("offsetWidth", card.offsetWidth, 114);
check("scrollHeight", scroller.scrollHeight, 500);
check("clientHeight of the scroller", scroller.clientHeight, 100);

card.style.set({ height: "60px" });
check("a read after a write lays out again", card.getBoundingClientRect().height, 74);

items[5].scrollIntoView();
check("scrollIntoView aligns to the start", scroller.scrollTop, 250);
items[5].scrollIntoView({ block: "end" });
check("block end", scroller.scrollTop, 200);
items[4].scrollIntoViewIfNeeded();
check("already shown: no scroll", scroller.scrollTop, 200);
items[0].scrollIntoViewIfNeeded();
check("centered when needed", scroller.scrollTop, 0);
scroller.scrollBy(0, 30);
check("scrollBy", scroller.scrollTop, 30);
scroller.scrollTo({ top: 120 });
check("scrollTo options", scroller.scrollTop, 120);
scroller.scrollTop = 0;
check("scrollTop setter", scroller.scrollTop, 0);
let threw = false;
try { items[0].scrollIntoView({ block: "middle" }); } catch (error) { threw = error instanceof TypeError; }
check("a bad block throws", threw, true);

check("CSS.supports declaration", CSS.supports("display", "grid"), true);
check("CSS.supports bad value", CSS.supports("display", "nope"), false);
check("CSS.supports condition", supports("(display: flex) and (not (color: nope))"), true);
check("CSS.supports bare declaration", CSS.supports("color: red"), true);
check("CSS.supports selector()", CSS.supports("selector(:has(a))"), true);

// Observers: the first layout reports every target.
const seen = [];
const io = new IntersectionObserver((entries) => {
  for (const entry of entries) seen.push([items.indexOf(entry.target), entry.isIntersecting, entry.intersectionRatio]);
}, { threshold: [0, 1] });
for (const item of items) io.observe(item);
const sizes = [];
const ro = new ResizeObserver((entries) => {
  for (const entry of entries) sizes.push([entry.contentRect.width, entry.borderBoxSize[0].blockSize]);
});
ro.observe(card);
check("thresholds", io.thresholds.join(), "0,1");
check("rootMargin", io.rootMargin, "0px 0px 0px 0px");

globalThis.geometryAfterFrame = (step) => {
  if (step === 0) {
    // Hit tests need the window's size, which the first frame gives.
    check("hit test", elementFromPoint(20, 20), card);
    check("hit test stack", elementsFromPoint(20, 20)[0], card);
    check("one entry per target", seen.length, 10);
    check("first shown", seen[0].join(), "0,true,1");
    check("second shown", seen[1].join(), "1,true,1");
    check("edge-adjacent counts as intersecting", seen[2].join(), "2,true,0");
    check("fourth hidden", seen[3].join(), "3,false,0");
    check("resize entry", sizes.join(), "100,74");
    seen.length = 0;
    sizes.length = 0;
    scroller.scrollTop = 75;
  } else if (step === 1) {
    // 75px down: item 0 out, item 1 half out, item 2 whole, item 3 half in.
    check("only crossings", seen.map((entry) => entry[0]).join(), "0,1,2,3");
    check("item 0 leaves", seen[0].join(), "0,false,0");
    check("item 1 partly shown", seen[1][2], 0.5);
    check("item 3 enters", seen[3].join(), "3,true,0.5");
    check("no resize", sizes.length, 0);
    seen.length = 0;
    card.style.set({ width: "80px" });
    io.disconnect();
    scroller.scrollTop = 300;
  } else {
    check("disconnected", seen.length, 0);
    check("resize after a change", sizes.join(), "80,74");
    globalThis.geometryChecked = true;
  }
};

// Range geometry: a range over text has rectangles, read through the tree.
{
  const text = createText("hello world");
  root.appendChild(text);
  const range = createRange();
  range.setStart(text, 0);
  range.setEnd(text, 5);
  check("range rects", range.getClientRects().length > 0, true);
  check("range bounds", range.getBoundingClientRect().width > 0, true);
  root.removeChild(text);
}
