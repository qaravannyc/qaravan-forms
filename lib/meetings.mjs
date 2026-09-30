// Письмо со ссылкой на встречу группы поддержки — участникам, одной кнопкой ведущей.
//
// Как это устроено:
//  1. Каждый день около полудня по Нью-Йорку Vercel-крон зовёт /api/meeting-prompts.
//     Для каждой встречи Джины или Саймона на завтра (строки календаря событий 4774572020)
//     ведущей приходит письмо «Завтра встреча — отправьте ссылку участникам» с кнопкой.
//  2. Кнопка открывает /support/send?t=<ключ> — личную страницу без входа в monday:
//     текст письма, ссылка на встречу, телефон для подключения, тема, список людей с
//     галочками и «Добавить человека». Галочка — это доска группы: у Джины статус «Joined»
//     (кто в группе, тот и получает письма), у Саймона — колонка «Gets meeting emails».
//  3. «Отправить» (POST /api/meetings) — одно письмо: ведущей в «Кому», всем выбранным —
//     в скрытой копии (Bcc), так что участники не видят адреса друг друга. Ответы — ведущей.
//     Галочки ложатся на доску (у Джины: отметили — «Joined», сняли — «Not now»; новые
//     анкеты приходят со статусом «New», без галочки). Ссылка и текст запоминаются на
//     строке встречи (Meeting link, ⚙️ Meeting email) и в следующий раз подставляются сами.
//
// Своих функций в api/ нет (лимит 12 на Hobby): vercel.json переписывает /api/meetings и
// /api/meeting-prompts на /api/survey?form=…, api/survey.mjs отдаёт их сюда.
// Ключ в ссылке — HMAC от номера строки, группы и срока (до конца встречи); секрет —
// MEETINGS_SECRET, а если его нет — производный от MONDAY_TOKEN. По ссылке видны адреса
// участников, поэтому её получает только ведущая.
import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { esc } from "./letter-mail.mjs";

export const CALENDAR = "4774572020";
const CAL = { date: "date4", status: "status", link: "meeting_link", mail: "meeting_mail" };
const FORM_BASE = process.env.FORM_BASE || "https://feedback.qaravan.org";

// Группы. Ссылка и телефон — постоянные по умолчанию; ведущая меняет их на странице,
// и тогда в следующий раз подставляются новые (с последней отправки).
export const GROUPS = {
  gina: {
    match: /gina|джин/i,
    board: "18433061986", C: { email: "email", status: "sg_status", source: "source", submitted: "submitted" },
    member: { on: "Joined", off: "Not now" }, // письма получают те, у кого статус «Joined»
    title: "Группа поддержки с Джиной", leader: "Джина", from: "Джина, QARAVAN",
    leaderEmail: "gina@rusalgbtq.org", minutes: 60,
    link: "https://meet.google.com/tyu-nksn-hpd",
    dial: "(US) +1 216-839-9317, PIN: 382 371 488#",
    // по письму Джины от 23 сентября 2026
    text: "Всем привет, друзья! 💕\n\nПриходите завтра на нашу встречу! Встречаемся, как всегда, в 7:30 pm по Нью-Йорку.\n\nЭто безопасное место встречи квир-людей с разным опытом эмиграции. Мы встречаемся, чтобы поддержать друг друга, узнать что-то новое и просто побыть вместе.\n\nС любовью, Джина 🌈",
  },
  simon: {
    match: /simon|саймон/i,
    board: "5469799506", C: { email: "email_2", mailing: "mailing", city: "short_text39" },
    title: "Группа равной поддержки с Саймоном", leader: "Саймон", from: "Саймон, QARAVAN",
    leaderEmail: "simon@rusalgbtq.org", minutes: 0,
    link: "", dial: "",
    text: "Здравствуйте!\n\nЗавтра встречаемся в группе равной поддержки. Подключайтесь по ссылке ниже.\n\nНапоминаю правила: то, что сказано в группе, остаётся в группе; никто не обязан рассказывать больше, чем хочет, можно просто слушать.\n\nДо встречи!\nСаймон",
  },
};
// Кто получает письма: у группы с member — статус (C.status), иначе — галочка C.mailing.
export function isOn(group, cv) {
  const { C, member } = GROUPS[group];
  if (member) return (cv[C.status]?.text || "") === member.on;
  try { const c = JSON.parse(cv[C.mailing]?.value || "null")?.checked; return c === true || c === "true"; } catch { return false; }
}
export function mailingValue(group, on) {
  const { C, member } = GROUPS[group];
  if (member) return { [C.status]: { label: on ? member.on : member.off } };
  return { [C.mailing]: on ? { checked: "true" } : null };
}
export const groupOf = (name) => Object.keys(GROUPS).find((g) => GROUPS[g].match.test(name || "")) || null;
export const leaderEmail = (g, env = process.env) => (env[`MEETINGS_LEADER_${g.toUpperCase()}`] || GROUPS[g].leaderEmail).trim();

// ---------- время: строка календаря хранит начало в UTC ----------
const TZ = "America/New_York";
export function startOf(dateValue) {
  let v = dateValue;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return null; } }
  if (!v?.date) return null;
  return new Date(`${v.date}T${v.time || "00:00:00"}Z`);
}
const nyDate = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const nyTime = (d) => new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(d);
export function when(start, minutes = 0) {
  const day = new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(start); // «четверг, 24 сентября»
  const range = minutes ? `${nyTime(start)}–${nyTime(new Date(start.getTime() + minutes * 60000))}` : nyTime(start);
  return { day, time: nyTime(start), range, line: `${day[0].toUpperCase()}${day.slice(1)}, ${range} по Нью-Йорку` };
}
// «завтра» / «сегодня» / дата — для темы письма, считая от момента отправки
export function relDay(start, now = new Date()) {
  const a = nyDate(start), b = nyDate(now), t = nyDate(new Date(now.getTime() + 86400000));
  if (a === b) return "сегодня";
  if (a === t) return "завтра";
  return new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, day: "numeric", month: "long" }).format(start);
}
export function defaultSubject(g, start, now = new Date()) {
  const r = relDay(start, now), w = when(start);
  const rel = r === "сегодня" || r === "завтра" ? `${r}, ${w.day.split(", ")[1]}` : r;
  return `${GROUPS[g].title}: встреча ${rel}, в ${w.time}`;
}

// ---------- ключ в ссылке ----------
function secret(env = process.env) {
  const base = env.MEETINGS_SECRET || env.MONDAY_TOKEN;
  if (!base) throw new Error("MEETINGS_SECRET / MONDAY_TOKEN is not set");
  return createHash("sha256").update("qaravan-meetings:" + base).digest();
}
export function signToken({ item, group, exp }, env = process.env) {
  const body = Buffer.from(JSON.stringify({ i: String(item), g: group, x: Math.floor(exp / 1000) })).toString("base64url");
  return `${body}.${createHmac("sha256", secret(env)).update(body).digest("base64url")}`;
}
// → { item, group } или { error: "bad" | "expired" }
export function verifyToken(t, now = Date.now(), env = process.env) {
  const [body, sig] = String(t || "").split(".");
  if (!body || !sig) return { error: "bad" };
  const want = createHmac("sha256", secret(env)).update(body).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { error: "bad" };
  let p; try { p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return { error: "bad" }; }
  if (!GROUPS[p.g] || !/^\d+$/.test(p.i || "")) return { error: "bad" };
  if (now > p.x * 1000) return { error: "expired" };
  return { item: p.i, group: p.g };
}
// ссылка работает до конца дня встречи (6 часов после начала)
export const tokenExp = (start) => start.getTime() + 6 * 3600000;
export const sendUrl = (item, group, start, env = process.env) => `${FORM_BASE}/support/send?t=${signToken({ item, group, exp: tokenExp(start) }, env)}`;

// ---------- monday ----------
async function mondayApi(query, variables = {}) {
  const r = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: process.env.MONDAY_TOKEN, "API-Version": "2024-10" },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
}
const cvMap = (cvs) => Object.fromEntries((cvs || []).map((c) => [c.id, c]));
const parseMail = (s) => { try { const j = JSON.parse(s || "null"); return j && typeof j === "object" ? j : {}; } catch { return {}; } };
function meetingRow(it) {
  const cv = cvMap(it.column_values);
  let link = "";
  try { link = JSON.parse(cv[CAL.link]?.value || "null")?.url || ""; } catch {}
  return { id: String(it.id), name: it.name, group: groupOf(it.name), start: startOf(cv[CAL.date]?.value), status: cv[CAL.status]?.text || "", link, mail: parseMail(cv[CAL.mail]?.text) };
}
const MEETING_FIELDS = `id name column_values(ids: ["${CAL.date}", "${CAL.status}", "${CAL.link}", "${CAL.mail}"]) { id text value }`;

// Доступ к данным — отдельно, чтобы проверки и локальный сервер подменяли его на поддельный.
export const mondayStore = {
  async meeting(id) {
    const d = await mondayApi(`query ($i: [ID!]) { items(ids: $i) { ${MEETING_FIELDS} } }`, { i: [String(id)] });
    return d.items?.[0] ? meetingRow(d.items[0]) : null;
  },
  // встречи с началом в этом отрезке дат UTC (включительно)
  async meetingsBetween(fromDate, toDate) {
    const d = await mondayApi(`query ($b: [ID!], $v: CompareValue!) { boards(ids: $b) { items_page(limit: 100, query_params: { rules: [{ column_id: "${CAL.date}", compare_value: $v, operator: between }] }) { items { ${MEETING_FIELDS} } } } }`,
      { b: [CALENDAR], v: [fromDate, toDate] });
    return (d.boards?.[0]?.items_page?.items || []).map(meetingRow);
  },
  // прошлые встречи группы, у которых уже есть ссылка или отправленное письмо, — самые свежие первыми
  async previousMeetings(group, before) {
    const d = await mondayApi(`query ($b: [ID!], $n: CompareValue!) { boards(ids: $b) { items_page(limit: 50, query_params: { rules: [{ column_id: "name", compare_value: $n, operator: contains_text }, { column_id: "${CAL.mail}", compare_value: [], operator: is_not_empty }], order_by: [{ column_id: "${CAL.date}", direction: desc }] }) { items { ${MEETING_FIELDS} } } } }`,
      { b: [CALENDAR], n: group === "gina" ? "Gina" : "Simon" });
    return (d.boards?.[0]?.items_page?.items || []).map(meetingRow).filter((m) => m.group === group && m.start && m.start < before);
  },
  async saveMeeting(id, { link, mail }) {
    const v = {};
    if (link !== undefined) v[CAL.link] = link ? { url: link, text: "Ссылка на встречу" } : null;
    if (mail !== undefined) v[CAL.mail] = { text: JSON.stringify(mail) };
    await mondayApi(`mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id: $b, item_id: $i, column_values: $v) { id } }`, { b: CALENDAR, i: String(id), v: JSON.stringify(v) });
  },
  async note(id, text) {
    await mondayApi(`mutation ($i: ID!, $t: String!) { create_update(item_id: $i, body: $t) { id } }`, { i: String(id), t: text });
  },
  async people(group) {
    const { board, C } = GROUPS[group];
    const ids = Object.values(C);
    const d = await mondayApi(`query ($b: [ID!]) { boards(ids: $b) { items_page(limit: 500) { items { id name created_at column_values(ids: ${JSON.stringify(ids)}) { id text value } } } } }`, { b: [board] });
    return (d.boards?.[0]?.items_page?.items || []).map((it) => {
      const cv = cvMap(it.column_values);
      return {
        id: String(it.id), name: it.name, email: (cv[C.email]?.text || "").trim().toLowerCase(), checked: isOn(group, cv),
        status: C.status ? cv[C.status]?.text || "" : "", source: C.source ? cv[C.source]?.text || "" : "",
        date: (C.submitted && cv[C.submitted]?.text) || it.created_at || "", city: C.city ? cv[C.city]?.text || "" : "",
      };
    });
  },
  async setMailing(group, changes) { // changes: [{ id, checked }]
    const { board } = GROUPS[group];
    for (let k = 0; k < changes.length; k += 25) {
      const part = changes.slice(k, k + 25);
      const vars = { b: board }, decl = ["$b: ID!"], body = [];
      part.forEach((c, j) => { decl.push(`$i${j}: ID!`, `$v${j}: JSON!`); vars["i" + j] = c.id; vars["v" + j] = JSON.stringify(mailingValue(group, c.checked)); body.push(`m${j}: change_multiple_column_values(board_id: $b, item_id: $i${j}, column_values: $v${j}) { id }`); });
      await mondayApi(`mutation (${decl.join(", ")}) { ${body.join(" ")} }`, vars);
    }
  },
  async addPerson(group, { name, email }) {
    const { board, C } = GROUPS[group];
    const v = { [C.email]: { email, text: email }, ...mailingValue(group, true) };
    if (C.source) v[C.source] = { label: "Added by hand" };
    const d = await mondayApi(`mutation ($b: ID!, $n: String!, $v: JSON!) { create_item(board_id: $b, item_name: $n, column_values: $v, create_labels_if_missing: true) { id } }`, { b: board, n: name, v: JSON.stringify(v) });
    return d.create_item.id;
  },
};
let store = mondayStore;
export const setStore = (s) => { store = s || mondayStore; };

// ---------- почта (Gmail API, info@qaravan.org; тот же токен, что у анкет) ----------
async function googleToken() {
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID || "", client_secret: process.env.GOOGLE_CLIENT_SECRET || "", refresh_token: process.env.GOOGLE_REFRESH_TOKEN || "", grant_type: "refresh_token", scope: "https://www.googleapis.com/auth/gmail.send" }) });
  const j = await r.json();
  if (!j.access_token) throw new Error("Google auth failed: " + JSON.stringify(j).slice(0, 200));
  return j.access_token;
}
const hdr = (s) => `=?UTF-8?B?${Buffer.from(s).toString("base64")}?=`;
const addr = (name, email) => (name ? `${hdr(name)} <${email}>` : email);
// Письмо с HTML и текстовой версией. bcc не попадает в заголовки, которые видят получатели.
export function buildMime({ fromName, to, bcc = [], replyTo, subject, html, text }) {
  const b = "qv" + createHash("sha1").update(subject + Date.now()).digest("hex").slice(0, 16);
  const lines = [`From: ${addr(fromName, "info@qaravan.org")}`, `To: ${to}`];
  if (bcc.length) lines.push(`Bcc: ${bcc.join(", ")}`);
  if (replyTo) lines.push(`Reply-To: ${replyTo}`);
  lines.push(`Subject: ${hdr(subject)}`, "MIME-Version: 1.0", `Content-Type: multipart/alternative; boundary="${b}"`, "",
    `--${b}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", Buffer.from(text).toString("base64"),
    `--${b}`, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", Buffer.from(html).toString("base64"), `--${b}--`, "");
  return lines.join("\r\n");
}
async function sendMime(mime) {
  if (!process.env.GOOGLE_REFRESH_TOKEN) throw new Error("GOOGLE_REFRESH_TOKEN is not set");
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST",
    headers: { Authorization: `Bearer ${await googleToken()}`, "Content-Type": "application/json" }, body: JSON.stringify({ raw: Buffer.from(mime).toString("base64url") }) });
  if (!res.ok) throw new Error(`Gmail send: ${res.status} ${await res.text()}`);
}

// ---------- вёрстка писем: дизайн-система 2026-09 (как lib/support-mail.mjs) ----------
const INK = "#333333", MUTED = "#5E5A53", LINE = "#ECE8DE", SKY = "#0099CC", PURPLE = "#7668AA";
const BODY = `'Fira Sans','Helvetica Neue',Helvetica,Arial,sans-serif`;
const HEAD = `'Fira Sans Condensed','Fira Sans','Helvetica Neue',Helvetica,Arial,sans-serif`; // без Arial Narrow: в Gmail он сплющивает заголовки
const LOGO = `<img src="https://feedback.qaravan.org/logo-email.png" width="140" height="26" alt="qaravan" style="display:block;border:0;outline:none;text-decoration:none;width:140px;height:auto;">`;
// «Нью-Йорку» не разрывается на дефисе
const nb = (html) => html.replace(/Нью-Йорку/g, '<span style="white-space:nowrap;">Нью-Йорку</span>');
const linkify = (s) => esc(s).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" style="color:${INK};font-weight:600;text-decoration:underline;text-decoration-color:${SKY};">${u}</a>`);
const paras = (text) => String(text).trim().split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px;font-family:${BODY};font-size:16px;line-height:1.5;color:${INK};">${linkify(p).replace(/\n/g, "<br>")}</p>`).join("");
const button = (href, label) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${INK}" style="background:${INK};"><a href="${esc(href)}" style="display:block;padding:13px 22px;font-family:${HEAD};font-weight:600;font-size:17px;line-height:1.15;letter-spacing:.01em;color:#FFFFFF;text-decoration:none;">${esc(label)}</a></td></tr></table>`;
// флажок у надзаголовка — ячейкой таблицы с bgcolor: пустой цветной span Gmail не рисует
const eyebrow = (label) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle" style="padding-right:10px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="8" height="8" bgcolor="${PURPLE}" style="width:8px;height:8px;background-color:${PURPLE};font-size:0;line-height:0;">&nbsp;</td></tr></table></td><td style="font-family:${HEAD};font-size:13px;font-weight:600;line-height:1;letter-spacing:.08em;text-transform:uppercase;color:${INK};">${esc(label)}</td></tr></table>`;
function frame(title, inner, foot) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light">
<link href="https://fonts.googleapis.com/css2?family=Fira+Sans:wght@400;600;700&family=Fira+Sans+Condensed:wght@600;700&display=swap" rel="stylesheet"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#FFFFFF;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FFFFFF;"><tr><td style="padding:28px 20px 40px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;width:100%;"><tr><td style="padding:0 0 28px;">${LOGO}</td></tr>${inner}
<tr><td style="padding:44px 0 0;font-family:${BODY};font-size:15px;line-height:1.45;color:${MUTED};">${esc(foot)}</td></tr></table>
</td></tr></table></body></html>`;
}

// Письмо участникам: сначала текст ведущей, потом блок встречи со ссылкой — как в её письмах.
export function meetingEmail(g, { start, text, link, dial }) {
  const G = GROUPS[g], w = when(start, G.minutes);
  const block = `<tr><td style="padding:14px 0 0;"><div style="border-top:1px solid ${LINE};padding-top:22px;">${eyebrow(G.title)}
<div style="font-family:${HEAD};font-size:24px;font-weight:700;line-height:1.15;letter-spacing:-.005em;color:${INK};padding-top:12px;">${nb(esc(w.line))}</div>
<div style="padding-top:20px;">${button(link, "Присоединиться к встрече")}</div>
<div style="font-family:${BODY};font-size:15px;line-height:1.5;color:${MUTED};padding-top:14px;">Ссылка: ${linkify(link)}${dial ? `<br>По телефону: ${esc(dial)}` : ""}</div></div></td></tr>`;
  const foot = `Вы получили это письмо, потому что записались в группу через QARAVAN. Ответ на него придёт ${G.leader === "Джина" ? "Джине" : "Саймону"}. Не хотите больше получать эти письма — просто ответьте на это письмо.`;
  const html = frame(G.title, `<tr><td>${paras(text)}</td></tr>${block}`, foot);
  const plain = `${String(text).trim()}\n\n${G.title}\n${w.line}\nСсылка: ${link}${dial ? `\nПо телефону: ${dial}` : ""}\n\n${foot}`;
  return { html, text: plain };
}

// 1 человек, 2 человека, 5 человек
export function people(n) {
  const d = n % 10, h = n % 100;
  return `${n} ${d >= 2 && d <= 4 && (h < 12 || h > 14) ? "человека" : "человек"}`;
}
// Письмо ведущей накануне: одна кнопка на страницу отправки.
export function promptEmail(g, { start, url, inList }) {
  const G = GROUPS[g], w = when(start, G.minutes);
  const rel = relDay(start);
  const subject = `${rel[0].toUpperCase()}${rel.slice(1)} встреча в ${w.time}: отправьте ссылку участникам`;
  const inner = `<tr><td>${eyebrow(G.title)}
<div style="font-family:${HEAD};font-size:28px;font-weight:700;line-height:1.12;letter-spacing:-.005em;color:${INK};padding-top:12px;">${nb(esc(w.line))}</div>
<div style="padding-top:16px;">${paras(`Проверьте текст письма и ссылку на встречу, отметьте, кому отправить, и нажмите «Отправить». Письмо уйдёт всем в скрытой копии: участники не увидят адреса друг друга.\n\nСейчас в списке: ${people(inList)}.`)}</div>
<div style="padding-top:6px;">${button(url, "Проверить и отправить")}</div></td></tr>`;
  const foot = "Кнопка работает до конца встречи. Не пересылайте это письмо: по ссылке видны адреса участников.";
  return { subject, html: frame(subject, inner, foot), text: `${w.line}\n\nПроверьте текст и ссылку и отправьте участникам: ${url}\n\nСейчас в списке: ${inList}.\n\n${foot}` };
}

// ---------- данные страницы ----------
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// один человек — один адрес: берём самую свежую анкету, галочка — если стоит хоть на одной
export function peopleByEmail(rows) {
  const by = new Map();
  for (const r of rows) {
    if (!EMAIL_RX.test(r.email)) continue;
    const cur = by.get(r.email);
    if (!cur) by.set(r.email, { ...r, ids: [r.id] });
    else { cur.ids.push(r.id); cur.checked ||= r.checked; if (r.date > cur.date) Object.assign(cur, { name: r.name, status: r.status, source: r.source, date: r.date, city: r.city }); }
  }
  return [...by.values()].sort((a, b) => (b.checked - a.checked) || String(b.date).localeCompare(String(a.date)));
}
async function defaultsFor(m) {
  const G = GROUPS[m.group];
  const prev = await store.previousMeetings(m.group, m.start).catch(() => []);
  const last = prev.find((p) => p.mail?.text || p.link) || null;
  return {
    link: m.link || m.mail?.link || last?.link || last?.mail?.link || G.link,
    dial: m.mail?.dial ?? last?.mail?.dial ?? G.dial,
    text: m.mail?.text || last?.mail?.text || G.text,
  };
}
export async function pageData(t, now = new Date()) {
  const v = verifyToken(t, now.getTime());
  if (v.error) return { error: v.error };
  const m = await store.meeting(v.item);
  if (!m || m.group !== v.group || !m.start) return { error: "gone" };
  const G = GROUPS[m.group], d = await defaultsFor(m);
  const people = peopleByEmail(await store.people(m.group)).map((p) => ({ email: p.email, name: p.name, checked: p.checked, status: p.status, source: p.source, date: String(p.date).slice(0, 10), city: p.city }));
  return {
    group: m.group, title: G.title, leader: G.leader, leaderEmail: leaderEmail(m.group), member: G.member || null,
    meeting: { name: m.name, start: m.start.toISOString(), line: when(m.start, G.minutes).line, cancelled: m.status === "Cancelled" },
    subject: defaultSubject(m.group, m.start, now), link: d.link, dial: d.dial, text: d.text,
    sent: (m.mail?.sent || []).slice(-3), people,
  };
}

// ---------- отправка ----------
const clean = (s, max) => String(s ?? "").replace(/\r/g, "").trim().slice(0, max);
export function parseSend(b) {
  const out = {
    link: clean(b.link, 500), dial: clean(b.dial, 200).replace(/\n/g, " "), text: clean(b.text, 5000), subject: clean(b.subject, 200).replace(/\n/g, " "),
    selected: [...new Set((Array.isArray(b.selected) ? b.selected : []).map((e) => String(e).trim().toLowerCase()))].filter((e) => EMAIL_RX.test(e)),
    add: (Array.isArray(b.add) ? b.add : []).map((p) => ({ name: clean(p?.name, 120).replace(/\n/g, " "), email: clean(p?.email, 200).toLowerCase() })).filter((p) => EMAIL_RX.test(p.email)),
  };
  const bad = [];
  if (!/^https:\/\/[^\s]+\.[^\s]+/.test(out.link)) bad.push("link");
  if (!out.text) bad.push("text");
  if (!out.subject) bad.push("subject");
  if (!out.selected.length && !out.add.length) bad.push("people");
  return { ok: !bad.length, bad, s: out };
}
export async function sendMeeting(t, body, now = new Date()) {
  const v = verifyToken(t, now.getTime());
  if (v.error) return { status: 403, error: v.error };
  const { ok, bad, s } = parseSend(body);
  if (!ok) return { status: 400, error: "invalid", fields: bad };
  const m = await store.meeting(v.item);
  if (!m || m.group !== v.group || !m.start) return { status: 404, error: "gone" };
  const g = m.group, G = GROUPS[g];

  // список на доске: галочки по выбору, новые люди — новыми строками
  const rows = await store.people(g);
  const byEmail = peopleByEmail(rows);
  const known = new Set(byEmail.map((p) => p.email));
  const chosen = new Set([...s.selected, ...s.add.map((p) => p.email)]);
  const changes = [];
  for (const r of rows) if (EMAIL_RX.test(r.email) && r.checked !== chosen.has(r.email)) changes.push({ id: r.id, checked: chosen.has(r.email) });
  const added = [];
  for (const p of s.add) if (!known.has(p.email)) { await store.addPerson(g, { name: p.name || p.email, email: p.email }); added.push(p.email); known.add(p.email); }
  if (changes.length) await store.setMailing(g, changes);

  // одно письмо: ведущей в «Кому», всем остальным — в скрытой копии
  const to = leaderEmail(g);
  const bcc = [...chosen].filter((e) => e !== to.toLowerCase());
  const mail = meetingEmail(g, { start: m.start, text: s.text, link: s.link, dial: s.dial });
  await sendMime(buildMime({ fromName: G.from, to, bcc, replyTo: to, subject: s.subject, html: mail.html, text: mail.text }));

  const at = now.toISOString();
  const log = { ...m.mail, link: s.link, dial: s.dial, text: s.text, sent: [...(m.mail?.sent || []), { at, n: bcc.length }] };
  await store.saveMeeting(m.id, { link: s.link, mail: log }).catch((e) => console.error("meeting save failed:", e.message));
  await store.note(m.id, `Письмо со ссылкой на встречу отправлено в скрытой копии, получателей: ${bcc.length}; копия — ${to}.\nСсылка: ${s.link}\nТема: ${s.subject}\n\n${s.text}`)
    .catch((e) => console.error("meeting note failed:", e.message));
  return { status: 200, ok: true, sent: bcc.length, added: added.length, at };
}

// ---------- крон: письмо ведущей накануне ----------
// to — только вместе с item: тестовая копия письма ведущей на другой адрес (кнопка настоящая),
// встреча при этом не помечается как «уже спрашивали»
export async function promptTomorrow({ now = new Date(), item = null, dry = false, to = null } = {}) {
  let meetings;
  if (item) meetings = [await store.meeting(item)].filter(Boolean);
  else {
    const tomorrow = nyDate(new Date(now.getTime() + 86400000));
    const d1 = tomorrow, d2 = new Date(new Date(tomorrow + "T12:00:00Z").getTime() + 86400000).toISOString().slice(0, 10);
    meetings = (await store.meetingsBetween(d1, d2)).filter((m) => m.start && nyDate(m.start) === tomorrow);
  }
  const done = [];
  for (const m of meetings) {
    if (!m.group || !m.start || m.status === "Cancelled") continue;
    if (!item && m.mail?.prompted) continue; // уже спрашивали — второй раз не шлём
    const inList = peopleByEmail(await store.people(m.group)).filter((p) => p.checked).length;
    const url = sendUrl(m.id, m.group, m.start);
    const e = promptEmail(m.group, { start: m.start, url, inList });
    const rcpt = (item && to) || leaderEmail(m.group);
    if (!dry) {
      await sendMime(buildMime({ fromName: "QARAVAN", to: rcpt, subject: e.subject, html: e.html, text: e.text }));
      if (rcpt === leaderEmail(m.group)) await store.saveMeeting(m.id, { mail: { ...m.mail, prompted: now.toISOString() } }).catch((err) => console.error("prompt mark failed:", err.message));
    }
    done.push({ item: m.id, group: m.group, to: rcpt, start: m.start.toISOString(), inList, ...(dry ? { url } : {}) });
  }
  return done;
}

// ---------- HTTP ----------
async function readJson(req) {
  const chunks = []; for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return null; }
}
const reply = (res, status, obj) => { res.statusCode = status; res.end(JSON.stringify(obj)); };

// GET /api/meetings?t=… → данные страницы; POST /api/meetings { t, … } → отправка
export async function meetingsHandler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  const u = new URL(req.url, "https://x");
  try {
    if (req.method === "GET") {
      const d = await pageData(u.searchParams.get("t"));
      return reply(res, d.error ? (d.error === "gone" ? 404 : 403) : 200, d);
    }
    if (req.method === "POST") {
      const b = await readJson(req);
      if (!b) return reply(res, 400, { error: "invalid" });
      const r = await sendMeeting(b.t, b);
      const { status, ...rest } = r;
      return reply(res, status, rest);
    }
    return reply(res, 405, {});
  } catch (e) {
    console.error("meetings:", e.message);
    return reply(res, 502, { error: "failed" });
  }
}

// GET /api/meeting-prompts — Vercel-крон раз в день (vercel.json, 16:00 UTC ≈ полдень в Нью-Йорке).
// Если в Vercel задан CRON_SECRET, крон приходит с Authorization: Bearer <CRON_SECRET>, и без
// него эндпоинт отказывает. Если не задан — обычный прогон всё равно разрешён: он только
// пишет ведущим о завтрашних встречах и не повторяется (отметка prompted на строке встречи).
// Вручную, только с секретом (?key=<CRON_SECRET>): &item=<id строки> — письмо ведущей по
// этой встрече прямо сейчас (&to=<почта> — вместо ведущей на этот адрес, для проверки);
// &dry=1 — показать, что ушло бы, вместе со ссылками на страницы отправки (по ним видны
// адреса участников, поэтому без секрета — никогда).
export async function meetingPromptsHandler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  const u = new URL(req.url, "https://x");
  const key = process.env.CRON_SECRET;
  const authed = !!key && ((req.headers.authorization || "") === `Bearer ${key}` || u.searchParams.get("key") === key);
  const manual = u.searchParams.has("item") || u.searchParams.has("dry") || u.searchParams.has("to");
  if (key && !authed) return reply(res, 401, { error: "unauthorized" });
  if (!key && manual) return reply(res, 503, { error: "CRON_SECRET is not set in Vercel: item and dry need it" });
  const to = (u.searchParams.get("to") || "").trim().toLowerCase();
  if (to && (!EMAIL_RX.test(to) || !u.searchParams.get("item"))) return reply(res, 400, { error: "to needs item and a valid email" });
  try {
    const done = await promptTomorrow({ item: u.searchParams.get("item"), dry: u.searchParams.get("dry") === "1", to: to || null });
    return reply(res, 200, { ok: true, prompted: done });
  } catch (e) {
    console.error("meeting prompts:", e.message);
    return reply(res, 502, { error: "failed" });
  }
}
