// WebGPU for a ui-js realm: `navigator.gpu`, the GPU classes and `canvas.getContext("webgpu")`,
// with the names and behavior of the W3C API. The prelude evaluates this on first use. It is a
// function of `__ui`.
//
// Nothing here talks to a GPU. Every call writes a command into a byte stream, the stream goes
// to the host at the end of the JavaScript job (`__ui.gpu(bytes)`), and the host runs it on a
// GPU device that belongs to the application, apart from the one that draws the window. What
// the API answers later (adapters, devices, mapped buffers, error scopes) comes back through
// `__ui.gpuReplies`. Objects are numbers on the wire: JavaScript picks an object's id when it
// makes it, so no call waits for the host.
//
// Edit this, then run `silk task embed-assets` to regenerate generated_webgpu_api.silk.
(function (native) {
  // The numbers of webgpu.h enums (webgpu_sys.generated_webgpu), by their names in lower case
  // without separators: "bgra8unorm-srgb" is bgra8unormsrgb.
  const E = {"AddressMode":{"undefined":0,"clamptoedge":1,"repeat":2,"mirrorrepeat":3},"BlendFactor":{"undefined":0,"zero":1,"one":2,"src":3,"oneminussrc":4,"srcalpha":5,"oneminussrcalpha":6,"dst":7,"oneminusdst":8,"dstalpha":9,"oneminusdstalpha":10,"srcalphasaturated":11,"constant":12,"oneminusconstant":13,"src1":14,"oneminussrc1":15,"src1alpha":16,"oneminussrc1alpha":17},"BlendOperation":{"undefined":0,"add":1,"subtract":2,"reversesubtract":3,"min":4,"max":5},"BufferBindingType":{"bindingnotused":0,"undefined":1,"uniform":2,"storage":3,"readonlystorage":4},"CompareFunction":{"undefined":0,"never":1,"less":2,"equal":3,"lessequal":4,"greater":5,"notequal":6,"greaterequal":7,"always":8},"CullMode":{"undefined":0,"none":1,"front":2,"back":3},"ErrorFilter":{"validation":1,"outofmemory":2,"internal":3},"FeatureName":{"corefeaturesandlimits":1,"depthclipcontrol":2,"depth32floatstencil8":3,"texturecompressionbc":4,"texturecompressionbcsliced3d":5,"texturecompressionetc2":6,"texturecompressionastc":7,"texturecompressionastcsliced3d":8,"timestampquery":9,"indirectfirstinstance":10,"shaderf16":11,"rg11b10ufloatrenderable":12,"bgra8unormstorage":13,"float32filterable":14,"float32blendable":15,"clipdistances":16,"dualsourceblending":17,"subgroups":18,"textureformatstier1":19,"textureformatstier2":20,"primitiveindex":21,"texturecomponentswizzle":22,"subgroupsizecontrol":23,"texturecompressionunaligned":24,"atomicvec2uminmax":25},"FilterMode":{"undefined":0,"nearest":1,"linear":2},"FrontFace":{"undefined":0,"ccw":1,"cw":2},"IndexFormat":{"undefined":0,"uint16":1,"uint32":2},"LoadOp":{"undefined":0,"load":1,"clear":2},"MipmapFilterMode":{"undefined":0,"nearest":1,"linear":2},"PowerPreference":{"undefined":0,"lowpower":1,"highperformance":2},"PrimitiveTopology":{"undefined":0,"pointlist":1,"linelist":2,"linestrip":3,"trianglelist":4,"trianglestrip":5},"QueryType":{"occlusion":1,"timestamp":2},"SamplerBindingType":{"bindingnotused":0,"undefined":1,"filtering":2,"nonfiltering":3,"comparison":4},"StencilOperation":{"undefined":0,"keep":1,"zero":2,"replace":3,"invert":4,"incrementclamp":5,"decrementclamp":6,"incrementwrap":7,"decrementwrap":8},"StorageTextureAccess":{"bindingnotused":0,"undefined":1,"writeonly":2,"readonly":3,"readwrite":4},"StoreOp":{"undefined":0,"store":1,"discard":2},"TextureAspect":{"undefined":0,"all":1,"stencilonly":2,"depthonly":3},"TextureDimension":{"undefined":0,"1d":1,"2d":2,"3d":3},"TextureFormat":{"undefined":0,"r8unorm":1,"r8snorm":2,"r8uint":3,"r8sint":4,"r16unorm":5,"r16snorm":6,"r16uint":7,"r16sint":8,"r16float":9,"rg8unorm":10,"rg8snorm":11,"rg8uint":12,"rg8sint":13,"r32float":14,"r32uint":15,"r32sint":16,"rg16unorm":17,"rg16snorm":18,"rg16uint":19,"rg16sint":20,"rg16float":21,"rgba8unorm":22,"rgba8unormsrgb":23,"rgba8snorm":24,"rgba8uint":25,"rgba8sint":26,"bgra8unorm":27,"bgra8unormsrgb":28,"rgb10a2uint":29,"rgb10a2unorm":30,"rg11b10ufloat":31,"rgb9e5ufloat":32,"rg32float":33,"rg32uint":34,"rg32sint":35,"rgba16unorm":36,"rgba16snorm":37,"rgba16uint":38,"rgba16sint":39,"rgba16float":40,"rgba32float":41,"rgba32uint":42,"rgba32sint":43,"stencil8":44,"depth16unorm":45,"depth24plus":46,"depth24plusstencil8":47,"depth32float":48,"depth32floatstencil8":49,"bc1rgbaunorm":50,"bc1rgbaunormsrgb":51,"bc2rgbaunorm":52,"bc2rgbaunormsrgb":53,"bc3rgbaunorm":54,"bc3rgbaunormsrgb":55,"bc4runorm":56,"bc4rsnorm":57,"bc5rgunorm":58,"bc5rgsnorm":59,"bc6hrgbufloat":60,"bc6hrgbfloat":61,"bc7rgbaunorm":62,"bc7rgbaunormsrgb":63,"etc2rgb8unorm":64,"etc2rgb8unormsrgb":65,"etc2rgb8a1unorm":66,"etc2rgb8a1unormsrgb":67,"etc2rgba8unorm":68,"etc2rgba8unormsrgb":69,"eacr11unorm":70,"eacr11snorm":71,"eacrg11unorm":72,"eacrg11snorm":73,"astc4x4unorm":74,"astc4x4unormsrgb":75,"astc5x4unorm":76,"astc5x4unormsrgb":77,"astc5x5unorm":78,"astc5x5unormsrgb":79,"astc6x5unorm":80,"astc6x5unormsrgb":81,"astc6x6unorm":82,"astc6x6unormsrgb":83,"astc8x5unorm":84,"astc8x5unormsrgb":85,"astc8x6unorm":86,"astc8x6unormsrgb":87,"astc8x8unorm":88,"astc8x8unormsrgb":89,"astc10x5unorm":90,"astc10x5unormsrgb":91,"astc10x6unorm":92,"astc10x6unormsrgb":93,"astc10x8unorm":94,"astc10x8unormsrgb":95,"astc10x10unorm":96,"astc10x10unormsrgb":97,"astc12x10unorm":98,"astc12x10unormsrgb":99,"astc12x12unorm":100,"astc12x12unormsrgb":101},"TextureSampleType":{"bindingnotused":0,"undefined":1,"float":2,"unfilterablefloat":3,"depth":4,"sint":5,"uint":6},"TextureViewDimension":{"undefined":0,"1d":1,"2d":2,"2darray":3,"cube":4,"cubearray":5,"3d":6},"VertexFormat":{"uint8":1,"uint8x2":2,"uint8x4":3,"sint8":4,"sint8x2":5,"sint8x4":6,"unorm8":7,"unorm8x2":8,"unorm8x4":9,"snorm8":10,"snorm8x2":11,"snorm8x4":12,"uint16":13,"uint16x2":14,"uint16x4":15,"sint16":16,"sint16x2":17,"sint16x4":18,"unorm16":19,"unorm16x2":20,"unorm16x4":21,"snorm16":22,"snorm16x2":23,"snorm16x4":24,"float16":25,"float16x2":26,"float16x4":27,"float32":28,"float32x2":29,"float32x3":30,"float32x4":31,"uint32":32,"uint32x2":33,"uint32x3":34,"uint32x4":35,"sint32":36,"sint32x2":37,"sint32x3":38,"sint32x4":39,"unorm1010102":40,"unorm8x4bgra":41,"snorm1010102":42},"VertexStepMode":{"undefined":0,"vertex":1,"instance":2}};

  // The limits in the order the host lists their values.
  const LIMITS = [
    "maxTextureDimension1D", "maxTextureDimension2D", "maxTextureDimension3D", "maxTextureArrayLayers",
    "maxBindGroups", "maxBindGroupsPlusVertexBuffers", "maxBindingsPerBindGroup",
    "maxDynamicUniformBuffersPerPipelineLayout", "maxDynamicStorageBuffersPerPipelineLayout",
    "maxSampledTexturesPerShaderStage", "maxSamplersPerShaderStage", "maxStorageBuffersPerShaderStage",
    "maxStorageTexturesPerShaderStage", "maxUniformBuffersPerShaderStage", "maxUniformBufferBindingSize",
    "maxStorageBufferBindingSize", "minUniformBufferOffsetAlignment", "minStorageBufferOffsetAlignment",
    "maxVertexBuffers", "maxBufferSize", "maxVertexAttributes", "maxVertexBufferArrayStride",
    "maxInterStageShaderVariables", "maxColorAttachments", "maxColorAttachmentBytesPerSample",
    "maxComputeWorkgroupStorageSize", "maxComputeInvocationsPerWorkgroup", "maxComputeWorkgroupSizeX",
    "maxComputeWorkgroupSizeY", "maxComputeWorkgroupSizeZ", "maxComputeWorkgroupsPerDimension",
  ];
  const FEATURES = [
    "core-features-and-limits", "depth-clip-control", "depth32float-stencil8", "texture-compression-bc",
    "texture-compression-bc-sliced-3d", "texture-compression-etc2", "texture-compression-astc",
    "texture-compression-astc-sliced-3d", "timestamp-query", "indirect-first-instance", "shader-f16",
    "rg11b10ufloat-renderable", "bgra8unorm-storage", "float32-filterable", "float32-blendable",
    "clip-distances", "dual-source-blending", "subgroups", "texture-formats-tier1", "texture-formats-tier2",
    "primitive-index", "texture-component-swizzle",
  ];

  const keys = new Map();
  const key = (name) => {
    let found = keys.get(name);
    if (found === undefined) keys.set(name, (found = String(name).replaceAll("-", "").toLowerCase()));
    return found;
  };
  // The number of `value` in enum `table`; `missing` for undefined.
  const en = (table, value, missing = 0) => {
    if (value === undefined || value === null) return missing;
    const number = E[table][key(value)];
    if (number === undefined) throw new TypeError("'" + value + "' is not a GPU" + table);
    return number;
  };
  const featureNames = new Map(FEATURES.map((name) => [E.FeatureName[key(name)], name]));

  // The top-level commands, as ui_js_gpu.wire has them.
  const REQUEST_ADAPTER = 1, REQUEST_DEVICE = 2, DESTROY_DEVICE = 3, DROP = 4;
  const CREATE_BUFFER = 10, BUFFER_WRITE_MAPPED = 11, BUFFER_UNMAP = 12, BUFFER_MAP = 13, BUFFER_DESTROY = 14;
  const CREATE_TEXTURE = 20, CREATE_VIEW = 21, TEXTURE_DESTROY = 22, CREATE_SAMPLER = 23;
  const CREATE_BIND_GROUP_LAYOUT = 24, CREATE_PIPELINE_LAYOUT = 25, CREATE_BIND_GROUP = 26, CREATE_SHADER_MODULE = 27;
  const CREATE_RENDER_PIPELINE = 28, CREATE_COMPUTE_PIPELINE = 29, PIPELINE_LAYOUT_OF = 30;
  const ENCODE = 31, SUBMIT = 32, WRITE_BUFFER = 33, WRITE_TEXTURE = 34, WORK_DONE = 35;
  const PUSH_ERROR_SCOPE = 36, POP_ERROR_SCOPE = 37, COMPILATION_INFO = 38;
  const CONFIGURE = 40, UNCONFIGURE = 41, CANVAS_TEXTURE = 42;
  // Inside ENCODE.
  const END = 0, RENDER_PASS = 1, COMPUTE_PASS = 2, COPY_BUFFER = 3, COPY_BUFFER_TO_TEXTURE = 4;
  const COPY_TEXTURE_TO_BUFFER = 5, COPY_TEXTURE = 6, CLEAR_BUFFER = 7;
  // Inside a pass.
  const SET_PIPELINE = 1, SET_BIND_GROUP = 2, SET_VERTEX_BUFFER = 3, SET_INDEX_BUFFER = 4, DRAW = 5;
  const DRAW_INDEXED = 6, SET_VIEWPORT = 7, SET_SCISSOR = 8, SET_BLEND_CONSTANT = 9, SET_STENCIL_REFERENCE = 10;
  const DRAW_INDIRECT = 11, DRAW_INDEXED_INDIRECT = 12, DISPATCH = 13, DISPATCH_INDIRECT = 14;
  // Replies with token 0: something the host tells a device unasked.
  const EVENT_ERROR = 1, EVENT_LOST = 2;

  const UNDEFINED_COUNT = 0xffffffff;
  let encoder = null;
  const utf8 = (text) => (encoder ??= new TextEncoder()).encode(text);

  // A growing run of little-endian words, strings and bytes.
  class Writer {
    constructor(size) {
      this.buffer = new ArrayBuffer(size);
      this.bytes = new Uint8Array(this.buffer);
      this.view = new DataView(this.buffer);
      this.at = 0;
    }
    need(count) {
      if (this.at + count <= this.buffer.byteLength) return;
      let size = this.buffer.byteLength * 2;
      while (size < this.at + count) size *= 2;
      const grown = new ArrayBuffer(size);
      new Uint8Array(grown).set(this.bytes.subarray(0, this.at));
      this.buffer = grown;
      this.bytes = new Uint8Array(grown);
      this.view = new DataView(grown);
    }
    u32(value) {
      this.need(4);
      this.view.setUint32(this.at, value >>> 0, true);
      this.at += 4;
    }
    i32(value) {
      this.need(4);
      this.view.setInt32(this.at, value | 0, true);
      this.at += 4;
    }
    f64(value) {
      this.need(8);
      this.view.setFloat64(this.at, +value, true);
      this.at += 8;
    }
    flag(value) {
      this.u32(value ? 1 : 0);
    }
    str(text) {
      const encoded = text === undefined || text === null || text === "" ? null : utf8(String(text));
      this.u32(encoded ? encoded.length : 0);
      if (encoded) this.raw(encoded);
    }
    raw(bytes) {
      this.need(bytes.length);
      this.bytes.set(bytes, this.at);
      this.at += bytes.length;
    }
    blob(bytes) {
      this.u32(bytes.length);
      this.raw(bytes);
    }
    id(object) {
      this.u32(object ? object._id : 0);
    }
  }

  // The stream to the host. It leaves at the end of the job that wrote its first command.
  const main = new Writer(1 << 16);
  let leaving = false;
  const frames = [];
  // Where the command being written starts: each has its length before it, so a command the
  // host cannot read does not cost it the ones after.
  let started = -1;
  function close() {
    if (started < 0) return;
    main.view.setUint32(started, main.at - started - 4, true);
    started = -1;
  }
  function send() {
    leaving = false;
    close();
    for (const context of frames) context._open = false;
    frames.length = 0;
    if (main.at === 0) return;
    native.gpu(main.bytes.subarray(0, main.at));
    main.at = 0;
    if (main.buffer.byteLength > 1 << 22) {
      main.buffer = new ArrayBuffer(1 << 16);
      main.bytes = new Uint8Array(main.buffer);
      main.view = new DataView(main.buffer);
    }
  }
  function command(op) {
    if (!leaving) {
      leaving = true;
      queueMicrotask(send);
    }
    close();
    started = main.at;
    main.u32(0);
    main.u32(op);
    return main;
  }

  // Ids of freed objects are used again, so the host's table stays as small as what is live.
  let lastId = 0;
  const freeIds = [];
  const newId = () => (freeIds.length ? freeIds.pop() : ++lastId);
  const dropped = typeof FinalizationRegistry === "function"
    ? new FinalizationRegistry((id) => {
        command(DROP).u32(id);
        freeIds.push(id);
      })
    : null;

  // What the host answers: a token for each promise.
  const waiting = new Map();
  let lastToken = 0;
  const devices = new Map();
  function ask(settle) {
    const token = ++lastToken;
    waiting.set(token, settle);
    return token;
  }
  native.gpuReplies = function (count) {
    let failure = null;
    for (let i = 0; i < count; i++) {
      const token = native.gpuReply(i, 0);
      const reply = { status: native.gpuReply(i, 1), number: native.gpuReply(i, 2), text: native.gpuReply(i, 3), bytes: null };
      const size = native.gpuReply(i, 4);
      if (size > 0) {
        reply.bytes = new Uint8Array(size);
        native.gpuReplyBytes(i, reply.bytes);
      }
      try {
        if (token === 0) devices.get(reply.number)?.deref()?._told(reply);
        else {
          const settle = waiting.get(token);
          waiting.delete(token);
          settle?.(reply);
        }
      } catch (error) {
        failure ??= { error };
      }
    }
    if (failure) throw failure.error;
  };

  // What the host does not run yet: the classes are there so `instanceof` works.
  class GPURenderBundleEncoder {
    constructor() {
      throw new TypeError("Illegal constructor");
    }
  }
  class GPURenderBundle {
    constructor() {
      throw new TypeError("Illegal constructor");
    }
  }
  class GPUQuerySet {
    constructor() {
      throw new TypeError("Illegal constructor");
    }
  }
  class GPUExternalTexture {
    constructor() {
      throw new TypeError("Illegal constructor");
    }
  }

  class GPUError extends Error {
    constructor(message) {
      super(message);
      this.name = new.target.name;
    }
  }
  class GPUValidationError extends GPUError {}
  class GPUOutOfMemoryError extends GPUError {}
  class GPUInternalError extends GPUError {}
  class GPUPipelineError extends Error {
    constructor(message, options) {
      super(message);
      this.name = "GPUPipelineError";
      this.reason = options?.reason ?? "validation";
    }
  }
  const errorOf = (status, text) =>
    status === 2 ? new GPUOutOfMemoryError(text) : status === 3 ? new GPUInternalError(text) : new GPUValidationError(text);
  const operationError = (text) => {
    const error = new Error(text);
    error.name = "OperationError";
    return error;
  };

  class GPUObject {
    constructor(label) {
      this._id = newId();
      this.label = label ?? "";
      dropped?.register(this, this._id);
    }
  }

  const sizeOf = (size) => {
    if (typeof size === "number") return [size, 1, 1];
    if (Array.isArray(size) || ArrayBuffer.isView(size)) return [size[0], size[1] ?? 1, size[2] ?? 1];
    return [size.width, size.height ?? 1, size.depthOrArrayLayers ?? 1];
  };
  const originOf = (origin) => {
    if (!origin) return [0, 0, 0];
    if (Array.isArray(origin) || ArrayBuffer.isView(origin)) return [origin[0] ?? 0, origin[1] ?? 0, origin[2] ?? 0];
    return [origin.x ?? 0, origin.y ?? 0, origin.z ?? 0];
  };
  const colorOf = (color) => {
    if (!color) return [0, 0, 0, 0];
    if (Array.isArray(color) || ArrayBuffer.isView(color)) return [color[0], color[1], color[2], color[3]];
    return [color.r, color.g, color.b, color.a];
  };
  const bytesOf = (data, offset, size) => {
    const view = ArrayBuffer.isView(data);
    const unit = view && data.BYTES_PER_ELEMENT ? data.BYTES_PER_ELEMENT : 1;
    const start = (view ? data.byteOffset : 0) + (offset ?? 0) * unit;
    const whole = view ? data.byteLength : data.byteLength;
    const length = size === undefined ? whole - (offset ?? 0) * unit : size * unit;
    if (length < 0 || (offset ?? 0) * unit + length > whole) throw operationError("the data is smaller than the range to write");
    return new Uint8Array(view ? data.buffer : data, start, length);
  };

  class GPUSupportedFeatures extends Set {}
  const featuresOf = (numbers) => {
    const set = new GPUSupportedFeatures();
    for (const number of numbers) {
      const name = featureNames.get(number);
      if (name) set.add(name);
    }
    return set;
  };
  class GPUSupportedLimits {}
  const limitsOf = (values) => {
    const limits = new GPUSupportedLimits();
    LIMITS.forEach((name, at) => Object.defineProperty(limits, name, { value: values[at], enumerable: true }));
    return limits;
  };
  class GPUAdapterInfo {
    constructor(info) {
      this.vendor = info.vendor;
      this.architecture = info.architecture;
      this.device = info.device;
      this.description = info.description;
      this.subgroupMinSize = info.subgroupMinSize;
      this.subgroupMaxSize = info.subgroupMaxSize;
      this.isFallbackAdapter = info.fallback;
    }
  }

  class GPU {
    requestAdapter(options = {}) {
      return new Promise((resolve) => {
        const adapter = new GPUAdapter();
        const token = ask((reply) => {
          if (reply.status !== 0) return resolve(null);
          adapter._found(JSON.parse(reply.text));
          resolve(adapter);
        });
        const w = command(REQUEST_ADAPTER);
        w.u32(token);
        w.id(adapter);
        w.u32(en("PowerPreference", options.powerPreference));
        w.flag(options.forceFallbackAdapter);
      });
    }
    // As Chrome on desktop systems: BGRA canvases are the ones whose frames reach the window
    // without a copy where the devices share images (gpu_canvas.silk).
    getPreferredCanvasFormat() {
      return "bgra8unorm";
    }
    get wgslLanguageFeatures() {
      return new Set();
    }
  }

  class GPUAdapter extends GPUObject {
    _found(found) {
      this.features = featuresOf(found.features);
      this.limits = limitsOf(found.limits);
      this.info = new GPUAdapterInfo(found.info);
      this.isFallbackAdapter = found.info.fallback;
      this._used = false;
    }
    requestDevice(descriptor = {}) {
      if (this._used) return Promise.reject(operationError("this adapter already made a device: request another adapter"));
      this._used = true;
      const features = [];
      for (const name of descriptor.requiredFeatures ?? []) {
        if (!this.features.has(name)) return Promise.reject(new TypeError("the adapter has no feature '" + name + "'"));
        features.push(E.FeatureName[key(name)]);
      }
      const limits = [];
      for (const [name, value] of Object.entries(descriptor.requiredLimits ?? {})) {
        const at = LIMITS.indexOf(name);
        if (at < 0) return Promise.reject(operationError("there is no limit '" + name + "'"));
        if (value !== undefined) limits.push([at, value]);
      }
      return new Promise((resolve, reject) => {
        const device = new GPUDevice(descriptor.label, this.info);
        const token = ask((reply) => {
          if (reply.status !== 0) return reject(operationError(reply.text || "the device could not be made"));
          device._made(JSON.parse(reply.text));
          resolve(device);
        });
        const w = command(REQUEST_DEVICE);
        w.u32(token);
        w.id(this);
        w.id(device);
        w.str(descriptor.label);
        w.u32(features.length);
        for (const feature of features) w.u32(feature);
        w.u32(limits.length);
        for (const [at, value] of limits) {
          w.u32(at);
          w.f64(value);
        }
      });
    }
  }

  class GPUDeviceLostInfo {
    constructor(reason, message) {
      this.reason = reason;
      this.message = message;
    }
  }
  class GPUUncapturedErrorEvent extends Event {
    constructor(type, init) {
      super(type, init);
      this.error = init.error;
    }
  }

  class GPUDevice extends EventTarget {
    constructor(label, info) {
      super();
      this._id = newId();
      this.label = label ?? "";
      this.adapterInfo = info;
      this.onuncapturederror = null;
      this.queue = new GPUQueue(this);
      this.lost = new Promise((resolve) => (this._lose = resolve));
      this._scopes = 0;
      devices.set(this._id, new WeakRef(this));
      dropped?.register(this, this._id);
    }
    _made(made) {
      this.features = featuresOf(made.features);
      this.limits = limitsOf(made.limits);
    }
    _told(reply) {
      if (reply.status === EVENT_LOST) {
        this._lose(new GPUDeviceLostInfo(reply.text === "destroyed" ? "destroyed" : "unknown", reply.text));
        return;
      }
      const error = errorOf(reply.bytes ? reply.bytes[0] : 1, reply.text);
      const event = new GPUUncapturedErrorEvent("uncapturederror", { error, cancelable: true });
      let handled = false;
      if (typeof this.onuncapturederror === "function") {
        handled = true;
        this.onuncapturederror(event);
      }
      if (!this.dispatchEvent(event)) handled = true;
      if (!handled) console.error("Uncaptured WebGPU error: " + reply.text);
    }
    destroy() {
      command(DESTROY_DEVICE).id(this);
      this._lose(new GPUDeviceLostInfo("destroyed", "the device was destroyed"));
    }
    createBuffer(descriptor) {
      return new GPUBuffer(this, descriptor);
    }
    createTexture(descriptor) {
      return new GPUTexture(this, descriptor);
    }
    createSampler(descriptor = {}) {
      const sampler = new GPUSampler(descriptor.label);
      const w = command(CREATE_SAMPLER);
      w.id(this);
      w.id(sampler);
      w.str(descriptor.label);
      w.u32(en("AddressMode", descriptor.addressModeU ?? "clamp-to-edge"));
      w.u32(en("AddressMode", descriptor.addressModeV ?? "clamp-to-edge"));
      w.u32(en("AddressMode", descriptor.addressModeW ?? "clamp-to-edge"));
      w.u32(en("FilterMode", descriptor.magFilter ?? "nearest"));
      w.u32(en("FilterMode", descriptor.minFilter ?? "nearest"));
      w.u32(en("MipmapFilterMode", descriptor.mipmapFilter ?? "nearest"));
      w.f64(descriptor.lodMinClamp ?? 0);
      w.f64(descriptor.lodMaxClamp ?? 32);
      w.u32(en("CompareFunction", descriptor.compare));
      w.u32(descriptor.maxAnisotropy ?? 1);
      return sampler;
    }
    createBindGroupLayout(descriptor) {
      const layout = new GPUBindGroupLayout(descriptor.label);
      const entries = Array.from(descriptor.entries);
      const w = command(CREATE_BIND_GROUP_LAYOUT);
      w.id(this);
      w.id(layout);
      w.str(descriptor.label);
      w.u32(entries.length);
      for (const entry of entries) {
        w.u32(entry.binding);
        w.u32(entry.visibility);
        if (entry.buffer) {
          w.u32(0);
          w.u32(en("BufferBindingType", entry.buffer.type ?? "uniform"));
          w.flag(entry.buffer.hasDynamicOffset);
          w.f64(entry.buffer.minBindingSize ?? 0);
        } else if (entry.sampler) {
          w.u32(1);
          w.u32(en("SamplerBindingType", entry.sampler.type ?? "filtering"));
        } else if (entry.texture) {
          w.u32(2);
          w.u32(en("TextureSampleType", entry.texture.sampleType ?? "float"));
          w.u32(en("TextureViewDimension", entry.texture.viewDimension ?? "2d"));
          w.flag(entry.texture.multisampled);
        } else if (entry.storageTexture) {
          w.u32(3);
          w.u32(en("StorageTextureAccess", entry.storageTexture.access ?? "write-only"));
          w.u32(en("TextureFormat", entry.storageTexture.format));
          w.u32(en("TextureViewDimension", entry.storageTexture.viewDimension ?? "2d"));
        } else {
          throw new TypeError("a bind group layout entry needs a buffer, sampler, texture or storageTexture (external textures are not supported)");
        }
      }
      return layout;
    }
    createPipelineLayout(descriptor) {
      const layout = new GPUPipelineLayout(descriptor.label);
      const layouts = Array.from(descriptor.bindGroupLayouts);
      const w = command(CREATE_PIPELINE_LAYOUT);
      w.id(this);
      w.id(layout);
      w.str(descriptor.label);
      w.u32(layouts.length);
      for (const one of layouts) w.id(one);
      return layout;
    }
    createBindGroup(descriptor) {
      const group = new GPUBindGroup(descriptor.label);
      const entries = Array.from(descriptor.entries).map((entry) => {
        let resource = entry.resource;
        if (resource instanceof GPUTexture) resource = resource.createView();
        if (resource instanceof GPUBuffer) resource = { buffer: resource };
        return { binding: entry.binding, resource };
      });
      const w = command(CREATE_BIND_GROUP);
      w.id(this);
      w.id(group);
      w.str(descriptor.label);
      w.id(descriptor.layout);
      w.u32(entries.length);
      for (const { binding, resource } of entries) {
        w.u32(binding);
        if (resource instanceof GPUSampler) {
          w.u32(1);
          w.id(resource);
        } else if (resource instanceof GPUTextureView) {
          w.u32(2);
          w.id(resource);
        } else if (resource && resource.buffer instanceof GPUBuffer) {
          w.u32(0);
          w.id(resource.buffer);
          w.f64(resource.offset ?? 0);
          w.f64(resource.size ?? -1);
        } else {
          throw new TypeError("a bind group entry's resource is a sampler, a texture view or a buffer binding");
        }
      }
      return group;
    }
    createShaderModule(descriptor) {
      const module = new GPUShaderModule(descriptor.label);
      const w = command(CREATE_SHADER_MODULE);
      w.id(this);
      w.id(module);
      w.str(descriptor.label);
      w.str(descriptor.code);
      return module;
    }
    createRenderPipeline(descriptor) {
      const pipeline = new GPURenderPipeline(descriptor.label);
      writeRenderPipeline(this, pipeline, 0, descriptor);
      return pipeline;
    }
    createRenderPipelineAsync(descriptor) {
      return new Promise((resolve, reject) => {
        const pipeline = new GPURenderPipeline(descriptor.label);
        const token = ask((reply) =>
          reply.status === 0 ? resolve(pipeline) : reject(new GPUPipelineError(reply.text, { reason: reply.status === 3 ? "internal" : "validation" })));
        writeRenderPipeline(this, pipeline, token, descriptor);
      });
    }
    createComputePipeline(descriptor) {
      const pipeline = new GPUComputePipeline(descriptor.label);
      writeComputePipeline(this, pipeline, 0, descriptor);
      return pipeline;
    }
    createComputePipelineAsync(descriptor) {
      return new Promise((resolve, reject) => {
        const pipeline = new GPUComputePipeline(descriptor.label);
        const token = ask((reply) =>
          reply.status === 0 ? resolve(pipeline) : reject(new GPUPipelineError(reply.text, { reason: reply.status === 3 ? "internal" : "validation" })));
        writeComputePipeline(this, pipeline, token, descriptor);
      });
    }
    createCommandEncoder(descriptor = {}) {
      return new GPUCommandEncoder(this, descriptor);
    }
    createQuerySet() {
      throw operationError("query sets are not supported yet");
    }
    createRenderBundleEncoder() {
      throw operationError("render bundles are not supported yet");
    }
    importExternalTexture() {
      throw operationError("external textures are not supported");
    }
    pushErrorScope(filter) {
      this._scopes++;
      const w = command(PUSH_ERROR_SCOPE);
      w.id(this);
      w.u32(en("ErrorFilter", filter));
    }
    popErrorScope() {
      if (this._scopes === 0) return Promise.reject(operationError("there is no error scope to pop"));
      this._scopes--;
      return new Promise((resolve) => {
        const token = ask((reply) => resolve(reply.status === 0 ? null : errorOf(reply.status, reply.text)));
        const w = command(POP_ERROR_SCOPE);
        w.u32(token);
        w.id(this);
      });
    }
  }

  function writeStage(w, stage) {
    w.id(stage.module);
    w.str(stage.entryPoint);
    const constants = Object.entries(stage.constants ?? {});
    w.u32(constants.length);
    for (const [name, value] of constants) {
      w.str(name);
      w.f64(Number(value));
    }
  }
  function writeStencilFace(w, face = {}) {
    w.u32(en("CompareFunction", face.compare ?? "always"));
    w.u32(en("StencilOperation", face.failOp ?? "keep"));
    w.u32(en("StencilOperation", face.depthFailOp ?? "keep"));
    w.u32(en("StencilOperation", face.passOp ?? "keep"));
  }
  function writeBlend(w, part = {}) {
    w.u32(en("BlendOperation", part.operation ?? "add"));
    w.u32(en("BlendFactor", part.srcFactor ?? "one"));
    w.u32(en("BlendFactor", part.dstFactor ?? "zero"));
  }
  function writeRenderPipeline(device, pipeline, token, descriptor) {
    const w = command(CREATE_RENDER_PIPELINE);
    w.id(device);
    w.id(pipeline);
    w.u32(token);
    w.str(descriptor.label);
    w.id(descriptor.layout === "auto" ? null : descriptor.layout);
    writeStage(w, descriptor.vertex);
    const buffers = Array.from(descriptor.vertex.buffers ?? []);
    w.u32(buffers.length);
    for (const buffer of buffers) {
      if (!buffer) {
        w.f64(0);
        w.u32(0);
        w.u32(0);
        continue;
      }
      const attributes = Array.from(buffer.attributes);
      w.f64(buffer.arrayStride);
      w.u32(en("VertexStepMode", buffer.stepMode ?? "vertex"));
      w.u32(attributes.length);
      for (const attribute of attributes) {
        w.u32(en("VertexFormat", attribute.format));
        w.f64(attribute.offset);
        w.u32(attribute.shaderLocation);
      }
    }
    const primitive = descriptor.primitive ?? {};
    w.u32(en("PrimitiveTopology", primitive.topology ?? "triangle-list"));
    w.u32(en("IndexFormat", primitive.stripIndexFormat));
    w.u32(en("FrontFace", primitive.frontFace ?? "ccw"));
    w.u32(en("CullMode", primitive.cullMode ?? "none"));
    w.flag(primitive.unclippedDepth);
    const depth = descriptor.depthStencil;
    w.flag(depth);
    if (depth) {
      w.u32(en("TextureFormat", depth.format));
      w.u32(depth.depthWriteEnabled === undefined ? 2 : depth.depthWriteEnabled ? 1 : 0);
      w.u32(en("CompareFunction", depth.depthCompare));
      writeStencilFace(w, depth.stencilFront);
      writeStencilFace(w, depth.stencilBack);
      w.u32(depth.stencilReadMask ?? 0xffffffff);
      w.u32(depth.stencilWriteMask ?? 0xffffffff);
      w.i32(depth.depthBias ?? 0);
      w.f64(depth.depthBiasSlopeScale ?? 0);
      w.f64(depth.depthBiasClamp ?? 0);
    }
    const multisample = descriptor.multisample ?? {};
    w.u32(multisample.count ?? 1);
    w.u32(multisample.mask ?? 0xffffffff);
    w.flag(multisample.alphaToCoverageEnabled);
    const fragment = descriptor.fragment;
    w.flag(fragment);
    if (fragment) {
      writeStage(w, fragment);
      const targets = Array.from(fragment.targets);
      w.u32(targets.length);
      for (const target of targets) {
        w.u32(target ? en("TextureFormat", target.format) : 0);
        w.flag(target?.blend);
        if (target?.blend) {
          writeBlend(w, target.blend.color);
          writeBlend(w, target.blend.alpha);
        }
        w.u32(target?.writeMask ?? 0xf);
      }
    }
  }
  function writeComputePipeline(device, pipeline, token, descriptor) {
    const w = command(CREATE_COMPUTE_PIPELINE);
    w.id(device);
    w.id(pipeline);
    w.u32(token);
    w.str(descriptor.label);
    w.id(descriptor.layout === "auto" ? null : descriptor.layout);
    writeStage(w, descriptor.compute);
  }

  class GPUQueue {
    constructor(device) {
      this._device = device;
      this.label = "";
    }
    submit(buffers) {
      const list = Array.from(buffers);
      for (const buffer of list) {
        if (buffer._submitted) throw operationError("a command buffer can be submitted once");
        buffer._submitted = true;
      }
      const w = command(SUBMIT);
      w.id(this._device);
      w.u32(list.length);
      for (const buffer of list) w.id(buffer);
    }
    writeBuffer(buffer, bufferOffset, data, dataOffset, size) {
      const bytes = bytesOf(data, dataOffset, size);
      const w = command(WRITE_BUFFER);
      w.id(this._device);
      w.id(buffer);
      w.f64(bufferOffset);
      w.blob(bytes);
    }
    writeTexture(destination, data, dataLayout = {}, size) {
      const bytes = bytesOf(data, undefined, undefined);
      const w = command(WRITE_TEXTURE);
      w.id(this._device);
      writeTextureInfo(w, destination);
      w.f64(dataLayout.offset ?? 0);
      w.u32(dataLayout.bytesPerRow ?? UNDEFINED_COUNT);
      w.u32(dataLayout.rowsPerImage ?? UNDEFINED_COUNT);
      for (const part of sizeOf(size)) w.u32(part);
      w.blob(bytes);
    }
    copyExternalImageToTexture(source, destination, copySize) {
      const image = source.source;
      if (!image || !image.data || !image.width || !image.height) {
        throw operationError("copyExternalImageToTexture takes pixels here: an object with data, width and height (ImageData)");
      }
      const [width, height] = sizeOf(copySize);
      const [x, y] = originOf(source.origin);
      let pixels = new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength);
      if (source.flipY) {
        const flipped = new Uint8Array(pixels.length);
        const row = image.width * 4;
        for (let line = 0; line < image.height; line++) flipped.set(pixels.subarray(line * row, line * row + row), (image.height - 1 - line) * row);
        pixels = flipped;
      }
      this.writeTexture(destination, pixels, { offset: (y * image.width + x) * 4, bytesPerRow: image.width * 4, rowsPerImage: image.height }, [width, height, 1]);
    }
    onSubmittedWorkDone() {
      return new Promise((resolve) => {
        const token = ask(() => resolve(undefined));
        const w = command(WORK_DONE);
        w.u32(token);
        w.id(this._device);
      });
    }
  }

  function writeTextureInfo(w, info) {
    w.id(info.texture);
    w.u32(info.mipLevel ?? 0);
    for (const part of originOf(info.origin)) w.u32(part);
    w.u32(en("TextureAspect", info.aspect ?? "all"));
  }
  function writeBufferInfo(w, info) {
    w.id(info.buffer);
    w.f64(info.offset ?? 0);
    w.u32(info.bytesPerRow ?? UNDEFINED_COUNT);
    w.u32(info.rowsPerImage ?? UNDEFINED_COUNT);
  }

  const MAP_READ = 1, MAP_WRITE = 2;

  class GPUBuffer extends GPUObject {
    constructor(device, descriptor) {
      super(descriptor.label);
      this._device = device;
      this.size = descriptor.size;
      this.usage = descriptor.usage;
      // What is mapped: null, or { mode, offset, size, bytes (what a read saw), ranges }.
      this._mapped = descriptor.mappedAtCreation ? { mode: MAP_WRITE, offset: 0, size: this.size, bytes: null, ranges: [] } : null;
      this._pending = false;
      const w = command(CREATE_BUFFER);
      w.id(device);
      w.id(this);
      w.str(descriptor.label);
      w.f64(this.size);
      w.u32(this.usage);
      w.flag(descriptor.mappedAtCreation);
    }
    get mapState() {
      return this._pending ? "pending" : this._mapped ? "mapped" : "unmapped";
    }
    mapAsync(mode, offset = 0, size) {
      if (this._pending || this._mapped) return Promise.reject(operationError("the buffer is already mapped or being mapped"));
      const length = size ?? Math.max(0, this.size - offset);
      this._pending = true;
      return new Promise((resolve, reject) => {
        const token = ask((reply) => {
          if (!this._pending) return reject(Object.assign(new Error("the buffer was unmapped before the mapping finished"), { name: "AbortError" }));
          this._pending = false;
          if (reply.status !== 0) return reject(operationError(reply.text || "the buffer could not be mapped"));
          this._mapped = { mode, offset, size: length, bytes: reply.bytes, ranges: [] };
          resolve(undefined);
        });
        const w = command(BUFFER_MAP);
        w.u32(token);
        w.id(this._device);
        w.id(this);
        w.u32(mode);
        w.f64(offset);
        w.f64(length);
      });
    }
    getMappedRange(offset = 0, size) {
      const mapped = this._mapped;
      if (!mapped) throw operationError("the buffer is not mapped");
      const length = size ?? Math.max(0, mapped.offset + mapped.size - offset);
      if (offset < mapped.offset || offset + length > mapped.offset + mapped.size) throw operationError("the range is outside what is mapped");
      for (const range of mapped.ranges) {
        if (offset < range.offset + range.buffer.byteLength && range.offset < offset + length) throw operationError("the range overlaps one already taken");
      }
      const buffer = new ArrayBuffer(length);
      if (mapped.bytes) new Uint8Array(buffer).set(mapped.bytes.subarray(offset - mapped.offset, offset - mapped.offset + length));
      mapped.ranges.push({ offset, buffer });
      return buffer;
    }
    unmap() {
      const mapped = this._mapped;
      this._pending = false;
      if (!mapped) return;
      this._mapped = null;
      for (const range of mapped.ranges) {
        if (mapped.mode === MAP_WRITE && range.buffer.byteLength > 0) {
          const w = command(BUFFER_WRITE_MAPPED);
          w.id(this);
          w.f64(range.offset);
          w.blob(new Uint8Array(range.buffer));
        }
        // The range is gone for JavaScript, as on the web.
        if (typeof range.buffer.transfer === "function") range.buffer.transfer();
      }
      command(BUFFER_UNMAP).id(this);
    }
    destroy() {
      this._mapped = null;
      this._pending = false;
      command(BUFFER_DESTROY).id(this);
    }
  }

  class GPUTexture extends GPUObject {
    constructor(device, descriptor, canvas) {
      super(descriptor.label);
      this._device = device;
      [this.width, this.height, this.depthOrArrayLayers] = sizeOf(descriptor.size);
      this.mipLevelCount = descriptor.mipLevelCount ?? 1;
      this.sampleCount = descriptor.sampleCount ?? 1;
      this.dimension = descriptor.dimension ?? "2d";
      this.format = descriptor.format;
      this.usage = descriptor.usage;
      if (canvas) return;
      const formats = Array.from(descriptor.viewFormats ?? []);
      const w = command(CREATE_TEXTURE);
      w.id(device);
      w.id(this);
      w.str(descriptor.label);
      w.u32(this.width);
      w.u32(this.height);
      w.u32(this.depthOrArrayLayers);
      w.u32(this.mipLevelCount);
      w.u32(this.sampleCount);
      w.u32(en("TextureDimension", this.dimension));
      w.u32(en("TextureFormat", this.format));
      w.u32(this.usage);
      w.u32(formats.length);
      for (const format of formats) w.u32(en("TextureFormat", format));
    }
    createView(descriptor = {}) {
      const view = new GPUTextureView(descriptor.label);
      view._texture = this;
      const w = command(CREATE_VIEW);
      w.id(this);
      w.id(view);
      w.str(descriptor.label);
      w.u32(en("TextureFormat", descriptor.format));
      w.u32(en("TextureViewDimension", descriptor.dimension));
      w.u32(descriptor.baseMipLevel ?? 0);
      w.u32(descriptor.mipLevelCount ?? UNDEFINED_COUNT);
      w.u32(descriptor.baseArrayLayer ?? 0);
      w.u32(descriptor.arrayLayerCount ?? UNDEFINED_COUNT);
      w.u32(en("TextureAspect", descriptor.aspect ?? "all"));
      w.u32(descriptor.usage ?? 0);
      return view;
    }
    destroy() {
      command(TEXTURE_DESTROY).id(this);
    }
  }

  class GPUTextureView extends GPUObject {}
  class GPUSampler extends GPUObject {}
  class GPUBindGroupLayout extends GPUObject {}
  class GPUPipelineLayout extends GPUObject {}
  class GPUBindGroup extends GPUObject {}
  class GPUCommandBuffer extends GPUObject {}

  class GPUCompilationInfo {
    constructor(messages) {
      this.messages = messages;
    }
  }
  class GPUShaderModule extends GPUObject {
    getCompilationInfo() {
      return new Promise((resolve) => {
        const token = ask((reply) => resolve(new GPUCompilationInfo(reply.text ? JSON.parse(reply.text) : [])));
        const w = command(COMPILATION_INFO);
        w.u32(token);
        w.id(this);
      });
    }
  }

  function layoutOf(pipeline, index) {
    const layout = new GPUBindGroupLayout("");
    const w = command(PIPELINE_LAYOUT_OF);
    w.id(pipeline);
    w.u32(index);
    w.id(layout);
    return layout;
  }
  class GPURenderPipeline extends GPUObject {
    getBindGroupLayout(index) {
      return layoutOf(this, index);
    }
  }
  class GPUComputePipeline extends GPUObject {
    getBindGroupLayout(index) {
      return layoutOf(this, index);
    }
  }

  // An encoder writes into a stream of its own, which `finish` puts into the main one whole:
  // the host makes the native encoder, runs the commands and finishes it in one go.
  class GPUCommandEncoder {
    constructor(device, descriptor) {
      this._device = device;
      this.label = descriptor.label ?? "";
      this._w = new Writer(1 << 12);
      // What the commands name, kept from collection until they reach the main stream.
      this._keep = [];
      this._pass = null;
      this._done = false;
    }
    _ready() {
      if (this._done) throw operationError("the encoder is finished");
      if (this._pass) throw operationError("a pass of this encoder is still open");
      return this._w;
    }
    _use(object) {
      if (object) this._keep.push(object);
      return object;
    }
    beginRenderPass(descriptor) {
      const w = this._ready();
      const colors = Array.from(descriptor.colorAttachments);
      w.u32(RENDER_PASS);
      w.str(descriptor.label);
      w.u32(colors.length);
      for (const color of colors) {
        const view = color ? this._view(color.view) : null;
        w.id(view);
        if (!view) continue;
        w.u32(color.depthSlice ?? UNDEFINED_COUNT);
        w.id(color.resolveTarget ? this._view(color.resolveTarget) : null);
        w.u32(en("LoadOp", color.loadOp));
        w.u32(en("StoreOp", color.storeOp));
        for (const part of colorOf(color.clearValue)) w.f64(part);
      }
      const depth = descriptor.depthStencilAttachment;
      w.flag(depth);
      if (depth) {
        w.id(this._view(depth.view));
        w.u32(en("LoadOp", depth.depthLoadOp));
        w.u32(en("StoreOp", depth.depthStoreOp));
        w.f64(depth.depthClearValue ?? NaN);
        w.flag(depth.depthReadOnly);
        w.u32(en("LoadOp", depth.stencilLoadOp));
        w.u32(en("StoreOp", depth.stencilStoreOp));
        w.u32(depth.stencilClearValue ?? 0);
        w.flag(depth.stencilReadOnly);
      }
      return (this._pass = new GPURenderPassEncoder(this, descriptor.label));
    }
    _view(target) {
      return this._use(target instanceof GPUTexture ? target.createView() : target);
    }
    beginComputePass(descriptor = {}) {
      const w = this._ready();
      w.u32(COMPUTE_PASS);
      w.str(descriptor.label);
      return (this._pass = new GPUComputePassEncoder(this, descriptor.label));
    }
    copyBufferToBuffer(source, sourceOffset, destination, destinationOffset, size) {
      // The short form: (source, destination, size).
      if (sourceOffset instanceof GPUBuffer) {
        size = destination;
        destination = sourceOffset;
        sourceOffset = 0;
        destinationOffset = 0;
      }
      const w = this._ready();
      w.u32(COPY_BUFFER);
      w.id(this._use(source));
      w.f64(sourceOffset ?? 0);
      w.id(this._use(destination));
      w.f64(destinationOffset ?? 0);
      w.f64(size ?? source.size - (sourceOffset ?? 0));
    }
    copyBufferToTexture(source, destination, copySize) {
      const w = this._ready();
      w.u32(COPY_BUFFER_TO_TEXTURE);
      writeBufferInfo(w, source);
      writeTextureInfo(w, destination);
      for (const part of sizeOf(copySize)) w.u32(part);
      this._use(source.buffer);
      this._use(destination.texture);
    }
    copyTextureToBuffer(source, destination, copySize) {
      const w = this._ready();
      w.u32(COPY_TEXTURE_TO_BUFFER);
      writeTextureInfo(w, source);
      writeBufferInfo(w, destination);
      for (const part of sizeOf(copySize)) w.u32(part);
      this._use(source.texture);
      this._use(destination.buffer);
    }
    copyTextureToTexture(source, destination, copySize) {
      const w = this._ready();
      w.u32(COPY_TEXTURE);
      writeTextureInfo(w, source);
      writeTextureInfo(w, destination);
      for (const part of sizeOf(copySize)) w.u32(part);
      this._use(source.texture);
      this._use(destination.texture);
    }
    clearBuffer(buffer, offset = 0, size) {
      const w = this._ready();
      w.u32(CLEAR_BUFFER);
      w.id(this._use(buffer));
      w.f64(offset);
      w.f64(size ?? -1);
    }
    pushDebugGroup() {}
    popDebugGroup() {}
    insertDebugMarker() {}
    finish(descriptor = {}) {
      const w = this._ready();
      this._done = true;
      const buffer = new GPUCommandBuffer(descriptor.label);
      const out = command(ENCODE);
      out.id(this._device);
      out.id(buffer);
      out.str(this.label);
      out.raw(w.bytes.subarray(0, w.at));
      out.u32(END);
      this._w = null;
      this._keep = null;
      return buffer;
    }
  }

  class GPUPassEncoder {
    constructor(parent, label) {
      this._parent = parent;
      this._w = parent._w;
      this.label = label ?? "";
    }
    _open() {
      if (!this._w) throw operationError("the pass has ended");
      return this._w;
    }
    setBindGroup(index, group, offsets, start, length) {
      const w = this._open();
      w.u32(SET_BIND_GROUP);
      w.u32(index);
      w.id(this._parent._use(group));
      const from = start ?? 0;
      const count = offsets ? (length ?? offsets.length - from) : 0;
      w.u32(count);
      for (let i = 0; i < count; i++) w.u32(offsets[from + i]);
    }
    pushDebugGroup() {}
    popDebugGroup() {}
    insertDebugMarker() {}
    end() {
      this._open().u32(END);
      this._w = null;
      this._parent._pass = null;
    }
  }

  class GPURenderPassEncoder extends GPUPassEncoder {
    setPipeline(pipeline) {
      const w = this._open();
      w.u32(SET_PIPELINE);
      w.id(this._parent._use(pipeline));
    }
    setVertexBuffer(slot, buffer, offset = 0, size) {
      const w = this._open();
      w.u32(SET_VERTEX_BUFFER);
      w.u32(slot);
      w.id(this._parent._use(buffer));
      w.f64(offset);
      w.f64(size ?? -1);
    }
    setIndexBuffer(buffer, format, offset = 0, size) {
      const w = this._open();
      w.u32(SET_INDEX_BUFFER);
      w.id(this._parent._use(buffer));
      w.u32(en("IndexFormat", format));
      w.f64(offset);
      w.f64(size ?? -1);
    }
    draw(vertexCount, instanceCount = 1, firstVertex = 0, firstInstance = 0) {
      const w = this._open();
      w.u32(DRAW);
      w.u32(vertexCount);
      w.u32(instanceCount);
      w.u32(firstVertex);
      w.u32(firstInstance);
    }
    drawIndexed(indexCount, instanceCount = 1, firstIndex = 0, baseVertex = 0, firstInstance = 0) {
      const w = this._open();
      w.u32(DRAW_INDEXED);
      w.u32(indexCount);
      w.u32(instanceCount);
      w.u32(firstIndex);
      w.i32(baseVertex);
      w.u32(firstInstance);
    }
    drawIndirect(buffer, offset) {
      const w = this._open();
      w.u32(DRAW_INDIRECT);
      w.id(this._parent._use(buffer));
      w.f64(offset);
    }
    drawIndexedIndirect(buffer, offset) {
      const w = this._open();
      w.u32(DRAW_INDEXED_INDIRECT);
      w.id(this._parent._use(buffer));
      w.f64(offset);
    }
    setViewport(x, y, width, height, minDepth, maxDepth) {
      const w = this._open();
      w.u32(SET_VIEWPORT);
      for (const part of [x, y, width, height, minDepth, maxDepth]) w.f64(part);
    }
    setScissorRect(x, y, width, height) {
      const w = this._open();
      w.u32(SET_SCISSOR);
      for (const part of [x, y, width, height]) w.u32(part);
    }
    setBlendConstant(color) {
      const w = this._open();
      w.u32(SET_BLEND_CONSTANT);
      for (const part of colorOf(color)) w.f64(part);
    }
    setStencilReference(reference) {
      const w = this._open();
      w.u32(SET_STENCIL_REFERENCE);
      w.u32(reference);
    }
    beginOcclusionQuery() {
      throw operationError("query sets are not supported yet");
    }
    endOcclusionQuery() {}
    executeBundles() {
      throw operationError("render bundles are not supported yet");
    }
  }

  class GPUComputePassEncoder extends GPUPassEncoder {
    setPipeline(pipeline) {
      const w = this._open();
      w.u32(SET_PIPELINE);
      w.id(this._parent._use(pipeline));
    }
    dispatchWorkgroups(x, y = 1, z = 1) {
      const w = this._open();
      w.u32(DISPATCH);
      w.u32(x);
      w.u32(y);
      w.u32(z);
    }
    dispatchWorkgroupsIndirect(buffer, offset) {
      const w = this._open();
      w.u32(DISPATCH_INDIRECT);
      w.id(this._parent._use(buffer));
      w.f64(offset);
    }
  }

  const CANVAS_USAGE = 0x10;

  // What `canvas.getContext("webgpu")` gives. `canvas` is a canvas node (`nodeId`, `width`,
  // `height`); the node calls `_resized` when its size attributes change.
  class GPUCanvasContext {
    constructor(canvas) {
      this.canvas = canvas;
      this._id = newId();
      this._configuration = null;
      this._texture = null;
      this._open = false;
    }
    configure(configuration) {
      const format = configuration.format;
      if (format !== "rgba8unorm" && format !== "bgra8unorm") {
        throw new TypeError("a canvas here is 'rgba8unorm' or 'bgra8unorm', not '" + format + "'");
      }
      this._configuration = {
        device: configuration.device,
        format,
        usage: configuration.usage ?? CANVAS_USAGE,
        viewFormats: Array.from(configuration.viewFormats ?? []),
        colorSpace: configuration.colorSpace ?? "srgb",
        toneMapping: configuration.toneMapping ?? { mode: "standard" },
        alphaMode: configuration.alphaMode ?? "opaque",
      };
      this._send();
    }
    _send() {
      const configuration = this._configuration;
      this._texture = null;
      this._width = Math.max(1, this.canvas.width | 0);
      this._height = Math.max(1, this.canvas.height | 0);
      const w = command(CONFIGURE);
      w.id(this);
      w.u32(this.canvas.nodeId);
      w.id(configuration.device);
      w.u32(this._width);
      w.u32(this._height);
      w.u32(en("TextureFormat", configuration.format));
      w.flag(configuration.alphaMode === "opaque");
    }
    _resized() {
      if (this._configuration) this._send();
    }
    unconfigure() {
      if (!this._configuration) return;
      this._configuration = null;
      this._texture = null;
      const w = command(UNCONFIGURE);
      w.id(this);
      w.u32(this.canvas.nodeId);
    }
    getConfiguration() {
      return this._configuration ? { ...this._configuration } : null;
    }
    getCurrentTexture() {
      const configuration = this._configuration;
      if (!configuration) throw operationError("the canvas context is not configured");
      this._texture ??= new GPUTexture(configuration.device, {
        label: "canvas",
        size: [this._width, this._height, 1],
        format: configuration.format,
        usage: configuration.usage,
      }, this);
      // The first use in a job says which texture the frame is drawn into; the host shows the
      // canvas once the commands of the turn ran.
      if (!this._open) {
        this._open = true;
        const w = command(CANVAS_TEXTURE);
        w.id(this);
        w.id(this._texture);
        frames.push(this);
      }
      return this._texture;
    }
  }

  const contexts = new WeakMap();
  const flags = (values) => Object.freeze(values);

  return {
    gpu: new GPU(),
    context(canvas) {
      let context = contexts.get(canvas);
      if (!context) contexts.set(canvas, (context = new GPUCanvasContext(canvas)));
      return context;
    },
    globals: {
      GPU, GPUAdapter, GPUAdapterInfo, GPUDevice, GPUQueue, GPUBuffer, GPUTexture, GPUTextureView, GPUSampler,
      GPUBindGroupLayout, GPUPipelineLayout, GPUBindGroup, GPUShaderModule, GPUCompilationInfo, GPURenderPipeline,
      GPUComputePipeline, GPUCommandEncoder, GPUCommandBuffer, GPURenderPassEncoder, GPUComputePassEncoder,
      GPUCanvasContext, GPUSupportedFeatures, GPUSupportedLimits, GPUDeviceLostInfo, GPUError, GPUValidationError,
      GPUOutOfMemoryError, GPUInternalError, GPUPipelineError, GPUUncapturedErrorEvent,
      GPURenderBundleEncoder, GPURenderBundle, GPUQuerySet, GPUExternalTexture,
      GPUBufferUsage: flags({ MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512 }),
      GPUTextureUsage: flags({ COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 }),
      GPUShaderStage: flags({ VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 }),
      GPUMapMode: flags({ READ: 1, WRITE: 2 }),
      GPUColorWrite: flags({ RED: 1, GREEN: 2, BLUE: 4, ALPHA: 8, ALL: 15 }),
    },
  };
})
