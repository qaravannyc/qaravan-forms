// Checks for the website inquiry email (lib/website-inquiry.mjs) against a fake monday and a
// fake Gmail: one email per new row, in the support-mail layout, with the request's line breaks
// kept and everything from the form escaped; a note on the row stops a second email; old rows,
// rows on other boards and a failed send write nothing.
// Run: node --test tools/website-inquiry.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

process.env.MONDAY_TOKEN = "fake-token";
process.env.GOOGLE_REFRESH_TOKEN = "fake";
delete process.env.WEBSITE_NOTIFY;

const W = await import("../lib/website-inquiry.mjs");
const L = await import("../lib/person-lookup.mjs");

const NOW = new Date("2026-10-01T16:30:00Z");
const cv = (id, text) => ({ id, text });
const row = (id, { board = W.BOARD, created = "2026-10-01T16:07:21Z", request = "Здравствуйте!\nНужен юрист <срочно> & быстро.", updates = [] } = {}) => ({
  id: String(id), name: "Алекс", created_at: created, state: "active", board: { id: board }, updates,
  column_values: [cv("text2", "Петров"), cv("long_text", request), cv("color", "They/Them (Они/их)"), cv("status", "Legal -  юридическая помощь"),
    cv("email", "Alex@Example.com"), cv("phone93", "13475550123"), cv("text5", "Brooklyn, NY"), cv("status6", "")],
});

let S;
function reset(items = []) { S = { items: Object.fromEntries(items.map((it) => [it.id, it])), mails: [], notes: [], gmailFails: false }; }
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith("https://oauth2.googleapis.com/")) return new Response(JSON.stringify({ access_token: "tok" }));
  if (u.startsWith("https://gmail.googleapis.com/")) {
    if (S.gmailFails) return new Response("quota", { status: 429 });
    S.mails.push(Buffer.from(JSON.parse(opts.body).raw, "base64url").toString("utf8"));
    return new Response("{}");
  }
  if (u !== "https://api.monday.com/v2") throw new Error("unexpected fetch " + u);
  const { query, variables = {} } = JSON.parse(opts.body);
  const ok = (data) => new Response(JSON.stringify({ data }));
  if (/items\(ids: \$id\)/.test(query)) { const it = S.items[variables.id[0]]; return ok({ items: it ? [it] : [] }); }
  if (/create_update/.test(query)) {
    S.notes.push(variables);
    S.items[variables.i].updates = [...(S.items[variables.i].updates || []), { text_body: variables.t }];
    return ok({ create_update: { id: "1" } });
  }
  return ok({}); // the person lookup: nobody found
};
const noLookup = async () => ({ ok: true, member: null, attended: [], led: [], volunteer: { card: "", skills: "", applications: [] }, agreement: "", earlier: [] });

test("the email: name, category, request with its line breaks, everything escaped, a reply button", () => {
  const q = W.inquiryFrom(row(7));
  assert.equal(q.name, "Алекс Петров");
  assert.equal(q.email, "alex@example.com");
  assert.deepEqual(q.category, { ru: "Юридическая помощь", color: "#0099CC" });
  const { subject, html } = W.inquiryEmail(q, { known: { ...L.buildDossier({}, null, { now: NOW }), earlier: [{ id: "5", date: "2026-09-24", status: "Done" }] } });
  assert.equal(subject, "Обращение с сайта: Алекс Петров, юридическая помощь");
  assert.match(html, /Здравствуйте!<br>Нужен юрист &lt;срочно&gt; &amp; быстро\./);
  assert.doesNotMatch(html, /<срочно>/);
  assert.match(html, /href="mailto:alex@example\.com\?subject=%D0%92%D0%B0%D1%88%D0%B5[^"]*"[^>]*>Ответить</);
  assert.match(html, /href="https:\/\/qaravan\.monday\.com\/boards\/4939299706\/pulses\/7"/);
  assert.match(html, /href="tel:\+13475550123"[^>]*>\+13475550123</);
  assert.match(html, /1 октября(,| в) 12:07 по Нью-Йорку/);
  assert.match(html, /Прежние обращения через сайт/);
  assert.match(html, /1, последнее 24 сентября 2026, статус Done/);
  assert.ok(html.indexOf(">Обращение</div>") < html.indexOf(">Контакты</div>"));
  assert.doesNotMatch(html, /[·•]|RUSA/);
  // English request with a Latin name: the reply subject is in English
  const en = W.inquiryEmail(W.inquiryFrom({ ...row(8), name: "Harry", column_values: [cv("long_text", "Hello"), cv("status", "Media - СМИ"), cv("email", "harry@example.org")] })).html;
  assert.match(en, /subject=Your%20message%20to%20QARAVAN/);
  assert.match(en, /#FF3333/, "media: the red flag");
  // no email: no reply button, a line that says so; no lookup → no context section
  const none = W.inquiryEmail(W.inquiryFrom({ ...row(9), column_values: [cv("long_text", "Hi"), cv("email", "not an email")] })).html;
  assert.doesNotMatch(none, />Ответить</);
  assert.match(none, /Почты в обращении нет\./);
  assert.match(none, /not an email/);
  assert.doesNotMatch(none, />Контекст</);
  assert.deepEqual(W.category("Something new"), { ru: "Something new", color: "#0099CC" });
  assert.equal(W.category("").ru, "Без категории");
});

test("a new row: one email to the team, then a note on the row stops a second one", async () => {
  reset([row(7)]);
  const r = await W.inquiryForItem({ itemId: "7" }, { now: NOW, lookup: noLookup });
  assert.equal(r.result, "sent");
  assert.equal(S.mails.length, 1);
  assert.match(S.mails[0], /^To: ezra@qaravan\.org$/m);
  assert.match(S.mails[0], /^From: QARAVAN <info@qaravan\.org>$/m);
  assert.equal(S.notes.length, 1);
  assert.match(S.notes[0].t, /^Письмо команде отправлено: ezra@qaravan\.org, 1 октября(,| в) 12:30 по Нью-Йорку\.\n\nКонтекст:/);
  const again = await W.inquiryForItem({ itemId: "7" }, { now: NOW, lookup: noLookup });
  assert.deepEqual([again.result, again.why, S.mails.length], ["skipped", "already sent", 1]);
});

test("old rows, other boards, unknown rows and a failed send write nothing", async () => {
  reset([row(1, { created: "2026-09-29T10:00:00Z" }), row(2, { board: "18433061986" }), row(3)]);
  assert.equal((await W.inquiryForItem({ itemId: "1" }, { now: NOW, lookup: noLookup })).why, "outside the window");
  assert.equal((await W.inquiryForItem({ itemId: "2" }, { now: NOW, lookup: noLookup })).status, 400);
  assert.equal((await W.inquiryForItem({ itemId: "9" }, { now: NOW, lookup: noLookup })).why, "no such item");
  assert.equal((await W.inquiryForItem({ itemId: "3", boardId: "123" }, { now: NOW, lookup: noLookup })).status, 400);
  assert.equal((await W.inquiryForItem({ itemId: "3", dry: true }, { now: NOW, lookup: noLookup })).result, "would send");
  S.gmailFails = true;
  const r = await W.inquiryForItem({ itemId: "3" }, { now: NOW, lookup: noLookup });
  assert.deepEqual([r.status, r.result], [502, "failed"]);
  assert.deepEqual([S.mails.length, S.notes.length], [0, 0]);
});

test("WEBSITE_NOTIFY replaces the recipients", () => {
  assert.deepEqual(W.recipients({ WEBSITE_NOTIFY: "a@qaravan.org, not-an-email ,b@qaravan.org" }), ["a@qaravan.org", "b@qaravan.org"]);
  assert.deepEqual(W.recipients({}), ["ezra@qaravan.org"]);
});

test("the handler: monday's challenge, a webhook call, and nothing personal in the answer", async () => {
  const call = async (method, path, body) => {
    const req = { method, url: path, async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(JSON.stringify(body)); } };
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(s) { this.body = JSON.parse(s); } };
    await W.websiteInquiryHandler(req, res);
    return res;
  };
  reset([row(7, { created: new Date(Date.now() - 60000).toISOString() })]);
  assert.deepEqual((await call("POST", "/api/website-inquiry", { challenge: "abc" })).body, { challenge: "abc" });
  assert.equal((await call("GET", "/api/website-inquiry")).statusCode, 405);
  assert.equal((await call("POST", "/api/website-inquiry", {})).statusCode, 400);
  const r = await call("POST", "/api/website-inquiry", { event: { pulseId: 7, boardId: 4939299706 } });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.body, { ok: true, result: "sent", why: "Юридическая помощь" });
  assert.equal(S.mails.length, 1);
  assert.doesNotMatch(JSON.stringify(r.body), /alex|Алекс/i);
});
