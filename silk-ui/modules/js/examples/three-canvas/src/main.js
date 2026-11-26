// three.js in a canvas: its WebGPU renderer draws a lit torus knot, as it would on a web page.
// The canvas is a node of the page like any other, here with round corners and a caption.
import { createBox, createNode, createText, mount } from "@silkui/core";
import * as THREE from "three/webgpu";

const WIDTH = 640;
const HEIGHT = 400;

const words = createText("THREE.JS ON WEBGPU");
const caption = createBox({ color: "rgb(161, 161, 170)", fontSize: 14, letterSpacing: 2, fontFamily: "Geist Mono, monospace" }, words);
const canvas = createNode("canvas");
canvas.width = WIDTH;
canvas.height = HEIGHT;
canvas.style = { width: WIDTH, height: HEIGHT, borderRadius: 16 };
const page = createBox(
  { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24, width: "100%", height: "100%", backgroundColor: "rgb(4, 4, 5)" },
  canvas,
  caption,
);
// The window check clicks the page and waits for the caption (`--check`).
page.setAttribute("testId", "counter");
mount(page);

async function start() {
  const renderer = new THREE.WebGPURenderer({ canvas });
  await renderer.init();
  renderer.setSize(WIDTH, HEIGHT, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101420);
  const camera = new THREE.PerspectiveCamera(50, WIDTH / HEIGHT, 0.1, 100);
  camera.position.z = 4;
  const colors = [0x66aaff, 0xa3e635, 0xfb7185, 0xfbbf24, 0xa78bfa];
  const material = new THREE.MeshStandardMaterial({ color: colors[0], roughness: 0.35, metalness: 0.2 });
  const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(1, 0.35, 160, 24), material);
  scene.add(knot);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 2.5);
  sun.position.set(2, 3, 4);
  scene.add(sun);

  let clicks = 0;
  page.addEventListener("click", () => {
    clicks += 1;
    material.color.setHex(colors[clicks % colors.length]);
    words.data = clicks === 1 ? "CLICKED" : "CLICKED " + clicks + " TIMES";
  });
  renderer.setAnimationLoop((time) => {
    knot.rotation.x = time / 1700;
    knot.rotation.y = time / 1100;
    renderer.render(scene, camera);
  });
}

start().catch((error) => {
  words.data = String(error);
  console.error(String((error && error.stack) || error));
});
