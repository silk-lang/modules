import { test } from "node:test";
import assert from "node:assert/strict";
import { installMock } from "./mock.js";

installMock();
const { compute, terminateComputePool } = await import("../src/index.js");

test("compute executes pure worker functions and returns cloned results", async () => {
  try {
    const sum = await compute((items) => items.reduce((a, b) => a + b, 0), [1, 2, 3, 4, 5]);
    assert.equal(sum, 15);
  } finally {
    terminateComputePool();
  }
});

test("compute supports transferable ArrayBuffers", async () => {
  try {
    const input = new Uint8Array([10, 20, 30, 40]);
    const doubled = await compute(
      (buf) => {
        const view = new Uint8Array(buf);
        for (let i = 0; i < view.length; i++) view[i] *= 2;
        return buf;
      },
      input.buffer,
      { transfer: [input.buffer] },
    );
    assert.equal(input.buffer.byteLength, 0, "transferred buffer is detached on caller");
    assert.deepEqual(Array.from(new Uint8Array(doubled)), [20, 40, 60, 80]);
  } finally {
    terminateComputePool();
  }
});

test("compute honors pre-aborted and in-flight AbortSignal", async () => {
  try {
    const pre = new AbortController();
    pre.abort(new Error("already stopped"));
    await assert.rejects(() => compute((x) => x + 1, 1, { signal: pre.signal }), /already stopped/);

    const live = new AbortController();
    const pending = compute(
      () => {
        const deadline = Date.now() + 250;
        while (Date.now() < deadline) {}
        return 42;
      },
      undefined,
      { signal: live.signal },
    );
    setTimeout(() => live.abort(new Error("cancelled in flight")), 10);
    await assert.rejects(() => pending, /cancelled in flight/);

    // Subsequent calls continue cleanly on a fresh pooled worker.
    assert.equal(await compute((x) => x * 3, 7), 21);
  } finally {
    terminateComputePool();
  }
});
