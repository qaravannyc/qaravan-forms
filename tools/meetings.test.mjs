// Checks for the meeting-link emails (lib/meetings.mjs) with an in-memory store instead of
// monday and a fake Gmail: the private link, defaults from the last meeting, the send
// (one email, everyone in Bcc, the leader in To), the remembered ticks (Gina: status Joined),
// people added by hand, and the day-before prompt. Run: node --test tools/meetings.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

process.env.MONDAY_TOKEN = "fake-token";
process.env.GOOGLE_REFRESH_TOKEN = "fake";
process.env.CRON_SECRET = "cron";
const mails = [];
globalThis.fetch = async (url, opts = {}) => {
  if (String(url).startsWith("https://oauth2.googleapis.com/")) return new Response(JSON.stringify({ access_token: "tok" }));
  if (String(url).startsWith("https://gmail.googleapis.com/")) { mails.push(Buffer.from(JSON.parse(opts.body).raw, "base64url").toString("utf8")); return new Response("{}"); }
  throw new Error("unexpected fetch " + url);
};
const M = await import("../lib/meetings.mjs");
const survey = (await import("../api/survey.mjs")).default;

const at = (iso) => new Date(iso);
function fakeStore() {
  const s = {
    meetings: {
      "900": { id: "900", name: "Support Group with Gina", group: "gina", start: at("2026-09-30T23:30:00Z"), status: "Confirmed", link: "", mail: {} },
      "800": { id: "800", name: "Support Group with Gina", group: "gina", start: at("2026-09-24T23:30:00Z"), status: "Confirmed", link: "https://meet.google.com/old-link", mail: { link: "https://meet.google.com/old-link", dial: "", text: "Прошлый текст Джины", sent: [{ at: "2026-09-23T16:40:00Z", n: 3 }] } },
      "700": { id: "700", name: "Support Group with Simon", group: "simon", start: at("2026-10-03T15:00:00Z"), status: "Cancelled", link: "", mail: {} },
    },
    rows: {
      gina: [
        { id: "1", name: "Алекс", email: "alex@example.com", checked: true, status: "Joined", source: "Typeform", date: "2026-01-01 10:00" },
        { id: "2", name: "Алекс И.", email: "alex@example.com", checked: false, status: "New", source: "feedback.qaravan.org", date: "2026-09-01 10:00" },
        { id: "3", name: "Мария", email: "maria@example.com", checked: false, status: "", source: "Typeform", date: "2025-05-01 10:00" },
        { id: "4", name: "Без почты", email: "", checked: false, status: "", source: "", date: "" },
      ],
      simon: [],
    },
    saved: [], notes: [], changes: [], added: [],
    async meeting(id) { return s.meetings[id] || null; },
    async meetingsBetween() { return Object.values(s.meetings); },
    async previousMeetings(g, before) { return Object.values(s.meetings).filter((m) => m.group === g && m.start < before && m.mail?.text).sort((a, b) => b.start - a.start); },
    async saveMeeting(id, v) { s.saved.push({ id, ...v }); if (v.mail) s.meetings[id].mail = v.mail; if (v.link !== undefined) s.meetings[id].link = v.link; },
    async note(id, text) { s.notes.push({ id, text }); },
    async people(g) { return s.rows[g].map((r) => ({ ...r })); },
    async setMailing(g, ch) { s.changes.push(...ch); for (const c of ch) s.rows[g].find((r) => r.id === c.id).checked = c.checked; },
    async addPerson(g, p) { s.added.push(p); s.rows[g].push({ id: "n" + s.added.length, name: p.name, email: p.email, checked: true, status: "", source: "Added by hand", date: "2026-09-29" }); return "n" + s.added.length; },
  };
  return s;
}
const NOW = at("2026-09-29T16:20:00Z"); // вторник, 12:20 по Нью-Йорку, за день до встречи 900
const token = (item = "900", group = "gina", exp = Date.parse("2026-10-01T05:30:00Z")) => M.signToken({ item, group, exp });

test("the private link: tamper-proof, tied to one meeting, expires after it", () => {
  const t = token();
  assert.deepEqual(M.verifyToken(t, NOW.getTime()), { item: "900", group: "gina" });
  assert.deepEqual(M.verifyToken(t.slice(0, -3) + "abc", NOW.getTime()), { error: "bad" });
  const [body, sig] = t.split(".");
  const forged = Buffer.from(JSON.stringify({ i: "901", g: "gina", x: 9999999999 })).toString("base64url");
  assert.deepEqual(M.verifyToken(`${forged}.${sig}`, NOW.getTime()), { error: "bad" });
  assert.deepEqual(M.verifyToken(t, Date.parse("2026-10-02T00:00:00Z")), { error: "expired" });
  assert.deepEqual(M.verifyToken("", NOW.getTime()), { error: "bad" });
  assert.equal(M.tokenExp(at("2026-09-30T23:30:00Z")), Date.parse("2026-10-01T05:30:00Z"));
});

test("dates are New York time; the subject says tomorrow", () => {
  const s = at("2026-09-30T23:30:00Z");
  assert.equal(M.when(s, 60).line, "Среда, 30 сентября, 19:30–20:30 по Нью-Йорку");
  assert.equal(M.when(at("2026-10-03T15:00:00Z")).line, "Суббота, 3 октября, 11:00 по Нью-Йорку");
  assert.equal(M.defaultSubject("gina", s, NOW), "Группа поддержки: встреча завтра, 30 сентября, в 19:30");
  assert.equal(M.relDay(s, at("2026-09-30T14:00:00Z")), "сегодня");
  assert.equal(M.people(1), "1 человек"); assert.equal(M.people(3), "3 человека"); assert.equal(M.people(14), "14 человек");
});

test("page data: last meeting's link and text by default, one row per email, ticked first", async () => {
  M.setStore(fakeStore());
  const d = await M.pageData(token(), NOW);
  assert.equal(d.title, "Группа поддержки");
  assert.equal(d.leaderEmail, "gina@rusalgbtq.org");
  assert.equal(d.link, "https://meet.google.com/old-link");
  assert.equal(d.text, "Прошлый текст Джины");
  assert.equal(d.subject, "Группа поддержки: встреча завтра, 30 сентября, в 19:30");
  assert.deepEqual(d.people.map((p) => [p.email, p.name, p.checked]), [["alex@example.com", "Алекс И.", true], ["maria@example.com", "Мария", false]]);
  const none = fakeStore(); none.meetings["800"].mail = {}; none.meetings["800"].link = ""; M.setStore(none);
  const d2 = await M.pageData(token(), NOW);
  assert.equal(d2.link, "https://meet.google.com/tyu-nksn-hpd"); // постоянная ссылка Джины
  assert.match(d2.text, /^Всем привет, друзья! 💕\n\nПриходите завтра на нашу встречу!/);
  // открыла в день встречи — «сегодня»; у Саймона с большой буквы
  const d3 = await M.pageData(token(), at("2026-09-30T15:00:00Z"));
  assert.match(d3.text, /Приходите сегодня на нашу встречу!/);
  assert.equal(M.fillWhen(M.GROUPS.simon.text, at("2026-10-03T15:00:00Z"), NOW).split("\n")[2], "3 октября встречаемся в группе равной поддержки. Подключайтесь по ссылке ниже.");
  assert.doesNotMatch(M.fillWhen(M.GROUPS.gina.text, at("2026-09-30T23:30:00Z"), NOW), /\{/);
  assert.equal(d2.dial, "(US) +1 216-839-9317, PIN: 382 371 488#");
  assert.deepEqual(await M.pageData("nope", NOW), { error: "bad" });
});

test("send: one email, leader in To, everyone else in Bcc, replies to the leader; ticks and new people saved", async () => {
  const s = fakeStore(); M.setStore(s); mails.length = 0;
  const r = await M.sendMeeting(token(), {
    link: "https://meet.google.com/tyu-nksn-hpd", dial: "(US) +1 216-839-9317", subject: "Встреча завтра", text: "Всем привет!\n\nС любовью, Джина 🌈",
    selected: ["maria@example.com", "MARIA@example.com", "not-an-email", "gina@rusalgbtq.org"], add: [{ name: "Глеб", email: "gleb@example.com" }, { name: "Мария", email: "maria@example.com" }],
  }, NOW);
  assert.deepEqual({ ok: r.ok, sent: r.sent, added: r.added }, { ok: true, sent: 2, added: 1 });
  assert.equal(mails.length, 1);
  const raw = mails[0];
  assert.match(raw, /\r\nTo: gina@rusalgbtq\.org\r\n/);
  assert.match(raw, /\r\nBcc: (maria@example\.com, gleb@example\.com|gleb@example\.com, maria@example\.com)\r\n/);
  assert.match(raw, /\r\nReply-To: gina@rusalgbtq\.org\r\n/);
  assert.doesNotMatch(raw.split("\r\n\r\n")[0], /alex@example/);
  const html = Buffer.from(raw.split("Content-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n")[1].split("\r\n")[0], "base64").toString("utf8");
  assert.match(html, /Присоединиться к встрече/);
  assert.match(html, /href="https:\/\/meet\.google\.com\/tyu-nksn-hpd"/);
  assert.match(html, /Среда, 30 сентября, 19:30–20:45 по <span style="white-space:nowrap;">Нью-Йорку<\/span>/);
  assert.match(html, /С любовью, Джина 🌈/);
  assert.match(html, /По телефону: \(US\) \+1 216-839-9317/);
  // Алекс был отмечен — теперь снят (на обеих его строках), Мария отмечена, Глеб добавлен
  assert.deepEqual(s.changes.sort((a, b) => a.id.localeCompare(b.id)), [{ id: "1", checked: false }, { id: "3", checked: true }]);
  assert.deepEqual(s.added, [{ name: "Глеб", email: "gleb@example.com" }]);
  const saved = s.saved.at(-1);
  assert.equal(saved.link, "https://meet.google.com/tyu-nksn-hpd");
  assert.equal(saved.mail.text, "Всем привет!\n\nС любовью, Джина 🌈");
  assert.equal(saved.mail.sent.at(-1).n, 2);
  assert.doesNotMatch(s.notes[0].text, /@example\.com/); // в ленте календаря — без адресов участников
});

test("who gets the emails on the board: Gina — status Joined, Simon — the checkbox", async () => {
  assert.equal(M.isOn("gina", { sg_status: { text: "Joined" } }), true);
  for (const st of ["New", "Contacted", "Intro call done", "Not now", ""]) assert.equal(M.isOn("gina", { sg_status: { text: st } }), false);
  assert.equal(M.isOn("simon", { mailing: { value: '{"checked":"true"}' } }), true);
  assert.equal(M.isOn("simon", { mailing: { value: null } }), false);
  assert.deepEqual(M.mailingValue("gina", true), { sg_status: { label: "Joined" } });
  assert.deepEqual(M.mailingValue("gina", false), { sg_status: { label: "Not now" } });
  assert.deepEqual(M.mailingValue("simon", false), { mailing: null });

  // настоящий store против поддельного monday: что читается и что пишется на доску Джины
  const calls = [], real = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url) !== "https://api.monday.com/v2") return real(url, opts);
    const { query, variables } = JSON.parse(opts.body); calls.push({ query, variables });
    if (query.includes("items_page")) return new Response(JSON.stringify({ data: { boards: [{ items_page: { items: [
      { id: "1", name: "Алекс", created_at: "2026-01-01T10:00:00Z", column_values: [{ id: "email", text: "alex@example.com" }, { id: "sg_status", text: "Joined" }] },
      { id: "2", name: "Мария", created_at: "2026-09-29T10:00:00Z", column_values: [{ id: "email", text: "maria@example.com" }, { id: "sg_status", text: "New" }] },
    ] } }] } }));
    return new Response(JSON.stringify({ data: { create_item: { id: "3" } } }));
  };
  try {
    M.setStore(null);
    const rows = await M.mondayStore.people("gina");
    assert.deepEqual(rows.map((r) => [r.email, r.checked, r.status]), [["alex@example.com", true, "Joined"], ["maria@example.com", false, "New"]]);
    assert.doesNotMatch(calls[0].query, /mailing/);
    await M.mondayStore.setMailing("gina", [{ id: "1", checked: false }, { id: "2", checked: true }]);
    assert.deepEqual([calls[1].variables.v0, calls[1].variables.v1].map((v) => JSON.parse(v)), [{ sg_status: { label: "Not now" } }, { sg_status: { label: "Joined" } }]);
    await M.mondayStore.addPerson("gina", { name: "Новый", email: "new@example.com" });
    assert.deepEqual(JSON.parse(calls[2].variables.v), { email: { email: "new@example.com", text: "new@example.com" }, sg_status: { label: "Joined" }, source: { label: "Added by hand" } });
    await M.mondayStore.addPerson("simon", { name: "Новый", email: "new@example.com" });
    assert.deepEqual(JSON.parse(calls[3].variables.v), { email_2: { email: "new@example.com", text: "new@example.com" }, mailing: { checked: "true" } });
  } finally { globalThis.fetch = real; }
});

test("send: bad input is refused before anything is written or sent", async () => {
  const s = fakeStore(); M.setStore(s); mails.length = 0;
  const r = await M.sendMeeting(token(), { link: "meet.google.com/x", subject: "", text: " ", selected: [] }, NOW);
  assert.equal(r.status, 400);
  assert.deepEqual(r.fields, ["link", "text", "subject", "people"]);
  assert.equal(mails.length, 0); assert.equal(s.changes.length + s.saved.length, 0);
  const r2 = await M.sendMeeting(token("900", "simon"), { link: "https://x.org/a", subject: "a", text: "b", selected: ["a@b.co"] }, NOW);
  assert.equal(r2.status, 404); // ключ Саймона к встрече Джины не подходит
  const r3 = await M.sendMeeting(token(), { link: "https://x.org/a", subject: "a", text: "b", selected: ["a@b.co"] }, at("2026-10-02T00:00:00Z"));
  assert.deepEqual([r3.status, r3.error], [403, "expired"]);
});

test("prompt: tomorrow's meetings only, once, not for cancelled ones; the button opens the send page", async () => {
  const s = fakeStore(); M.setStore(s); mails.length = 0;
  const done = await M.promptTomorrow({ now: NOW });
  assert.deepEqual(done.map((d) => [d.item, d.to, d.inList]), [["900", "gina@rusalgbtq.org", 1]]);
  assert.equal(mails.length, 1);
  assert.match(mails[0], /\r\nTo: gina@rusalgbtq\.org\r\n/);
  const html = Buffer.from(mails[0].split("Content-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n")[1].split("\r\n")[0], "base64").toString("utf8");
  const url = /href="(https:\/\/feedback\.qaravan\.org\/support\/send\?t=[^"]+)"/.exec(html)[1];
  assert.deepEqual(M.verifyToken(new URL(url).searchParams.get("t"), NOW.getTime()), { item: "900", group: "gina" });
  assert.match(html, /Сейчас в списке: 1 человек/);
  assert.ok(s.meetings["900"].mail.prompted);
  mails.length = 0;
  assert.deepEqual(await M.promptTomorrow({ now: NOW }), []); // второй раз не спрашиваем
  assert.equal(mails.length, 0);
  const forced = await M.promptTomorrow({ now: NOW, item: "900", dry: true });
  assert.equal(forced.length, 1); assert.match(forced[0].url, /\/support\/send\?t=/); assert.equal(mails.length, 0);
  // тестовая копия: то же письмо с настоящей кнопкой, но на другой адрес; отметку не трогает
  const s2 = fakeStore(); M.setStore(s2); mails.length = 0;
  const test1 = await M.promptTomorrow({ now: NOW, item: "900", to: "me@example.org" });
  assert.deepEqual(test1.map((d) => [d.item, d.to]), [["900", "me@example.org"]]);
  assert.match(mails[0], /\r\nTo: me@example\.org\r\n/);
  assert.doesNotMatch(mails[0], /gina@rusalgbtq\.org/);
  assert.equal(s2.meetings["900"].mail.prompted, undefined);
  // флажок у надзаголовка — ячейкой с bgcolor (пустой span Gmail не рисует)
  assert.match(html, /<td width="8" height="8" bgcolor="#7668AA"/);
  assert.doesNotMatch(html, /display:inline-block/);
});

function fakeReq(url, method = "GET", body = null, headers = {}) {
  const buf = Buffer.from(body ? JSON.stringify(body) : "");
  return { method, url, headers, async *[Symbol.asyncIterator]() { yield buf; } };
}
function fakeRes() { const r = { statusCode: 200, headers: {}, body: "", setHeader(k, v) { r.headers[k] = v; }, end(b) { r.body = b || ""; } }; return r; }

test("routes: /api/meetings answers through the survey function; prompts need the cron secret", async () => {
  M.setStore(fakeStore());
  const res = fakeRes();
  await survey(fakeReq("/api/meetings?t=bad"), res);
  assert.equal(res.statusCode, 403);
  const r2 = fakeRes();
  await survey(fakeReq("/api/meeting-prompts"), r2);
  assert.equal(r2.statusCode, 401);
  const r3 = fakeRes();
  await survey(fakeReq("/api/meeting-prompts?dry=1", "GET", null, { authorization: "Bearer cron" }), r3);
  assert.equal(r3.statusCode, 200);
  assert.equal(JSON.parse(r3.body).ok, true);
  const r7 = fakeRes();
  await survey(fakeReq("/api/meeting-prompts?key=cron&to=me@example.org"), r7);
  assert.equal(r7.statusCode, 400); // to — только вместе с item
  // без CRON_SECRET: обычный прогон можно, ручные режимы — нет
  delete process.env.CRON_SECRET;
  const r4 = fakeRes();
  await survey(fakeReq("/api/meeting-prompts"), r4);
  assert.equal(r4.statusCode, 200);
  const r5 = fakeRes();
  await survey(fakeReq("/api/meeting-prompts?dry=1"), r5);
  assert.equal(r5.statusCode, 503);
  const r6 = fakeRes();
  await survey(fakeReq("/api/meeting-prompts?item=900&to=me@example.org"), r6);
  assert.equal(r6.statusCode, 503); // без секрета тестовую копию не отправить
  process.env.CRON_SECRET = "cron";
  M.setStore(null);
});
