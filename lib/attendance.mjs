// «Кто пришёл на встречу» — страница ведущей после встречи группы поддержки
// (/support/attendance?t=<ключ>, support/attendance.js). Письмо со ссылкой уходит ведущей
// сразу после встречи (lib/meetings.mjs, askAttendance); ссылка работает две недели.
//
// Что на странице (GET /api/attendance?t=…): по одному на человека (по почте) — участники группы
// (у Джины — статус «Joined», у Саймона — галочка рассылки), под ними новые анкеты (New) и те,
// кто уже отмечен в «Confirmed attendees» этой встречи (с галочкой); остальные анкеты и бывшие
// на прошлых встречах — свёрнуты (support/roster.js). Кого нет совсем, ведущая добавляет по
// имени и почте. Порядок на странице — по имени, и он не меняется от галочек.
// Сохранение (POST /api/attendance { t, selected, unselected, add }): отмеченные становятся
// «Confirmed attendees» встречи в календаре событий (4774572020) — это карточки доски
// посетителей мероприятий (18425190164). Кого там нет, ищем по почте и «Other emails», а
// если не нашли — заводим карточку (имя, почта, First seen — день встречи, Sources). Снятые
// галочки убирают человека из «Confirmed attendees»; кого ведущая отметила, убираем из
// «Did not attend / declined» этой встречи. «Guest records» (регистрации) не трогаем.
// Годовые доски посещений (робот sync-attendance в events-robot) считают «Confirmed
// attendees» подтверждённым участием. Робот сам эти колонки у групп поддержки не пишет: у
// них нет ссылки на Partiful.
import { GROUPS, CALENDAR, groupOf, startOf, when, verifyToken, peopleByEmail, mondayStore as meetingsStore } from "./meetings.mjs";
import { monday } from "./letter-board.mjs";

export const MEMBERS = "18425190164";
const P = { email: "email_mm5ysnnh", other: "text_mm63j91w", firstSeen: "date_mm63nt8n", sources: "text_mm63rhsv" };
const PEOPLE_GROUP = "group_mm634cbx"; // «People»
const EV = { date: "date4", status: "status", mail: "meeting_mail", confirmed: "attendance_confirmed", excluded: "attendance_excluded" };
export const SOURCE = "support group attendance";
const PAST_MEETINGS = 8; // «был(а) на прошлых встречах» — по стольким последним встречам группы
const TZ = "America/New_York";
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const nyDate = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

// ---------- monday ----------
const CARD = `id name column_values(ids: ["${P.email}", "${P.other}"]) { id text }`;
const MEETING = `id name column_values(ids: ["${EV.date}", "${EV.status}", "${EV.mail}", "${EV.confirmed}", "${EV.excluded}"]) { id text value ... on BoardRelationValue { linked_item_ids linked_items { ${CARD} } } }`;
const splitEmails = (s) => String(s || "").toLowerCase().split(/[,;\s]+/).filter((e) => e.includes("@"));
export function cardRow(it) {
  const cv = Object.fromEntries((it.column_values || []).map((c) => [c.id, c]));
  return { id: String(it.id), name: it.name || "", email: (cv[P.email]?.text || "").trim().toLowerCase(), other: splitEmails(cv[P.other]?.text) };
}
export function meetingRow(it) {
  const cv = Object.fromEntries((it.column_values || []).map((c) => [c.id, c]));
  let mail = {};
  try { const j = JSON.parse(cv[EV.mail]?.text || "null"); if (j && typeof j === "object") mail = j; } catch {}
  return {
    id: String(it.id), name: it.name, group: groupOf(it.name), start: startOf(cv[EV.date]?.value), status: cv[EV.status]?.text || "", mail,
    confirmed: (cv[EV.confirmed]?.linked_items || []).map(cardRow),
    excluded: (cv[EV.excluded]?.linked_item_ids || []).map(String),
  };
}

export const mondayStore = {
  async meeting(id) {
    const d = await monday(`query ($i: [ID!]) { items(ids: $i) { ${MEETING} } }`, { i: [String(id)] });
    return d.items?.[0] ? meetingRow(d.items[0]) : null;
  },
  // последние встречи группы до этой — самые свежие первыми
  async pastMeetings(group, before) {
    const d = await monday(`query ($b: [ID!], $n: CompareValue!) { boards(ids: $b) { items_page(limit: 40, query_params: { rules: [{ column_id: "name", compare_value: $n, operator: contains_text }], order_by: [{ column_id: "${EV.date}", direction: desc }] }) { items { ${MEETING} } } } }`,
      { b: [CALENDAR], n: group === "gina" ? "Gina" : "Simon" });
    return (d.boards?.[0]?.items_page?.items || []).map(meetingRow)
      .filter((m) => m.group === group && m.start && m.start < before && m.status !== "Cancelled").slice(0, PAST_MEETINGS);
  },
  people: (group) => meetingsStore.people(group),
  // почта → карточка: сначала по Email, потом по «Other emails» (точное совпадение одного из адресов)
  async findCards(emails) {
    const list = [...new Set(emails)].slice(0, 60);
    if (!list.length) return new Map();
    const decl = ["$e: [String]!"], vars = { e: list }, parts = [`byEmail: items_page_by_column_values(board_id: ${MEMBERS}, limit: 100, columns: [{ column_id: "${P.email}", column_values: $e }]) { items { ${CARD} } }`];
    list.forEach((e, k) => { decl.push(`$o${k}: CompareValue!`); vars["o" + k] = [e]; parts.push(`o${k}: boards(ids: [${MEMBERS}]) { items_page(limit: 5, query_params: { rules: [{ column_id: "${P.other}", compare_value: $o${k}, operator: contains_text }] }) { items { ${CARD} } } }`); });
    const d = await monday(`query (${decl.join(", ")}) { ${parts.join("\n")} }`, vars);
    const out = new Map();
    for (const it of d.byEmail?.items || []) { const c = cardRow(it); if (list.includes(c.email) && !out.has(c.email)) out.set(c.email, c); }
    list.forEach((e, k) => {
      if (out.has(e)) return;
      const c = (d["o" + k]?.[0]?.items_page?.items || []).map(cardRow).find((c) => c.other.includes(e));
      if (c) out.set(e, c);
    });
    return out;
  },
  async createCard({ name, email, date }) {
    const v = { [P.email]: { email, text: email }, [P.firstSeen]: { date }, [P.sources]: SOURCE };
    const d = await monday(`mutation ($b: ID!, $g: String!, $n: String!, $v: JSON!) { create_item(board_id: $b, group_id: $g, item_name: $n, column_values: $v) { id } }`,
      { b: MEMBERS, g: PEOPLE_GROUP, n: name, v: JSON.stringify(v) });
    return String(d.create_item.id);
  },
  async setEvidence(id, { confirmed, excluded }) {
    const v = { [EV.confirmed]: { item_ids: confirmed.map(Number) } };
    if (excluded) v[EV.excluded] = { item_ids: excluded.map(Number) };
    await monday(`mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id: $b, item_id: $i, column_values: $v) { id } }`, { b: CALENDAR, i: String(id), v: JSON.stringify(v) });
  },
  saveMail: (id, mail) => meetingsStore.saveMeeting(id, { mail }),
  note: (id, text) => meetingsStore.note(id, text),
};
let store = mondayStore;
export const setStore = (s) => { store = s || mondayStore; };

// ---------- кто на странице ----------
// Один человек — одна строка. Ключ — почта (у карточки без почты — card:<id>); по «Other emails»
// анкета с доски группы находит ту же карточку.
export function buildPeople({ confirmed = [], past = [], rows = [] }) {
  const list = [], byEmail = new Map(), byCard = new Map();
  const index = (p, emails) => { for (const e of emails) if (e && !byEmail.has(e)) { byEmail.set(e, p); p.emails.push(e); } };
  const person = (o) => { const p = { key: "", name: "", email: "", card: null, status: "", member: false, past: 0, checked: false, date: "", emails: [], ...o }; list.push(p); return p; };
  const addCard = (c) => {
    let p = byCard.get(c.id) || byEmail.get(c.email) || c.other.map((e) => byEmail.get(e)).find(Boolean);
    if (!p) p = person({ key: c.email || `card:${c.id}`, name: c.name, email: c.email, card: c.id });
    if (!p.card) p.card = c.id;
    byCard.set(c.id, p); index(p, [c.email, ...c.other]);
    return p;
  };
  for (const c of confirmed) addCard(c).checked = true;
  for (const m of past) for (const c of m.confirmed || []) addCard(c).past++;
  for (const r of peopleByEmail(rows)) {
    let p = byEmail.get(r.email);
    if (!p) { p = person({ key: r.email, name: r.name, email: r.email }); index(p, [r.email]); }
    p.status = r.status || p.status;
    p.member ||= !!r.checked; // у Джины — «Joined», у Саймона — галочка рассылки
    p.date = String(r.date || "").slice(0, 10);
    if (!p.name) p.name = r.name;
  }
  // сначала отмеченные, потом участники группы и те, кто уже ходил, потом свежие анкеты
  return list.sort((a, b) => (b.checked - a.checked) || (b.member - a.member) || (b.past - a.past) || String(b.date).localeCompare(String(a.date)) || String(a.name).localeCompare(String(b.name), "ru"));
}

async function load(t, now) {
  const v = verifyToken(t, now.getTime(), process.env, "att");
  if (v.error) return { error: v.error };
  const m = await store.meeting(v.item);
  if (!m || m.group !== v.group || !m.start) return { error: "gone" };
  if (m.start > now) return { error: "early" };
  const [past, rows] = await Promise.all([store.pastMeetings(m.group, m.start).catch(() => []), store.people(m.group)]);
  return { m, people: buildPeople({ confirmed: m.confirmed, past, rows }) };
}

export async function pageData(t, now = new Date()) {
  const r = await load(t, now);
  if (r.error) return r;
  const { m, people } = r, G = GROUPS[m.group];
  return {
    group: m.group, title: G.title,
    meeting: { start: m.start.toISOString(), line: when(m.start, G.minutes).line, cancelled: m.status === "Cancelled" },
    // все: страница показывает участников (у Джины — Joined), новые анкеты (show) и уже
    // отмеченных, а остальных сворачивает
    show: G.show || [],
    people: people.map(({ key, name, email, status, member, past, checked }) => ({ key, name, email, status, member, past, checked })),
    saved: m.mail?.attendance || null,
  };
}

// ---------- сохранение ----------
const clean = (s, max) => String(s ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, max);
const keys = (a) => [...new Set((Array.isArray(a) ? a : []).map((k) => String(k).trim().toLowerCase()).filter(Boolean))].slice(0, 500);
export function parseSave(b) {
  return {
    selected: keys(b?.selected), unselected: keys(b?.unselected),
    add: (Array.isArray(b?.add) ? b.add : []).slice(0, 50).map((p) => ({ name: clean(p?.name, 120), email: clean(p?.email, 200).toLowerCase() })).filter((p) => EMAIL_RX.test(p.email)),
  };
}

export async function saveAttendance(t, body, now = new Date()) {
  const r = await load(t, now);
  if (r.error) return { status: r.error === "gone" ? 404 : r.error === "early" ? 409 : 403, error: r.error };
  const { m, people } = r;
  const s = parseSave(body);
  const byKey = new Map(people.map((p) => [p.key, p]));
  const byEmail = new Map(people.flatMap((p) => p.emails.map((e) => [e, p])));
  const keyOf = {}; // почта добавленного → ключ его строки на странице

  // кого отметили: люди со страницы и добавленные вручную
  const chosen = [];
  for (const k of s.selected) if (byKey.has(k)) chosen.push(byKey.get(k));
  for (const a of s.add) {
    let p = byEmail.get(a.email);
    if (!p) { p = { key: a.email, name: a.name || a.email, email: a.email, card: null, emails: [a.email] }; byEmail.set(a.email, p); }
    chosen.push(p); keyOf[a.email] = p.key;
  }
  // у кого ещё нет карточки — ищем по почте, не нашли — заводим
  const need = [...new Set(chosen.filter((p) => !p.card && p.email).map((p) => p.email))];
  const found = need.length ? await store.findCards(need) : new Map();
  let created = 0;
  for (const p of chosen) {
    if (p.card) continue;
    const c = found.get(p.email);
    if (c) p.card = c.id;
    else { p.card = await store.createCard({ name: p.name || p.email, email: p.email, date: nyDate(m.start) }); created++; found.set(p.email, { id: p.card }); }
  }
  const on = new Set(chosen.map((p) => p.card));
  const off = new Set(s.unselected.map((k) => byKey.get(k)?.card).filter((id) => id && !on.has(id)));

  // свежие значения прямо перед записью: сохраняем то, что за это время добавили в monday
  const fresh = (await store.meeting(m.id)) || m;
  const next = [...new Set([...fresh.confirmed.map((c) => c.id).filter((id) => !off.has(id)), ...on])];
  const excluded = fresh.excluded.filter((id) => !on.has(id));
  await store.setEvidence(m.id, { confirmed: next, ...(excluded.length !== fresh.excluded.length ? { excluded } : {}) });

  const at = now.toISOString();
  await store.saveMail(m.id, { ...fresh.mail, attendance: { at, n: next.length } }).catch((e) => console.error("attendance mark failed:", e.message));
  await store.note(m.id, `Ведущая отметила, кто пришёл: ${next.length} в «Confirmed attendees»${created ? `, новых карточек на доске посетителей мероприятий: ${created}` : ""}.`)
    .catch((e) => console.error("attendance note failed:", e.message));
  return { status: 200, ok: true, n: next.length, created, at, keys: keyOf };
}

// ---------- HTTP ----------
async function readJson(req) {
  const chunks = []; for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return null; }
}
const reply = (res, status, obj) => { res.statusCode = status; res.end(JSON.stringify(obj)); };

// GET /api/attendance?t=… → люди; POST /api/attendance { t, selected, unselected, add } → сохранить
export async function attendanceHandler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  const u = new URL(req.url, "https://x");
  try {
    if (req.method === "GET") {
      const d = await pageData(u.searchParams.get("t"));
      return reply(res, d.error ? (d.error === "gone" ? 404 : d.error === "early" ? 409 : 403) : 200, d);
    }
    if (req.method === "POST") {
      const b = await readJson(req);
      if (!b) return reply(res, 400, { error: "invalid" });
      const { status, ...rest } = await saveAttendance(b.t, b);
      return reply(res, status, rest);
    }
    return reply(res, 405, {});
  } catch (e) {
    console.error("attendance:", e.message);
    return reply(res, 502, { error: "failed" });
  }
}
