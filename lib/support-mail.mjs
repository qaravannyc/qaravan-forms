// Письмо команде о новой анкете группы поддержки (lib/support-groups.mjs вызывает
// sendSignupEmail после того, как строка появилась на доске). Отправляет info@qaravan.org
// через Gmail API — тот же токен, что у анкеты на письмо поддержки (lib/letter-mail.mjs).
// Вёрстка — по дизайн-системе QARAVAN, ревизия 2026-09, как у самих анкет: белая страница,
// колонка 560px (как у форм), Fira Sans для текста и Fira Sans Condensed для заголовков и
// кнопки, всё квадратное, разделители — волосяная линия. Цвет — только флажками: флажок
// группы у надзаголовка (группы поддержки — фиолетовый) и флажки у выбранных вариантов;
// читаемый текст всегда чернилами на белом. Капсом — только надзаголовок. Письмо
// внутреннее, поэтому только по-русски.
//
// Кому: NOTIFY ниже; переменные окружения SUPPORT_NOTIFY_GINA / SUPPORT_NOTIFY_SIMON
// (адреса через запятую) их переопределяют. Автоматизация monday на доске Саймона «Email
// peer-support registrations to Ezra» выключена; включите — Эзра получит анкету дважды.
import { esc, sendEmail } from "./letter-mail.mjs";
import { dossierRows, HEAD_TITLE as KNOWN_TITLE, HEAD_LINE as KNOWN_LINE } from "./person-lookup.mjs";
import { hasStatus, statusUrl as statusLink } from "./status.mjs";

export const NOTIFY = {
  gina: ["info@qaravan.org", "gina@rusalgbtq.org", "ezra@qaravan.org"],
  simon: ["simon@rusalgbtq.org", "ezra@qaravan.org"],
};
export function recipients(group, env = process.env) {
  const own = env[`SUPPORT_NOTIFY_${group.toUpperCase()}`];
  const list = own != null ? own.split(",") : NOTIFY[group] || [];
  return list.map((s) => s.trim()).filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s));
}

const GROUP_NAME = { gina: "Группа поддержки с Джиной", simon: "Группа равной поддержки с Саймоном" };
const SUBJECT = { gina: "Новая анкета в группу поддержки с Джиной", simon: "Новая анкета в группу равной поддержки с Саймоном" };
const BOARD_NAME = { gina: "Support Group with Gina — Sign-ups", simon: "Группа равной поддержки с Саймоном: регистрация на участие" };

// Русские названия вариантов — те же, что в анкете (support/app.js, TEXTS.*.ru).
export const NEEDS_RU = {
  talk: "Общение", mental: "Психологическая помощь", support: "Поддержка и понимание", friends: "Друзья и новые знакомства",
  growth: "Развитие и учёба", work: "Работа", calm: "Спокойствие, меньше тревоги", acceptance: "Принять себя и быть собой",
  belonging: "Свои люди, сообщество", money: "Деньги, стабильный доход", legal: "Документы и легализация", safety: "Безопасность",
  health: "Здоровье", love: "Отношения и любовь", housing: "Жильё", adaptation: "Адаптация на новом месте",
  loneliness: "Не чувствовать себя одиноко", basics: "Еда и самое необходимое", family: "Отношения с семьёй", other: "Другое",
};
export const IDENTITIES_RU = {
  agender: "Агендер", asexual: "Асексуал(ка)", bisexual: "Бисексуал(ка)", cisgender: "Цисгендер", demisexual: "Демисексуал(ка)",
  gay_lesbian: "Гей / лесбиянка", genderfluid: "Гендерфлюид", genderqueer: "Гендерквир", heterosexual: "Гетеросексуал(ка)",
  nonbinary: "Небинарный человек", pansexual: "Пансексуал(ка)", queer: "Квир", transgender: "Транс-персона", prefer_not: "Предпочитаю не отвечать",
};
const FORMAT_RU = { remote: "Только онлайн", in_person: "Только вживую", both: "И так, и так" };
const YN = { yes: "Да", no: "Нет" };

// Токены дизайн-системы (tokens.json, они же assets/qaravan.css): q-ink, q-muted, q-line, q-sky.
export const INK = "#333333", MUTED = "#5E5A53", LINE = "#ECE8DE", SKY = "#0099CC";
const PURPLE = "#7668AA"; // категория «группы поддержки»: её флажок
// флажки выбранных вариантов — те же цвета и в том же порядке, что в анкете;
// у жёлтого на белом — тонкий чернильный край (правило жёлтого)
const MARKS = ["#FF9933", "#F8F36E", "#66CC66"];
// Fira подгружается там, где почта умеет веб-шрифты (Apple Mail, iOS); Gmail веб-шрифты не
// грузит, и тогда заголовки идут обычным Helvetica/Arial. Arial Narrow в запасных нет нарочно:
// на месте Fira Sans Condensed он выглядит сплющенным.
export const BODY = `'Fira Sans','Helvetica Neue',Helvetica,Arial,sans-serif`;
export const HEAD = `'Fira Sans Condensed','Fira Sans','Helvetica Neue',Helvetica,Arial,sans-serif`;
const LOGO = `<img src="https://feedback.qaravan.org/logo-email.png" width="140" height="26" alt="qaravan" style="display:block;border:0;outline:none;text-decoration:none;width:140px;height:auto;">`;

// цветной флажок — ячейкой таблицы с bgcolor: пустой цветной span Gmail не рисует
// (у жёлтого на белом — тонкий чернильный край, правило жёлтого)
export const flag = (c, size) => {
  const edge = c === "#F8F36E" ? `border:1px solid ${INK};` : "", s = edge ? size - 2 : size;
  return `<td width="${s}" height="${s}" bgcolor="${c}" style="width:${s}px;height:${s}px;background-color:${c};${edge}font-size:0;line-height:0;">&nbsp;</td>`;
};
// Отступы — по шкале дизайн-системы (space-1…space-8: 4, 8, 12, 16, 24, 32, 48, 64).
const td = (html, style = "") => `<td style="font-family:${BODY};font-size:16px;line-height:1.5;color:${INK};vertical-align:top;${style}">${html}</td>`;
export const text = (s) => esc(s).replace(/\n/g, "<br>");
// ссылки — чернилами с голубым подчёркиванием, как на сайте
const UNDERLINE = `text-decoration:underline;text-decoration-color:${SKY};text-decoration-thickness:2px;text-underline-offset:4px;`;
export const link = (href, label) => `<a href="${esc(href)}" style="color:${INK};font-weight:600;${UNDERLINE}">${esc(label)}</a>`;

// заголовок раздела: сжатый 700, строчными (капс — только у надзаголовка), волосяная линия под ним
// sub — приглушённая строка под заголовком, как у SectionHeader (second-line, 15px)
export function section(title, inner, sub = "") {
  const t = `<div style="font-family:${HEAD};font-size:22px;font-weight:700;line-height:1.15;letter-spacing:-.005em;color:${INK};${sub ? "" : `padding-bottom:12px;border-bottom:1px solid ${LINE};`}">${esc(title)}</div>`;
  const s = sub ? `<div style="font-family:${BODY};font-size:15px;line-height:1.4;color:${MUTED};padding:4px 0 12px;border-bottom:1px solid ${LINE};">${esc(sub)}</div>` : "";
  return `<tr><td style="padding:32px 0 0;">${t}${s}${inner}</td></tr>`;
}
// строки «вопрос — ответ», как Field: вопрос сверху (сжатый 600, приглушённый), ответ под ним
// чернилами — в одну колонку, чтобы на телефоне ничего не сжималось; пустые не показываем
export function pairs(rows) {
  const tr = rows.filter(([, v]) => v).map(([k, v]) => `<tr>${td(
    `<div style="font-family:${BODY};font-size:15px;font-weight:600;line-height:1.3;color:${INK};">${esc(k)}</div><div style="padding-top:6px;">${v}</div>`,
    `padding:12px 0;border-bottom:1px solid ${LINE};`)}</tr>`).join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${tr}</table>`;
}
export const para = (s) => `<div style="font-family:${BODY};font-size:16px;line-height:1.5;color:${INK};padding-top:12px;">${text(s)}</div>`;
// выбранные варианты — список: цветной квадратный флажок, затем текст чернилами на белом
export function chips(labels) {
  const rows = labels.map((l, i) => {
    const c = MARKS[i % MARKS.length];
    const mark = `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${flag(c, 10)}</tr></table>`;
    return `<tr>${td(mark, `width:24px;padding:19px 0 0;line-height:1;border-bottom:1px solid ${LINE};`)}${td(esc(l), `padding:12px 0;border-bottom:1px solid ${LINE};`)}</tr>`;
  });
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${rows.join("")}</table>`;
}
// белая страница, колонка 560px по левому краю — как у анкет
// lang — язык письма (по умолчанию русский; письмо об обращении с сайта — английское)
export function frame(title, rows, foot, lang = "ru") {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light">
<link href="https://fonts.googleapis.com/css2?family=Fira+Sans:wght@400;600;700&family=Fira+Sans+Condensed:wght@600;700&display=swap" rel="stylesheet"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#FFFFFF;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FFFFFF;"><tr><td style="padding:32px 20px 48px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;width:100%;"><tr><td style="padding:0 0 32px;">${LOGO}</td></tr>${rows}
<tr><td style="padding:48px 0 0;font-family:${BODY};font-size:15px;line-height:1.4;color:${MUTED};">${esc(foot)}</td></tr>
<tr><td style="padding:12px 0 0;"><a href="https://qaravan.org" style="font-family:${BODY};font-size:15px;font-weight:600;color:${INK};${UNDERLINE}">qaravan.org</a></td></tr></table>
</td></tr></table></body></html>`;
}

function contacts(p) {
  const tg = /^@[A-Za-z0-9_]{3,32}$/.test(p.telegram || "") ? link(`https://t.me/${p.telegram.slice(1)}`, p.telegram) : esc(p.telegram || "");
  const ig = /^@[A-Za-z0-9._]{1,30}$/.test(p.instagram || "") ? link(`https://instagram.com/${p.instagram.slice(1)}`, p.instagram) : esc(p.instagram || "");
  const phone = p.phone?.country ? link(`tel:${p.phone.e164}`, p.phone.e164) : esc(p.phoneRaw);
  return pairs([
    ["Местоимения", p.group === "gina" ? esc(p.a.pronouns) : ""],
    ["Email", link(`mailto:${p.email}`, p.email)],
    ["Телефон", phone],
    ["Telegram", tg],
    ["Instagram", ig],
  ]);
}

function ginaBody(p) {
  const a = p.a;
  const inUs = a.inUs === "yes" ? "Да" : `Не совсем${a.inUsNote ? `<div style="color:${MUTED};font-size:15px;padding-top:4px;">«${text(a.inUsNote)}»</div>` : ""}`;
  return section("Ответы", pairs([
    ["Русскоязычный ЛГБТК+ человек в США", inUs],
    ["Будет приходить регулярно", YN[a.regular]],
    ["15 минут на знакомство в Zoom", YN[a.intro]],
    ["Правила группы", "Обещает соблюдать"],
  ]))
  + section("Что нужнее всего", chips(a.needs.map((x) => (x === "other" && a.needsText ? `Другое: ${a.needsText}` : NEEDS_RU[x]))))
  + section("Чего ждёт от группы", para(a.expect))
  + (a.notes ? section("Что ещё важно знать", para(a.notes)) : "");
}
function simonBody(p) {
  const a = p.a;
  return section("Ответы", pairs([
    ["Где живёт", esc(a.city)],
    ["Как удобнее встречаться", FORMAT_RU[a.format] || ""],
  ]))
  + (a.identities.length ? section("Как себя определяет", chips(a.identities.map((x) => IDENTITIES_RU[x]))) : "")
  + (a.question ? section("Вопрос для группы", para(a.question)) : "")
  + (a.notes ? section("Чем ещё хочет поделиться", para(a.notes)) : "");
}

// «Контекст: что робот нашёл…» — первым разделом, сразу под кнопкой: ради него письмо и читают.
// opts уходят в dossierRows: group — чья группа, earlier — подпись прежних анкет на другой доске.
export function known(d, opts = {}) {
  if (!d) return "";
  return knownSection(dossierRows(d, opts));
}
// Сам раздел — по готовым строкам; t — подписи на другом языке (письмо об обращении с сайта)
const KNOWN_RU = { title: KNOWN_TITLE, line: KNOWN_LINE, open: "Открыть карточку",
  failed: "Проверить не получилось: monday не ответил. Посмотрите человека на доске посетителей мероприятий (Attendees)." };
export function knownSection(rows, t = KNOWN_RU) {
  if (!rows) return section(t.title, `<div style="font-family:${BODY};font-size:15px;line-height:1.4;color:${MUTED};padding-top:12px;">${esc(t.failed)}</div>`, t.line);
  // одна мысль — одна строка: каждое событие своей строкой с зазором 4px, «и ещё N» приглушённым
  const lines = (list, more = "") => list.map((l, i) => `<div style="${i ? "padding-top:4px;" : ""}">${esc(l)}</div>`).join("")
    + (more ? `<div style="padding-top:4px;font-size:15px;line-height:1.4;color:${MUTED};">${esc(more)}</div>` : "");
  const val = (v) => (Array.isArray(v) ? lines(v)
    : v?.lines ? lines(v.lines, v.more)
      : typeof v === "object" ? `${esc(v.text)}<div style="padding-top:8px;">${link(v.url, t.open)}</div>` : esc(v));
  return section(t.title, pairs(rows.map(([k, v]) => [k, val(v)])), t.line);
}

// Button md: квадратная, чернилами, 44px, сжатый 600 17px
export const btn = (href, label) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${INK}" style="background:${INK};"><a href="${esc(href)}" style="display:block;padding:12px 18px;font-family:${HEAD};font-weight:600;font-size:17px;line-height:1.15;letter-spacing:.01em;color:#FFFFFF;text-decoration:none;">${esc(label)}</a></td></tr></table>`;
// надзаголовок письма, как у SectionHeader: квадратный флажок цвета, затем разрядка капсом
export const eyebrow = (color, label) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle" style="padding-right:10px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${flag(color, 8)}</tr></table></td><td style="font-family:${HEAD};font-size:13.5px;font-weight:600;line-height:1.2;letter-spacing:.1em;text-transform:uppercase;color:${INK};">${esc(label)}</td></tr></table>`;

// status — какой статус сейчас на доске (новая анкета приходит со статусом New)
export function signupEmail(p, { itemUrl, statusUrl = "", status = "New", now = new Date(), known: d = null } = {}) {
  const when = new Intl.DateTimeFormat("ru-RU", { timeZone: "America/New_York", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(now);
  const subject = `${SUBJECT[p.group]}: ${p.name}`;
  // открывашка как SectionHeader: надзаголовок (фиолетовый флажок категории, разрядка капсом),
  // имя сжатым 700 (title-xl, 28px), строка приглушённым (second-line, 15px)
  const head = `<tr><td>
${eyebrow(PURPLE, "Новая анкета")}
<div style="font-family:${HEAD};font-size:28px;font-weight:700;line-height:1.12;letter-spacing:-.005em;color:${INK};padding-top:12px;">${esc(p.name)}</div>
<div style="font-family:${BODY};font-size:15px;line-height:1.4;color:${MUTED};padding-top:8px;">${esc(GROUP_NAME[p.group])}<br>${esc(when)} по Нью-Йорку, анкета на ${p.lang === "en" ? "английском" : "русском"}</div>
</td></tr>`;
  // главная кнопка (btn). Есть статус на доске (у Джины) — кнопка «Изменить статус» (страница
  // статуса, lib/status.mjs) стоит в конце письма, после ответов, а monday — ссылкой под ней;
  // иначе «Открыть в monday» — сразу под именем.
  const button = statusUrl
    ? `<tr><td style="padding:32px 0 0;">${btn(statusUrl, "Изменить статус")}<div style="font-family:${BODY};font-size:15px;line-height:1.4;color:${MUTED};padding-top:12px;">Статус на доске сейчас — ${esc(status)}: те же статусы, что в monday.${itemUrl ? ` ${link(itemUrl, "Открыть в monday")}` : ""}</div></td></tr>`
    : itemUrl ? `<tr><td style="padding:24px 0 0;">${btn(itemUrl, "Открыть в monday")}</td></tr>` : "";
  const body = known(d, { group: p.group }) + section("Контакты", contacts(p)) + (p.group === "gina" ? ginaBody(p) : simonBody(p));
  const rows = statusUrl ? head + body + button : head + button + body;
  const foot = `Письмо отправила анкета feedback.qaravan.org/support/${p.group}. Все анкеты — на доске «${BOARD_NAME[p.group]}» в monday.`;
  return { subject, html: frame(subject, rows, foot) };
}

export async function sendSignupEmail(p, itemId, known = null) {
  const to = recipients(p.group);
  if (!to.length) return false;
  const boards = { gina: "18433061986", simon: "5469799506" };
  let sUrl = "";
  try { if (itemId && hasStatus(p.group)) sUrl = statusLink(itemId, p.group); } catch (e) { console.error("status link failed:", e.message); }
  const m = signupEmail(p, { itemUrl: itemId ? `https://qaravan.monday.com/boards/${boards[p.group]}/pulses/${itemId}` : "", statusUrl: sUrl, known });
  await sendEmail(to.join(", "), m.subject, m.html);
  return true;
}
