// Письмо команде о новой анкете группы поддержки (lib/support-groups.mjs вызывает
// sendSignupEmail после того, как строка появилась на доске). Отправляет info@qaravan.org
// через Gmail API — тот же токен и та же рамка письма, что у анкеты на письмо поддержки
// (lib/letter-mail.mjs). Письмо внутреннее, поэтому только по-русски.
//
// Кому: NOTIFY ниже; переменные окружения SUPPORT_NOTIFY_GINA / SUPPORT_NOTIFY_SIMON
// (адреса через запятую) их переопределяют. Раньше у Саймона письмо слала автоматизация
// доски monday; её выключили, чтобы письма не приходили дважды.
import { FONT, esc, shell, sendEmail } from "./letter-mail.mjs";

export const NOTIFY = {
  gina: ["ezra@qaravan.org"],
  simon: ["ezra@qaravan.org"],
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

// цвета выбранных вариантов — как в анкете: оранжевый, жёлтый, зелёный, фиолетовый
const CHIP = [["#FF9933", "#333333"], ["#F8F36E", "#333333"], ["#66CC66", "#333333"], ["#7668AA", "#FFFFFF"]];
const INK = "#333333", MUTED = "#6E6E6E", LINE = "#ECE8DE";

const td = (html, style = "") => `<td style="font-family:${FONT};font-size:15px;line-height:1.5;color:${INK};vertical-align:top;${style}">${html}</td>`;
const text = (s) => esc(s).replace(/\n/g, "<br>");
const link = (href, label) => `<a href="${esc(href)}" style="color:${INK};text-decoration:underline;text-decoration-color:#0099CC;">${esc(label)}</a>`;

function section(title, inner) {
  return `<tr><td style="padding:26px 40px 0;"><div style="font-family:${FONT};font-size:12px;font-weight:bold;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};padding-bottom:10px;border-bottom:1px solid ${LINE};">${esc(title)}</div>${inner}</td></tr>`;
}
// label / value rows; empty values are left out
function pairs(rows) {
  const tr = rows.filter(([, v]) => v).map(([k, v]) => `<tr>${td(esc(k), `width:42%;padding:9px 12px 9px 0;color:${MUTED};border-bottom:1px solid ${LINE};`)}${td(v, `padding:9px 0;border-bottom:1px solid ${LINE};`)}</tr>`).join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${tr}</table>`;
}
const para = (s) => `<div style="font-family:${FONT};font-size:15px;line-height:1.55;color:${INK};padding-top:12px;">${text(s)}</div>`;
function chips(labels) {
  const cells = labels.map((l, i) => { const [bg, fg] = CHIP[i % CHIP.length]; return `<span style="display:inline-block;margin:10px 6px 0 0;padding:7px 12px;background:${bg};color:${fg};font-family:${FONT};font-size:14px;font-weight:bold;line-height:1.2;">${esc(l)}</span>`; });
  return `<div>${cells.join("")}</div>`;
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
  const inUs = a.inUs === "yes" ? "Да" : `Не совсем${a.inUsNote ? `<div style="color:${MUTED};padding-top:4px;">«${text(a.inUsNote)}»</div>` : ""}`;
  return section("Ответы", pairs([
    ["Русскоязычный ЛГБТК+ человек в США", inUs],
    ["Будет приходить регулярно", YN[a.regular]],
    ["Интересно про иммиграцию и психическое здоровье", YN[a.immig]],
    ["15 минут на знакомство в Zoom", YN[a.intro]],
    ["Правила и конфиденциальность", "Обещает соблюдать"],
  ]))
  + section("Что нужнее всего", chips(a.needs.map((x) => NEEDS_RU[x])) + (a.needsText ? para(`Другое: ${a.needsText}`) : ""))
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

export function signupEmail(p, { itemUrl, now = new Date() } = {}) {
  const when = new Intl.DateTimeFormat("ru-RU", { timeZone: "America/New_York", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(now);
  const subject = `${SUBJECT[p.group]}: ${p.name}`;
  const head = `<tr><td style="padding:30px 40px 0;">
<div style="font-family:${FONT};font-size:12px;font-weight:bold;letter-spacing:.08em;text-transform:uppercase;color:${INK};"><span style="display:inline-block;width:9px;height:9px;background:${p.group === "gina" ? "#7668AA" : "#66CC66"};margin-right:8px;"></span>Новая анкета</div>
<div style="font-family:${FONT};font-size:26px;font-weight:bold;line-height:1.25;color:${INK};padding-top:10px;">${esc(p.name)}</div>
<div style="font-family:${FONT};font-size:15px;line-height:1.5;color:${MUTED};padding-top:6px;">${esc(GROUP_NAME[p.group])}<br>${esc(when)} по Нью-Йорку, анкета на ${p.lang === "en" ? "английском" : "русском"}</div>
</td></tr>`;
  const button = itemUrl ? `<tr><td style="padding:22px 40px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#333333" style="border-radius:999px;"><a href="${esc(itemUrl)}" style="display:block;padding:14px 28px;font-family:${FONT};font-weight:bold;font-size:15px;line-height:1;color:#FFFFFF;text-decoration:none;border-radius:999px;">Открыть в monday</a></td></tr></table></td></tr>` : "";
  const rows = head + button + section("Контакты", contacts(p)) + (p.group === "gina" ? ginaBody(p) : simonBody(p)) + `<tr><td style="padding:0 0 36px;"></td></tr>`;
  const foot = `Письмо отправила анкета feedback.qaravan.org/support/${p.group}. Все анкеты — на доске «${BOARD_NAME[p.group]}» в monday.`;
  return { subject, html: shell(subject, rows, foot) };
}

export async function sendSignupEmail(p, itemId) {
  const to = recipients(p.group);
  if (!to.length) return false;
  const boards = { gina: "18433061986", simon: "5469799506" };
  const m = signupEmail(p, { itemUrl: itemId ? `https://qaravan.monday.com/boards/${boards[p.group]}/pulses/${itemId}` : "" });
  await sendEmail(to.join(", "), m.subject, m.html);
  return true;
}
