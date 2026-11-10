// Signed links from emails and secret-guarded runs (audit D7):
//   • /api/didnt-attend and /api/unsubscribe do nothing on a GET (mail scanners open every link): the GET
//     shows a button that POSTs the same signed address, and only the POST writes to monday;
//   • the cron secret is taken only from the Authorization header, never from ?key=;
//   • personal link signatures are checked (compared in constant time) and addresses are masked in logs.
// Run: node --test tools/signed-links.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

process.env.MONDAY_TOKEN = "fake-token";
process.env.UNSUB_SECRET = "test-secret";

let calls = [];
globalThis.fetch = async (url, opts = {}) => {
  if (String(url) !== "https://api.monday.com/v2") throw new Error("unexpected fetch " + url);
  const { query } = JSON.parse(opts.body);
  calls.push(query);
  const ok = (data) => new Response(JSON.stringify({ data }));
  if (/event: items/.test(query)) return ok({ event: [{ id: "111", name: "Test event", board: { id: "4774572020" } }], person: [] });
  if (/items_page_by_column_values/.test(query)) return ok({ items_page_by_column_values: { items: [] } });
  if (/create_item/.test(query)) return ok({ create_item: { id: "9" } });
  return ok({ create_update: { id: "1" }, change_multiple_column_values: { id: "1" } });
};

const didnt = (await import("../api/didnt-attend.mjs")).default;
const unsub = (await import("../api/unsubscribe.mjs")).default;
const aggregate = (await import("../api/aggregate.mjs")).default;
const { respondentKey, multiAttendee } = await import("../api/submit.mjs");
const { cronAuthed, maskEmail, maskEmails, safeEqual } = await import("../lib/gate.mjs");

async function call(handler, method, url, headers = {}) {
  const req = { method, url, headers, async *[Symbol.asyncIterator]() {} };
  const res = { statusCode: 200, headers: {}, body: "", setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b || ""; } };
  await handler(req, res);
  return res;
}
const naSig = (i, a) => createHmac("sha256", "test-secret").update(`na:${i}:${a}`).digest("hex").slice(0, 16);

test("didnt-attend: a GET only asks, with a button that POSTs the same signed address; the POST records it", async () => {
  const url = `/api/didnt-attend?i=111&a=222&s=${naSig(111, 222)}`;
  calls = [];
  const g = await call(didnt, "GET", url);
  assert.equal(g.statusCode, 200);
  assert.equal(calls.length, 0, "a GET writes nothing to monday");
  assert.match(g.body, /<form method="post" action="\/api\/didnt-attend\?i=111&amp;a=222&amp;s=[0-9a-f]{16}">/);
  calls = [];
  const p = await call(didnt, "POST", url);
  assert.equal(p.statusCode, 200);
  assert.ok(calls.some((q) => /create_update/.test(q)), "the POST records the no-show");
  calls = [];
  const bad = await call(didnt, "POST", `/api/didnt-attend?i=111&a=222&s=${"0".repeat(16)}`);
  assert.equal(bad.statusCode, 400);
  assert.equal(calls.length, 0);
});

test("unsubscribe: a GET only asks; the POST (the button or a mail app's one-click) unsubscribes", async () => {
  const email = "person@example.org";
  const e = Buffer.from(email).toString("base64url");
  const s = createHmac("sha256", "test-secret").update(email).digest("hex");
  calls = [];
  const g = await call(unsub, "GET", `/api/unsubscribe?e=${e}&s=${s}`);
  assert.equal(g.statusCode, 200);
  assert.equal(calls.length, 0, "a GET writes nothing to monday");
  assert.match(g.body, /<form method="post" action="\/api\/unsubscribe\?e=[\w-]+&amp;s=[0-9a-f]{64}">/);
  const p = await call(unsub, "POST", `/api/unsubscribe?e=${e}&s=${s}`);
  assert.equal(p.statusCode, 200);
  assert.ok(calls.some((q) => /Unsubscribed|create_item|change_multiple_column_values/.test(q)));
});

test("cron secret: only `Authorization: Bearer <CRON_SECRET>`, never ?key=, never an empty secret", async () => {
  process.env.CRON_SECRET = "cron";
  assert.equal(cronAuthed({ headers: { authorization: "Bearer cron" } }), true);
  assert.equal(cronAuthed({ headers: { authorization: "Bearer cro" } }), false);
  assert.equal(cronAuthed({ headers: {} }), false);
  assert.equal(cronAuthed({ headers: { authorization: "Bearer " } }, ""), false);
  assert.equal((await call(aggregate, "GET", "/api/aggregate?key=cron")).statusCode, 401);
  assert.equal(safeEqual("", ""), false);
  delete process.env.CRON_SECRET;
});

test("personal link signatures: the right one opens, any other (shorter, longer, wrong) doesn't", () => {
  const sig = createHmac("sha256", "test-secret").update("555:777").digest("hex").slice(0, 16);
  assert.equal(respondentKey("555", `777.${sig}`), "555:777");
  assert.equal(respondentKey("555", `777.${sig.slice(0, 15)}${sig[15] === "a" ? "b" : "a"}`), null);
  assert.equal(respondentKey("555", `777.${sig}0`), null);
  assert.equal(respondentKey("556", `777.${sig}`), null);
  const m = createHmac("sha256", "test-secret").update("multi:777").digest("hex").slice(0, 16);
  assert.equal(multiAttendee(`777.${m}`), "777");
  assert.equal(multiAttendee(`778.${m}`), null);
});

test("logs: addresses are masked to their first letter and domain, also in a failed send's error", async () => {
  assert.equal(maskEmail("someone@example.org"), "s***@example.org");
  assert.equal(maskEmails("a@x.org, bee@y.org"), "a***@x.org, b***@y.org");
  assert.equal(maskEmail(""), "");
  const { sendEmail } = await import("../lib/letter-mail.mjs");
  const keep = globalThis.fetch;
  process.env.GOOGLE_REFRESH_TOKEN = "fake";
  globalThis.fetch = async (url) => String(url).includes("oauth2") ? new Response(JSON.stringify({ access_token: "t" })) : new Response("nope", { status: 400 });
  await assert.rejects(sendEmail("someone@example.org", "s", "<p>x</p>"), (e) => !e.message.includes("someone@") && e.message.includes("s***@example.org"));
  globalThis.fetch = keep;
  delete process.env.GOOGLE_REFRESH_TOKEN;
});
