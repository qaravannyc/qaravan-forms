// Checks for the countries of removal in the support-letter form (api/letter.mjs) against a fake
// monday and a fake Gmail: up to three countries, each with the person's note on how they are
// connected to it; drafts from the older page (one `country1`) still read; the board's Country
// column, the update and the team email carry every country; on submit the person gets the
// confirmation and a copy of their answers at the address they typed in.
// Run: node --test tools/letter.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

process.env.MONDAY_TOKEN = "fake-token";
process.env.GOOGLE_REFRESH_TOKEN = "fake";
delete process.env.TEAM_NOTIFY;

const Letter = await import("../api/letter.mjs");
const { C } = await import("../lib/letter-board.mjs");

let S;
const reset = () => { S = { mails: [], updates: [], cv: {}, raw: null }; };
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith("https://oauth2.googleapis.com/")) return new Response(JSON.stringify({ access_token: "tok" }));
  if (u.startsWith("https://gmail.googleapis.com/")) { S.mails.push(Buffer.from(JSON.parse(opts.body).raw, "base64url").toString("utf8")); return new Response("{}"); }
  if (u !== "https://api.monday.com/v2") throw new Error("unexpected fetch " + u);
  const { query, variables = {} } = JSON.parse(opts.body);
  const ok = (data) => new Response(JSON.stringify({ data }));
  if (/items_page_by_column_values/.test(query) && /text_mm6vmdw4/.test(query)) return ok({ items_page_by_column_values: { items: S.raw ? [{ id: "77", group: { id: "group_mm6vn84d" }, column_values: [{ id: C.raw, text: S.raw }] }] : [] } });
  if (/create_item/.test(query)) return ok({ create_item: { id: "77" } });
  if (/change_multiple_column_values/.test(query)) { const v = JSON.parse(variables.v); Object.assign(S.cv, v); if (v[C.raw]) S.raw = v[C.raw].text; return ok({ change_multiple_column_values: { id: "77" } }); }
  if (/create_update/.test(query)) { S.updates.push(variables.t); return ok({ create_update: { id: "1" } }); }
  return ok({}); // the person lookup and the rest: nobody found
};
const mailTo = (m) => /^To: (.*)$/m.exec(m)[1];
const subject = (m) => Buffer.from(/^Subject: =\?UTF-8\?B\?(.*)\?=$/m.exec(m)[1], "base64").toString("utf8");
const html = (m) => m.split("\r\n\r\n").slice(1).join("\r\n\r\n");
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

test("cleanAnswers keeps up to three different countries with their notes and reads the older single country", () => {
  const a = Letter.cleanAnswers({ countries: [
    { code: "ru", why: "  born and grew up there  " }, { code: "RU", why: "again" }, { code: "KZ", why: "x".repeat(300) },
    { code: "Russia", why: "" }, { code: "", why: "" }, { code: "GE" }, { code: "UA", why: "a fourth one" },
  ] });
  assert.deepEqual(a.countries.map((c) => c.code), ["RU", "KZ", "GE"]); // a repeat, a name instead of a code and an empty card don't take a place
  assert.equal(a.countries[0].why, "born and grew up there");
  assert.equal(a.countries[1].why.length, 200);
  assert.deepEqual(Letter.cleanAnswers({ country1: "uz" }).countries, [{ code: "UZ", why: "" }]);
  assert.deepEqual(Letter.cleanAnswers({}).countries, []);
  assert.deepEqual(Letter.cleanAnswers({ countries: "RU" }).countries, []);
  // a draft keeps a note typed before the country was picked
  assert.deepEqual(Letter.cleanAnswers({ countries: [{ code: "AM", why: "" }, { code: "", why: "lived there 2015-2019" }] }).countries, [{ code: "AM", why: "" }, { code: "", why: "lived there 2015-2019" }]);
});

test("countriesText: one line for the board column, a line per country for people", () => {
  const a = { countries: [{ code: "RU", why: "born and grew up there" }, { code: "KZ", why: "" }, { code: "", why: "not picked yet" }] };
  assert.equal(Letter.countriesText(a, "; "), "Russia (born and grew up there); Kazakhstan");
  assert.equal(Letter.countriesText(a), "Russia — born and grew up there\nKazakhstan");
});

test("a submitted form writes every country to the board, the update and the team email, and mails the person a copy of the answers", async () => {
  reset();
  const rid = "4f1c2b7e-9d0a-4c3b-8e21-0123456789ab";
  const a = { firstName: "Ivan", lastName: "Example", email: "Ivan@Example.org", phone: "3475550104", proceeding: "removal",
    countries: [{ code: "RU", why: "Родился и вырос там" }, { code: "KZ", why: "citizenship" }], claim: { gay: true }, noAttorney: true,
    consent: { truth: true, share: true, contact: true } };
  const copy = [{ q: "Which countries could you be deported to?", a: "Russia: Родился и вырос там\nKazakhstan: citizenship" }, { q: "Email", a: "ivan@example.org" }];
  const r = await post({ rid, mode: "submit", lang: "en", step: 18, progress: 100, log: [], a, copy });
  assert.equal(r.statusCode, 200);
  assert.equal(S.cv[C.country], "Russia (Родился и вырос там); Kazakhstan (citizenship)");
  assert.match(S.updates[0], /Countries of removal: \nRussia — Родился и вырос там\nKazakhstan — citizenship\n/);
  const team = S.mails.find((m) => mailTo(m) === "ezra@qaravan.org");
  assert.match(html(team), /Countries of removal/);
  assert.match(html(team), /Russia — Родился и вырос там<br>Kazakhstan — citizenship/);
  const mine = S.mails.filter((m) => mailTo(m) === "ivan@example.org");
  assert.equal(mine.length, 2); // the confirmation and the copy
  const copyMail = mine.find((m) => subject(m).startsWith("A copy of your answers"));
  assert.ok(copyMail, "copy of the answers sent");
  assert.match(html(copyMail), /Which countries could you be deported to\?/);
  assert.match(html(copyMail), /Russia: Родился и вырос там<br>Kazakhstan: citizenship/);
  // the personal link reads the countries back
  assert.deepEqual((await get(rid)).a.countries, [{ code: "RU", why: "Родился и вырос там" }, { code: "KZ", why: "citizenship" }]);
});

test("one country reads as «Country of removal»", async () => {
  reset();
  await post({ rid: "9a8b7c6d-5e4f-4a3b-9c2d-0123456789ab", mode: "submit", lang: "ru", step: 18, progress: 100, log: [],
    a: { firstName: "A", lastName: "B", email: "a@example.org", phone: "3475550104", country1: "GE", consent: { truth: true, share: true, contact: true } } });
  assert.equal(S.cv[C.country], "Georgia");
  assert.match(S.updates[0], /\nCountry of removal: Georgia\n/);
});
