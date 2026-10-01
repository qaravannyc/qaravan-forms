// Что о человеке уже есть в monday — шаг перед письмом команде о новой анкете группы
// поддержки (lib/support-groups.mjs: lookupPerson → апдейт на строке и письмо). Только чтение.
//  • Карточка на доске Attendees (18425190164): по почте, по «Other emails», по телефону.
//  • Мероприятия — из календаря событий (4774572020), как их считает доска Attendance 2026:
//    «Confirmed attendees» и «Verified registrations» на прошедших, не отменённых событиях,
//    кроме «Did not attend / declined». «Event records» на карточке — это регистрации и
//    импорт, а не посещение, поэтому их не берём. Проведённые — «Events led» на карточке.
//  • Волонтёрство: «Volunteer» и «Volunteer skills» на карточке и заявки на доске
//    «Волонтёры событий — запись на роли» (18432838181) по почте.
//  • Community Agreement: доска 5451306001 по почте (дата подписи), иначе дата на карточке.
//  • Прежние анкеты в ту же группу — на её доске по почте (кроме только что созданной).
// Если monday не ответил за несколько секунд или ответил ошибкой — { ok: false }: письмо
// уходит с пометкой, что проверить не получилось, анкета всё равно на доске.
import { monday } from "./letter-board.mjs";

// Заголовок раздела. В письме — как SectionHeader: короткий заголовок и приглушённая строка
// под ним; в апдейте — одной строкой TITLE.
export const HEAD_TITLE = "Контекст";
export const HEAD_LINE = "Что робот нашёл про этого человека на разных досках Monday";
export const TITLE = `${HEAD_TITLE}: ${HEAD_LINE[0].toLowerCase()}${HEAD_LINE.slice(1)}`;
export const BOARDS = { members: "18425190164", calendar: "4774572020", agreement: "5451306001", volunteers: "18432838181" };
const M = { email: "email_mm5ysnnh", phone: "phone_mm5yxd54", other: "text_mm63j91w", led: "board_relation_mm63b63v", volunteer: "color_mm63hwy2", skills: "text_mm6311dk", agreement: "date_mm63tz8c", firstSeen: "date_mm63nt8n" };
const EV = { date: "date4", status: "status", confirmed: "attendance_confirmed", registered: "attendance_registered", excluded: "attendance_excluded" };
const TIMEOUT_MS = 6000;
const TZ = "America/New_York";

const MEMBER = `id name column_values(ids: ["${M.email}", "${M.other}", "${M.volunteer}", "${M.skills}", "${M.agreement}", "${M.firstSeen}"]) { id text }
  led: column_values(ids: ["${M.led}"]) { ... on BoardRelationValue { linked_items { id name column_values(ids: ["${EV.date}"]) { id text } } } }`;
const EVENT = `id name column_values(ids: ["${EV.date}", "${EV.status}"]) { id text }`;
const cvText = (it, id) => (it?.column_values || []).find((c) => c.id === id)?.text || "";
const nyToday = (now) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

// Телефон как его хранит Attendees: у номеров США — 10 цифр без +1, у остальных — все цифры.
export function phoneKeys(e164) {
  const d = String(e164 || "").replace(/\D/g, "");
  if (!d) return [];
  return d.length === 11 && d[0] === "1" ? [d.slice(1)] : [d];
}

// Первый запрос: карточка, Community Agreement, волонтёрские заявки, прежние анкеты.
export function firstQuery({ email, phone, group }) {
  const pk = phoneKeys(phone);
  const parts = [
    `byEmail: items_page_by_column_values(board_id: ${BOARDS.members}, limit: 3, columns: [{ column_id: "${M.email}", column_values: $e }]) { items { ${MEMBER} } }`,
    `byOther: boards(ids: [${BOARDS.members}]) { items_page(limit: 3, query_params: { rules: [{ column_id: "${M.other}", compare_value: $ec, operator: contains_text }] }) { items { ${MEMBER} } } }`,
    pk.length && `byPhone: items_page_by_column_values(board_id: ${BOARDS.members}, limit: 3, columns: [{ column_id: "${M.phone}", column_values: $p }]) { items { ${MEMBER} } }`,
    `agreement: boards(ids: [${BOARDS.agreement}]) { items_page(limit: 5, query_params: { rules: [{ column_id: "short_text6", compare_value: $ec, operator: contains_text }] }) { items { id created_at column_values(ids: ["date_1"]) { id text } } } }`,
    `volunteers: items_page_by_column_values(board_id: ${BOARDS.volunteers}, limit: 5, columns: [{ column_id: "email", column_values: $e }]) { items { id created_at column_values(ids: ["roles", "app_status"]) { id text } } }`,
    group?.board && group?.email && `earlier: items_page_by_column_values(board_id: ${group.board}, limit: 25, columns: [{ column_id: "${group.email}", column_values: $e }]) { items { id created_at column_values(ids: ${JSON.stringify([group.status, group.submitted].filter(Boolean))}) { id text } } }`,
  ].filter(Boolean);
  // $e — для поиска по значению колонки, $ec — то же для правил фильтра (у них свой тип)
  const vars = pk.length ? "$e: [String]!, $ec: CompareValue!, $p: [String]!" : "$e: [String]!, $ec: CompareValue!";
  const variables = { e: [email], ec: [email], ...(pk.length ? { p: pk } : {}) };
  return { query: `query (${vars}) { ${parts.join("\n")} }`, variables };
}

// Второй запрос: события календаря, где человек отмечен (по id карточки).
export function eventsQuery(memberId) {
  const r = (alias, col) => `${alias}: items_page(limit: 200, query_params: { rules: [{ column_id: "${col}", compare_value: $m, operator: any_of }] }) { items { ${EVENT} } }`;
  return {
    query: `query ($m: CompareValue!) { boards(ids: [${BOARDS.calendar}]) { ${r("confirmed", EV.confirmed)} ${r("registered", EV.registered)} ${r("excluded", EV.excluded)} } }`,
    variables: { m: [Number(memberId)] },
  };
}

const ev = (it) => ({ id: String(it.id), name: it.name, date: cvText(it, EV.date).slice(0, 10), status: cvText(it, EV.status) });
const byDateDesc = (a, b) => String(b.date).localeCompare(String(a.date));

// Два ответа monday → то, что попадёт в письмо и апдейт.
export function buildDossier(first, events, { itemId = null, now = new Date(), group = null } = {}) {
  const items = (x) => x?.items || x?.[0]?.items_page?.items || [];
  const cand = [["email", items(first.byEmail)], ["other", items(first.byOther)], ["phone", items(first.byPhone)]];
  const hit = cand.find(([, list]) => list.length);
  const m = hit ? hit[1][0] : null;
  const today = nyToday(now);

  let attended = [], led = [];
  if (m) {
    const b = events?.boards?.[0] || {};
    const excluded = new Set(items(b.excluded).map((it) => String(it.id)));
    const confirmed = new Set(items(b.confirmed).map((it) => String(it.id)));
    const seen = new Map();
    for (const it of [...items(b.confirmed), ...items(b.registered)]) {
      const e = ev(it);
      if (seen.has(e.id) || excluded.has(e.id) || !e.date || e.date >= today || e.status === "Cancelled") continue;
      seen.set(e.id, { ...e, confirmed: confirmed.has(e.id) });
    }
    attended = [...seen.values()].sort(byDateDesc);
    led = (m.led?.[0]?.linked_items || []).map(ev).filter((e) => e.status !== "Cancelled").sort(byDateDesc);
  }

  const agreements = items(first.agreement).map((it) => cvText(it, "date_1") || String(it.created_at || "").slice(0, 10)).filter(Boolean).sort();
  const vols = items(first.volunteers).map((it) => ({ roles: cvText(it, "roles"), status: cvText(it, "app_status"), date: String(it.created_at || "").slice(0, 10) })).sort(byDateDesc);
  const earlier = items(first.earlier).filter((it) => String(it.id) !== String(itemId))
    // дата анкеты — из «Submitted», если он есть на доске: created_at у строк из Typeform — день
    // импорта, у добавленных вручную — день, когда строку завели, а не дата анкеты
    .map((it) => ({ id: String(it.id), date: group?.submitted ? cvText(it, group.submitted).slice(0, 10) : String(it.created_at || "").slice(0, 10), status: group?.status ? cvText(it, group.status) : "" })).sort(byDateDesc);

  return {
    ok: true,
    member: m ? { id: String(m.id), name: m.name, url: `https://qaravan.monday.com/boards/${BOARDS.members}/pulses/${m.id}`, firstSeen: cvText(m, M.firstSeen), by: hit[0] } : null,
    attended, led,
    volunteer: { card: m ? cvText(m, M.volunteer) : "", skills: m ? cvText(m, M.skills) : "", applications: vols },
    agreement: agreements[0] || (m ? cvText(m, M.agreement) : "") || "",
    earlier,
  };
}

export async function lookupPerson(p, { group, itemId = null, now = new Date(), api = monday, timeoutMs = TIMEOUT_MS } = {}) {
  const work = (async () => {
    const q1 = firstQuery({ email: p.email, phone: p.phone?.e164, group });
    const first = await api(q1.query, q1.variables);
    const items = (x) => x?.items || x?.[0]?.items_page?.items || [];
    const m = [first.byEmail, first.byOther, first.byPhone].map(items).find((l) => l.length)?.[0];
    let events = null;
    if (m) { const q2 = eventsQuery(m.id); events = await api(q2.query, q2.variables); }
    return buildDossier(first, events, { itemId, now, group });
  })();
  let timer;
  const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("monday lookup timed out")), timeoutMs); });
  try { return await Promise.race([work, timeout]); }
  catch (e) { console.error("person lookup failed:", e.message); return { ok: false }; }
  finally { clearTimeout(timer); }
}

// ---------- как это читается ----------
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
export function ruDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : "";
}
const SHOW = 8;
// список событий: { lines, more } — «и ещё N» письмо показывает приглушённым
function eventLines(list) {
  return { lines: list.slice(0, SHOW).map((e) => `${ruDate(e.date)} — ${e.name}`), more: list.length > SHOW ? `и ещё ${list.length - SHOW}` : "" };
}
// Строки «вопрос — ответ» простым текстом; письмо и апдейт собирают из них своё.
// Значение — строка, массив строк, { lines, more } (список событий) или { text, url } (карточка).
// earlier — подпись прежних строк на другой доске: { label, last, none } («Прежние обращения через сайт»,
// «последнее»); по умолчанию — прежние анкеты в группу поддержки.
export function dossierRows(d, { group, earlier: E = null } = {}) {
  if (!d?.ok) return null;
  const rows = [];
  const by = { email: "", other: " (нашли по другой почте)", phone: " (нашли по телефону)" };
  rows.push(["Карточка на доске посетителей мероприятий", d.member
    ? { text: `Есть${d.member.firstSeen ? `, в базе с ${ruDate(d.member.firstSeen)}` : ""}${by[d.member.by] || ""}`, url: d.member.url }
    : "Нет: ни почта, ни телефон нам раньше не встречались"]);
  rows.push([d.attended.length ? `Мероприятия (${d.attended.length})` : "Мероприятия", d.attended.length ? eventLines(d.attended) : "Ни одного подтверждённого"]);
  if (d.led.length) rows.push([`Проводил(а) мероприятия (${d.led.length})`, eventLines(d.led)]);
  const v = d.volunteer, vol = [];
  if (v.card) vol.push(`На карточке: ${v.card}${v.skills ? `. Навыки: ${v.skills}` : ""}`);
  else if (v.skills) vol.push(`Навыки: ${v.skills}`);
  for (const a of v.applications) vol.push(`Заявка ${ruDate(a.date)}${a.roles ? `: ${a.roles}` : ""}${a.status ? ` (${a.status})` : ""}`);
  rows.push(["Волонтёрство", vol.length ? vol : "Статус неизвестен"]);
  rows.push(["Community Agreement", d.agreement ? `Подписано ${ruDate(d.agreement)}` : "Не подписано"]);
  if (d.earlier.length) {
    const last = d.earlier[0];
    const e = E || { label: `Прежние анкеты в группу ${group === "simon" ? "Саймона" : "Джины"}`, last: "последняя", none: "без даты анкеты" };
    rows.push([e.label,
      `${d.earlier.length}, ${last.date ? `${e.last} ${ruDate(last.date)}` : e.none}${last.status ? `, статус ${last.status}` : ""}`]);
  }
  return rows;
}
// Строку, которую анкета только что создала, из «прежних анкет» убираем (поиск шёл параллельно).
export function withoutItem(d, itemId) {
  return d?.ok ? { ...d, earlier: d.earlier.filter((e) => e.id !== String(itemId)) } : d;
}
export function dossierText(d, opts) {
  const rows = dossierRows(d, opts);
  if (!rows) return `${TITLE}\nПроверить не получилось: monday не ответил.`;
  const val = (v) => (Array.isArray(v) ? v.join("\n  ")
    : v?.lines ? [...v.lines, v.more].filter(Boolean).join("\n  ")
      : typeof v === "object" ? `${v.text}, ${v.url}` : v);
  return [TITLE, ...rows.map(([k, v]) => `${k}: ${val(v)}`)].join("\n");
}
