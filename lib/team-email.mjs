// Письма команде о новых заявках с досок форм monday: запись в волонтёры, заявки на роли
// Event Project Manager и Community Manager, Rainbow Connections (волонтёр или участник).
//
// Раньше о каждой такой строке писала автоматизация monday на доске («When a new item is
// created → Send an email»: одна строка текста от ezra@rusalgbtq.org). Теперь на каждой доске
// из FORMS висит вебхук API (create_webhook, событие create_item) на POST /api/team-email
// (vercel.json → /api/survey?form=team-email: своей функции нет, в api/ не больше 12 файлов).
// Автоматизации на досках выключены; включите — письма придут дважды.
//
// Порядок — как у письма об обращении с сайта (lib/website-inquiry.mjs):
//   1. перечитывает строку из monday (тело вебхука ничего не решает); доска не из FORMS — отказ;
//   2. строка не старше WINDOW_HOURS;
//   3. на строке уже есть апдейт MARK — стоп: monday повторяет вебхук, если ответ не 200;
//   4. смотрит, что о человеке уже есть в monday (lib/person-lookup.mjs, только чтение);
//   5. шлёт письмо от info@qaravan.org на NOTIFY (TEAM_NOTIFY в окружении — адреса через
//      запятую — их заменяет) и пишет на строку апдейт с той же пометкой и разделом Context.
// Вёрстка и язык — как у того письма: дизайн-система QARAVAN, по-английски. recipients() здесь
// общий и для письма о заявке на письмо поддержки (его шлёт сама анкета, api/letter.mjs).
//
// В ответе эндпоинта нет ни имён, ни адресов: он открыт всем. ?dry=1 — сказать, что было бы.
import { esc, sendEmail } from "./letter-mail.mjs";
import { monday } from "./letter-board.mjs";
import { parseCall } from "./agreement-invite.mjs";
import { lookupPerson, withoutItem } from "./person-lookup.mjs";
import { MUTED, BODY, HEAD, INK, frame, section, pairs, para, text, link, btn, eyebrow, knownSection, chips } from "./support-mail.mjs";
import { contextRows, contextText, enDate, nyWhen, CONTEXT } from "./website-inquiry.mjs";

export const NOTIFY = ["ezra@qaravan.org"];
export const WINDOW_HOURS = 24;
export const MARK = "Team email sent";
const ORANGE = "#FF9933", PURPLE = "#7668AA"; // флажки категорий: волонтёрство, поддержка
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function recipients(env = process.env) {
  const own = env.TEAM_NOTIFY;
  const list = own != null ? own.split(",") : NOTIFY;
  return list.map((s) => s.trim()).filter((s) => EMAIL_RX.test(s));
}

// Доски с вебхуком. Колонки у трёх волонтёрских досок общие (у ролей нет навыков, часов и
// формата, зато есть два файла: резюме и сопроводительное письмо, в каком порядке — не знаем).
export const FORMS = {
  4806484412: { kind: "volunteer", title: "Volunteer sign-up", board: "Volunteer sign-ups and engagement", form: "volunteer sign-up form" },
  9710026121: { kind: "role", title: "Event Project Manager application", board: "Event Project Manager", form: "Event Project Manager form on qaravan.org/volunteer" },
  9710142984: { kind: "role", title: "Community Manager application", board: "Community Manager", form: "Community Manager form on qaravan.org/volunteer" },
  5344342465: { kind: "rc", title: "Rainbow Connections", board: "RC: Submissions", form: "Rainbow Connections form" },
};
const V = { email: "email", phone: "phone", location: "location", pronouns: "multi_select", skills: "dropdown", hours: "status_1", format: "single_select", start: "date4", notes: "long_text", linkedin: "link", files: ["filezatpfpwk", "filetry1z2xt"] };
// RC: Submissions — две формы в одну доску: волонтёры в группе topics, участники в group_title
const RC = {
  volunteer: { last: "short_text77", email: "email_2", phone: "phone_2", city: "short_text39", areas: "multi_select_130", hours: "single_select5", start: "date_13", russian: "single_select65", prefs: "long_text2" },
  participant: { last: "short_text28", email: "email_15", phone: "phone_19", city: "short_text5", areas: "multi_select_13", english: "single_select62", prefs: "long_text7" },
  background: "long_text6", notes: "long_text0", participantGroup: "group_title",
};
const ITEM_URL = (board, id) => `https://qaravan.monday.com/boards/${board}/pulses/${id}`;

const cv = (it, id) => (it?.column_values || []).find((c) => c.id === id) || {};
const t = (it, id) => String(cv(it, id).text || "").trim();
const json = (it, id) => { try { return JSON.parse(cv(it, id).value || "null") || {}; } catch { return {}; } };
// метки форм — «1. English Conversation Practice» или «Fluent | Свободное владение»: в
// английском письме без номера и без русской половины
const clean = (s) => String(s || "").replace(/^\d+\.\s*/, "").split(" | ")[0].trim();
const labels = (it, id) => (cv(it, id).values || []).map((v) => clean(v.label)).filter(Boolean);
function phoneOf(it, id) {
  const d = t(it, id).replace(/\D/g, "");
  if (!d) return null;
  return { e164: d.length === 10 && json(it, id).countryShortName === "US" ? `+1${d}` : `+${d}` };
}
function linkOf(it, id) {
  const url = String(json(it, id).url || t(it, id)).trim();
  return /^https?:\/\//.test(url) ? { href: url, label: url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") } : url;
}
// файлы: адреса — в text через запятую, имена — в value.files в том же порядке
function filesOf(it, ids) {
  return ids.flatMap((id) => {
    const names = (json(it, id).files || []).map((f) => f.name);
    return t(it, id).split(/,\s*(?=https:\/\/)/).filter((u) => /^https:\/\//.test(u)).map((href, i) => {
      let label = names[i];
      if (!label) try { label = decodeURIComponent(href.split("/").pop()); } catch { label = "File"; }
      return { href, label };
    });
  });
}

// строка monday → что попадёт в письмо: шапка и блоки [вид, заголовок, данные] (без HTML)
export function signupFrom(it) {
  const boardId = String(it.board?.id || "");
  const f = FORMS[boardId];
  if (!f) return null;
  const base = { id: String(it.id), boardId, created: it.created_at, board: f.board, form: f.form, color: ORANGE, noun: f.kind === "role" ? "application" : "sign-up" };
  const contact = (rows) => ["pairs", "Contact", rows];
  const mail = (raw) => { const e = raw.toLowerCase(); return EMAIL_RX.test(e) ? e : ""; };
  const email = (raw) => (mail(raw) ? { href: `mailto:${mail(raw)}`, label: mail(raw) } : raw);
  const tel = (p) => (p ? { href: `tel:${p.e164}`, label: p.e164 } : "");

  if (f.kind === "rc") {
    const kind = it.group?.id === RC.participantGroup || (!t(it, RC.volunteer.email) && t(it, RC.participant.email)) ? "participant" : "volunteer";
    const c = RC[kind];
    const raw = t(it, c.email), phone = phoneOf(it, c.phone);
    const blocks = kind === "volunteer"
      ? [["chips", "Can help with", labels(it, c.areas)],
        ["pairs", "Availability", [["Hours per week", clean(t(it, c.hours))], ["Can start", enDate(t(it, c.start))], ["Russian", clean(t(it, c.russian))]]]]
      : [["chips", "Wants help with", labels(it, c.areas)], ["pairs", "Language", [["English", clean(t(it, c.english))]]]];
    blocks.push(["para", "Background", t(it, RC.background)], ["para", "Pairing preferences", t(it, c.prefs)], ["para", "Anything else", t(it, RC.notes)],
      contact([["Email", email(raw)], ["Phone", tel(phone)], ["City", t(it, c.city)]]));
    return { ...base, title: `Rainbow Connections ${kind}`, color: kind === "participant" ? PURPLE : ORANGE,
      name: [String(it.name || "").trim(), t(it, c.last)].filter(Boolean).join(" ") || "No name",
      email: mail(raw), phone, emailCol: c.email, reply: "Rainbow Connections at QARAVAN", earlier: "Earlier Rainbow Connections sign-ups", blocks };
  }

  const raw = t(it, V.email), phone = phoneOf(it, V.phone);
  const files = f.kind === "role" ? filesOf(it, V.files) : [];
  const blocks = f.kind === "volunteer"
    ? [["chips", "Interests", labels(it, V.skills)],
      ["pairs", "Availability", [["Hours per week", t(it, V.hours)], ["Remote or in person", t(it, V.format)], ["Can start", enDate(t(it, V.start))]]],
      ["para", "Anything else", t(it, V.notes)]]
    : [["para", "Anything else", t(it, V.notes)],
      ["pairs", "Files", files.map((x) => ["File", x])],
      ["pairs", "Availability", [["Can start", enDate(t(it, V.start))]]]];
  blocks.push(contact([["Pronouns", labels(it, V.pronouns).join(", ")], ["Email", email(raw)], ["Phone", tel(phone)], ["Location", t(it, V.location)], ["LinkedIn", linkOf(it, V.linkedin)]]));
  return { ...base, title: f.title, name: String(it.name || "").trim() || "No name", email: mail(raw), phone, emailCol: V.email,
    reply: f.kind === "role" ? `Your ${f.title} at QARAVAN` : "Volunteering with QARAVAN", earlier: `Earlier ${base.noun}s on this board`, blocks };
}

// значение строки «вопрос — ответ»: текст или ссылка { href, label }
const val = (v) => (v && typeof v === "object" ? link(v.href, v.label) : text(v));
function block([type, title, v]) {
  if (type === "chips") return v.length ? section(title, chips(v)) : "";
  if (type === "para") return v ? section(title, para(v)) : "";
  const rows = v.filter(([, x]) => x);
  return rows.length ? section(title, pairs(rows.map(([k, x]) => [k, val(x)]))) : "";
}
const muted = (html, pad = "padding-top:12px;") => `<div style="font-family:${BODY};font-size:15px;line-height:1.4;color:${MUTED};${pad}">${html}</div>`;
// Шапка, кнопка Reply и подвал — общие с письмом о заявке на письмо поддержки (api/letter.mjs).
// lines — приглушённые строки под именем; extra — что добавить к пояснению под кнопкой.
export function teamLetter({ title, color, name, lines, email, reply, extra = "", itemUrl, body, foot }) {
  const subject = `${title}: ${name}`;
  const head = `<tr><td>${eyebrow(color, title)}
<div style="font-family:${HEAD};font-size:28px;font-weight:700;line-height:1.12;letter-spacing:-.005em;color:${INK};padding-top:12px;">${esc(name)}</div>
${muted(lines.map(esc).join("<br>"), "padding-top:8px;")}
</td></tr>`;
  // Reply — новое письмо на адрес человека: обычный «Ответить» ушёл бы на info@qaravan.org
  const mailto = email ? `mailto:${email}?subject=${encodeURIComponent(reply)}` : "";
  const note = [email ? `Opens a new email to ${esc(email)}.` : "No email in the form.", extra, link(itemUrl, "Open in monday")].filter(Boolean).join(" ");
  const action = `<tr><td style="padding:24px 0 0;">${mailto ? btn(mailto, "Reply") : ""}${muted(note)}</td></tr>`;
  return { subject, html: frame(subject, head + action + body, foot, "en") };
}

export function signupEmail(s, { known: d = null } = {}) {
  const body = s.blocks.map(block).join("") + (d ? knownSection(contextRows(d, { earlier: s.earlier }), CONTEXT) : "");
  return teamLetter({ title: s.title, color: s.color, name: s.name, lines: [`${nyWhen(new Date(s.created || Date.now()))}, New York time`],
    email: s.email, reply: s.reply, itemUrl: ITEM_URL(s.boardId, s.id), body,
    foot: `Sent by the ${s.form}. Every ${s.noun} is on the ${s.board} board in monday.` });
}

async function getItem(id) {
  const d = await monday(`query ($id: [ID!]) { items(ids: $id) { id name created_at state board { id } group { id } column_values { id text value ... on DropdownValue { values { label } } } updates(limit: 25) { text_body } } }`, { id: [String(id)] });
  return d.items?.[0] || null;
}

// → { status, result, why } (result: "sent" | "skipped" | "would send" | "failed")
export async function teamEmailForItem({ itemId, boardId = "", dry = false }, { now = new Date(), send = sendEmail, lookup = lookupPerson } = {}) {
  const skip = (why) => ({ status: 200, result: "skipped", why });
  const it = await getItem(itemId);
  if (!it || it.state !== "active") return skip("no such item");
  const s = signupFrom(it);
  if (!s) return { status: 400, result: "skipped", why: "not a form board" };
  if (boardId && String(boardId) !== s.boardId) return { status: 400, result: "skipped", why: "item is on another board" };
  const age = now - new Date(it.created_at);
  if (!(age >= -5 * 60000 && age <= WINDOW_HOURS * 3600000)) return skip("outside the window");
  if ((it.updates || []).some((u) => String(u.text_body || "").startsWith(MARK))) return skip("already sent");
  const to = recipients();
  if (!to.length) return skip("no recipients");
  if (dry) return { status: 200, result: "would send", why: s.title };

  const d = s.email ? withoutItem(await lookup(s, { group: { board: s.boardId, email: s.emailCol }, itemId: s.id, now }), s.id) : null;
  const m = signupEmail(s, { known: d });
  try {
    await send(to.join(", "), m.subject, m.html);
  } catch (e) {
    console.error(`team email: item ${s.id} failed: ${e.message}`);
    return { status: 502, result: "failed", why: "email not sent" };
  }
  const note = `${MARK}: ${to.join(", ")}, ${nyWhen(now)}, New York time.` + (d ? `\n\n${contextText(d, { earlier: s.earlier })}` : "");
  await monday(`mutation ($i: ID!, $t: String!) { create_update(item_id: $i, body: $t) { id } }`, { i: s.id, t: note })
    .catch((e) => console.error(`team email: note on item ${s.id} failed: ${e.message}`));
  return { status: 200, result: "sent", why: s.title };
}

async function readJson(req) {
  const chunks = []; for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return null; }
}
const reply = (res, status, obj) => { res.statusCode = status; res.end(JSON.stringify(obj)); };

export async function teamEmailHandler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  const url = new URL(req.url, "https://x");
  const dry = url.searchParams.get("dry") === "1";
  if (req.method !== "POST" && !(req.method === "GET" && dry)) return reply(res, 405, { error: "POST only" });
  const body = req.method === "POST" ? await readJson(req) : {};
  if (body === null) return reply(res, 400, { error: "invalid JSON" });
  if (typeof body.challenge === "string") return reply(res, 200, { challenge: body.challenge });
  const call = parseCall(body, url);
  if (!call.itemId) return reply(res, 400, { error: "itemId is required" });
  try {
    const r = await teamEmailForItem({ ...call, dry });
    console.log(`team email: item ${call.itemId} → ${r.result} (${r.why})`);
    const { status, ...rest } = r;
    return reply(res, status, { ok: status === 200, ...rest });
  } catch (e) {
    console.error(`team email: item ${call.itemId}: ${e.message}`);
    return reply(res, 502, { ok: false, error: "failed" });
  }
}
