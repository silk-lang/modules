// A triangle drawn with WebGPU in a canvas, as a web page draws one. Click and it turns.
// Run from the repository root:
//   silk run --manifest-path modules/js/demo/silk.toml -- modules/js/examples/webgpu-canvas/app.js
import { createBox, createNode, createText, mount } from "@silkui/core";

const SHADER = `
struct Out { @builtin(position) position: vec4f, @location(0) color: vec3f };
@group(0) @binding(0) var<uniform> turn: vec4f;
@vertex fn vertex(@location(0) at: vec2f, @location(1) color: vec3f) -> Out {
  let c = cos(turn.x);
  let s = sin(turn.x);
  var out: Out;
  out.position = vec4f(at.x * c - at.y * s, at.x * s + at.y * c, 0.0, 1.0);
  out.color = color;
  return out;
}
@fragment fn fragment(in: Out) -> @location(0) vec4f {
  return vec4f(in.color, 1.0);
}`;

const words = createText("WEBGPU");
const label = createBox({ color: "rgb(250, 250, 250)", fontSize: 20, fontFamily: "Geist Mono, monospace" }, words);
const canvas = createNode("canvas");
canvas.width = 480;
canvas.height = 360;
canvas.style = { width: 480, height: 360, borderRadius: 12 };
const page = createBox(
  { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24, width: "100%", height: "100%", backgroundColor: "rgb(4, 4, 5)" },
  canvas,
  label,
);
page.setAttribute("testId", "counter");
mount(page);

async function start() {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("no GPU adapter");
  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu");
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });

  const vertices = new Float32Array([
    0.0, 0.8, 1, 0.2, 0.3,
    -0.7, -0.6, 0.2, 1, 0.4,
    0.7, -0.6, 0.3, 0.4, 1,
  ]);
  const vertexBuffer = device.createBuffer({ size: vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(vertexBuffer, 0, vertices);
  const uniform = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const module = device.createShaderModule({ code: SHADER });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module,
      entryPoint: "vertex",
      buffers: [{
        arrayStride: 20,
        attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x2" },
          { shaderLocation: 1, offset: 8, format: "float32x3" },
        ],
      }],
    },
    fragment: { module, entryPoint: "fragment", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });
  const group = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniform } }],
  });

  let angle = 0;
  function draw() {
    device.queue.writeBuffer(uniform, 0, new Float32Array([angle, 0, 0, 0]));
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0.05, g: 0.06, b: 0.1, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.setVertexBuffer(0, vertexBuffer);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  // Reads the middle pixel of a frame back, as a test of the frame would.
  async function middle() {
    const texture = device.createTexture({ size: [16, 16], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: texture.createView(), clearValue: [0, 0, 0, 1], loadOp: "clear", storeOp: "store" }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.setVertexBuffer(0, vertexBuffer);
    pass.draw(3);
    pass.end();
    const out = device.createBuffer({ size: 256 * 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    encoder.copyTextureToBuffer({ texture }, { buffer: out, bytesPerRow: 256 }, [16, 16]);
    device.queue.submit([encoder.finish()]);
    await out.mapAsync(GPUMapMode.READ);
    const bytes = new Uint8Array(out.getMappedRange());
    const at = 8 * 256 + 8 * 4;
    const pixel = format === "bgra8unorm"
      ? [bytes[at + 2], bytes[at + 1], bytes[at], bytes[at + 3]]
      : [bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]];
    out.unmap();
    return pixel;
  }

  draw();
  page.addEventListener("click", async () => {
    angle += Math.PI / 6;
    draw();
    const pixel = await middle();
    // The middle of the triangle is lit: every channel is there.
    words.data = pixel[3] === 255 && pixel[0] + pixel[1] + pixel[2] > 200 ? "CLICKED" : "WRONG PIXEL " + pixel.join(",");
  });
  device.addEventListener("uncapturederror", (event) => {
    words.data = "GPU ERROR " + event.error.message;
    console.error(event.error.message);
  });
}

start().catch((error) => {
  words.data = String(error);
  console.error(String(error && error.stack || error));
});
