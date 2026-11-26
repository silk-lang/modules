// A terminal-like drawing with Canvas 2D, as a web page draws one: rows of text on a dark
// background, a cursor, shapes, clips, gradients, a pattern, a shadow and an image. Click and
// it reads a pixel back.
// Run from the repository root:
//   silk run --manifest-path modules/js/demo/silk.toml -- modules/js/examples/canvas2d/app.js
import { createBox, createNode, createText, mount } from "@silkui/core";

const words = createText("CANVAS 2D");
const label = createBox({ color: "rgb(250, 250, 250)", fontSize: 20, fontFamily: "Geist Mono, monospace" }, words);
const canvas = createNode("canvas");
const ratio = globalThis.devicePixelRatio || 1;
canvas.width = 480 * ratio;
canvas.height = 300 * ratio;
canvas.style = { width: 480, height: 300 };
const page = createBox(
  { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24, width: "100%", height: "100%", backgroundColor: "rgb(4, 4, 5)" },
  canvas,
  label,
);
page.setAttribute("testId", "counter");
mount(page);

const context = canvas.getContext("2d", { alpha: false });
context.setTransform(ratio, 0, 0, ratio, 0, 0);
context.fillStyle = "rgb(16, 18, 24)";
context.fillRect(0, 0, 480, 300);

const font = "normal 400 14px monospace";
context.font = font;
const cell = context.measureText("M");
const metrics = context.measureText("Mg");
const height = Math.max(Math.round(14 * 1.35), Math.ceil(metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent));
const lines = [
  ["$ ", "rgb(120, 220, 140)", "silk run --manifest-path modules/js/demo/silk.toml"],
  ["  ", "rgb(200, 200, 210)", "Compiling ui-js-demo ... done"],
  ["  ", "rgb(240, 200, 90)", "warning: 2 canvases drew this frame"],
  ["$ ", "rgb(120, 220, 140)", "echo été → λ"],
];
context.textBaseline = "alphabetic";
lines.forEach(([prompt, color, text], row) => {
  const top = 16 + row * height;
  context.fillStyle = "rgb(16, 18, 24)";
  context.fillRect(0, top, 480, height);
  context.fillStyle = "rgb(120, 220, 140)";
  context.fillText(prompt, 16, top + height - 5);
  context.fillStyle = color;
  context.font = row === 2 ? "italic 700 14px monospace" : font;
  context.fillText(text, 16 + cell.width * 2, top + height - 5);
  context.font = font;
});
// A block cursor, and its text in the background color.
const cursorTop = 16 + lines.length * height;
context.fillStyle = "rgb(230, 230, 240)";
context.fillRect(16, cursorTop, cell.width, height);
context.strokeStyle = "rgb(90, 140, 255)";
context.lineWidth = 2;
context.strokeRect(12, 12, 456, cursorTop + height - 4);

// Shapes: a circle, a rounded rectangle and a powerline arrow, one of them clipped.
context.fillStyle = "rgb(255, 90, 120)";
context.beginPath();
context.arc(400, 230, 40, 0, Math.PI * 2);
context.fill();
context.save();
context.beginPath();
context.rect(40, 200, 120, 30);
context.clip();
context.fillStyle = "rgba(90, 140, 255, 0.8)";
context.beginPath();
context.roundRect(30, 190, 180, 80, 16);
context.fill();
context.restore();
context.fillStyle = "#f0c";
context.beginPath();
context.moveTo(240, 200);
context.lineTo(280, 230);
context.lineTo(240, 260);
context.closePath();
context.fill();
context.textAlign = "center";
context.fillStyle = "white";
context.fillText("centered", 400, 290);
context.textAlign = "start";

// Effects: gradients, a pattern inside a star-shaped clip, a shadow, a blend mode and text turned
// and outlined.
const linear = context.createLinearGradient(20, 0, 140, 0);
linear.addColorStop(0, "#ff5a78");
linear.addColorStop(0.5, "#f0c85a");
linear.addColorStop(1, "#5a8cff");
context.fillStyle = linear;
context.fillRect(20, 128, 120, 22);
const radial = context.createRadialGradient(176, 150, 2, 176, 150, 24);
radial.addColorStop(0, "white");
radial.addColorStop(1, "rgba(90, 140, 255, 0)");
context.fillStyle = radial;
context.fillRect(150, 124, 52, 52);
const conic = context.createConicGradient(0, 230, 150);
conic.addColorStop(0, "red");
conic.addColorStop(0.33, "lime");
conic.addColorStop(0.66, "blue");
conic.addColorStop(1, "red");
context.fillStyle = conic;
context.beginPath();
context.arc(230, 150, 22, 0, Math.PI * 2);
context.fill();
const tile = context.createImageData(4, 4);
for (let i = 0; i < 16; i++) tile.data.set((((i & 3) >> 1) + (i >> 3)) % 2 ? [240, 200, 90, 255] : [16, 18, 24, 255], i * 4);
context.save();
context.beginPath();
for (let i = 0; i < 10; i++) {
  const angle = -Math.PI / 2 + (i * Math.PI) / 5;
  const radius = i % 2 ? 10 : 24;
  context.lineTo(290 + radius * Math.cos(angle), 152 + radius * Math.sin(angle));
}
context.closePath();
context.clip();
context.fillStyle = context.createPattern(tile, "repeat");
context.fillRect(260, 124, 60, 56);
context.restore();
context.save();
context.shadowColor = "rgba(255, 90, 120, 0.9)";
context.shadowBlur = 6;
context.shadowOffsetX = 3;
context.shadowOffsetY = 3;
context.fillStyle = "white";
context.font = "normal 700 16px sans-serif";
context.fillText("shadow", 330, 146);
context.restore();
context.fillStyle = "white";
context.fillRect(326, 154, 84, 32);
context.save();
context.globalCompositeOperation = "multiply";
context.fillStyle = "rgb(90, 220, 255)";
context.fillRect(330, 156, 50, 20);
context.fillStyle = "rgb(255, 220, 90)";
context.fillRect(355, 162, 50, 20);
context.restore();
context.save();
context.translate(450, 128);
context.rotate(Math.PI / 2);
context.font = "normal 400 12px sans-serif";
context.fillStyle = "rgb(120, 220, 140)";
context.fillText("turned", 0, 0);
context.restore();
context.strokeStyle = "white";
context.lineWidth = 1;
context.font = "normal 700 20px sans-serif";
context.strokeText("outlined", 100, 196);

// An image: a 2 by 2 checker scaled into the corner.
const image = context.createImageData(2, 2);
image.data.set([255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
context.drawImage(image, 300, 190, 40, 40);

page.addEventListener("click", () => {
  // The background is opaque, the circle red.
  const background = context.getImageData(2 * ratio, 2 * ratio, 1, 1).data;
  const circle = context.getImageData(400 * ratio, 230 * ratio, 1, 1).data;
  const ok = background[3] === 255 && background[0] === 16 && circle[0] === 255 && circle[1] === 90 && cell.width > 0;
  words.data = ok ? "CLICKED" : "WRONG PIXEL " + [...background].join(",") + " " + [...circle].join(",") + " " + cell.width;
});
