// Письмо команде о новом обращении с сайта qaravan.org.
//
// Форма на сайте пишет строку на доску Website submissions (4939299706) в monday; на доске висит
// вебхук API (create_webhook, событие create_item), он зовёт POST /api/website-inquiry
// (vercel.json → /api/survey?form=website-inquiry: своей функции нет, на плане Hobby в api/ не
// больше 12 функций). При подключении вебхука monday присылает { challenge } — отвечаем им же.
// Понимает и { "itemId": … }, и ?item= (parseCall из lib/agreement-invite.mjs).
//
// Что делает, по порядку:
//   1. перечитывает строку из monday (тело вебхука ничего не решает); строка не с этой доски — отказ;
//   2. строка не старше WINDOW_HOURS: старые обращения эндпоинт никому не пересылает;
//   3. на строке уже есть апдейт «Письмо команде отправлено» — стоп (monday повторяет вебхук,
//      если ответ не 200);
//   4. смотрит, что о человеке уже есть в monday (lib/person-lookup.mjs, только чтение);
//   5. шлёт письмо от info@qaravan.org на NOTIFY (WEBSITE_NOTIFY в окружении — адреса через
//      запятую — их заменяет) и пишет на строку апдейт с той же пометкой и «Контекстом».
// Вёрстка — та же, что у писем об анкетах групп поддержки (lib/support-mail.mjs, дизайн-система
// QARAVAN, ревизия 2026-09). Письмо внутреннее, поэтому по-русски. Всё, что пришло из формы,
// экранируется: форму заполняет кто угодно. Ответить человеку — кнопкой «Ответить»: она
// открывает новое письмо на его адрес. Обычный «Ответить» в почте ушёл бы на info@qaravan.org, а
// Reply-To на человека не ставим: в ответ попала бы цитата этого письма с «Контекстом».
//
// В ответе эндпоинта нет ни имён, ни адресов: он открыт всем. Кто угодно может разве что
// прислать команде письмо о свежей строке, о которой оно и так пришло бы, и только один раз.
// ?dry=1 — только сказать, что было бы, без письма и апдейта.
import { esc, sendEmail } from "./letter-mail.mjs";
import { monday } from "./letter-board.mjs";
import { parseCall } from "./agreement-invite.mjs";
import { lookupPerson, withoutItem, dossierText } from "./person-lookup.mjs";
import { INK, MUTED, BODY, HEAD, frame, section, pairs, para, link, btn, eyebrow, known } from "./support-mail.mjs";

export const BOARD = "4939299706";
export const C = { lastName: "text2", request: "long_text", pronouns: "color", category: "status", email: "email", phone: "phone93", location: "text5", status: "status6" };
export const NOTIFY = ["ezra@qaravan.org"];
export const WINDOW_HOURS = 24;
export const MARK = "Письмо команде отправлено";
const ITEM_URL = (id) => `https://qaravan.monday.com/boards/${BOARD}/pulses/${id}`;
const EARLIER = { label: "Прежние обращения через сайт", last: "последнее", none: "без даты" };

export function recipients(env = process.env) {
  const own = env.WEBSITE_NOTIFY;
  const list = own != null ? own.split(",") : NOTIFY;
  return list.map((s) => s.trim()).filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s));
}

// Метка категории на доске — «Legal -  юридическая помощь»: по английской части — русское
// название для письма и цвет флажка (цвета категорий событий: ресурсы — голубой, поддержка —
// фиолетовый, сообщество — оранжевый, культура — красный).
const SKY = "#0099CC", PURPLE = "#7668AA", ORANGE = "#FF9933", RED = "#FF3333";
const CATEGORY = {
  "legal": ["Юридическая помощь", SKY], "housing": ["Помощь с жильём", SKY], "healthcare": ["Вопросы про медицину", SKY],
  "mental health": ["Психологическая поддержка", PURPLE], "volunteering": ["Волонтёрство", ORANGE],
  "partnership / event invite": ["Партнёрство и приглашения", ORANGE], "media": ["СМИ", RED],
  "not listed": ["Что-то ещё", INK], "sales / spam": ["Реклама и спам", INK],
};
export function category(label) {
  const s = String(label || "").trim();
  if (!s) return { ru: "Без категории", color: INK };
  const en = s.split(/\s+-\s+/)[0].trim().toLowerCase();
  const [ru, color] = CATEGORY[en] || [s, SKY];
  return { ru, color };
}

const cv = (it, id) => (it?.column_values || []).find((c) => c.id === id) || {};
// строка monday → что попадёт в письмо
export function inquiryFrom(it) {
  const t = (id) => String(cv(it, id).text || "").trim();
  const first = String(it.name || "").trim(), last = t(C.lastName);
  const email = t(C.email).toLowerCase();
  const digits = t(C.phone).replace(/\D/g, "");
  return {
    id: String(it.id), first, name: [first, last].filter(Boolean).join(" ") || "Без имени",
    email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : "", emailRaw: t(C.email),
    phone: digits ? { e164: `+${digits}` } : null, phoneRaw: t(C.phone),
    pronouns: t(C.pronouns), category: category(t(C.category)), location: t(C.location),
    request: String(cv(it, C.request).text || "").trim(), created: it.created_at,
  };
}

const nyWhen = (d) => new Intl.DateTimeFormat("ru-RU", { timeZone: "America/New_York", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(d);
const cyrillic = (s) => /[А-Яа-яЁё]/.test(s);

export function inquiryEmail(q, { known: d = null } = {}) {
  const when = nyWhen(new Date(q.created || Date.now()));
  const subject = `Обращение с сайта: ${q.name}, ${q.category.ru.toLowerCase()}`;
  const head = `<tr><td>${eyebrow(q.category.color, "Обращение с сайта")}
<div style="font-family:${HEAD};font-size:28px;font-weight:700;line-height:1.12;letter-spacing:-.005em;color:${INK};padding-top:12px;">${esc(q.name)}</div>
<div style="font-family:${BODY};font-size:15px;line-height:1.4;color:${MUTED};padding-top:8px;">${esc(q.category.ru)}<br>${esc(when)} по Нью-Йорку</div>
</td></tr>`;
  // «Ответить» — новое письмо на адрес человека, тема на языке, которым он писал
  const ru = cyrillic(q.name) || cyrillic(q.request);
  const mailto = q.email ? `mailto:${q.email}?subject=${encodeURIComponent(ru ? "Ваше обращение в QARAVAN" : "Your message to QARAVAN")}` : "";
  const note = [q.email ? `Откроется новое письмо на ${esc(q.email)}.` : "Почты в обращении нет.", link(ITEM_URL(q.id), "Открыть в monday")].join(" ");
  const action = `<tr><td style="padding:24px 0 0;">${mailto ? btn(mailto, "Ответить") : ""}<div style="font-family:${BODY};font-size:15px;line-height:1.4;color:${MUTED};padding-top:12px;">${note}</div></td></tr>`;
  const phone = q.phone ? link(`tel:${q.phone.e164}`, q.phone.e164) : "";
  const body = section("Обращение", q.request ? para(q.request) : `<div style="font-family:${BODY};font-size:15px;line-height:1.4;color:${MUTED};padding-top:12px;">Текста нет.</div>`)
    + section("Контакты", pairs([
      ["Местоимения", esc(q.pronouns)],
      ["Email", q.email ? link(`mailto:${q.email}`, q.email) : esc(q.emailRaw)],
      ["Телефон", phone],
      ["Откуда", esc(q.location)],
    ]))
    + known(d, { earlier: EARLIER });
  const foot = "Письмо отправила форма на сайте qaravan.org. Все обращения — на доске «Website submissions» в monday.";
  return { subject, html: frame(subject, head + action + body, foot) };
}

async function getItem(id) {
  const d = await monday(`query ($id: [ID!]) { items(ids: $id) { id name created_at state board { id } column_values(ids: ${JSON.stringify(Object.values(C))}) { id text } updates(limit: 25) { text_body } } }`, { id: [String(id)] });
  return d.items?.[0] || null;
}

// → { status, result, why } (result: "sent" | "skipped" | "would send" | "failed")
export async function inquiryForItem({ itemId, boardId = "", dry = false }, { now = new Date(), send = sendEmail, lookup = lookupPerson } = {}) {
  const skip = (why) => ({ status: 200, result: "skipped", why });
  const it = await getItem(itemId);
  if (!it || it.state !== "active") return skip("no such item");
  if (String(it.board?.id) !== BOARD) return { status: 400, result: "skipped", why: "not a website submission" };
  if (boardId && String(boardId) !== BOARD) return { status: 400, result: "skipped", why: "item is on another board" };
  const age = now - new Date(it.created_at);
  if (!(age >= -5 * 60000 && age <= WINDOW_HOURS * 3600000)) return skip("outside the window");
  if ((it.updates || []).some((u) => String(u.text_body || "").startsWith(MARK))) return skip("already sent");
  const to = recipients();
  if (!to.length) return skip("no recipients");
  const q = inquiryFrom(it);
  if (dry) return { status: 200, result: "would send", why: q.category.ru };

  const d = q.email ? withoutItem(await lookup(q, { group: { board: BOARD, email: C.email, status: C.status }, itemId: q.id, now }), q.id) : null;
  const m = inquiryEmail(q, { known: d });
  try {
    await send(to.join(", "), m.subject, m.html);
  } catch (e) {
    console.error(`website inquiry: email for item ${q.id} failed: ${e.message}`);
    return { status: 502, result: "failed", why: "email not sent" };
  }
  const note = `${MARK}: ${to.join(", ")}, ${nyWhen(now)} по Нью-Йорку.` + (d ? `\n\n${dossierText(d, { earlier: EARLIER })}` : "");
  await monday(`mutation ($i: ID!, $t: String!) { create_update(item_id: $i, body: $t) { id } }`, { i: q.id, t: note })
    .catch((e) => console.error(`website inquiry: note on item ${q.id} failed: ${e.message}`));
  return { status: 200, result: "sent", why: q.category.ru };
}

async function readJson(req) {
  const chunks = []; for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return null; }
}
const reply = (res, status, obj) => { res.statusCode = status; res.end(JSON.stringify(obj)); };

export async function websiteInquiryHandler(req, res) {
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
    const r = await inquiryForItem({ ...call, dry });
    console.log(`website inquiry: item ${call.itemId} → ${r.result} (${r.why})`);
    const { status, ...rest } = r;
    return reply(res, status, { ok: status === 200, ...rest });
  } catch (e) {
    console.error(`website inquiry: item ${call.itemId}: ${e.message}`);
    return reply(res, 502, { ok: false, error: "failed" });
  }
}
