// Upload tokens for Google Photos and the rescue upload (audit D4), against fake monday, Google and Cloudflare:
//   • a token reaches the browser only when Google's answer names exactly the append-only scope;
//   • once TURNSTILE_SECRET_KEY is set, a token needs the personal link from our email (p), a ticket from an
//     earlier answer for the same event, or a passed Turnstile check;
//   • the rescue upload needs that event's ticket or the personal link;
//   • the pages send p, the ticket and, where asked, a Turnstile token (their own code, run against stubs).
// Run: node --test tools/photos-token.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";

process.env.MONDAY_TOKEN = "fake-token";
process.env.UNSUB_SECRET = "test-secret";
process.env.GOOGLE_REFRESH_TOKEN = "fake";
const APPEND = "https://www.googleapis.com/auth/photoslibrary.appendonly";

let G = { scope: APPEND }, calls = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  calls.push(u);
  if (u === "https://challenges.cloudflare.com/turnstile/v0/siteverify") return new Response(JSON.stringify({ success: new URLSearchParams(String(opts.body)).get("response") === "good-token" }));
  if (u === "https://oauth2.googleapis.com/token") return new Response(JSON.stringify({ access_token: "ya29.fake", expires_in: 3599, ...G }));
  if (u === "https://api.monday.com/v2/file") return new Response(JSON.stringify({ data: { add_file_to_column: { id: "f" } } }));
  if (u === "https://api.monday.com/v2") return new Response(JSON.stringify({ data: { items: [{ id: "111", name: "Picnic", board: { id: "4774572020" } }] } }));
  throw new Error("unexpected fetch " + u);
};
const token = (await import("../api/photos-token.mjs")).default;
const rescue = (await import("../api/rescue-file.mjs")).default;

async function ask(body, headers = {}) {
  const req = { method: "POST", url: "/api/photos-token", headers, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); } };
  const res = { statusCode: 200, setHeader() {}, end(s) { this.body = s; } };
  await token(req, res);
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") };
}
const pFor = (event, who) => `${who}.${createHmac("sha256", "test-secret").update(`${event}:${who}`).digest("hex").slice(0, 16)}`;

test("a token goes out only when Google narrowed it to exactly the append-only scope", async () => {
  delete process.env.TURNSTILE_SECRET_KEY;
  G = { scope: APPEND };
  const ok = await ask({ eventId: "111" });
  assert.equal(ok.status, 200); assert.equal(ok.json.token, "ya29.fake"); assert.match(ok.json.ticket, /^\d{13}\.[0-9a-f]{16}$/);
  for (const scope of [`${APPEND} https://www.googleapis.com/auth/gmail.send`, "https://www.googleapis.com/auth/photoslibrary", undefined]) {
    G = scope === undefined ? {} : { scope };
    const r = await ask({ eventId: "111" });
    assert.equal(r.status, 503, String(scope)); assert.equal(r.json.token, undefined);
  }
  G = { scope: APPEND };
});

test("with Turnstile on: the personal link, a ticket for this event or a passed check; nothing else", async () => {
  process.env.TURNSTILE_SECRET_KEY = "ts-secret";
  calls = [];
  const none = await ask({ eventId: "111" });
  assert.equal(none.status, 403); assert.ok(!calls.includes("https://oauth2.googleapis.com/token"), "Google is never asked");
  assert.equal((await ask({ eventId: "111", turnstile: "bad-token" })).status, 403);
  assert.equal((await ask({ eventId: "111", p: pFor("222", "5") })).status, 403, "a link signed for another event");
  const viaLink = await ask({ eventId: "111", p: pFor("111", "5") });
  assert.equal(viaLink.status, 200);
  const multi = `5.${createHmac("sha256", "test-secret").update("multi:5").digest("hex").slice(0, 16)}`;
  assert.equal((await ask({ eventId: "111", p: multi })).status, 200, "the weekly form's link");
  const viaCheck = await ask({ eventId: "111", turnstile: "good-token" }, { "x-real-ip": "203.0.113.5" });
  assert.equal(viaCheck.status, 200);
  assert.equal((await ask({ eventId: "111", ticket: viaCheck.json.ticket })).status, 200, "the ticket from the first answer");
  assert.equal((await ask({ eventId: "112", ticket: viaCheck.json.ticket })).status, 403, "not for another event");
  delete process.env.TURNSTILE_SECRET_KEY;
});

test("rescue upload: only with this event's ticket or the personal link", async () => {
  const send = async (headers) => {
    const req = { method: "POST", url: "/api/rescue-file?event=111&name=a.jpg", headers, async *[Symbol.asyncIterator]() { yield Buffer.from("bytes"); } };
    const res = { statusCode: 200, setHeader() {}, end(s) { this.body = s; } };
    await rescue(req, res); return res.statusCode;
  };
  calls = [];
  assert.equal(await send({}), 403);
  assert.ok(!calls.includes("https://api.monday.com/v2/file"));
  const { json } = await ask({ eventId: "111" });
  assert.equal(await send({ "x-qv-ticket": json.ticket }), 200);
  assert.equal(await send({ "x-qv-ticket": (await ask({ eventId: "112" })).json.ticket }), 403);
  assert.equal(await send({ "x-qv-p": pFor("111", "9") }), 200);
});

// ---- the pages ----
function block(page) {
  const src = readFileSync(new URL(`../pages/${page}.html`, import.meta.url), "utf8");
  const start = src.indexOf(page === "multi" ? "const phTok = {};" : "let phAccess = null");
  const end = src.indexOf("\nfunction phPump(", start);
  assert.ok(start > 0 && end > start, page);
  return src.slice(start, end);
}
for (const page of ["attendee", "lead", "photos", "multi"]) {
  test(`${page}: the token request carries the personal link and the ticket; the check runs only when the server asks and there's no link`, async () => {
    const sent = [], rendered = [];
    const el = () => ({ setAttribute() {}, remove() {}, appendChild() {} });
    const ctx = vm.createContext({
      window: {}, document: { createElement: el, body: el(), head: el() }, JSON, Date, Promise,
      fetch: async (url, o) => { sent.push(JSON.parse(o.body)); return { ok: true, json: async () => ({ token: "t", expiresIn: 1, ticket: "1999999999999.abcdefabcdefabcd" }) }; },
    });
    if (page === "attendee" || page === "multi") ctx.pTok = "5.0123456789abcdef";
    vm.runInContext(block(page) + (page === "multi" ? "" : "\nvar eventId = '111';"), ctx);
    const get = () => vm.runInContext(page === "multi" ? "phGetAccess('111')" : "phGetAccess()", ctx);
    await get();
    assert.equal(sent[0].eventId, "111");
    assert.equal(sent[0].p, ctx.pTok || "");
    await get(); // the token has expired (expiresIn: 1), so a second request goes out, with the ticket
    assert.equal(sent[1].ticket, "1999999999999.abcdefabcdefabcd");
    // switched on: a page without a personal link runs the check before its first request
    if (!ctx.pTok) {
      vm.runInContext("for (const k in phTickets) delete phTickets[k];", ctx);
      ctx.window.__TS_KEY__ = "site-key";
      ctx.window.turnstile = { render: (box, o) => { rendered.push(o.sitekey); o.callback("ts-token"); } };
      vm.runInContext("phAccess = null; phAccessReq = null;", ctx);
      await get();
      assert.deepEqual(rendered, ["site-key"]); assert.equal(sent[2].turnstile, "ts-token");
    }
  });
}
