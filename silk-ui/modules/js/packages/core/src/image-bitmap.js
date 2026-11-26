// The web's `createImageBitmap` and `ImageBitmap`: a picture decoded once, which a 2D context
// draws (`drawImage`, `createPattern`) as it draws `ImageData`. PNG and JPEG files decode on the
// host (`__ui.imageDecode`), with ICC profiles and EXIF orientation applied as a browser does.
// The pixels are straight RGBA, as `ImageData` holds them.

const native = globalThis.__ui;

function domError(name, message) {
  const DOMExceptionClass = globalThis.DOMException;
  if (DOMExceptionClass) return new DOMExceptionClass(message, name);
  const error = new Error(message);
  error.name = name;
  return error;
}

const MADE = Symbol("ImageBitmap");

export class ImageBitmap {
  constructor(key, pixels) {
    if (key !== MADE) throw new TypeError("Illegal constructor");
    // What canvas2d.js draws: { width, height, data }, null once closed.
    Object.defineProperty(this, "_pixels", { value: pixels, writable: true });
  }
  get width() {
    return this._pixels?.width ?? 0;
  }
  get height() {
    return this._pixels?.height ?? 0;
  }
  close() {
    this._pixels = null;
  }
}

const pixels = (width, height, data = new Uint8ClampedArray(width * height * 4)) => ({ width, height, data });

function decode(bytes) {
  if (!native?.imageDecode || native.imageDecode(bytes) !== 2) throw domError("InvalidStateError", "The source image could not be decoded.");
  const width = native.geometry(0);
  const height = native.geometry(1);
  const decoded = pixels(width, height);
  native.imageTake(decoded.data);
  return decoded;
}

// The bytes at an `<img>`'s address: a `blob:` URL from `URL.createObjectURL`, or anything
// `fetch` reaches (`data:`, `http(s):`, the app's own files).
async function addressBytes(src) {
  if (!src) throw domError("InvalidStateError", "The image has no source.");
  if (src.startsWith("blob:")) {
    const blob = globalThis.process?.getBuiltinModule?.("node:buffer")?.resolveObjectURL?.(src);
    if (!blob) throw domError("InvalidStateError", "The image's blob URL was revoked.");
    return new Uint8Array(await blob.arrayBuffer());
  }
  if (typeof globalThis.fetch !== "function") throw domError("InvalidStateError", "This runtime cannot load '" + src + "'.");
  const response = await globalThis.fetch(src);
  if (!response.ok) throw domError("InvalidStateError", "The image at '" + src + "' did not load (" + response.status + ").");
  return new Uint8Array(await response.arrayBuffer());
}

async function sourcePixels(image) {
  if (image instanceof ImageBitmap) {
    if (!image._pixels) throw domError("InvalidStateError", "The image bitmap is closed.");
    return image._pixels;
  }
  if (typeof Blob === "function" && image instanceof Blob) return decode(new Uint8Array(await image.arrayBuffer()));
  if (image && typeof image.getContext === "function") {
    const width = image.width | 0, height = image.height | 0;
    if (!width || !height) throw domError("InvalidStateError", "The canvas has no pixels.");
    const context = image.getContext("2d");
    const read = context?.getImageData?.(0, 0, width, height);
    return read?.data?.length === width * height * 4 ? read : pixels(width, height);
  }
  if (image && image.data && typeof image.width === "number" && typeof image.height === "number") return image;
  if (typeof image?._readPixels === "function") {
    const read = image._readPixels();
    if (read && read.width && read.height) return read;
  }
  if (image && typeof image.src === "string") return decode(await addressBytes(image.src));
  throw new TypeError("createImageBitmap takes a Blob, ImageData, ImageBitmap, canvas or image.");
}

// The rectangle (sx, sy, sw, sh) of `from`, transparent where it falls outside.
function crop(from, sx, sy, sw, sh) {
  if (sx === 0 && sy === 0 && sw === from.width && sh === from.height) return from;
  const out = pixels(sw, sh);
  const x0 = Math.max(0, sx), x1 = Math.min(from.width, sx + sw);
  if (x1 <= x0) return out;
  for (let y = Math.max(0, sy); y < Math.min(from.height, sy + sh); y++) {
    const row = from.data.subarray((y * from.width + x0) * 4, (y * from.width + x1) * 4);
    out.data.set(row, ((y - sy) * sw + (x0 - sx)) * 4);
  }
  return out;
}

// `from` scaled to width by height: nearest for "pixelated", else each output pixel averages
// the source area it covers (bilinear where the image grows).
function resize(from, width, height, quality) {
  if (width === from.width && height === from.height) return from;
  const out = pixels(width, height);
  const src = from.data, dst = out.data;
  const scaleX = from.width / width, scaleY = from.height / height;
  if (quality === "pixelated") {
    for (let y = 0; y < height; y++) {
      const row = Math.min(from.height - 1, Math.floor((y + 0.5) * scaleY)) * from.width;
      for (let x = 0; x < width; x++) {
        const at = (row + Math.min(from.width - 1, Math.floor((x + 0.5) * scaleX))) * 4;
        dst.set(src.subarray(at, at + 4), (y * width + x) * 4);
      }
    }
    return out;
  }
  // Averaged with alpha weights, so transparent pixels do not darken the edges.
  const sample = (x0, x1, y0, y1, into) => {
    let r = 0, g = 0, b = 0, a = 0, area = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const at = (y * from.width + x) * 4, alpha = src[at + 3];
        r += src[at] * alpha;
        g += src[at + 1] * alpha;
        b += src[at + 2] * alpha;
        a += alpha;
        area++;
      }
    }
    dst[into + 3] = Math.round(a / area);
    if (a) {
      dst[into] = Math.round(r / a);
      dst[into + 1] = Math.round(g / a);
      dst[into + 2] = Math.round(b / a);
    }
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const into = (y * width + x) * 4;
      if (scaleX >= 1 && scaleY >= 1) {
        const x0 = Math.floor(x * scaleX), y0 = Math.floor(y * scaleY);
        sample(x0, Math.max(x0 + 1, Math.floor((x + 1) * scaleX)), y0, Math.max(y0 + 1, Math.floor((y + 1) * scaleY)), into);
        continue;
      }
      const fx = Math.max(0, Math.min(from.width - 1, (x + 0.5) * scaleX - 0.5));
      const fy = Math.max(0, Math.min(from.height - 1, (y + 0.5) * scaleY - 0.5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const x1 = Math.min(from.width - 1, x0 + 1), y1 = Math.min(from.height - 1, y0 + 1);
      const tx = fx - x0, ty = fy - y0;
      for (let c = 0; c < 4; c++) {
        const top = src[(y0 * from.width + x0) * 4 + c] * (1 - tx) + src[(y0 * from.width + x1) * 4 + c] * tx;
        const bottom = src[(y1 * from.width + x0) * 4 + c] * (1 - tx) + src[(y1 * from.width + x1) * 4 + c] * tx;
        dst[into + c] = Math.round(top * (1 - ty) + bottom * ty);
      }
    }
  }
  return out;
}

function flipped(from) {
  const out = pixels(from.width, from.height);
  const row = from.width * 4;
  for (let y = 0; y < from.height; y++) out.data.set(from.data.subarray(y * row, (y + 1) * row), (from.height - 1 - y) * row);
  return out;
}

export async function createImageBitmap(image, ...args) {
  let rect = null;
  let options = {};
  if (args.length >= 4) {
    let [sx, sy, sw, sh] = args.slice(0, 4).map((value) => Math.trunc(Number(value)));
    if (!sw || !sh || !Number.isFinite(sw) || !Number.isFinite(sh)) throw new RangeError("The crop rectangle's width and height cannot be 0.");
    if (sw < 0) [sx, sw] = [sx + sw, -sw];
    if (sh < 0) [sy, sh] = [sy + sh, -sh];
    rect = [sx, sy, sw, sh];
    options = args[4] ?? {};
  } else if (args.length >= 1) {
    options = args[0] ?? {};
  }
  const { resizeWidth, resizeHeight, resizeQuality = "low", imageOrientation = "from-image" } = options;
  if (resizeWidth === 0 || resizeHeight === 0) throw domError("InvalidStateError", "The resize width and height cannot be 0.");
  let result = await sourcePixels(image);
  if (rect) result = crop(result, ...rect);
  if (resizeWidth !== undefined || resizeHeight !== undefined) {
    const width = resizeWidth ?? Math.max(1, Math.round((result.width * resizeHeight) / result.height));
    const height = resizeHeight ?? Math.max(1, Math.round((result.height * resizeWidth) / result.width));
    result = resize(result, width >>> 0, height >>> 0, resizeQuality);
  }
  if (imageOrientation === "flipY") result = flipped(result);
  // A bitmap keeps pixels of its own: a later change to the ImageData does not show.
  if (result.data === image?.data) result = pixels(result.width, result.height, result.data.slice());
  return new ImageBitmap(MADE, { width: result.width, height: result.height, data: result.data });
}
