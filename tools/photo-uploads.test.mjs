import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the real page code without a browser, network, or Google credentials.
// The DOM only implements the nodes these photo controls actually use; uploads
// and token requests remain pending until the test explicitly completes them.
class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.style = {};
    this.className = '';
    this.value = '';
    this.listeners = {};
    this.classList = {
      contains: name => this.className.split(/\s+/).includes(name),
      add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(' '); },
    };
  }
  appendChild(child) {
    child.remove();
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
  }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  set innerHTML(html) {
    this.children.forEach(child => { child.parentNode = null; });
    this.children = [];
    if (html.includes('ph-name')) {
      const name = new Element('span');
      name.className = 'ph-name';
      this.appendChild(name);
    }
    if (html.includes('<img')) this.appendChild(new Element('img'));
    if (html.includes('<video')) this.appendChild(new Element('video'));
    if (html.includes('ph-bar')) {
      const bar = new Element('div');
      bar.className = 'ph-bar';
      bar.appendChild(new Element('i'));
      this.appendChild(bar);
    }
  }
  querySelector(selector) {
    const [first, ...rest] = selector.split(' ');
    const match = node => first.startsWith('.') ? node.classList.contains(first.slice(1)) : node.tagName === first;
    for (const child of this.children) {
      if (match(child)) return rest.length ? child.querySelector(rest.join(' ')) : child;
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const flush = () => new Promise(resolve => setImmediate(resolve));
const file = (name = 'photo.jpg', type = 'image/jpeg') => ({ name, type, size: 12_000_000 });

async function drainUploads(h) {
  for (let round = 0; round < 100; round++) {
    h.tokenRequests.forEach((_, index) => h.authorize(index));
    await flush();
    h.uploads.filter(upload => upload.inFlight).forEach(upload => upload.succeed());
    await flush();
    if (!h.schedulerActive) return;
  }
  assert.fail('Upload queue did not drain');
}

function harness(page, { holdPreparation = false, language = 'en' } = {}) {
  const source = readFileSync(new URL(`../pages/${page}.html`, import.meta.url), 'utf8');
  const stringsStart = source.indexOf('const STRINGS =');
  const stringsEnd = source.indexOf('const params =', stringsStart);
  assert.ok(stringsStart !== -1 && stringsEnd !== -1, `${page}: translations are present`);
  const strings = vm.runInNewContext(`${source.slice(stringsStart, stringsEnd)}; STRINGS`);
  const start = source.indexOf('const PH_MAX_SIZE =');
  const end = source.indexOf('// =====', start);
  assert.ok(start !== -1 && end !== -1, `${page}: photo block is present`);
  const submitStart = source.indexOf('$("f").addEventListener("submit",');
  const submitEnd = source.indexOf('\n});', submitStart) + '\n});'.length;
  assert.ok(submitStart !== -1 && submitEnd > submitStart, `${page}: submit handler is present`);
  const elements = new Map();
  const $ = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  $('headcount').value = '10';
  const events = ['event-a', 'event-b'].map(id => ({ id, rating: 5, photos: [], phStatus: new Element() }));
  const tokenRequests = [], uploads = [], submissions = [], previews = [], revoked = [];
  let active = 0, maxActive = 0;
  class FakeXHR {
    constructor() { this.upload = {}; this.headers = {}; this.inFlight = false; }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(name, value) { this.headers[name] = value; }
    send(body) {
      this.body = body;
      this.inFlight = true;
      active++;
      maxActive = Math.max(maxActive, active);
      uploads.push(this);
    }
    settle() {
      if (this.inFlight) active--;
      this.inFlight = false;
    }
    succeed(token = `upload-${uploads.indexOf(this)}`) {
      this.settle(); this.status = 200; this.responseText = token;
      this.onload?.();
    }
    fail() { this.settle(); this.onerror?.(); }
    abort() { this.aborted = true; this.settle(); this.onabort?.(); }
  }
  const context = vm.createContext({
    $, document: { createElement: tag => new Element(tag), querySelector: () => new Element() },
    XMLHttpRequest: FakeXHR,
    QPhotoPreview: { enqueue(img, original, options) {
      const pending = deferred();
      const preview = { img, file: original, options, ...pending, cancelled: false };
      previews.push(preview);
      if (!holdPreparation || !options.optimize) pending.resolve(original);
      const cancel = () => { preview.cancelled = true; pending.resolve(null); };
      cancel.ready = pending.promise;
      return cancel;
    } },
    URL: { createObjectURL: () => `blob:media-${Math.random()}`, revokeObjectURL: url => revoked.push(url) },
    fetch(url, options) {
      if (url === '/api/photos-token') {
        const pending = deferred();
        tokenRequests.push({ ...pending, eventId: JSON.parse(options.body).eventId });
        return pending.promise;
      }
      assert.equal(url, '/api/submit');
      submissions.push(JSON.parse(options.body));
      return Promise.resolve({ ok: true, json: async () => ({}) });
    },
    eventId: 'event-a', ev: events, lang: language, pTok: 'participant',
    T: () => strings[language], STRINGS: strings, rating: 5, contactOk: '', consent: '', customQ: '',
    high: new Set(), low: new Set(), why: new Set(), obstacles: new Set(), missing: new Set(),
    render() {}, goStep() {}, answered: event => !!event.rating || !!event.na, clearDraft() {}, rescueFiles: async () => {},
    window: { scrollTo() {} },
  });
  context.window.QPhotoPreview = context.QPhotoPreview;
  vm.runInContext(source.slice(start, end), context, { filename: `pages/${page}.html:photos` });
  vm.runInContext(source.slice(submitStart, submitEnd), context, { filename: `pages/${page}.html:submit` });
  const records = index => page === 'multi' ? events[index || 0].photos : vm.runInContext('photos', context);
  return {
    $, context, events, tokenRequests, uploads, submissions, previews, revoked, records,
    get active() { return active; }, get maxActive() { return maxActive; },
    get schedulerActive() { return vm.runInContext('phActive', context); },
    originals(enabled, index = 0) {
      if (page === 'multi') events[index].uploadOriginal = enabled;
      else $('phOriginal').checked = enabled;
    },
    prepare(index, prepared = previews[index].file) { previews[index].resolve(prepared); },
    status(index = 0) { return page === 'multi' ? events[index].phStatus : $('phStatus'); },
    add(files, index = 0) {
      if (page === 'multi') context.phAdd(events[index], files, $(`grid-${index}`), $(`error-${index}`));
      else context.phAddFiles(files);
    },
    remove(record) { record.el.querySelector('.ph-x').onclick(); },
    authorize(index = 0) {
      const request = tokenRequests[index];
      request.resolve({ ok: true, json: async () => ({ token: `access-${request.eventId}`, expiresIn: 3600 }) });
    },
    submit() { return $('f').listeners.submit({ preventDefault() {} }); },
  };
}

for (const page of ['attendee', 'lead', 'photos', 'multi']) {
  test(`${page}: accepts 50 files, rejects the 51st, and removal frees a slot`, async () => {
    const h = harness(page);
    const originals = Array.from({ length: 51 }, (_, i) => file(`photo-${i}.jpg`));
    h.add(originals);
    assert.equal(h.records().length, 50);
    const error = h.$(page === 'multi' ? 'error-0' : 'phErr');
    assert.equal(error.classList.contains('show'), true);
    const removed = h.records()[10];
    h.remove(removed);
    const replacement = file('replacement.jpg');
    h.add([replacement]);
    assert.equal(h.records().filter(record => record.status !== 'removed').length, 50);
    assert.equal(error.classList.contains('show'), false);
    await drainUploads(h);
    assert.equal(h.uploads.length, 50);
    assert.equal(h.maxActive, 4);
    assert.equal(h.uploads.some(upload => upload.body === originals[10]), false);
    assert.equal(h.uploads.some(upload => upload.body === originals[50]), false);
    assert.equal(h.uploads.some(upload => upload.body === replacement), true);
    await h.submit();
    assert.equal(h.submissions.length, 1);
    const submitted = page === 'multi' ? h.submissions[0].events[0].photos : h.submissions[0].photos;
    assert.equal(submitted.length, 50);
  });

  test(`${page}: upload at most four originals concurrently with one shared token request`, async () => {
    const h = harness(page);
    h.originals(true);
    const originals = Array.from({ length: 9 }, (_, i) => file(`photo-${i}.jpg`));
    h.add(originals);
    assert.equal(h.tokenRequests.length, 1);
    assert.equal(h.uploads.length, 0);
    assert.equal(h.schedulerActive, 4);
    h.authorize();
    await flush();
    assert.equal(h.active, 4);
    assert.equal(h.uploads.length, 4);
    assert.equal(h.previews.length, originals.length);
    for (let round = 0; round < 3; round++) {
      h.uploads.filter(upload => upload.inFlight).forEach(upload => upload.succeed());
      await flush();
    }
    assert.equal(h.uploads.length, originals.length);
    assert.equal(h.maxActive, 4);
    assert.equal(h.active, 0);
    assert.equal(h.schedulerActive, 0);
    assert.equal(h.tokenRequests.length, 1);
    assert.ok(h.records().every(record => record.status === 'done'));
    h.uploads.forEach((upload, index) => {
      assert.equal(upload.body, originals[index], 'send the original File, not a thumbnail');
      assert.equal(h.previews[index].file, originals[index]);
      assert.equal(h.previews[index].options.optimize, false);
      assert.equal(upload.headers.Authorization, 'Bearer access-event-a');
      assert.equal(upload.headers['X-Goog-Upload-Content-Type'], 'image/jpeg');
      assert.equal(upload.url, 'https://photoslibrary.googleapis.com/v1/uploads');
    });
  });

  test(`${page}: upload waits for preparation and sends the prepared file with its MIME type and name`, async () => {
    const h = harness(page, { holdPreparation: true });
    const original = file('publication.png', 'image/png');
    const prepared = { name: 'publication.jpg', type: 'image/jpeg', size: 4_000_000 };
    h.add([original]);
    assert.equal(h.previews[0].options.optimize, true, 'high-quality optimization is enabled by default');
    assert.equal(h.tokenRequests.length, 1, 'authorization starts while preparation is pending');
    h.authorize();
    await flush();
    assert.equal(h.uploads.length, 0, 'do not send the original while a prepared file is pending');
    await h.submit();
    assert.equal(h.submissions.length, 0, 'preparing files must finish before submission');
    h.prepare(0, prepared);
    await flush();
    assert.equal(h.uploads.length, 1);
    assert.equal(h.uploads[0].body, prepared);
    assert.equal(h.uploads[0].headers['X-Goog-Upload-Content-Type'], 'image/jpeg');
    assert.equal(h.records()[0].file, prepared);
    h.uploads[0].succeed('prepared-file-token');
    await flush();
    await h.submit();
    const submitted = page === 'multi' ? h.submissions[0].events[0].photos : h.submissions[0].photos;
    assert.equal(submitted[0].name, prepared.name);
    assert.equal(submitted[0].token, 'prepared-file-token');
    if (page !== 'multi') assert.equal(submitted[0].mime, prepared.type);
  });

  test(`${page}: one slow preparation does not hold ready photos or the rest of the queue`, async () => {
    const h = harness(page, { holdPreparation: true });
    const originals = Array.from({ length: 5 }, (_, i) => file(`photo-${i}.jpg`));
    h.add(originals);
    h.authorize();
    for (let i = 1; i < originals.length; i++) h.prepare(i);
    await flush();
    assert.equal(h.uploads.length, 3);
    assert.ok(h.uploads.every(upload => upload.body !== originals[0]));
    h.uploads[0].succeed();
    await flush();
    assert.ok(h.uploads.some(upload => upload.body === originals[4]), 'later ready files use an available slot');
    h.prepare(0);
    await flush();
    await drainUploads(h);
    assert.equal(h.uploads.length, originals.length);
    assert.ok(h.records().every(record => record.status === 'done'));
    assert.ok(h.maxActive <= 4);
  });

  test(`${page}: original-file preference applies to newly selected files and leaves them unchanged`, async () => {
    const h = harness(page, { holdPreparation: true });
    const first = file('before-originals.jpg');
    const original = file('keep-camera-metadata.jpg');
    h.add([first]);
    h.originals(true);
    h.add([original]);
    h.authorize();
    await flush();
    assert.equal(h.previews[0].options.optimize, true, 'already selected photos retain their preference');
    assert.equal(h.previews[1].options.optimize, false);
    assert.equal(h.uploads.length, 1);
    assert.equal(h.uploads[0].body, original, 'original mode preserves the exact File');
    h.prepare(0);
    await drainUploads(h);
  });

  test(`${page}: removal cancels pending preparation and its late result never uploads`, async () => {
    const h = harness(page, { holdPreparation: true });
    h.add([file()]);
    h.authorize();
    await flush();
    const record = h.records()[0];
    h.remove(record);
    await flush();
    assert.equal(h.previews[0].cancelled, true);
    assert.equal(await h.previews[0].promise, null);
    h.prepare(0, file('late-prepared.jpg'));
    await flush();
    assert.equal(h.uploads.length, 0);
    assert.equal(record.status, 'removed');
    assert.equal(record.file, null);
    assert.equal(record.prepared, null);
    assert.equal(h.schedulerActive, 0);
  });

  test(`${page}: retries reuse the prepared bytes without preparing the photo again`, async () => {
    const h = harness(page, { holdPreparation: true });
    const prepared = { name: 'optimized.jpg', type: 'image/jpeg', size: 3_000_000 };
    h.add([file('original.png', 'image/png')]);
    h.prepare(0, prepared);
    h.authorize();
    await flush();
    h.uploads[0].fail();
    await flush();
    h.records()[0].el.querySelector('.ph-retry').onclick();
    await flush();
    assert.equal(h.previews.length, 1);
    assert.equal(h.uploads.length, 2);
    assert.equal(h.uploads[0].body, prepared);
    assert.equal(h.uploads[1].body, prepared);
    assert.equal(h.uploads[1].headers['X-Goog-Upload-Content-Type'], prepared.type);
    h.uploads[1].succeed('retried-prepared-token');
    await flush();
    assert.equal(h.records()[0].status, 'done');
  });

  for (const language of ['en', 'ru']) {
    test(`${page} ${language}: failed uploads block submission and identify retry or removal as the next action`, async () => {
      const h = harness(page, { language });
      h.add([file('done.jpg'), file('failed.jpg')]);
      h.authorize();
      await flush();
      h.uploads[0].succeed('done-token');
      h.uploads[1].fail();
      await flush();
      const action = language === 'en' ? /retry.*upload|upload.*again/i : /повтори.*загруз|загруз.*повтор/i;
      const removal = language === 'en' ? /remove|delete/i : /удал|убер/i;
      const retry = h.records()[1].el.querySelector('.ph-retry');
      assert.match(retry.textContent, action, 'retry button names the action');
      assert.match(h.status().textContent, removal, 'status gives a way to recover');
      await h.submit();
      assert.equal(h.submissions.length, 0, 'failed files cannot be silently discarded from the submission');
      assert.equal(h.$('err').classList.contains('show'), true);
      assert.match(h.$('err').textContent, action);
      assert.match(h.$('err').textContent, removal);
      assert.notEqual(h.$('send').disabled, true);
      h.remove(h.records()[1]);
      await h.submit();
      assert.equal(h.submissions.length, 1, 'removing the failed file allows submission');
      assert.equal(h.$('err').classList.contains('show'), false);
      const submitted = page === 'multi' ? h.submissions[0].events[0].photos : h.submissions[0].photos;
      assert.deepEqual(submitted.map(photo => photo.name), ['done.jpg']);
    });
  }

  test(`${page}: removing while authorization is pending prevents upload and releases preview`, async () => {
    const h = harness(page);
    h.add([file()]);
    const record = h.records()[0];
    h.remove(record);
    h.authorize();
    await flush();
    assert.equal(h.uploads.length, 0);
    assert.equal(record.status, 'removed');
    assert.equal(record.file, null);
    assert.ok(!record.token);
    assert.equal(record.el.parentNode, null);
    assert.equal(h.previews[0].cancelled, true);
    assert.equal(h.schedulerActive, 0);
  });

  test(`${page}: removing a queued file skips it when an upload slot opens`, async () => {
    const h = harness(page);
    const originals = Array.from({ length: 5 }, (_, i) => file(`${i}.jpg`));
    h.add(originals);
    h.remove(h.records()[4]);
    h.authorize();
    await flush();
    h.uploads.forEach(upload => upload.succeed());
    await flush();
    assert.equal(h.uploads.length, 4);
    assert.ok(h.uploads.every(upload => upload.body !== originals[4]));
    assert.equal(h.schedulerActive, 0);
  });

  test(`${page}: removing an active upload aborts it and late callbacks cannot restore it`, async () => {
    const h = harness(page);
    h.add([file()]); h.authorize(); await flush();
    const record = h.records()[0], upload = h.uploads[0];
    h.remove(record);
    assert.equal(upload.aborted, true);
    upload.succeed('late-token');
    upload.onerror?.();
    await flush();
    assert.equal(record.status, 'removed');
    assert.equal(record.file, null);
    assert.ok(!record.token);
    assert.equal(record.el.querySelector('.ph-retry'), null);
    assert.equal(h.schedulerActive, 0);
  });

  test(`${page}: removal between upload completion and its continuation stays removed`, async () => {
    const h = harness(page);
    h.add([file()]); h.authorize(); await flush();
    const record = h.records()[0];
    h.uploads[0].succeed('just-finished');
    h.remove(record);
    await flush();
    assert.equal(record.status, 'removed');
    assert.ok(!record.token);
    assert.equal(record.el.classList.contains('done'), false);
    assert.equal(h.schedulerActive, 0);
  });

  test(`${page}: a failed upload retries the original using its cached token`, async () => {
    const h = harness(page), original = file('retry.heic', 'image/heic');
    h.add([original]); h.authorize(); await flush();
    h.uploads[0].fail(); await flush();
    const record = h.records()[0];
    assert.equal(record.status, 'fail');
    record.el.querySelector('.ph-retry').onclick(); await flush();
    assert.equal(h.uploads.length, 2);
    assert.equal(h.uploads[1].body, original);
    assert.equal(h.tokenRequests.length, 1);
    assert.equal(record.el.querySelector('.ph-retry'), null);
    h.uploads[1].succeed('retry-token'); await flush();
    assert.equal(record.status, 'done');
    assert.equal(record.token, 'retry-token');
  });

  test(`${page}: a failed token request can be retried`, async () => {
    const h = harness(page);
    h.add([file()]);
    h.tokenRequests[0].reject(new Error('temporary token service failure'));
    await flush();
    const record = h.records()[0];
    assert.equal(record.status, 'fail');
    record.el.querySelector('.ph-retry').onclick();
    assert.equal(h.tokenRequests.length, 2);
    h.authorize(1); await flush();
    h.uploads[0].succeed('recovered'); await flush();
    assert.equal(record.status, 'done');
    assert.equal(record.token, 'recovered');
  });

  test(`${page}: completed photos removed by the user never enter the submitted payload`, async () => {
    const h = harness(page);
    h.add([file('keep.jpg'), file('remove.jpg')]); h.authorize(); await flush();
    h.uploads[0].succeed('keep-token'); h.uploads[1].succeed('remove-token'); await flush();
    h.remove(h.records()[1]);
    await h.submit();
    assert.equal(h.submissions.length, 1);
    const payload = h.submissions[0];
    const submittedPhotos = page === 'multi' ? payload.events[0].photos : payload.photos;
    assert.deepEqual(submittedPhotos.map(photo => photo.name), ['keep.jpg']);
    assert.deepEqual(submittedPhotos.map(photo => photo.token), ['keep-token']);
    assert.equal(h.previews[1].cancelled, true);
  });
}

test('multi: uploads keep event-specific tokens and land in the matching event payload', async () => {
  const h = harness('multi');
  h.add([file('a.jpg')], 0);
  h.add([file('b.jpg'), file('b2.jpg')], 1);
  assert.deepEqual(h.tokenRequests.map(request => request.eventId), ['event-a', 'event-b']);
  // Resolve in the reverse order to expose any accidental global token cache.
  h.authorize(1); await flush();
  h.authorize(0); await flush();
  for (const upload of h.uploads) {
    const eventId = upload.body.name.startsWith('a') ? 'event-a' : 'event-b';
    assert.equal(upload.headers.Authorization, `Bearer access-${eventId}`);
    upload.succeed(`token-${upload.body.name}`);
  }
  await flush();
  await h.submit();
  assert.equal(h.submissions.length, 1);
  assert.deepEqual(h.submissions[0].events.map(event => ({ id: event.id, photos: event.photos })), [
    { id: 'event-a', photos: [{ token: 'token-a.jpg', name: 'a.jpg' }] },
    { id: 'event-b', photos: [{ token: 'token-b.jpg', name: 'b.jpg' }, { token: 'token-b2.jpg', name: 'b2.jpg' }] },
  ]);
  assert.equal(h.maxActive, 3);
});

test('multi: the 50-file allowance applies independently to each event', async () => {
  const h = harness('multi');
  for (const eventIndex of [0, 1]) {
    h.add(Array.from({ length: 51 }, (_, i) => file(`event-${eventIndex}-photo-${i}.jpg`)), eventIndex);
    assert.equal(h.records(eventIndex).length, 50);
  }
  await drainUploads(h);
  assert.equal(h.uploads.length, 100);
  assert.equal(h.maxActive, 4);
  assert.equal(h.tokenRequests.length, 2);
  await h.submit();
  assert.deepEqual(h.submissions[0].events.map(event => event.photos.length), [50, 50]);
});

// Run the real server handler and album-filing code in an isolated context.
// All external services are replaced; the captured Google batch payload is the
// observable boundary, so this catches server-side truncation after the UI.
async function submitToServer(body) {
  const source = readFileSync(new URL('../api/submit.mjs', import.meta.url), 'utf8')
    .replace(/^import \{ createHmac \} from "node:crypto";$/m, '')
    .replace('export default async function handler', 'async function handler');
  const batches = [];
  const context = vm.createContext({
    Buffer, URLSearchParams, process: { env: {} },
    console: { error(...args) { assert.fail(`Unexpected server error: ${args.join(' ')}`); } },
    async fetch(url, options) {
      if (url === 'https://oauth2.googleapis.com/token') return { json: async () => ({ access_token: 'test-access-token' }) };
      assert.equal(url, 'https://photoslibrary.googleapis.com/v1/mediaItems:batchCreate');
      const batch = JSON.parse(options.body);
      batches.push(batch);
      return { json: async () => ({ newMediaItemResults: batch.newMediaItems.map((_, i) => ({ mediaItem: { id: `media-${i}` } })) }) };
    },
  });
  vm.runInContext(source, context, { filename: 'api/submit.mjs' });
  context.getEvent = async id => id ? ({ id: String(id), name: `Event ${id}`, albumId: `album-${id}`, custom: '' }) : null;
  context.monday = async () => ({ create_item: { id: 'feedback-id' } });
  context.slackNotify = async () => {};
  context.eventThread = async () => 'test-thread';
  const req = {
    method: 'POST',
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); },
  };
  let response;
  const res = { statusCode: 200, setHeader() {}, end(text) { response = JSON.parse(text); } };
  await context.handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(response.ok, true);
  return batches;
}

for (const route of ['attendee', 'lead', 'photos', 'multi']) {
  test(`server ${route}: all 50 accepted tokens reach Google, with a cap per event`, async () => {
    for (const count of [50, 51]) {
      const media = Array.from({ length: count }, (_, i) => ({ token: `upload-token-${i}`, name: `photo-${i}.jpg` }));
      // Invalid entries must not consume slots ahead of valid media.
      const photos = [null, { token: 'short' }, ...media];
      const base = { eventId: '101', rating: 5, photos, lang: 'en' };
      const body = route === 'lead' ? { ...base, isLead: 1, headcount: 10 }
        : route === 'photos' ? { ...base, photos_only: true }
        : route === 'multi' ? { multi: 1, events: [
          { id: '101', rating: 5, photos }, { id: '202', rating: 5, photos },
        ] }
        : base;
      const batches = await submitToServer(body);
      assert.equal(batches.length, route === 'multi' ? 2 : 1);
      assert.deepEqual(batches.map(batch => batch.albumId), route === 'multi' ? ['album-101', 'album-202'] : ['album-101']);
      for (const batch of batches) {
        assert.equal(batch.newMediaItems.length, 50);
        assert.deepEqual(batch.newMediaItems.map(item => item.simpleMediaItem.uploadToken), media.slice(0, 50).map(item => item.token));
      }
    }
  });
}
