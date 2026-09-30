// Checks for «отметьте, кто пришёл» after a support group meeting: the email to the leader right
// after the meeting (lib/meetings.mjs, askAttendance — once, only after the end, never for
// cancelled meetings) and the page behind its button (lib/attendance.mjs): who is listed, the
// saved «Confirmed attendees» on the calendar row, cards found by email or «Other emails» or
// created, unticked people removed. In-memory stores instead of monday, a fake Gmail.
// Run: node --test tools/attendance.test.mjs
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
const A = await import("../lib/attendance.mjs");
const survey = (await import("../api/survey.mjs")).default;

const at = (iso) => new Date(iso);
const decode = (mime) => mime.split(/\r\n/).filter((l) => /^[A-Za-z0-9+/=]{40,}$/.test(l)).map((l) => Buffer.from(l, "base64").toString("utf8")).join("\n");
const START = at("2026-09-30T23:30:00Z"); // среда, 19:30 по Нью-Йорку; у Джины 60 минут → конец в 00:30Z

function meetingsFake() {
  const s = {
    meetings: {
      "900": { id: "900", name: "Support Group with Gina", group: "gina", start: START, status: "Confirmed", link: "", mail: { prompted: "2026-09-29T16:00:00Z" } },
      "901": { id: "901", name: "Support Group with Gina", group: "gina", start: at("2026-10-07T23:30:00Z"), status: "Confirmed", link: "", mail: {} },
      "700": { id: "700", name: "Support Group with Simon", group: "simon", start: at("2026-09-30T22:00:00Z"), status: "Cancelled", link: "", mail: {} },
      "701": { id: "701", name: "Peer Support Group with Simon", group: "simon", start: at("2026-09-30T21:00:00Z"), status: "Confirmed", link: "", mail: {} },
      "500": { id: "500", name: "Board game night", group: null, start: START, status: "Confirmed", link: "", mail: {} },
    },
    saved: [],
    async meeting(id) { return s.meetings[id] || null; },
    async meetingsBetween() { return Object.values(s.meetings); },
    async saveMeeting(id, v) { s.saved.push({ id, ...v }); if (v.mail) s.meetings[id].mail = v.mail; },
  };
  return s;
}

const card = (id, name, email, other = []) => ({ id, name, email, other });
function attendanceFake() {
  const s = {
    meetings: {
      "900": { id: "900", name: "Support Group with Gina", group: "gina", start: START, status: "Confirmed", mail: { prompted: "x", attendanceAsked: "y" }, confirmed: [card("c1", "Алекс Иванов", "alex@example.com", ["alex.old@example.com"])], excluded: ["c2"] },
      "901": { id: "901", name: "Support Group with Gina", group: "gina", start: at("2026-10-07T23:30:00Z"), status: "Confirmed", mail: {}, confirmed: [], excluded: [] },
    },
    past: [
      { id: "800", start: at("2026-09-24T23:30:00Z"), confirmed: [card("c1", "Алекс Иванов", "alex@example.com"), card("c2", "Мария Фомина", "maria@example.com"), card("c9", "Без почты", "")] },
      { id: "799", start: at("2026-09-16T23:30:00Z"), confirmed: [card("c2", "Мария Фомина", "maria@example.com")] },
    ],
    rows: [
      { id: "1", name: "Алекс", email: "alex.old@example.com", checked: true, status: "Joined", date: "2026-01-01 10:00" }, // та же карточка c1 — по «Other emails»
      { id: "2", name: "Мария", email: "maria@example.com", checked: true, status: "Joined", date: "2025-05-01 10:00" },
      { id: "3", name: "Глеб Руденко", email: "gleb@example.com", checked: false, status: "New", date: "2026-09-28 10:00" },
      { id: "4", name: "Надежда", email: "nadia@example.com", checked: true, status: "Joined", date: "2024-02-02 10:00" },
    ],
    cards: [card("c1", "Алекс Иванов", "alex@example.com", ["alex.old@example.com"]), card("c2", "Мария Фомина", "maria@example.com"), card("c9", "Без почты", ""), card("c5", "Nadia K", "nadia.k@example.com", ["nadia@example.com"])],
    created: [], evidence: [], mail: [], notes: [], found: [],
    async meeting(id) { const m = s.meetings[id]; return m ? { ...m, confirmed: m.confirmed.map((c) => ({ ...c })), excluded: [...m.excluded] } : null; },
    async pastMeetings() { return s.past; },
    async people() { return s.rows.map((r) => ({ ...r })); },
    async findCards(emails) {
      s.found.push(emails);
      const out = new Map();
      for (const e of emails) { const c = s.cards.find((c) => c.email === e) || s.cards.find((c) => c.other.includes(e)); if (c) out.set(e, c); }
      return out;
    },
    async createCard(p) { const id = "new" + (s.created.length + 1); s.created.push({ id, ...p }); s.cards.push(card(id, p.name, p.email)); return id; },
    async setEvidence(id, v) {
      s.evidence.push({ id, ...v });
      const m = s.meetings[id];
      m.confirmed = v.confirmed.map((cid) => s.cards.find((c) => c.id === cid) || card(cid, "?", ""));
      if (v.excluded) m.excluded = v.excluded;
    },
    async saveMail(id, mail) { s.mail.push({ id, mail }); s.meetings[id].mail = mail; },
    async note(id, text) { s.notes.push({ id, text }); },
  };
  return s;
}
const AFTER = at("2026-10-01T00:40:00Z"); // через 10 минут после конца встречи 900
const attToken = (item = "900", group = "gina", exp = START.getTime() + 14 * 86400000) => M.signToken({ item, group, exp, kind: "att" });

async function call(method, url, body) {
  const chunks = body === undefined ? [] : [Buffer.from(typeof body === "string" ? body : JSON.stringify(body))];
  const req = { method, url, headers: {}, async *[Symbol.asyncIterator]() { yield* chunks; } };
  const res = { statusCode: 200, headers: {}, body: "", setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b || ""; } };
  await survey(req, res);
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
}

test("links: the attendance key opens only the attendance page, for two weeks after the meeting", () => {
  const url = M.attendanceUrl("900", "gina", START);
  const t = new URL(url).searchParams.get("t");
  assert.match(url, /\/support\/attendance\?t=/);
  assert.deepEqual(M.verifyToken(t, AFTER.getTime(), process.env, "att"), { item: "900", group: "gina" });
  assert.deepEqual(M.verifyToken(t, AFTER.getTime()), { error: "bad" }); // страница отправки письма его не примет
  const send = new URL(M.sendUrl("900", "gina", START)).searchParams.get("t");
  assert.deepEqual(M.verifyToken(send, START.getTime(), process.env, "att"), { error: "bad" }); // и наоборот
  assert.deepEqual(M.verifyToken(t, START.getTime() + 13 * 86400000, process.env, "att"), { item: "900", group: "gina" });
  assert.deepEqual(M.verifyToken(t, START.getTime() + 15 * 86400000, process.env, "att"), { error: "expired" });
  assert.equal(M.meetingEnd("gina", START).toISOString(), "2026-10-01T00:30:00.000Z");
  assert.equal(M.meetingEnd("simon", START).toISOString(), "2026-10-01T01:00:00.000Z"); // длительность не указана — 90 минут
});

test("ask: right after the meeting ends, once, to the leader; not before the end, not for cancelled ones", async () => {
  const s = meetingsFake(); M.setStore(s); mails.length = 0;
  // 00:20Z: встреча Джины ещё идёт (до 00:30Z), у Саймона 701 уже кончилась (22:30Z), 700 отменена
  assert.deepEqual((await M.askAttendance({ now: at("2026-10-01T00:20:00Z") })).map((d) => [d.item, d.to]), [["701", "simon@rusalgbtq.org"]]);
  mails.length = 0;
  const done = await M.askAttendance({ now: AFTER });
  assert.deepEqual(done.map((d) => [d.item, d.to]), [["900", "gina@rusalgbtq.org"]]);
  assert.equal(mails.length, 1);
  const gina = mails[0];
  assert.match(gina, /^To: gina@rusalgbtq\.org/m);
  const body = decode(gina);
  assert.match(body, /Отметить, кто пришёл/);
  assert.match(body, /https:\/\/feedback\.qaravan\.org\/support\/attendance\?t=[\w-]+\.[\w-]+/);
  assert.match(body, /Среда, 30 сентября, 19:30–20:30 по/);
  assert.doesNotMatch(gina, /^Bcc:/m);
  assert.deepEqual(Object.keys(s.meetings["900"].mail).sort(), ["attendanceAsked", "prompted"]); // прежние отметки на строке сохранились
  // второй прогон через 15 минут — уже спрашивали
  mails.length = 0;
  assert.deepEqual(await M.askAttendance({ now: at("2026-10-01T00:55:00Z") }), []);
  assert.equal(mails.length, 0);
  // через 13 часов после конца — поздно (например, если запуски долго не шли)
  s.meetings["900"].mail = {};
  assert.deepEqual((await M.askAttendance({ now: at("2026-10-01T13:40:00Z") })).map((d) => d.item), []);
});

test("ask: item + to sends a test copy elsewhere without marking; dry sends nothing", async () => {
  const s = meetingsFake(); M.setStore(s); mails.length = 0;
  const [d] = await M.askAttendance({ now: AFTER, item: "900", to: "studio@rusalgbtq.org" });
  assert.equal(d.to, "studio@rusalgbtq.org");
  assert.match(mails[0], /To: studio@rusalgbtq\.org/);
  assert.equal(s.meetings["900"].mail.attendanceAsked, undefined);
  mails.length = 0;
  const [dry] = await M.askAttendance({ now: AFTER, item: "900", dry: true });
  assert.equal(mails.length, 0);
  assert.match(dry.url, /\/support\/attendance\?t=/);
});

test("people: one row per person, by email and «Other emails»; ticked, then group members and regulars, then the rest", () => {
  const s = attendanceFake();
  const list = A.buildPeople({ confirmed: s.meetings["900"].confirmed, past: s.past, rows: s.rows });
  assert.deepEqual(list.map((p) => [p.key, p.checked, p.member, p.past, p.card]), [
    ["alex@example.com", true, true, 1, "c1"], // анкета alex.old@ — та же карточка
    ["maria@example.com", false, true, 2, "c2"],
    ["nadia@example.com", false, true, 0, null], // карточки c5 на странице нет: найдём при сохранении
    ["card:c9", false, false, 1, "c9"],
    ["gleb@example.com", false, false, 0, null],
  ]);
  assert.equal(list[0].status, "Joined");
  assert.deepEqual(list[0].emails, ["alex@example.com", "alex.old@example.com"]);
});

test("page: the list for the leader; bad, expired, early and missing meetings are refused", async () => {
  const s = attendanceFake(); A.setStore(s);
  const d = await A.pageData(attToken(), AFTER);
  assert.equal(d.title, "Группа поддержки с Джиной");
  assert.equal(d.meeting.line, "Среда, 30 сентября, 19:30–20:30 по Нью-Йорку");
  assert.equal(d.people.length, 5);
  assert.deepEqual(Object.keys(d.people[0]).sort(), ["checked", "email", "key", "member", "name", "past", "status"]); // без id карточек
  assert.equal(d.saved, null);
  assert.deepEqual(await A.pageData(M.signToken({ item: "900", group: "gina", exp: Date.parse("2026-10-20T00:00:00Z") }), AFTER), { error: "bad" }); // ключ страницы отправки
  assert.deepEqual(await A.pageData(attToken(), at("2026-10-16T00:00:00Z")), { error: "expired" });
  assert.deepEqual(await A.pageData(attToken("901"), AFTER), { error: "early" });
  assert.deepEqual(await A.pageData(attToken("902"), AFTER), { error: "gone" });
  assert.deepEqual(await A.pageData(attToken("900", "simon"), AFTER), { error: "gone" });
});

test("save: ticked people become Confirmed attendees; cards found by email or other email, new ones created; unticked removed", async () => {
  const s = attendanceFake(); A.setStore(s);
  s.meetings["900"].confirmed.push(card("c7", "Отмечена в monday вручную", "hand@example.com"));
  const r = await A.saveAttendance(attToken(), {
    selected: ["maria@example.com", "nadia@example.com", "gleb@example.com", "not-on-page@example.com"],
    unselected: ["alex@example.com", "card:c9"],
    add: [{ name: "Новенькая", email: "New.Person@Example.com" }, { name: "", email: "alex.old@example.com" }, { name: "x", email: "broken" }],
  }, AFTER);
  assert.equal(r.status, 200);
  // Алекса сняли, но добавили по старой почте — значит, остаётся; c7 на странице не было — не трогаем
  const ev = s.evidence.at(-1);
  assert.deepEqual([...ev.confirmed].sort(), ["c1", "c2", "c5", "c7", "new1", "new2"].sort());
  assert.deepEqual(ev.excluded, []); // Марию отметили — из «Did not attend / declined» убрали
  assert.deepEqual(s.found, [["nadia@example.com", "gleb@example.com", "new.person@example.com"]]);
  assert.deepEqual(s.created.map(({ name, email, date }) => [name, email, date]), [["Глеб Руденко", "gleb@example.com", "2026-09-30"], ["Новенькая", "new.person@example.com", "2026-09-30"]]);
  assert.equal(r.n, 6); assert.equal(r.created, 2);
  assert.deepEqual(r.keys, { "new.person@example.com": "new.person@example.com", "alex.old@example.com": "alex@example.com" });
  assert.deepEqual(s.meetings["900"].mail, { prompted: "x", attendanceAsked: "y", attendance: { at: AFTER.toISOString(), n: 6 } });
  assert.equal(s.notes.length, 1);
  assert.doesNotMatch(s.notes[0].text, /@/); // без адресов
  assert.match(s.notes[0].text, /6 в «Confirmed attendees», новых карточек на доске посетителей мероприятий: 2/);

  // второй раз: сняли Глеба — уходит из «Confirmed attendees», карточка остаётся; excluded не пишем, если не менялся
  const again = await A.pageData(attToken(), AFTER);
  assert.equal(again.saved.n, 6);
  assert.ok(again.people.find((p) => p.key === "gleb@example.com").checked);
  await A.saveAttendance(attToken(), { selected: [], unselected: ["gleb@example.com"] }, AFTER);
  assert.deepEqual([...s.evidence.at(-1).confirmed].sort(), ["c1", "c2", "c5", "c7", "new2"].sort());
  assert.equal("excluded" in s.evidence.at(-1), false);
  assert.equal(s.created.length, 2);
});

test("save: refused with a bad key or before the meeting; nothing written", async () => {
  const s = attendanceFake(); A.setStore(s);
  assert.equal((await A.saveAttendance("nope", { selected: ["maria@example.com"] }, AFTER)).status, 403);
  assert.equal((await A.saveAttendance(attToken("901"), { selected: ["maria@example.com"] }, AFTER)).status, 409);
  assert.equal(s.evidence.length + s.created.length + s.notes.length, 0);
});

test("routes: /api/attendance through the survey function; /api/meeting-attendance is public without links, manual modes need the key", async () => {
  const s = attendanceFake(); A.setStore(s);
  const past = new Date(Date.now() - 2 * 86400000); // обработчик смотрит на настоящие часы
  s.meetings["900"].start = past;
  const t = attToken("900", "gina", past.getTime() + 14 * 86400000);
  const g = await call("GET", `/api/survey?form=attendance&t=${t}`);
  assert.equal(g.status, 200); assert.equal(g.json.people.length, 5);
  assert.equal((await call("GET", "/api/survey?form=attendance&t=bad")).status, 403);
  const p = await call("POST", "/api/survey?form=attendance", { t, selected: ["maria@example.com"], unselected: [] });
  assert.equal(p.status, 200); assert.equal(p.json.ok, true);
  assert.equal((await call("POST", "/api/survey?form=attendance", "{nope")).status, 400);

  const ms = meetingsFake(); M.setStore(ms); mails.length = 0;
  const run = await call("GET", "/api/survey?form=meeting-attendance");
  assert.equal(run.status, 200);
  assert.ok(Array.isArray(run.json.asked));
  assert.doesNotMatch(JSON.stringify(run.json), /support\/attendance|"to"/); // без ссылок и адресов
  assert.equal((await call("GET", "/api/survey?form=meeting-attendance&item=900&dry=1")).status, 401);
  const dry = await call("GET", "/api/survey?form=meeting-attendance&item=900&dry=1&key=cron");
  assert.equal(dry.status, 200); assert.match(dry.json.asked[0].url, /\/support\/attendance\?t=/);
  assert.equal((await call("GET", "/api/survey?form=meeting-attendance&to=x@example.com&key=cron")).status, 400); // to — только с item
});
