// Shared DOM layout and event recorder for Chromium vs Silk UI event parity.
// Uses only standard DOM APIs so the exact same script runs verbatim in headless Chromium
// and in Silk UI's JsHost + UiTree.
document.body.style.margin = "0";
document.body.style.padding = "0";

const container = document.createElement("div");
container.style.display = "flex";
container.style.flexDirection = "column";
container.style.alignItems = "flex-start";
container.style.width = "400px";
container.style.height = "300px";
document.body.appendChild(container);

function makeButton(id, label) {
  const btn = document.createElement("button");
  btn.id = id;
  btn.type = "button";
  btn.textContent = label;
  btn.style.display = "block";
  btn.style.width = "120px";
  btn.style.height = "36px";
  btn.style.margin = "0";
  btn.style.padding = "0";
  btn.style.border = "0";
  return btn;
}

const btnEnter = makeButton("btn-enter", "Enter");
const btnSpace = makeButton("btn-space", "Space");
const btnPrevent = makeButton("btn-prevent", "Prevent");
const chk = document.createElement("input");
chk.id = "chk";
chk.type = "checkbox";
chk.style.display = "block";
chk.style.width = "24px";
chk.style.height = "24px";
chk.style.margin = "0";
chk.style.padding = "0";

const openModal = makeButton("open-modal", "Open Modal");
const modal = document.createElement("dialog");
modal.id = "modal";
modal.style.position = "fixed";
modal.style.margin = "0";
modal.style.padding = "0";
modal.style.border = "0";
modal.style.left = "0px";
modal.style.top = "0px";
const closeModal = makeButton("close-modal", "Close");
modal.appendChild(closeModal);

container.appendChild(btnEnter);
container.appendChild(btnSpace);
container.appendChild(btnPrevent);
container.appendChild(chk);
container.appendChild(openModal);
container.appendChild(modal);

const log = [];
let openClicks = 0;
let closeClicks = 0;

function record(target, type, detail) {
  log.push(detail === undefined ? `${type}:${target.id}` : `${type}:${target.id}:${detail}`);
}

for (const el of [btnEnter, btnSpace, btnPrevent, chk, openModal, closeModal]) {
  el.addEventListener("keydown", (event) => {
    if (el === btnPrevent && event.key === " ") event.preventDefault();
    record(el, "keydown", event.key);
  });
  el.addEventListener("keyup", (event) => {
    record(el, "keyup", event.key);
  });
  el.addEventListener("click", () => {
    record(el, "click");
  });
}

chk.addEventListener("input", () => record(chk, "input", String(chk.checked)));
chk.addEventListener("change", () => record(chk, "change", String(chk.checked)));

// Simulates a toggle trigger: if double-click happens on Enter/Space, the modal opens and
// closes immediately instead of staying open.
openModal.addEventListener("click", () => {
  openClicks++;
  if (modal.open) {
    modal.close();
  } else {
    modal.showModal();
    closeModal.focus();
  }
});

closeModal.addEventListener("click", () => {
  closeClicks++;
  modal.close();
  openModal.focus();
});

globalThis.__parityLog = log;
globalThis.__parityState = () => ({
  events: [...log],
  openClicks,
  closeClicks,
  modalOpen: Boolean(modal.open),
  checked: Boolean(chk.checked),
  activeId: document.activeElement?.id ?? "",
});
globalThis.__closeModalCenter = () => {
  const r = closeModal.getBoundingClientRect();
  return [r.x + r.width * 0.5, r.y + r.height * 0.5];
};
