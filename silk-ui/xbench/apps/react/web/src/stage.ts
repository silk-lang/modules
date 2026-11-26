// The canvas scene's drawing (SCENES.md): 20,000 small squares on orbits, drawn with WebGPU in
// one instanced draw. Every position comes from the instance index and one time uniform, so a
// frame uploads 16 bytes and nothing else: what the scene costs is the GPU work and the way the
// canvas reaches the window, not JavaScript.
export const SQUARES = 20000;

const SHADER = `
struct Out { @builtin(position) position: vec4f, @location(0) color: vec3f };
@group(0) @binding(0) var<uniform> clock: vec4f;
const CORNERS = array<vec2f, 6>(vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1));
@vertex fn vertex(@builtin(vertex_index) corner: u32, @builtin(instance_index) index: u32) -> Out {
  let i = f32(index);
  let ring = fract(i * 0.61803398875);
  let orbit = fract(i * 0.754877666);
  // Inner orbits turn faster. The speed must not follow the ring, which the angle follows too.
  let angle = ring * 6.28318530718 + clock.x * (1.2 - orbit);
  let radius = 0.08 + 0.9 * sqrt(orbit);
  let center = vec2f(cos(angle) * radius * 0.375, sin(angle) * radius);
  var out: Out;
  out.position = vec4f(center + CORNERS[corner] * vec2f(0.004 * 0.375, 0.004), 0.0, 1.0);
  out.color = vec3f(0.45 + 0.5 * ring, 0.6 + 0.3 * sin(i), 1.0 - 0.5 * ring);
  return out;
}
@fragment fn fragment(in: Out) -> @location(0) vec4f {
  return vec4f(in.color, 1.0);
}`;

/** Sets `canvas` up and returns the function that draws frame `f`. */
export async function stage(canvas: any): Promise<(f: number) => void> {
  const gpu = (navigator as any).gpu;
  const adapter = await gpu?.requestAdapter();
  if (!adapter) throw new Error("the canvas scene needs WebGPU");
  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu");
  const format = gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });
  const module = device.createShaderModule({ code: SHADER });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vertex" },
    fragment: { module, entryPoint: "fragment", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });
  const clock = device.createBuffer({ size: 16, usage: 0x40 | 0x08 }); // UNIFORM | COPY_DST
  const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: clock } }] });
  const time = new Float32Array(4);
  return (f) => {
    time[0] = f / 60;
    device.queue.writeBuffer(clock, 0, time);
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: context.getCurrentTexture().createView(), clearValue: { r: 0.06, g: 0.07, b: 0.09, a: 1 }, loadOp: "clear", storeOp: "store" }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.draw(6, SQUARES);
    pass.end();
    device.queue.submit([encoder.finish()]);
  };
}
