// Checks for the legal help form handler (lib/legal-help.mjs) with a fake monday and Gmail:
// codes on the page match the board labels, code → label mapping, required name, email and
// consent, contact details kept out of the raw copy, the answers copy to the person and to
// the team, the honeypot.
// Run: node --test tools/legal-help.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.MONDAY_TOKEN = "fake";
process.env.GOOGLE_REFRESH_TOKEN = "fake";
delete process.env.LEGAL_HELP_NOTIFY;
const calls = [], mails = [];
globalThis.fetch = async (url, opts = {}) => {
  if (String(url).includes("oauth2.googleapis.com")) return new Response(JSON.stringify({ access_token: "t" }));
  if (String(url).includes("gmail.googleapis.com")) {
    const raw = Buffer.from(JSON.parse(opts.body).raw, "base64url").toString("utf8");
    mails.push({ to: /^To: (.*)$/m.exec(raw)[1], raw });
    return new Response("{}");
  }
  const { query, variables } = JSON.parse(opts.body);
  calls.push({ query, variables });
  if (query.includes("create_item")) return new Response(JSON.stringify({ data: { create_item: { id: "901" } } }));
  if (query.includes("create_update")) return new Response(JSON.stringify({ data: { create_update: { id: "u1" } } }));
  return new Response(JSON.stringify({ errors: [{ message: "unexpected" }] }));
};

const H = await import("../lib/legal-help.mjs");
const survey = (await import("../api/survey.mjs")).default;

function fakeReq(body, url = "/api/survey?form=legal-help") {
  const buf = Buffer.from(JSON.stringify(body));
  return { method: "POST", url, async *[Symbol.asyncIterator]() { yield buf; } };
}
function fakeRes() {
  const r = { statusCode: 200, headers: {}, body: "", setHeader(k, v) { r.headers[k] = v; }, end(b) { r.body = b || ""; } };
  return r;
}

test("every answer code on the page has a board label, and every question a column", () => {
  const html = readFileSync(new URL("../legal-help/index.html", import.meta.url), "utf8");
  const rx = /^\s{2}(\w+): \{ type: "(?:one|many)", opts: \[([^\]]+)\]/gm;
  let m, n = 0;
  while ((m = rx.exec(html))) {
    n++;
    const codes = m[2].split(",").map((s) => s.trim().replace(/"/g, ""));
    assert.deepEqual(codes, Object.keys(H.L[m[1]]), `codes for ${m[1]}`);
  }
  assert.equal(n, 24); // 26 questions minus price and story
  for (const [k] of H.COLUMNS) assert.ok(H.C[k], `column id for ${k}`);
});

const ID = { name: "Ани", email: "Ani@Example.com", consent: "yes" };

test("answers map to board labels; unknown codes and the exclusive answer are dropped", () => {
  const { ok, a } = H.parseAnswers({ ...ID, help: ["asylum", "nope", "other"], help_other: "  TPS  ", tried: ["none", "ark"], stage: "ref_noint", search: "gt2", price: "$4,500", lang: "en", rid: "abc12345" });
  assert.equal(ok, true);
  assert.deepEqual(a.tried, ["ark"]);
  const cv = H.columnValues(a, new Date("2026-10-28T12:00:00Z"));
  assert.deepEqual(cv[H.C.help], { labels: ["File for asylum", "Other"] });
  assert.deepEqual(cv[H.C.stage], { label: "Sent to court without interview" });
  assert.deepEqual(cv[H.C.search], { label: "Over 2 years" });
  assert.equal(cv[H.C.price], "4500");
  assert.equal(cv[H.C.lang].label, "EN");
  assert.match(cv[H.C.others].text, /Q1: TPS/);
  assert.deepEqual(cv[H.C.submitted], { date: "2026-10-28" });
  assert.deepEqual(cv[H.C.email], { email: "ani@example.com", text: "ani@example.com" });
});

test("name, email and consent are required; a quote needs a story", () => {
  assert.deepEqual(H.parseAnswers({}).fields, ["name", "email", "consent"]);
  assert.deepEqual(H.parseAnswers({ name: "Ани", email: "not-an-email", consent: "no" }).fields, ["email"]);
  const { a: q } = H.parseAnswers({ ...ID, quote: "yes" });
  assert.equal(q.quote, "", "no quote consent without a story");
});

test("submission writes one item and one update, then mails the copy to the person and to the team", async () => {
  calls.length = 0; mails.length = 0;
  const res = fakeRes();
  const copy = [{ q: "Имя", a: "Ани" }, { q: "Есть ли у вас сейчас адвокат по этому делу?", a: "Нет и не было" }, { q: "Что изменил бы адвокат?", a: "Смотрите https://evil.example/x" }];
  await survey(fakeReq({ ...ID, followup: "yes", story: "Мне нужен адвокат.", quote: "yes", lawyer: "never", copy }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].variables.b, H.BOARD);
  assert.equal(calls[0].variables.n, "Ани");
  const cv = JSON.parse(calls[0].variables.v);
  assert.deepEqual(cv[H.C.staff], { label: "New" });
  assert.equal(cv[H.C.name], "Ани");
  assert.doesNotMatch(cv[H.C.raw].text, /example\.com|Ани/);
  assert.match(calls[1].variables.t, /Q6 Has a lawyer now: Never had one/);
  assert.deepEqual(mails.map((m) => m.to).sort(), ["ani@example.com", "ezra@qaravan.org"]);
  const own = mails.find((m) => m.to === "ani@example.com").raw;
  assert.match(own, /Нет и не было/);
  assert.match(own, /\[ссылка\]/);
  assert.doesNotMatch(own, /evil\.example/);
});

test("missing fields are refused; the honeypot writes nothing", async () => {
  calls.length = 0; mails.length = 0;
  let res = fakeRes();
  await survey(fakeReq({ help: ["asylum"] }), res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(JSON.parse(res.body).fields, ["name", "email", "consent"]);
  res = fakeRes();
  await survey(fakeReq({ ...ID, website: "spam" }), res);
  assert.equal(res.body, '{"ok":true}');
  assert.equal(calls.length + mails.length, 0);
});
