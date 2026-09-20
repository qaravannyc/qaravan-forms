import assert from "node:assert/strict";
import { File } from "node:buffer";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../assets/photo-previews.js", import.meta.url), "utf8");
const workerSource = readFileSync(new URL("../assets/photo-preview-worker.js", import.meta.url), "utf8");

function harness({ support = true, constructorFails = false } = {}) {
  const workers = [], timers = new Map(), created = [], revoked = [];
  let nextTimer = 0;
  class Worker {
    constructor(url) {
      if (constructorFails) throw new Error("Worker blocked");
      assert.equal(url, "/assets/photo-preview-worker.js");
      this.messages = [];
      workers.push(this);
    }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
    respond(data) { this.onmessage({ data }); }
  }
  const window = {};
  vm.runInNewContext(source, {
    window, Worker: support ? Worker : undefined, Blob, File,
    URL: {
      createObjectURL(blob) { assert.ok(blob instanceof Blob); const url = `blob:${created.length}`; created.push(url); return url; },
      revokeObjectURL(url) { revoked.push(url); }
    },
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  return {
    workers, created, revoked, enqueue: window.QPhotoPreview.enqueue,
    tick(delay = 16) {
      for (const [id, timer] of timers) {
        if (timer.delay === delay) { timers.delete(id); timer.fn(); return; }
      }
      assert.fail(`No ${delay}ms timer pending`);
    }
  };
}

function image() {
  return { hidden: false, removeAttribute(name) { delete this[name]; } };
}

test("selection yields before processing and only one original is in flight", () => {
  const h = harness();
  const images = Array.from({ length: 20 }, image);
  images.forEach((img, i) => h.enqueue(img, { name: `${i}.jpg` }));
  assert.ok(images.every(img => img.hidden && !img.src));
  assert.equal(h.workers.length, 0);
  h.tick();
  const worker = h.workers[0];
  assert.equal(worker.messages.length, 1);
  worker.respond({ id: worker.messages[0].id, blob: new Blob(["thumbnail"]) });
  assert.equal(worker.messages.length, 1);
  h.tick();
  assert.equal(worker.messages.length, 2);
  assert.equal(h.workers.length, 1);
});

test("thumbnail appears only after loading and its object URL is released", () => {
  const h = harness(), img = image();
  const cleanup = h.enqueue(img, {});
  h.tick();
  h.workers[0].respond({ id: 1, blob: new Blob(["thumbnail"]) });
  assert.equal(img.hidden, true);
  assert.equal(img.src, "blob:0");
  img.onload();
  assert.equal(img.hidden, false);
  assert.deepEqual(h.revoked, ["blob:0"]);
  cleanup();
  assert.equal(img.hidden, true);
  assert.equal(img.src, undefined);
  assert.deepEqual(h.revoked, ["blob:0"]);
});

test("cancelled queued files never reach the worker", () => {
  const h = harness();
  h.enqueue(image(), { name: "first" });
  h.enqueue(image(), { name: "cancelled" })();
  h.enqueue(image(), { name: "third" });
  h.tick();
  h.workers[0].respond({ id: 1, failed: true });
  h.tick();
  assert.deepEqual(h.workers[0].messages.map(message => message.file.name), ["first", "third"]);
});

test("cancelling active work terminates decoding and ignores stale completion", () => {
  const h = harness(), removed = image();
  const cleanup = h.enqueue(removed, {});
  h.enqueue(image(), {});
  h.tick();
  const oldWorker = h.workers[0];
  cleanup();
  assert.equal(oldWorker.terminated, true);
  h.tick();
  oldWorker.respond({ id: 1, blob: new Blob(["late thumbnail"]) });
  assert.equal(h.created.length, 0);
  assert.equal(removed.src, undefined);
  assert.equal(h.workers[1].messages.length, 1);
});

test("a stuck decoder times out and the next file gets a fresh worker", () => {
  const h = harness();
  h.enqueue(image(), {});
  h.enqueue(image(), {});
  h.tick();
  h.tick(10000);
  assert.equal(h.workers[0].terminated, true);
  h.tick();
  assert.equal(h.workers[1].messages[0].id, 2);
});

test("missing or blocked workers leave placeholders without original image URLs", () => {
  for (const options of [{ support: false }, { constructorFails: true }]) {
    const h = harness(options), img = image();
    h.enqueue(img, {});
    if (options.constructorFails) h.tick();
    assert.equal(img.hidden, true);
    assert.equal(img.src, undefined);
    assert.equal(h.created.length, 0);
  }
});

test("unsupported worker capabilities disable previews for the remaining queue", () => {
  const h = harness(), first = image(), second = image();
  h.enqueue(first, {});
  h.enqueue(second, {});
  h.tick();
  h.workers[0].respond({ id: 1, unsupported: true });
  assert.equal(h.workers[0].terminated, true);
  assert.ok(first.hidden && second.hidden);
  assert.equal(h.created.length, 0);
});

test("failed, cancelled, and stalled thumbnail loads all release their URLs", () => {
  for (const action of ["error", "cancel", "timeout"]) {
    const h = harness(), img = image();
    const cleanup = h.enqueue(img, {});
    h.tick();
    h.workers[0].respond({ id: 1, blob: new Blob(["thumbnail"]) });
    if (action === "error") img.onerror();
    if (action === "cancel") cleanup();
    if (action === "timeout") h.tick(10000);
    assert.equal(img.hidden, true);
    assert.equal(img.src, undefined);
    assert.deepEqual(h.revoked, ["blob:0"]);
  }
});

test("worker bounds portrait and landscape outputs and closes each bitmap", async () => {
  for (const [width, height] of [[360, 480], [480, 360]]) {
    let closed = 0, dimensions, message;
    const bitmap = { width, height, close() { closed++; } };
    const self = { postMessage(data) { message = data; } };
    vm.runInNewContext(workerSource, {
      self, createImageBitmap: async () => bitmap,
      OffscreenCanvas: class {
        constructor(w, h) { this.width = w; this.height = h; dimensions = [w, h]; }
        getContext() { return { drawImage() {} }; }
        async convertToBlob() { return new Blob(["thumbnail"]); }
      }
    });
    await self.onmessage({ data: { id: 1, file: {} } });
    assert.equal(Math.max(...dimensions), 360);
    assert.equal(dimensions[0] / dimensions[1], width / height);
    assert.equal(closed, 1);
    assert.ok(message.blob instanceof Blob);
  }
});

test("worker releases decoded memory when canvas processing fails", async () => {
  let closed = 0, message;
  const self = { postMessage(data) { message = data; } };
  vm.runInNewContext(workerSource, {
    self,
    createImageBitmap: async () => ({ width: 360, height: 360, close() { closed++; } }),
    OffscreenCanvas: class { constructor() { throw new Error("out of memory"); } }
  });
  await self.onmessage({ data: { id: 1, file: {} } });
  assert.equal(closed, 1);
  assert.equal(message.failed, true);
});

function jpeg() {
  return new File([new Uint8Array(1000)], "original.jpg", { type: "image/jpeg", lastModified: 12345 });
}

test("originals and excluded formats are ready before preview decoding starts", async () => {
  for (const [file, optimize] of [[jpeg(), false], [new File(["png"], "photo.png", { type: "image/png" }), true]]) {
    const h = harness();
    const cleanup = h.enqueue(image(), file, { optimize });
    assert.equal(await cleanup.ready, file);
    assert.equal(h.workers.length, 0);
  }
});

test("optimized JPEGs retain their filename and timestamp and require ten percent savings", async () => {
  for (const size of [850, 900, 901, 1100]) {
    const h = harness(), file = jpeg();
    const cleanup = h.enqueue(image(), file, { optimize: true });
    h.tick();
    assert.equal(h.workers[0].messages[0].optimize, true);
    h.workers[0].respond({ id: 1, uploadBlob: new Blob([new Uint8Array(size)], { type: "image/jpeg" }) });
    const result = await cleanup.ready;
    assert.equal(result.size, size <= 900 ? size : file.size);
    assert.equal(result.name, file.name);
    assert.equal(result.lastModified, file.lastModified);
    assert.equal(result.type, "image/jpeg");
    if (size > 900) assert.equal(result, file);
  }
});

test("cancelled preparation resolves null whether queued or actively decoding", async () => {
  for (const started of [false, true]) {
    const h = harness();
    const cleanup = h.enqueue(image(), jpeg(), { optimize: true });
    if (started) h.tick();
    cleanup();
    assert.equal(await cleanup.ready, null);
  }
});

test("failed or timed-out preparation always resolves to the original file", async () => {
  for (const failure of ["missing", "blocked", "unsupported", "decode", "timeout", "worker-error"]) {
    const h = harness({ support: failure !== "missing", constructorFails: failure === "blocked" });
    const file = jpeg(), nextFile = jpeg();
    const first = h.enqueue(image(), file, { optimize: true });
    const second = h.enqueue(image(), nextFile, { optimize: true });
    if (failure !== "missing") h.tick();
    if (failure === "unsupported") h.workers[0].respond({ id: 1, unsupported: true });
    if (failure === "decode") h.workers[0].respond({ id: 1, failed: true });
    if (failure === "timeout") h.tick(10000);
    if (failure === "worker-error") h.workers[0].onerror({ preventDefault() {} });
    assert.equal(await first.ready, file);
    if (failure === "decode" || failure === "timeout") {
      h.tick();
      h.workers.at(-1).respond({ id: 2, failed: true });
    }
    assert.equal(await second.ready, nextFile);
  }
});

test("optimization decodes once, preserves full pixel dimensions and uses quality 0.94", async () => {
  for (const candidateSize of [850, 950]) {
    const canvases = [], decodeCalls = [];
    let closed = 0, message;
    const self = { postMessage(data) { message = data; } };
    vm.runInNewContext(workerSource, {
      self,
      createImageBitmap: async (...args) => { decodeCalls.push(args); return { width: 4032, height: 3024, close() { closed++; } }; },
      OffscreenCanvas: class {
        constructor(width, height) { this.width = width; this.height = height; this.originalDimensions = [width, height]; canvases.push(this); }
        getContext() { return { drawImage() {} }; }
        async convertToBlob(options) {
          this.options = options;
          return new Blob([new Uint8Array(this.originalDimensions[0] > 360 ? candidateSize : 50)], { type: "image/jpeg" });
        }
      }
    });
    await self.onmessage({ data: { id: 1, file: jpeg(), optimize: true } });
    assert.equal(decodeCalls.length, 1);
    assert.equal(decodeCalls[0].length, 1, "Full-resolution decode must not specify a resize");
    assert.deepEqual(canvases[0].originalDimensions, [360, 270]);
    assert.deepEqual(canvases[1].originalDimensions, [4032, 3024]);
    assert.equal(canvases[1].options.quality, 0.94);
    assert.equal(closed, 1);
    assert.ok(canvases.every(canvas => canvas.width === 1 && canvas.height === 1));
    assert.ok(message.blob instanceof Blob);
    assert.equal(message.uploadBlob?.size, candidateSize <= 900 ? candidateSize : undefined);
  }
});
