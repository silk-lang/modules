// The page's GPU canvases, for the window's renderer.
//
// A canvas node that shows a GPU surface is drawn by the page with the browser's WebGPU, on a
// device of the page's own, into a canvas that is not in the document (an OffscreenCanvas).
// The renderer draws the window on another device, so each picture the page finishes goes
// into a texture of the renderer's device, which its surface sprites sample. There are two
// ways across:
//
// - `copyExternalImageToTexture` from the canvas, which stays on the GPU. Some browsers on
//   some GPUs (Chromium on a software Vulkan, for one) copy an empty picture, so the first
//   canvas tries it once with a picture it knows (`probe`).
// - Until that is known, and where it fails, the picture is read back on the page's device
//   and written into the renderer's texture, a frame or two later.
//
// The wasm asks for the textures through the `silk_browser` imports `canvas_sync`,
// `canvas_change` and `canvas_view` (render_inline.silk).

const COPY_SRC = 0x01;
const COPY_DST = 0x02;
const TEXTURE_BINDING = 0x04;
const RENDER_ATTACHMENT = 0x10;
const MAP_READ = 0x01;
const BUFFER_COPY_DST = 0x08;

/** The usage the page's canvas texture needs besides the application's: it is read back. */
export const CANVAS_USAGE = COPY_SRC;

export class PageCanvases {
  next = 1;
  /** Surface number to what is known of the canvas (see `open`). */
  surfaces = new Map();
  /** What the renderer has not heard yet: `[surface, view or null]`. */
  changes = [];
  current = null;
  /** The renderer's device, from its first frame on. */
  device = null;
  /** Whether canvases copy on the GPU: undefined before the try, null while it runs. */
  direct = undefined;
  /** Called when a picture arrives outside a frame, to have the window draw one. */
  wake = null;

  /**
   * `table` is the WebGPU host's object table, where the renderer's device is found and the
   * views it gets are kept.
   */
  constructor(table) {
    this.table = table;
  }

  /** Numbers `source`, a canvas the page draws. */
  open(source) {
    const surface = this.next++;
    this.surfaces.set(surface, {
      source, device: null, format: 'rgba8unorm', opaque: true, taking: false, sequence: 0, shown: 0,
      pixels: null, texture: null, width: 0, height: 0,
    });
    return surface;
  }

  /** The page configured the canvas of `surface` for its `device`. */
  configured(surface, device, format, opaque) {
    const entry = this.surfaces.get(surface);
    if (entry) Object.assign(entry, { device, format, opaque });
  }

  /**
   * The page took `texture`, the canvas's texture, to draw `surface` again. The picture is
   * taken when the code that draws it has run: it is the canvas's only until the task ends.
   */
  drawn(surface, texture) {
    const entry = this.surfaces.get(surface);
    if (!entry || entry.taking) return;
    entry.taking = true;
    queueMicrotask(() => {
      entry.taking = false;
      if (!this.surfaces.has(surface) || !entry.device) return;
      try {
        this.take(surface, entry, texture);
      } catch (error) {
        console.warn(`canvas ${surface}: ${error?.message ?? error}`);
      }
    });
  }

  take(surface, entry, texture) {
    const { width, height } = texture;
    const sequence = ++entry.sequence;
    if (this.device && this.direct === undefined) this.probe(entry.device, entry.format);
    if (this.device && this.direct) {
      this.fit(surface, entry, width, height);
      this.device.queue.copyExternalImageToTexture(
        { source: entry.source },
        // The renderer's sprites take premultiplied pixels.
        { texture: entry.texture, premultipliedAlpha: true },
        [width, height],
      );
      entry.shown = sequence;
      entry.pixels = null;
      return;
    }
    const device = entry.device;
    const stride = Math.ceil(width * 4 / 256) * 256;
    const buffer = device.createBuffer({ label: 'page canvas', size: stride * height, usage: MAP_READ | BUFFER_COPY_DST });
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: stride, rowsPerImage: height }, [width, height]);
    device.queue.submit([encoder.finish()]);
    buffer.mapAsync(MAP_READ).then(() => {
      if (sequence > entry.shown && this.surfaces.has(surface)) {
        const rows = new Uint8Array(buffer.getMappedRange());
        const data = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) data.set(rows.subarray(y * stride, y * stride + width * 4), y * width * 4);
        // An opaque canvas shows as if its alpha were one, whatever was drawn there.
        if (entry.opaque) for (let i = 3; i < data.length; i += 4) data[i] = 255;
        entry.shown = sequence;
        entry.pixels = { data, width, height };
        this.wake?.();
      }
      buffer.destroy();
    }, error => {
      console.warn(`canvas ${surface}: ${error?.message ?? error}`);
      buffer.destroy();
    });
  }

  /** Gives `entry` a texture of the renderer's device with this size. */
  fit(surface, entry, width, height) {
    if (entry.texture && entry.width === width && entry.height === height && entry.textureFormat === entry.format) return;
    entry.texture?.destroy();
    entry.texture = this.device.createTexture({
      label: 'page canvas', size: [width, height], format: entry.format,
      usage: COPY_DST | TEXTURE_BINDING | RENDER_ATTACHMENT,
    });
    entry.width = width;
    entry.height = height;
    entry.textureFormat = entry.format;
    this.changes.push([surface, entry.texture.createView()]);
  }

  /**
   * Finds out whether a canvas of `device` copies into a texture of the renderer's device:
   * a one pixel canvas cleared to white must arrive white.
   */
  probe(device, format) {
    this.direct = null;
    const renderer = this.device;
    const answer = async () => {
      const canvas = new OffscreenCanvas(1, 1);
      const context = canvas.getContext('webgpu');
      context.configure({ device, format, alphaMode: 'opaque' });
      const encoder = device.createCommandEncoder();
      encoder.beginRenderPass({
        colorAttachments: [{ view: context.getCurrentTexture().createView(), clearValue: { r: 1, g: 1, b: 1, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
      }).end();
      device.queue.submit([encoder.finish()]);
      const texture = renderer.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: COPY_SRC | COPY_DST | RENDER_ATTACHMENT });
      renderer.queue.copyExternalImageToTexture({ source: canvas }, { texture }, [1, 1]);
      const buffer = renderer.createBuffer({ size: 256, usage: MAP_READ | BUFFER_COPY_DST });
      const copy = renderer.createCommandEncoder();
      copy.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: 256 }, [1, 1]);
      renderer.queue.submit([copy.finish()]);
      await buffer.mapAsync(MAP_READ);
      const white = new Uint8Array(buffer.getMappedRange())[0] > 127;
      buffer.destroy();
      texture.destroy();
      context.unconfigure();
      return white;
    };
    answer().then(white => { this.direct = white; }, () => { this.direct = false; });
  }

  /** Forgets `surface`: the renderer lets go of its texture. */
  close(surface) {
    const entry = this.surfaces.get(surface);
    if (!entry) return;
    this.surfaces.delete(surface);
    entry.texture?.destroy();
    this.changes.push([surface, null]);
  }

  /** `silk_browser#canvas_sync`: writes the pictures read back, and answers the number of changes. */
  sync(deviceHandle) {
    this.device = this.table.get(deviceHandle, 'WGPUDevice');
    for (const [surface, entry] of this.surfaces) {
      const pixels = entry.pixels;
      if (!pixels) continue;
      entry.pixels = null;
      this.fit(surface, entry, pixels.width, pixels.height);
      this.device.queue.writeTexture({ texture: entry.texture }, pixels.data, { bytesPerRow: pixels.width * 4 }, [pixels.width, pixels.height]);
    }
    return this.changes.length;
  }

  /** `silk_browser#canvas_change`: the surface of the next change. */
  change() {
    this.current = this.changes.shift() ?? null;
    return this.current ? this.current[0] : 0;
  }

  /** `silk_browser#canvas_view`: its view as a handle the wasm owns, or 0 when it went away. */
  view() {
    const view = this.current?.[1];
    return view ? this.table.add(view, 'WGPUTextureView') : 0;
  }

  imports() {
    return {
      canvas_sync: device => this.sync(device),
      canvas_change: () => this.change(),
      canvas_view: () => this.view(),
    };
  }
}
