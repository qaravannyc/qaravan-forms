// Who may make info@qaravan.org send "a copy of your answers" (audit D3), against fake monday, Gmail and Turnstile:
//   • formGate: qaravan.org's Worker proves itself with X-QV-Relay = RELAY_SECRET, a page here with Turnstile;
//     with RELAY_SECRET unset everything works as before ("open");
//   • an unverified request (RELAY_SECRET set, no proof) is saved, but no email goes to the address it names,
//     and the team's copy keeps only the form's own questions;
//   • a copy's questions come from the form's own texts (letter, event feedback always; the relayed forms when
//     the request isn't vouched for); every question the pages really send is on their list;
//   • at most 3 copies an address and 10 an IP a day (per function instance).
// Run: node --test tools/form-gate.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

process.env.MONDAY_TOKEN = "fake-token";
process.env.GOOGLE_REFRESH_TOKEN = "fake";
process.env.LEGAL_HELP_NOTIFY = "team@example.org";
delete process.env.RELAY_SECRET; delete process.env.TURNSTILE_SECRET_KEY; delete process.env.TEAM_NOTIFY;

let mails = [], created = 0;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u === "https://challenges.cloudflare.com/turnstile/v0/siteverify") return new Response(JSON.stringify({ success: new URLSearchParams(String(opts.body)).get("response") === "good" }));
  if (u.startsWith("https://oauth2.googleapis.com/")) return new Response(JSON.stringify({ access_token: "t" }));
  if (u.startsWith("https://gmail.googleapis.com/")) {
    const raw = Buffer.from(JSON.parse(opts.body).raw, "base64url").toString("utf8");
    mails.push({ to: /^To: (.*)$/m.exec(raw)[1], html: raw.split("\r\n\r\n").slice(1).join("\r\n\r\n") });
    return new Response("{}");
  }
  if (u !== "https://api.monday.com/v2") throw new Error("unexpected fetch " + u);
  const { query } = JSON.parse(opts.body);
  const ok = (data) => new Response(JSON.stringify({ data }));
  if (/create_item/.test(query)) { created++; return ok({ create_item: { id: "77" } }); }
  if (/items\(ids/.test(query)) return ok({ items: [{ id: "111", name: "Picnic in the park", board: { id: "4774572020" }, column_values: [{ id: "date4", text: "2026-11-01 14:00" }, { id: "long_text_mm64tyb5", text: "Что принести в следующий раз?\nWhat should we bring next time?" }] }] });
  return ok({ create_update: { id: "1" }, items_page_by_column_values: { items: [] }, change_multiple_column_values: { id: "1" } });
};

const gate = await import("../lib/gate.mjs");
const { formQuestions, sendAnswersCopy } = await import("../lib/answers-copy.mjs");
const survey = (await import("../api/survey.mjs")).default;
const submit = (await import("../api/submit.mjs")).default;
const letter = (await import("../api/letter.mjs")).default;

function req(url, body, headers = {}) {
  return { method: "POST", url, headers, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); } };
}
async function run(handler, r) { const res = { statusCode: 200, setHeader() {}, end(s) { this.body = s; } }; await handler(r, res); return res; }
const fresh = () => { mails = []; created = 0; gate.resetLimits(); };
const FAKE_Q = "Your account is locked. Call +1 555 0100 now";

test("formGate: relay header, Turnstile, open while RELAY_SECRET is unset, else unverified; the token never reaches the form", async () => {
  const b = { "cf-turnstile-response": "good" };
  assert.equal(await gate.formGate({ headers: {} }, { ...b }), "open");
  process.env.RELAY_SECRET = "relay-secret";
  assert.equal(await gate.formGate({ headers: { "x-qv-relay": "relay-secret" } }, {}), "relay");
  assert.equal(await gate.formGate({ headers: { "x-qv-relay": "relay-secre" } }, {}), "unverified");
  assert.equal(await gate.formGate({ headers: {} }, { ...b }), "unverified", "Turnstile off: a token proves nothing");
  process.env.TURNSTILE_SECRET_KEY = "ts";
  const body = { ...b, name: "x" };
  assert.equal(await gate.formGate({ headers: {} }, body), "turnstile");
  assert.equal("cf-turnstile-response" in body, false);
  assert.equal(await gate.formGate({ headers: {} }, { "cf-turnstile-response": "bad" }), "unverified");
  delete process.env.RELAY_SECRET; delete process.env.TURNSTILE_SECRET_KEY;
});

const legal = (extra = {}) => ({ lang: "ru", name: "Test Person", email: "person@example.org", consent: "yes", followup: "yes", story: "Нужен адвокат.", quote: "yes", lawyer: "never",
  copy: [{ q: "Имя", a: "Test" }, { q: FAKE_Q, a: "Go to evil.example" }], ...extra });

test("legal help: unverified → saved, no email to the address it names, the team copy keeps only real questions; relayed → copy sent", async () => {
  process.env.RELAY_SECRET = "relay-secret";
  fresh();
  const r = await run(survey, req("/api/legal-help", legal()));
  assert.equal(r.statusCode, 200); assert.equal(created, 1);
  assert.equal(mails.filter((m) => m.to === "person@example.org").length, 0);
  const team = mails.find((m) => m.to === "team@example.org");
  assert.ok(team, "the team still hears about it");
  assert.doesNotMatch(team.html, /account is locked/);
  fresh();
  await run(survey, req("/api/legal-help", legal(), { "x-qv-relay": "relay-secret" }));
  const copy = mails.find((m) => m.to === "person@example.org");
  assert.ok(copy, "a relayed request (qaravan.org checked Turnstile) gets its copy");
  delete process.env.RELAY_SECRET;
  fresh();
  await run(survey, req("/api/legal-help", legal()));
  assert.ok(mails.find((m) => m.to === "person@example.org"), "RELAY_SECRET unset: as before");
});

test("support letter: a copy keeps only the letter's own questions", async () => {
  fresh();
  const copy = [{ q: "Which countries could you be deported to?", a: "Kazakhstan" }, { q: FAKE_Q, a: "now" }, { q: "Telegram", a: "@me" }];
  await run(letter, req("/api/letter", { rid: "22222222-3333-4444-8555-666666666666", mode: "submit", lang: "en", a: { firstName: "T", email: "t@example.org" }, log: [], step: 18, copy }));
  const m = mails.find((x) => /A copy of your answers|copy/i.test(x.html) && x.to === "t@example.org" && /Kazakhstan/.test(x.html));
  assert.ok(m, "the copy went out");
  assert.doesNotMatch(m.html, /account is locked/);
  assert.match(m.html, /Telegram/);
});

test("event feedback: a copy keeps the page's questions and the event's own name and question, nothing else", async () => {
  fresh();
  const copy = [{ q: "Picnic in the park", a: "1 ноября 2026, 2:00 PM" }, { q: "Как вам в целом?", a: "★★★★☆" }, { q: "What should we bring next time?", a: "Cake" }, { q: FAKE_Q, a: "x" }];
  await run(submit, req("/api/submit", { eventId: "111", rating: 4, lang: "en", email: "guest@example.org", photos: [], copy }));
  const m = mails.find((x) => x.to === "guest@example.org");
  assert.ok(m);
  for (const t of ["Picnic in the park", "Как вам в целом?", "What should we bring next time?"]) assert.ok(m.html.includes(t), t);
  assert.doesNotMatch(m.html, /account is locked/);
});

test("caps: at most 3 copies to one address and 10 from one IP a day", async () => {
  fresh();
  const send = (to, ip = "") => sendAnswersCopy({ to, lang: "en", form: "Test", copy: [{ q: "Email", a: to }], ip });
  const r = [];
  for (let i = 0; i < 4; i++) r.push(await send("same@example.org"));
  assert.deepEqual(r, [true, true, true, false]);
  const byIp = [];
  for (let i = 0; i < 11; i++) byIp.push(await send(`p${i}@example.org`, "203.0.113.9"));
  assert.equal(byIp.filter(Boolean).length, 10);
});

// ---- every question the pages send is on their list ----
const src = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const plain = (s) => String(s).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const table = (file, start, end, expr) => { const s = src(file); const i = s.indexOf(start); return vm.runInNewContext(s.slice(i, s.indexOf(end, i + 1)) + `\n;(${expr})`, { window: {} }); };

test("letter: every question copyPairs uses, in all six languages", () => {
  const W = {}; vm.runInNewContext(src("letter/strings.js"), { window: W });
  const app = src("letter/app.js");
  const body = app.slice(app.indexOf("function copyPairs()"), app.indexOf("\nfunction fmtDate"));
  const keys = [...new Set([...body.matchAll(/add\(t\("(\w+)"\)/g)].map((m) => m[1]))];
  assert.ok(keys.length > 15);
  const set = formQuestions("letter");
  for (const lang of Object.keys(W.QARAVAN_STRINGS)) for (const k of keys) {
    const q = plain(W.QARAVAN_STRINGS[lang][k] ?? W.QARAVAN_STRINGS.en[k]);
    assert.ok(set.has(q), `${lang} ${k}: ${q}`);
  }
  for (const q of ["Telegram", "WhatsApp", "Instagram"]) assert.ok(set.has(q));
});

test("legal help, event volunteers, support groups, feedback: their questions are on their lists", () => {
  const L = table("legal-help/index.html", "const YN =", "// ===== состояние", "STRINGS"), ls = formQuestions("legal-help");
  for (const lang of ["ru", "en"]) for (const q of [L[lang].name, L[lang].email, ...Object.values(L[lang].q)]) assert.ok(ls.has(plain(q)), q);
  const V = table("event-volunteers/index.html", "const STRINGS =", "// ===== состояние", "STRINGS"), vs = formQuestions("event-volunteers");
  for (const lang of ["ru", "en"]) for (const k of ["q_name", "pronouns", "phone", "q_roles", "q_months", "q_freq", "q_attended", "q_notes"]) assert.ok(vs.has(plain(V[lang][k])), `${lang} ${k}`);
  const S = table("support/app.js", "const FORMS =", "// ===== состояние", "{ FORMS, COMMON, TEXTS }"), ss = formQuestions("support-groups");
  for (const g of ["gina", "simon"]) for (const lang of ["ru", "en"]) {
    const T = (k) => S.TEXTS[g][lang][k] ?? S.COMMON[lang][k];
    for (const f of S.FORMS[g]) for (const k of f.type === "contact" ? ["email", "phone"] : ["q_" + f.id]) assert.ok(ss.has(plain(T(k))), `${g} ${lang} ${k}`);
  }
  const fs = formQuestions("feedback");
  for (const page of ["attendee", "multi"]) {
    const P = table(`pages/${page}.html`, "const STRINGS =", "const params =", "STRINGS");
    for (const lang of ["ru", "en"]) for (const k of ["q_rating", "q_high", "q_low", "q_moment_good", "q_moment_bad", "q_whycome", "q_consent", "q_contact"]) if (P[lang][k]) assert.ok(fs.has(plain(P[lang][k])), `${page} ${lang} ${k}`);
  }
});
