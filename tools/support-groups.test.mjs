// Checks for the support group sign-up handler (lib/support-groups.mjs) with a fake
// monday API: code → label mapping for both boards, validation, follow-up fields,
// the exclusive "prefer not to say", the honeypot and the retry without the phone.
// Run: node --test tools/support-groups.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

process.env.MONDAY_TOKEN = "fake";
const calls = [];
let failFirstCreate = false;
const mails = [];
globalThis.fetch = async (url, opts = {}) => {
  if (String(url).startsWith("https://oauth2.googleapis.com/")) return new Response(JSON.stringify({ access_token: "tok" }));
  if (String(url).startsWith("https://gmail.googleapis.com/")) { mails.push(Buffer.from(JSON.parse(opts.body).raw, "base64url").toString("utf8")); return new Response("{}"); }
  const { query, variables } = JSON.parse(opts.body);
  calls.push({ query, variables });
  if (query.includes("create_item")) {
    if (failFirstCreate) { failFirstCreate = false; return new Response(JSON.stringify({ errors: [{ message: "bad phone" }] })); }
    return new Response(JSON.stringify({ data: { create_item: { id: "888" } } }));
  }
  if (query.includes("create_update")) return new Response(JSON.stringify({ data: { create_update: { id: "u1" } } }));
  return new Response(JSON.stringify({ errors: [{ message: "unexpected" }] }));
};

const S = await import("../lib/support-groups.mjs");
const M = await import("../lib/support-mail.mjs");
const survey = (await import("../api/survey.mjs")).default;

function fakeReq(body, url = "/api/survey?form=support-groups", method = "POST") {
  const buf = Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  return { method, url, async *[Symbol.asyncIterator]() { yield buf; } };
}
function fakeRes() {
  const r = { statusCode: 200, headers: {}, body: "", setHeader(k, v) { r.headers[k] = v; }, end(b) { r.body = b || ""; } };
  return r;
}
async function send(body, url) {
  calls.length = 0;
  const res = fakeRes();
  await survey(fakeReq(body, url), res);
  const create = calls.find((c) => c.query.includes("create_item"));
  return { res, create, cv: create && JSON.parse(create.variables.v), upd: calls.find((c) => c.query.includes("create_update")) };
}

const gina = () => ({
  group: "gina", lang: "ru", name: "  Алекс  Иванов ", email: "Alex@Example.com", phone: "(212) 555-0123", telegram: "https://t.me/alex_q", instagram: "",
  pronouns: "they", pronouns_other: "", in_us: "yes", in_us_note: "", regular: "yes", intro: "yes", rules: true,
  expect: "Поддержки.", needs: ["work", "talk", "nope", "work"], needs_text: "", notes: "",
});
const simon = () => ({
  group: "simon", lang: "en", name: "Sasha Petrova", email: "sasha@example.com", phone: "+7 916 123-45-67", instagram: "instagram.com/sasha.p",
  city: "Brooklyn, NY", identities: ["queer", "nonbinary", "nope"], format: "both", question: "Как найти психолога?", notes: "",
});

test("Gina: a valid form becomes one row on her board with the board's labels", async () => {
  const { res, create, cv, upd } = await send(gina());
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, '{"ok":true}');
  assert.equal(create.variables.b, "18433061986");
  assert.equal(create.variables.g, "topics");
  assert.equal(create.variables.n, "Алекс Иванов");
  assert.deepEqual(cv.sg_status, { label: "New" });
  assert.match(cv.submitted.date, /^\d{4}-\d\d-\d\d$/);
  assert.match(cv.submitted.time, /^\d\d:\d\d:\d\d$/);
  assert.equal(cv.pronouns, "Они/Их");
  assert.deepEqual(cv.email, { email: "alex@example.com", text: "alex@example.com" });
  assert.deepEqual(cv.phone, { phone: "+12125550123", countryShortName: "US" });
  assert.equal(cv.telegram, "@alex_q");
  assert.equal("instagram" in cv, false);
  assert.deepEqual(cv.in_us, { label: "Yes" });
  assert.equal("in_us_note" in cv, false);
  assert.deepEqual(cv.regular, { label: "Yes" });
  assert.equal(cv.immig_mh, undefined); // вопрос убран 30.09.2026
  assert.deepEqual(cv.intro_call, { label: "Yes" });
  assert.deepEqual(cv.rules, { label: "Yes" });
  assert.deepEqual(cv.expect, { text: "Поддержки." });
  assert.deepEqual(cv.needs_pick, { labels: ["Work", "Talking with people"] });
  assert.equal("needs" in cv, false);
  assert.equal("notes" in cv, false);
  assert.deepEqual(cv.source, { label: "feedback.qaravan.org" });
  assert.deepEqual(cv.form_lang, { label: "RU" });
  assert.equal(upd.variables.i, "888");
  assert.match(upd.variables.t, /^Анкета с формы feedback\.qaravan\.org\/support\/gina, язык формы: RU/);
  assert.match(upd.variables.t, /Telegram: @alex_q/);
  assert.match(upd.variables.t, /Телефон: \+12125550123/);
  assert.match(upd.variables.t, /Что нужнее всего: Work, Talking with people/);
});

test("Gina: own pronouns and «не совсем» are written as typed", async () => {
  const { cv, upd } = await send({ ...gina(), pronouns: "other", pronouns_other: "ze/zir", in_us: "partly", in_us_note: "Пока в Мексике", notes: "Спасибо" });
  assert.equal(cv.pronouns, "ze/zir");
  assert.deepEqual(cv.in_us, { label: "Not exactly" });
  assert.equal(cv.in_us_note, "Пока в Мексике");
  assert.deepEqual(cv.notes, { text: "Спасибо" });
  assert.match(upd.variables.t, /не совсем — Пока в Мексике/);
});

test("Gina: needs — up to three picks in pick order; «Другое» needs own words, which are kept only with it", async () => {
  const { cv, upd } = await send({ ...gina(), needs: ["support", "other", "talk", "friends"], needs_text: "Найти психолога" });
  assert.deepEqual(cv.needs_pick, { labels: ["Support & understanding", "Something else", "Talking with people"] });
  assert.deepEqual(cv.needs, { text: "Найти психолога" });
  assert.match(upd.variables.t, /Что нужнее всего: Support & understanding, Something else, Talking with people\nДругое, своими словами:\nНайти психолога/);
  const { cv: cv2 } = await send({ ...gina(), needs: ["talk"], needs_text: "осталось от «Другого»" });
  assert.equal("needs" in cv2, false);
  const { res } = await send({ ...gina(), needs: ["other"], needs_text: " " });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(JSON.parse(res.body).fields, ["needs_text"]);
  const { res: res2 } = await send({ ...gina(), needs: ["nope"], needs_text: "только текст" });
  assert.deepEqual(JSON.parse(res2.body).fields, ["needs"]);
});

test("Gina: missing answers → 400 with the list, nothing written", async () => {
  const { res } = await send({ group: "gina", name: " ", email: "nope", phone: "123", pronouns: "other", in_us: "partly", regular: "maybe", rules: "true" });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(JSON.parse(res.body).fields, ["name", "email", "phone", "pronouns_other", "in_us_note", "regular", "intro", "rules", "expect", "needs"]);
  assert.equal(calls.length, 0);
});

test("Simon: a valid form lands in the existing board's columns, labels as on the board", async () => {
  const { res, create, cv, upd } = await send(simon());
  assert.equal(res.body, '{"ok":true}');
  assert.equal(create.variables.b, "5469799506");
  assert.equal(create.variables.g, "new_group");
  assert.equal(create.variables.n, "Sasha Petrova");
  assert.deepEqual(cv.phone_2, { phone: "+79161234567", countryShortName: "RU" });
  assert.deepEqual(cv.email_2, { email: "sasha@example.com", text: "sasha@example.com" });
  assert.equal(cv.short_text39, "Brooklyn, NY");
  assert.deepEqual(cv.multi_select, { labels: ["Queer", "Nonbinary"] });
  assert.deepEqual(cv.color, { label: "Remote and in-person" });
  assert.deepEqual(cv.long_text, { text: "Как найти психолога?" });
  assert.equal("long_text7" in cv, false);
  assert.match(upd.variables.t, /support\/simon, язык формы: EN/);
  assert.equal(cv.instagram, "@sasha.p");
  assert.equal("telegram" in cv, false);
  assert.match(upd.variables.t, /Как удобнее встречаться: и так, и так/);
});

test("Simon: «prefer not to say» wins over other identities; optional answers can be empty", async () => {
  const { cv } = await send({ ...simon(), identities: ["queer", "prefer_not"], format: "", question: "" });
  assert.deepEqual(cv.multi_select, { labels: ["Prefer not to say"] });
  assert.equal("color" in cv, false);
  assert.equal("long_text" in cv, false);
  const { cv: cv2 } = await send({ ...simon(), identities: [] });
  assert.equal("multi_select" in cv2, false);
});

test("Simon: city is required", async () => {
  const { res } = await send({ ...simon(), city: "  " });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(JSON.parse(res.body).fields, ["city"]);
});

test("every label the forms write exists on the boards", () => {
  // Метки досок на 2026-09-28 (get_board_info). Новая метка на доске — сюда тоже.
  const simonIdentities = ["Agender", "Asexual", "Bisexual", "Cisgender", "Demisexual", "Gay / Lesbian", "Genderfluid", "Genderqueer", "Heterosexual", "Nonbinary", "Pansexual", "Prefer not to say", "Queer", "Transgender"];
  const simonFormat = ["In-person only", "Remote only", "Remote and in-person"];
  for (const l of Object.values(S.IDENTITIES)) assert.ok(simonIdentities.includes(l), l);
  for (const l of Object.values(S.FORMAT)) assert.ok(simonFormat.includes(l), l);
  assert.deepEqual(Object.values(S.IN_US), ["Yes", "Not exactly"]);
  const ginaNeeds = ["Something else", "Talking with people", "Psychological help", "Support & understanding", "Friends & new people", "Growth & learning", "Work", "Calm, less anxiety", "Self-acceptance", "Community & belonging", "Money & steady income", "Papers & legal status", "Safety", "Health", "Relationships & love", "Housing", "Settling in", "Feeling less alone", "Food & basics", "Family relationships"];
  assert.deepEqual(Object.values(S.NEEDS).sort(), [...ginaNeeds].sort());
});

test("unknown group → 400; honeypot → polite ok; both write nothing", async () => {
  const { res } = await send({ ...gina(), group: "katya" });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(JSON.parse(res.body).fields, ["group"]);
  const { res: res2 } = await send({ ...gina(), website: "http://spam" });
  assert.equal(res2.body, '{"ok":true}');
  assert.equal(calls.length, 0);
});

test("if monday rejects the phone, the row is created without it and the number stays in the update", async () => {
  failFirstCreate = true;
  const { res } = await send(simon());
  assert.equal(res.body, '{"ok":true}');
  const creates = calls.filter((c) => c.query.includes("create_item"));
  assert.equal(creates.length, 2);
  assert.equal("phone_2" in JSON.parse(creates[1].variables.v), false);
  assert.match(calls.find((c) => c.query.includes("create_update")).variables.t, /Телефон: \+79161234567/);
});

test("the plain /api/support-groups path is routed too; event volunteers still get theirs", async () => {
  const { res } = await send(gina(), "/api/support-groups");
  assert.equal(res.body, '{"ok":true}');
  const { res: res2 } = await send({}, "/api/event-volunteers");
  assert.equal(res2.statusCode, 400); // event volunteers' own validation answered
  assert.deepEqual(JSON.parse(res2.body).fields, ["name", "phone", "email", "roles", "months"]);
});

test("team email: sections, links, needs in Russian, everything escaped, no middle dots", () => {
  const { p } = S.parseSignup({ ...gina(), name: "Алекс <b>Иванов</b>", needs: ["mental", "other"], needs_text: "Психолог & юрист", notes: "Строка 1\nСтрока 2" });
  const { subject, html } = M.signupEmail(p, { itemUrl: "https://qaravan.monday.com/boards/1/pulses/2", now: new Date("2026-09-28T22:20:00Z") });
  assert.equal(subject, "Новая анкета в группу поддержки с Джиной: Алекс <b>Иванов</b>");
  assert.match(html, /Алекс &lt;b&gt;Иванов&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>Иванов/);
  assert.match(html, /28 сентября в 18:20 по Нью-Йорку/);
  assert.match(html, /href="mailto:alex@example\.com"/);
  assert.match(html, /href="tel:\+12125550123"/);
  assert.match(html, /href="https:\/\/t\.me\/alex_q"/);
  assert.match(html, /Психологическая помощь/);
  assert.match(html, /Другое: Психолог &amp; юрист/);
  assert.match(html, /Строка 1<br>Строка 2/);
  assert.match(html, /href="https:\/\/qaravan\.monday\.com\/boards\/1\/pulses\/2"/);
  assert.equal(html.includes("·"), false);
  const { p: ps } = S.parseSignup(simon());
  const s2 = M.signupEmail(ps, {});
  assert.match(s2.html, /Квир/);
  assert.match(s2.html, /href="https:\/\/instagram\.com\/sasha\.p"/);
  assert.doesNotMatch(s2.html, /Открыть в monday/); // без ссылки на строку — без кнопки
});

test("team email: every option has a Russian name; recipients can be overridden", () => {
  assert.deepEqual(Object.keys(M.NEEDS_RU).sort(), Object.keys(S.NEEDS).sort());
  assert.deepEqual(Object.keys(M.IDENTITIES_RU).sort(), Object.keys(S.IDENTITIES).sort());
  assert.deepEqual(M.recipients("simon", {}), ["ezra@qaravan.org"]);
  assert.deepEqual(M.recipients("gina", { SUPPORT_NOTIFY_GINA: " gina@rusalgbtq.org, nope ,ezra@qaravan.org" }), ["gina@rusalgbtq.org", "ezra@qaravan.org"]);
  assert.deepEqual(M.recipients("gina", { SUPPORT_NOTIFY_GINA: "" }), []);
});

test("a sign-up sends the team email with the row link; a failed email doesn't fail the sign-up", async () => {
  process.env.GOOGLE_REFRESH_TOKEN = "fake";
  mails.length = 0;
  const { res } = await send(gina());
  assert.equal(res.body, '{"ok":true}');
  assert.equal(mails.length, 1);
  assert.match(mails[0], /^From: QARAVAN <info@qaravan\.org>\r\nTo: ezra@qaravan\.org\r\n/);
  assert.match(mails[0], /boards\/18433061986\/pulses\/888/);
  delete process.env.GOOGLE_REFRESH_TOKEN; // без токена письмо не уходит, а анкета принимается
  mails.length = 0;
  const { res: res2 } = await send(simon());
  assert.equal(res2.body, '{"ok":true}');
  assert.equal(mails.length, 0);
});
