// Checks for "what monday already knows about this person" (lib/person-lookup.mjs), the step
// before the team email about a new support group sign-up: which card is picked (email,
// other email, phone), which events count as attended (as Attendance 2026 counts them),
// volunteering, the Community Agreement, earlier sign-ups, the timeout and the email section.
// Run: node --test tools/person-lookup.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

process.env.MONDAY_TOKEN = "fake";
const L = await import("../lib/person-lookup.mjs");
const S = await import("../lib/support-groups.mjs");
const Mail = await import("../lib/support-mail.mjs");

const NOW = new Date("2026-09-30T16:00:00Z");
const GINA = { board: "18433061986", email: "email", status: "sg_status", submitted: "submitted" };
const cv = (o) => Object.entries(o).map(([id, text]) => ({ id, text }));
const member = (id, extra = {}, led = []) => ({ id, name: "Алекс Иванов", column_values: cv({ email_mm5ysnnh: "alex@example.com", text_mm63j91w: "", color_mm63hwy2: null, text_mm6311dk: "", date_mm63tz8c: "", date_mm63nt8n: "2024-05-18", ...extra }), led: [{ linked_items: led }] });
const event = (id, name, date, status = "Done") => ({ id, name, column_values: cv({ date4: date, status }) });
const FIRST = {
  byEmail: { items: [member("500", { color_mm63hwy2: "Volunteer", text_mm6311dk: "фото" }, [event("L1", "Вечер настолок", "2025-03-03 19:00")])] },
  byOther: [{ items_page: { items: [] } }],
  agreement: [{ items_page: { items: [{ id: "a1", created_at: "2026-09-28T23:29:42Z", column_values: cv({ date_1: "2026-09-28" }) }] } }],
  volunteers: { items: [{ id: "v1", created_at: "2026-08-01T10:00:00Z", column_values: cv({ roles: "Event lead, Maker", app_status: "Новая" }) }] },
  earlier: { items: [{ id: "888", created_at: "2026-09-30T15:59:00Z", column_values: cv({ sg_status: "New", submitted: "" }) }, { id: "5", created_at: "2026-09-28T18:00:00Z", column_values: cv({ sg_status: "Joined", submitted: "2025-02-02 10:00" }) }] },
};
const EVENTS = { boards: [{
  confirmed: { items: [event("E1", "Брайтон Бич Прайд", "2026-05-01 12:00"), event("E2", "Будущая встреча", "2026-12-01 19:00")] },
  registered: { items: [event("E1", "Брайтон Бич Прайд", "2026-05-01 12:00"), event("E3", "Отменённый пикник", "2025-07-07 12:00", "Cancelled"), event("E4", "Группа поддержки <с Региной>", "2025-01-10 19:30"), event("E5", "Кино", "2025-06-01 19:00"), event("E6", "Сегодняшняя встреча", "2026-09-30 19:30")] },
  excluded: { items: [event("E5", "Кино", "2025-06-01 19:00")] },
}] };

test("phone keys: US numbers as 10 digits, others with the country code", () => {
  assert.deepEqual(L.phoneKeys("+12125550123"), ["2125550123"]);
  assert.deepEqual(L.phoneKeys("+79161234567"), ["79161234567"]);
  assert.deepEqual(L.phoneKeys(""), []);
});

test("first query: phone search only with a phone; earlier sign-ups read status and Submitted", () => {
  const a = L.firstQuery({ email: "alex@example.com", phone: "", group: GINA });
  assert.doesNotMatch(a.query, /byPhone|\$p/);
  assert.deepEqual(a.variables, { e: ["alex@example.com"], ec: ["alex@example.com"] });
  assert.match(a.query, /earlier: items_page_by_column_values\(board_id: 18433061986[^]*column_values\(ids: \["sg_status","submitted"\]\)/);
  const b = L.firstQuery({ email: "alex@example.com", phone: "+12125550123", group: { board: "5469799506", email: "email_2" } });
  assert.match(b.query, /byPhone/);
  assert.deepEqual(b.variables.p, ["2125550123"]);
  assert.match(b.query, /column_values\(ids: \[\]\)/); // у доски Саймона нет статуса и даты анкеты
  assert.deepEqual(L.eventsQuery("500").variables, { m: [500] });
});

test("dossier: attended = confirmed + verified registrations on past, not cancelled, not declined events", () => {
  const d = L.withoutItem(L.buildDossier(FIRST, EVENTS, { now: NOW, group: GINA }), "888");
  assert.equal(d.member.id, "500");
  assert.equal(d.member.by, "email");
  assert.equal(d.member.url, "https://qaravan.monday.com/boards/18425190164/pulses/500");
  assert.deepEqual(d.attended.map((e) => [e.id, e.confirmed]), [["E1", true], ["E4", false]]); // без будущей, сегодняшней, отменённой и «не пришёл»
  assert.deepEqual(d.led.map((e) => e.id), ["L1"]);
  assert.equal(d.agreement, "2026-09-28"); // с доски Community Agreement, хотя на карточке пусто
  assert.deepEqual(d.earlier.map((e) => [e.id, e.date, e.status]), [["5", "2025-02-02", "Joined"]]);
  const text = L.dossierText(d, { group: "gina" });
  assert.match(text, /^Что уже есть в monday:\nКарточка в Attendees: Есть, в базе с 18 мая 2024, https:\/\/qaravan\.monday\.com\/boards\/18425190164\/pulses\/500/);
  assert.match(text, /Мероприятия \(2\): 1 мая 2026 — Брайтон Бич Прайд\n  10 января 2025 — Группа поддержки <с Региной>/);
  assert.match(text, /Проводил\(а\) мероприятия \(1\): 3 марта 2025 — Вечер настолок/);
  assert.match(text, /Волонтёрство: На карточке: Volunteer\. Навыки: фото\n  Заявка 1 августа 2026: Event lead, Maker \(Новая\)/);
  assert.match(text, /Community Agreement: Подписан 28 сентября 2026/);
  assert.match(text, /Прежние анкеты в группу Джины: 1, последняя 2 февраля 2025, статус Joined/);
  assert.doesNotMatch(text, /·/);
});

test("dossier: a card found by phone says so; no card at all still shows the agreement", () => {
  const byPhone = { ...FIRST, byEmail: { items: [] }, byPhone: { items: [member("600")] } };
  const d = L.buildDossier(byPhone, { boards: [{}] }, { now: NOW, group: GINA });
  assert.equal(d.member.by, "phone");
  assert.match(L.dossierText(d, { group: "gina" }), /Карточка в Attendees: Есть, в базе с 18 мая 2024 \(нашли по телефону\)/);
  const none = L.buildDossier({ ...FIRST, byEmail: { items: [] }, volunteers: { items: [] }, earlier: { items: [] } }, null, { now: NOW, group: GINA });
  assert.equal(none.member, null);
  const t = L.dossierText(none, { group: "gina" });
  assert.match(t, /Карточка в Attendees: Нет: ни почта, ни телефон нам раньше не встречались/);
  assert.match(t, /Мероприятия: Ни одного подтверждённого/);
  assert.match(t, /Волонтёрство: Нет/);
  assert.match(t, /Community Agreement: Подписан 28 сентября 2026/);
  assert.doesNotMatch(t, /Прежние анкеты/);
});

test("lookup: events are asked only for a found card; errors and slowness give ok:false", async () => {
  const seen = [];
  const api = async (q, v) => { seen.push(q); return q.includes("attendance_confirmed") ? EVENTS : FIRST; };
  const d = await L.lookupPerson({ email: "alex@example.com", phone: { e164: "+12125550123" } }, { group: GINA, now: NOW, api });
  assert.equal(d.ok, true); assert.equal(seen.length, 2); assert.equal(d.attended.length, 2);
  seen.length = 0;
  const empty = { ...FIRST, byEmail: { items: [] }, byPhone: { items: [] } };
  const d2 = await L.lookupPerson({ email: "new@example.com", phone: null }, { group: GINA, now: NOW, api: async (q) => { seen.push(q); return empty; } });
  assert.equal(d2.member, null); assert.equal(seen.length, 1);
  assert.deepEqual(await L.lookupPerson({ email: "x@example.com" }, { api: async () => { throw new Error("boom"); } }), { ok: false });
  assert.deepEqual(await L.lookupPerson({ email: "x@example.com" }, { api: () => new Promise(() => {}), timeoutMs: 30 }), { ok: false });
  assert.equal(L.dossierText({ ok: false }), "Что уже есть в monday: проверить не получилось.");
});

test("team email: «Что уже есть в monday» comes first, escaped; a failed check says so", () => {
  const { p } = S.parseSignup({ group: "gina", lang: "ru", name: "Алекс", email: "alex@example.com", phone: "2125550123", pronouns: "they", in_us: "yes", regular: "yes", intro: "yes", rules: true, expect: "Поддержки.", needs: ["work"] });
  const d = L.withoutItem(L.buildDossier(FIRST, EVENTS, { now: NOW, group: GINA }), "888");
  const { html } = Mail.signupEmail(p, { itemUrl: "https://qaravan.monday.com/boards/1/pulses/2", now: NOW, known: d });
  assert.ok(html.indexOf("Что уже есть в monday") > 0 && html.indexOf("Что уже есть в monday") < html.indexOf("Контакты"));
  assert.match(html, /href="https:\/\/qaravan\.monday\.com\/boards\/18425190164\/pulses\/500"[^>]*>Открыть карточку</);
  assert.match(html, /10 января 2025 — Группа поддержки &lt;с Региной&gt;/);
  assert.match(html, /Подписан 28 сентября 2026/);
  const failed = Mail.signupEmail(p, { now: NOW, known: { ok: false } }).html;
  assert.match(failed, /Проверить не получилось: monday не ответил/);
  assert.doesNotMatch(Mail.signupEmail(p, { now: NOW }).html, /Что уже есть в monday/);
  assert.match(S.updateText(p, d), /\n\nЧто уже есть в monday:\nКарточка в Attendees: Есть/);
});
