import assert from 'node:assert/strict';
import test from 'node:test';
import { PageCanvases } from './page-canvases.mjs';

// A WebGPU device that records what it is asked: enough of one for a canvas picture to be
// read back on the page's device and written into a texture of the renderer's.
function fakeDevice(log) {
  return {
    queue: {
      submit: list => log.push(['submit', list.length]),
      writeTexture: (target, data, layout, size) => log.push(['write', target.texture.format, size, Array.from(data)]),
      copyExternalImageToTexture: () => log.push(['copyExternal']),
    },
    createBuffer: descriptor => ({
      size: descriptor.size,
      rows: null,
      mapAsync() { return Promise.resolve(); },
      getMappedRange() { return this.rows.buffer; },
      destroy() { log.push(['destroyBuffer']); },
    }),
    createCommandEncoder: () => ({
      copyTextureToBuffer(source, target, size) {
        // Two pixels a row in a 256 byte row, as the canvas's texture holds them.
        const rows = new Uint8Array(target.buffer.size);
        source.texture.pixels.forEach((row, y) => rows.set(row, y * target.bytesPerRow));
        target.buffer.rows = rows;
        log.push(['readBack', size]);
      },
      finish: () => ({}),
    }),
    createTexture: descriptor => ({
      ...descriptor,
      createView() { return { of: this }; },
      destroy() { log.push(['destroyTexture']); },
    }),
  };
}

function fakeTable(device) {
  const views = [];
  return { views, get: () => device, add: view => views.push(view) + 100 };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('a canvas picture is read back on the page device and written to a renderer texture', async () => {
  const log = [];
  const renderer = fakeDevice(log);
  const page = fakeDevice(log);
  const table = fakeTable(renderer);
  const canvases = new PageCanvases(table);
  let woken = 0;
  canvases.wake = () => woken++;
  const surface = canvases.open({});
  assert.equal(surface, 1);
  canvases.configured(surface, page, 'bgra8unorm', true);
  // Before the renderer's first frame there is no device to copy to on the GPU.
  assert.equal(canvases.sync(9), 0);
  canvases.direct = false;

  canvases.drawn(surface, { width: 2, height: 2, pixels: [[1, 2, 3, 0, 4, 5, 6, 0], [7, 8, 9, 0, 10, 11, 12, 0]] });
  canvases.drawn(surface, { width: 9, height: 9, pixels: [] });
  await settle();
  assert.equal(woken, 1, 'a picture that arrives asks for a frame');
  assert.deepEqual(log.filter(entry => entry[0] === 'readBack'), [['readBack', [2, 2]]], 'one picture a turn');

  assert.equal(canvases.sync(9), 1, 'the new texture is a change for the renderer');
  const write = log.find(entry => entry[0] === 'write');
  assert.equal(write[1], 'bgra8unorm', 'the texture has the canvas format: no channel is swapped');
  assert.deepEqual(write[2], [2, 2]);
  assert.deepEqual(write[3], [1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255], 'rows are packed and an opaque canvas has alpha one');
  assert.equal(canvases.change(), surface);
  assert.equal(canvases.view(), 101);
  assert.equal(table.views.length, 1);
  assert.equal(canvases.change(), 0);
  assert.equal(canvases.view(), 0);

  // The same size again reuses the texture.
  canvases.drawn(surface, { width: 2, height: 2, pixels: [[0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0]] });
  await settle();
  assert.equal(canvases.sync(9), 0);

  canvases.close(surface);
  assert.equal(canvases.sync(9), 1);
  assert.equal(canvases.change(), surface);
  assert.equal(canvases.view(), 0, 'a closed surface has no view');
});

test('where canvases copy on the GPU, a picture goes straight to the renderer texture', async () => {
  const log = [];
  const renderer = fakeDevice(log);
  const canvases = new PageCanvases(fakeTable(renderer));
  const surface = canvases.open({});
  canvases.configured(surface, fakeDevice(log), 'rgba8unorm', false);
  canvases.sync(9);
  canvases.direct = true;
  canvases.drawn(surface, { width: 4, height: 3 });
  await settle();
  assert.deepEqual(log.map(entry => entry[0]), ['copyExternal']);
  assert.equal(canvases.sync(9), 1);
});
