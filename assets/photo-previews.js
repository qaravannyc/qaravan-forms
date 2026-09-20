// One worker prepares previews and optional JPEG uploads without blocking UI.
(function () {
  "use strict";
  const queue = [];
  const TIMEOUT_MS = 10000;
  let worker = null, active = null, timeout = null, scheduled = false;
  let disabled = typeof Worker !== "function", nextId = 0;

  function revoke(job) {
    if (job.url) URL.revokeObjectURL(job.url);
    job.url = null;
    if (job.loadTimeout) clearTimeout(job.loadTimeout);
    job.loadTimeout = null;
  }

  function stopWorker() {
    if (worker) worker.terminate();
    worker = null;
  }

  function schedule() {
    if (scheduled || active || disabled || !queue.length) return;
    scheduled = true;
    // Let selection placeholders paint and network uploads start first.
    setTimeout(() => { scheduled = false; pump(); }, 16);
  }

  function settle(job, file) {
    if (!job.resolve) return;
    job.resolve(file);
    job.resolve = null;
  }

  function finish() {
    if (timeout) clearTimeout(timeout);
    timeout = null;
    if (active) {
      settle(active, active.cancelled ? null : active.file);
      active.file = null;
    }
    active = null;
    schedule();
  }

  function disable() {
    disabled = true;
    stopWorker();
    for (const job of queue) {
      settle(job, job.cancelled ? null : job.file);
      job.file = null;
    }
    queue.length = 0;
    finish();
  }

  function show(job, blob) {
    if (job.cancelled) return;
    try {
      job.url = URL.createObjectURL(blob);
      const done = success => {
        job.img.onload = null;
        job.img.onerror = null;
        job.img.hidden = !success || job.cancelled;
        if (!success || job.cancelled) job.img.removeAttribute("src");
        revoke(job);
      };
      job.img.onload = () => done(true);
      job.img.onerror = () => done(false);
      job.loadTimeout = setTimeout(() => done(false), TIMEOUT_MS);
      job.img.src = job.url;
    } catch (_) {
      job.img.onload = null;
      job.img.onerror = null;
      job.img.removeAttribute("src");
      job.img.hidden = true;
      revoke(job);
    }
  }

  function getWorker() {
    if (worker) return worker;
    const current = new Worker("/assets/photo-preview-worker.js");
    worker = current;
    current.onmessage = event => {
      if (worker !== current || !active) return;
      const data = event.data || {};
      if (data.id !== active.id) return;
      if (data.unsupported) { disable(); return; }
      if (data.blob instanceof Blob && data.blob.size && !active.cancelled) {
        show(active, data.blob);
      }
      if (active.optimize && !active.cancelled && data.uploadBlob instanceof Blob
          && data.uploadBlob.type === "image/jpeg"
          && data.uploadBlob.size > 0 && data.uploadBlob.size <= active.file.size * 0.9) {
        try {
          settle(active, new File([data.uploadBlob], active.file.name, {
            type: "image/jpeg", lastModified: active.file.lastModified
          }));
        } catch (_) { /* The original remains the upload fallback. */ }
      }
      finish();
    };
    current.onerror = event => {
      if (event.preventDefault) event.preventDefault();
      if (worker === current) disable();
    };
    return current;
  }

  function pump() {
    if (active || disabled) return;
    while (queue.length && queue[0].cancelled) queue.shift();
    if (!queue.length) return;
    active = queue.shift();
    const job = active;
    try {
      const current = getWorker();
      timeout = setTimeout(() => {
        if (active !== job) return;
        stopWorker();
        finish();
      }, TIMEOUT_MS);
      current.postMessage({ id: job.id, file: job.file, optimize: job.optimize });
    } catch (_) {
      disable();
    }
  }

  window.QPhotoPreview = {
    enqueue(img, file, options = {}) {
      img.hidden = true;
      const optimize = options.optimize === true && /^image\/jpe?g$/i.test(file.type || "");
      let resolve;
      const ready = new Promise(done => { resolve = done; });
      const job = { id: ++nextId, img, file: disabled ? null : file, optimize, resolve, cancelled: false, url: null, loadTimeout: null };
      // Originals and formats we do not re-encode can start uploading at once.
      if (!optimize || disabled) settle(job, file);
      if (!disabled) { queue.push(job); schedule(); }
      const cleanup = function () {
        if (job.cancelled) return;
        job.cancelled = true;
        settle(job, null);
        job.file = null;
        job.img.onload = null;
        job.img.onerror = null;
        job.img.removeAttribute("src");
        job.img.hidden = true;
        revoke(job);
        const index = queue.indexOf(job);
        if (index !== -1) queue.splice(index, 1);
        if (active === job) {
          stopWorker();
          finish();
        }
      };
      cleanup.ready = ready;
      return cleanup;
    }
  };
})();
