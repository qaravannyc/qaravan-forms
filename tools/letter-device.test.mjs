// The support letter's answers after it is sent (audit D2):
//   • the personal link (GET /api/letter?rid=) gives back only {found, submitted} once the letter is sent,
//     and a sent letter takes no more drafts or submissions (409), against a fake monday;
//   • the page (letter/app.js, run here against a stub DOM) keeps only the id and the sent flag on the device
//     after sending, trims records saved before this rule, and drops an unsent draft untouched for 8 weeks.
// Run: node --test tools/letter-device.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

process.env.MONDAY_TOKEN = "fake-token";
delete process.env.GOOGLE_REFRESH_TOKEN;
delete process.env.TEAM_NOTIFY;

const Letter = await import("../api/letter.mjs");
const { C } = await import("../lib/letter-board.mjs");
const RID = "11111111-2222-4333-8444-555555555555";

let S;
const reset = () => { S = { raw: null, writes: 0, updates: 0, feedback: 0 }; };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith("https://oauth2.googleapis.com/") || u.startsWith("https://gmail.googleapis.com/")) throw new Error("no mail in this test");
  if (u !== "https://api.monday.com/v2") return realFetch(url, opts);
  const { query, variables = {} } = JSON.parse(opts.body);
  const ok = (data) => new Response(JSON.stringify({ data }));
  if (/items_page_by_column_values/.test(query) && /text_mm6vmdw4/.test(query)) return ok({ items_page_by_column_values: { items: S.raw ? [{ id: "77", group: { id: "group_mm6vn84d" }, column_values: [{ id: C.raw, text: S.raw }] }] : [] } });
  if (/create_item/.test(query)) return ok({ create_item: { id: "77" } });
  if (/change_multiple_column_values/.test(query)) { const v = JSON.parse(variables.v); if (v[C.translationFeedback]) S.feedback++; else S.writes++; if (v[C.raw]) S.raw = v[C.raw].text; return ok({ change_multiple_column_values: { id: "77" } }); }
  if (/create_update/.test(query)) { S.updates++; return ok({ create_update: { id: "1" } }); }
  return ok({});
};
async function post(body) {
  const req = { method: "POST", url: "/api/letter", async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); } };
  const res = { statusCode: 200, setHeader() {}, end(s) { this.body = s; } };
  await Letter.default(req, res);
  return res;
}
async function get(rid) {
  const res = { statusCode: 200, setHeader() {}, end(s) { this.body = s; } };
  await Letter.default({ method: "GET", url: "/api/letter?rid=" + rid }, res);
  return JSON.parse(res.body);
}

test("the personal link reads a draft, but after sending only {found, submitted}; a sent letter takes no more writes", async () => {
  reset();
  await post({ rid: RID, mode: "draft", lang: "en", a: { firstName: "Test", incidents: "private details" }, log: [], step: 3 });
  const draft = await get(RID);
  assert.equal(draft.submitted, false); assert.equal(draft.a.firstName, "Test");
  assert.equal((await post({ rid: RID, mode: "submit", lang: "en", a: { firstName: "Test", incidents: "private details" }, log: [], step: 18, progress: 100 })).statusCode, 200);
  assert.deepEqual(await get(RID), { found: true, submitted: true });
  const before = { ...S };
  const again = await post({ rid: RID, mode: "submit", lang: "en", a: { firstName: "Changed" }, log: [], step: 18 });
  const draftAfter = await post({ rid: RID, mode: "draft", lang: "en", a: { firstName: "Changed" }, log: [], step: 2 });
  assert.equal(again.statusCode, 409); assert.equal(draftAfter.statusCode, 409);
  assert.equal(S.writes, before.writes); assert.equal(S.updates, before.updates);
  assert.match(S.raw, /"firstName":"Test"/);
  // "Spotted a translation problem?" still works on the thank-you screen
  assert.equal((await post({ rid: RID, mode: "feedback", lang: "en", text: "typo", step: 0 })).statusCode, 200);
  assert.equal(S.feedback, 1);
});

// ---- the page on a device ----
const KEY = "qaravan-intake-draft-v2";
function stubEl() {
  const box = (t, k) => (t[k] ||= new Proxy({}, { get: (o, kk) => (kk in o ? o[kk] : () => {}), set: (o, kk, v) => ((o[kk] = v), true) }));
  return new Proxy(function () {}, {
    get(t, k) { if (k === Symbol.toPrimitive) return () => ""; if (k in t) return t[k]; if (k === "style" || k === "dataset" || k === "classList") return box(t, k); return stubEl(); },
    set(t, k, v) { t[k] = v; return true; }, apply() { return stubEl(); },
  });
}
async function runPage(stored, { search = "", server = null } = {}) {
  const store = new Map(stored ? [[KEY, JSON.stringify(stored)]] : []);
  const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const win = { addEventListener() {}, innerWidth: 400, scrollTo() {} };
  const fetch = async (u) => (String(u).startsWith("/api/letter?rid=") && server ? { ok: true, json: async () => server } : { ok: false, status: 500 });
  const ctx = vm.createContext({ window: win, document: stubEl(), localStorage, location: { search, pathname: "/letter", origin: "https://x", hostname: "localhost" },
    history: { replaceState() {} }, navigator: { sendBeacon() {} }, crypto: { randomUUID: () => "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" }, fetch, confirm: () => true,
    setTimeout: () => 0, clearTimeout() {}, console, Intl, URLSearchParams, Date, JSON, Math, Blob: class {} });
  win.window = win;
  for (const f of ["intake-events.js", "events-i18n.js", "countries.js", "strings.js", "search-synonyms.js"]) vm.runInContext(readFileSync(new URL("../letter/" + f, import.meta.url), "utf8"), ctx);
  vm.runInContext(readFileSync(new URL("../letter/app.js", import.meta.url), "utf8"), ctx, { filename: "letter/app.js" });
  await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  return store.has(KEY) ? JSON.parse(store.get(KEY)) : null;
}
const WEEK = 7 * 864e5;
const answers = { firstName: "Test", email: "test@example.org", incidents: "private details" };

test("page: an unsent draft untouched for 8 weeks is dropped; a newer one stays", async () => {
  assert.equal(await runPage({ rid: RID, a: answers, savedAt: Date.now() - 8 * WEEK - 60e3, submitted: false, step: 4, view: "step" }), null);
  const kept = await runPage({ rid: RID, a: answers, savedAt: Date.now() - 7 * WEEK, submitted: false, step: 4, view: "step" });
  assert.equal(kept.a.incidents, "private details");
});

test("page: a sent letter keeps only its id and the sent flag on the device", async () => {
  const trimmed = await runPage({ rid: RID, a: answers, log: [{ t: 1, s: "name", d: "next" }], savedAt: Date.now() - 2 * WEEK, submitted: true, lang: "en" });
  assert.equal(trimmed.rid, RID); assert.equal(trimmed.submitted, true);
  assert.equal(trimmed.a, undefined); assert.equal(trimmed.log, undefined);
  // opening the personal link of a sent letter: nothing but the id and the flag is stored
  const viaLink = await runPage(null, { search: "?r=" + RID, server: { found: true, submitted: true } });
  assert.equal(viaLink.rid, RID); assert.equal(viaLink.submitted, true);
  assert.deepEqual(Object.keys(viaLink).sort(), ["lang", "rid", "savedAt", "submitted"]);
});
