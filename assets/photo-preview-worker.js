// Only one image is sent to this worker at a time. No original is decoded in
// the page's main thread, including browsers/formats without preview support.
self.onmessage = async function (event) {
  const { id, file } = event.data;
  const optimize = event.data.optimize === true && /^image\/jpe?g$/i.test(file.type || "");
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") {
    self.postMessage({ id, unsupported: true });
    return;
  }
  let bitmap, previewCanvas, uploadCanvas;
  try {
    // Optimization preserves the original pixel dimensions, including the
    // orientation applied by the browser. Originals mode only needs a preview.
    bitmap = optimize
      ? await createImageBitmap(file)
      : await createImageBitmap(file, { resizeWidth: 360, resizeQuality: "low" });
    const scale = Math.min(1, 360 / bitmap.width, 360 / bitmap.height);
    previewCanvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
    const context = previewCanvas.getContext("2d");
    if (!context || typeof previewCanvas.convertToBlob !== "function") {
      self.postMessage({ id, unsupported: true });
      return;
    }
    context.drawImage(bitmap, 0, 0, previewCanvas.width, previewCanvas.height);
    if (optimize) {
      uploadCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      uploadCanvas.getContext("2d").drawImage(bitmap, 0, 0);
    }
    bitmap.close();
    bitmap = null;
    const blob = await previewCanvas.convertToBlob({ type: "image/jpeg", quality: 0.72 });
    let uploadBlob;
    if (uploadCanvas) {
      // JPEG re-encoding removes original EXIF metadata. Keep the original
      // unless the high-quality version saves at least ten percent of bytes.
      const candidate = await uploadCanvas.convertToBlob({ type: "image/jpeg", quality: 0.94 });
      if (candidate.type === "image/jpeg" && candidate.size > 0 && candidate.size <= file.size * 0.9) uploadBlob = candidate;
    }
    self.postMessage({ id, blob, uploadBlob });
  } catch (_) {
    // Unsupported formats keep their filename placeholder and still upload.
    self.postMessage({ id, failed: true });
  } finally {
    if (bitmap) bitmap.close();
    // Release full-resolution canvas memory before processing the next file.
    if (previewCanvas) { previewCanvas.width = 1; previewCanvas.height = 1; }
    if (uploadCanvas) { uploadCanvas.width = 1; uploadCanvas.height = 1; }
  }
};
