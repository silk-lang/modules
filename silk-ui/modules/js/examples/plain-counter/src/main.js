// A counter on @silkui/core alone, with no framework.
import { createBox, createText, mount } from "@silkui/core";

const label = createText("Clicked 0 times");
const button = createBox(
  {
    paddingTop: 14, paddingBottom: 14, paddingLeft: 24, paddingRight: 24,
    borderRadius: 10, backgroundColor: "rgb(37, 99, 235)", color: "white", fontSize: 20,
  },
  label,
);
button.tabIndex = 0;
button.setAttribute("testId", "counter");
button.setAttribute("role", "button");
button.look("hover").set({ backgroundColor: "rgb(29, 78, 216)" });
button.setAttribute("cursor", "pointer");

let clicks = 0;
button.addEventListener("click", () => {
  clicks += 1;
  label.data = `Clicked ${clicks} time${clicks === 1 ? "" : "s"}`;
});

mount(
  createBox(
    {
      position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
      display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "rgb(248, 250, 252)",
    },
    button,
  ),
);
requestAnimationFrame(() => requestAnimationFrame(() => console.log("plain counter: first frame")));
