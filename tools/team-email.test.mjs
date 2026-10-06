// Checks for the team emails about new form rows (lib/team-email.mjs) and about a new
// support-letter request (api/letter.mjs) against a fake monday and a fake Gmail: one email per
// new row, in the support-mail layout, everything from the form escaped; a note on the row stops
// a second email; old rows, other boards and a failed send write nothing; the letter form writes
// to the team only on the first submission.
// Run: node --test tools/team-email.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

process.env.MONDAY_TOKEN = "fake-token";
process.env.GOOGLE_REFRESH_TOKEN = "fake";
delete process.env.TEAM_NOTIFY;

const T = await import("../lib/team-email.mjs");
const Letter = await import("../api/letter.mjs");

const NOW = new Date("2026-10-06T14:30:00Z");
const c = (id, text, extra = {}) => ({ id, text, ...extra });
const dd = (...l) => ({ values: l.map((label) => ({ label })) });
const volunteer = (id, { board = "4806484412", created = "2026-10-06T14:28:52Z", updates = [] } = {}) => ({
  id: String(id), name: "Sam <Example>", created_at: created, state: "active", board: { id: board }, group: { id: "topics" }, updates,
  column_values: [c("email", "Sam@Example.com"), c("phone", "9145550100", { value: '{"phone":"9145550100","countryShortName":"US"}' }),
    c("dropdown", "", dd("In-person support", "events")), c("status_1", "4-6"), c("single_select", "In-person only"), c("date4", "2026-10-12"),
    c("long_text", "I speak Russian.\nHappy to help & greet."), c("link", "", { value: '{"url":"https://www.linkedin.com/in/sam"}' })],
});

let S;
function reset(items = []) { S = { items: Object.fromEntries(items.map((it) => [it.id, it])), mails: [], notes: [], rows: {}, gmailFails: false }; }
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
    if (S.items[variables.i]) S.items[variables.i].updates = [...(S.items[variables.i].updates || []), { text_body: variables.t }];
    return ok({ create_update: { id: "1" } });
  }
  // the letter board: one row per intake id, its raw answers in a column
  if (/text_mm6vmdw4/.test(query) && /items_page_by_column_values/.test(query)) {
    const raw = S.rows[variables.v[0]];
    return ok({ items_page_by_column_values: { items: raw ? [{ id: "77", group: { id: "group_mm6vd9vd" }, column_values: [c("long_text_mm6vtrcm", raw)] }] : [] } });
  }
  if (/create_item/.test(query)) return ok({ create_item: { id: "77" } });
  if (/change_multiple_column_values/.test(query)) {
    const v = JSON.parse(variables.v);
    if (v.long_text_mm6vtrcm) S.rows[JSON.parse(v.long_text_mm6vtrcm.text).rid] = v.long_text_mm6vtrcm.text;
    return ok({ change_multiple_column_values: { id: "77" } });
  }
  return ok({}); // the person lookup and the rest: nobody found, nothing to say
};
const noLookup = async () => ({ ok: true, member: null, attended: [], led: [], volunteer: { card: "", skills: "", applications: [] }, agreement: "", earlier: [{ id: "5", date: "2025-05-01", status: "" }] });
const mailTo = (m) => /^To: (.*)$/m.exec(m)[1];

test("a volunteer sign-up: subject, interests, availability, contacts, everything escaped, a reply button", () => {
  const s = T.signupFrom(volunteer(7));
  const { subject, html } = T.signupEmail(s, { known: { ok: false } });
  assert.equal(subject, "Volunteer sign-up: Sam <Example>");
  assert.match(html, /Sam &lt;Example&gt;/);
  assert.doesNotMatch(html, /<Example>/);
  assert.match(html, />In-person support</);
  assert.match(html, /Happy to help &amp; greet\./);
  assert.match(html, /I speak Russian\.<br>/);
  assert.match(html, /href="mailto:sam@example\.com\?subject=Volunteering%20with%20QARAVAN"/);
  assert.match(html, /href="tel:\+19145550100"/);
  assert.match(html, />Oct 12, 2026</);
  assert.match(html, /href="https:\/\/www\.linkedin\.com\/in\/sam"[^>]*>linkedin\.com\/in\/sam</);
  assert.match(html, /href="https:\/\/qaravan\.monday\.com\/boards\/4806484412\/pulses\/7"/);
  assert.match(html, /Every sign-up is on the Volunteer sign-ups and engagement board/);
});

test("a role application lists its files by name; Rainbow Connections tells volunteers from participants", () => {
  const role = { id: "8", name: "Alex", created_at: "2026-10-06T14:00:00Z", board: { id: "9710026121" }, group: { id: "topics" }, column_values: [c("email", "alex@example.org"),
    c("filezatpfpwk", "https://qaravan.monday.com/protected_static/1/resources/2/Alex%20CV.pdf, https://qaravan.monday.com/protected_static/1/resources/3/b.pdf", { value: '{"files":[{"name":"Alex CV.pdf"},{"name":"Other.pdf"}]}' })] };
  const r = T.signupEmail(T.signupFrom(role));
  assert.equal(r.subject, "Event Project Manager application: Alex");
  assert.match(r.html, /resources\/2\/Alex%20CV\.pdf"[^>]*>Alex CV\.pdf</);
  assert.match(r.html, />Other\.pdf</);
  assert.match(r.html, /Every application is on the Event Project Manager board/);

  const rc = (group, cols) => T.signupFrom({ id: "9", name: "Тимофей", created_at: "2026-10-06T14:00:00Z", board: { id: "5344342465" }, group: { id: group }, column_values: cols });
  const p = rc("group_title", [c("short_text28", "Пример"), c("email_15", "tim@example.org"), c("multi_select_13", "", dd("6. Other Guidance and General Companionship | Прочее руководство и общение")), c("single_select62", "Fluent | Свободное владение")]);
  assert.deepEqual([p.title, p.name, p.email], ["Rainbow Connections participant", "Тимофей Пример", "tim@example.org"]);
  const html = T.signupEmail(p).html;
  assert.match(html, />Other Guidance and General Companionship</);
  assert.match(html, />Fluent</);
  assert.doesNotMatch(html, /Свободное/);
  const v = rc("topics", [c("short_text77", "Sample"), c("email_2", "zach@example.org"), c("multi_select_130", "", dd("2. Orientation to the City and U.S. Life, Systems, and Structures"))]);
  assert.equal(v.title, "Rainbow Connections volunteer");
  assert.match(T.signupEmail(v).html, />Orientation to the City and U\.S\. Life, Systems, and Structures</);
});

test("one email per row: sent with a note, never twice; old rows, other boards and a failed send write nothing", async () => {
  reset([volunteer(1), volunteer(2, { created: "2026-10-04T10:00:00Z" }), volunteer(3, { board: "4939299706" }), volunteer(4)]);
  const r = await T.teamEmailForItem({ itemId: "1" }, { now: NOW, lookup: noLookup });
  assert.deepEqual([r.status, r.result, r.why], [200, "sent", "Volunteer sign-up"]);
  assert.equal(mailTo(S.mails[0]), "ezra@qaravan.org");
  assert.match(S.notes[0].t, /^Team email sent: ezra@qaravan\.org, October 6 at 10:30 AM, New York time\.\n\nContext: /);
  assert.match(S.notes[0].t, /Earlier sign-ups on this board: 1, latest May 1, 2025/);
  assert.equal((await T.teamEmailForItem({ itemId: "1" }, { now: NOW, lookup: noLookup })).why, "already sent");
  assert.equal((await T.teamEmailForItem({ itemId: "2" }, { now: NOW, lookup: noLookup })).why, "outside the window");
  assert.equal((await T.teamEmailForItem({ itemId: "3" }, { now: NOW, lookup: noLookup })).status, 400);
  assert.equal((await T.teamEmailForItem({ itemId: "4", boardId: "9710026121" }, { now: NOW, lookup: noLookup })).status, 400);
  assert.equal((await T.teamEmailForItem({ itemId: "4", dry: true }, { now: NOW, lookup: noLookup })).result, "would send");
  S.gmailFails = true;
  assert.deepEqual((await T.teamEmailForItem({ itemId: "4" }, { now: NOW, lookup: noLookup })).status, 502);
  assert.deepEqual([S.mails.length, S.notes.length], [1, 1]);
});

test("TEAM_NOTIFY replaces the recipients", () => {
  assert.deepEqual(T.recipients({ TEAM_NOTIFY: "a@qaravan.org, nope ,b@qaravan.org" }), ["a@qaravan.org", "b@qaravan.org"]);
  assert.deepEqual(T.recipients({}), ["ezra@qaravan.org"]);
});

test("the handler: monday's challenge, a webhook call, and nothing personal in the answer", async () => {
  const call = async (method, path, body) => {
    const req = { method, url: path, async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(JSON.stringify(body)); } };
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(s) { this.body = JSON.parse(s); } };
    await T.teamEmailHandler(req, res);
    return res;
  };
  reset([volunteer(7, { created: new Date(Date.now() - 60000).toISOString() })]);
  assert.deepEqual((await call("POST", "/api/team-email", { challenge: "abc" })).body, { challenge: "abc" });
  assert.equal((await call("GET", "/api/team-email")).statusCode, 405);
  assert.equal((await call("POST", "/api/team-email", {})).statusCode, 400);
  const r = await call("POST", "/api/team-email", { event: { pulseId: 7, boardId: 4806484412 } });
  assert.deepEqual([r.statusCode, r.body], [200, { ok: true, result: "sent", why: "Volunteer sign-up" }]);
  assert.equal(S.mails.length, 1);
  assert.doesNotMatch(JSON.stringify(r.body), /sam/i);
});

test("the support-letter form writes to the team once, on the first submission, without identities or key events", async () => {
  const submit = async (rid) => {
    const body = { rid, mode: "submit", lang: "ru", step: 18, progress: 100, log: [], a: { firstName: "Ivan", lastName: "Example", email: "ivan@example.org", phone: "3475550104",
      followLang: "ru", proceeding: "removal", country1: "RU", deadline: "2026-11-20", claim: { gay: true }, incidents: "Detained in 2021", consent: { truth: true, share: true, contact: false } } };
    const req = { method: "POST", url: "/api/letter", async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); } };
    const res = { setHeader() {}, end(s) { this.body = s; } };
    await Letter.default(req, res);
    return res;
  };
  reset();
  const rid = "0b7c3a52-1d2e-4f00-9a7b-1234567890ab";
  await submit(rid);
  const team = S.mails.filter((m) => mailTo(m) === "ezra@qaravan.org");
  assert.equal(team.length, 1);
  assert.equal(S.mails.length, 2); // and the person's own confirmation
  const html = Buffer.from(team[0].split("\r\n\r\n")[1], "utf8").toString();
  assert.match(team[0], /Subject: =\?UTF-8\?B\?/);
  assert.match(html, /Removal \(defensive asylum\)<br>Letter needed by Nov 20, 2026/);
  assert.match(html, /May contact: NO/);
  assert.match(html, /They asked for follow-up in Russian\./);
  assert.match(html, /boards\/18429448469\/pulses\/77/);
  assert.doesNotMatch(html, /Detained|Gay/);
  await submit(rid);
  assert.equal(S.mails.filter((m) => mailTo(m) === "ezra@qaravan.org").length, 1);
});
