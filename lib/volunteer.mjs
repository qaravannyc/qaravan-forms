// POST /api/volunteer — анкета «Стать волонтёром QARAVAN» (volunteer/index.html).
// Своей функции в api/ у анкеты нет: на плане Hobby Vercel не собирает деплой
// больше чем с 12 функциями, поэтому vercel.json переписывает /api/volunteer на
// /api/survey?form=volunteer, а api/survey.mjs сразу отдаёт запрос сюда.
//
// Одна заявка — одна строка на доске monday «Волонтёры — запись на роли»
// (id 18432838181). Названия колонок и меток на этой доске русские: так их
// задала команда (исключение из правила репозитория «структура доски —
// по-английски»). Метки ниже должны СИМВОЛ В СИМВОЛ совпадать с доской, иначе
// monday наплодит дубликаты. Исключение — месяцы: их метки («Октябрь 2026»)
// создаются сами (create_labels_if_missing), поэтому список месяцев в анкете
// продлевается без правок доски.
//
// Клиент шлёт короткие коды (роли, частота, «был(а) на событиях», месяцы как
// "2026-10"); здесь они переводятся в метки. Остальное — текстом как есть.
import { monday } from "./letter-board.mjs";

export const BOARD = "18432838181";
export const GROUP = "topics"; // «Заявки»

// Column ids on the board. If a column is deleted and re-created its id
// changes and must be updated here.
export const C = {
  pronouns: "pronouns",    // Местоимения (text)
  telegram: "telegram",    // Telegram (text)
  instagram: "instagram",  // Instagram (text)
  phone: "phone",          // Телефон (phone)
  email: "email",          // Email (email)
  roles: "roles",          // Роли (dropdown, several)
  months: "months",        // Месяцы (dropdown, several)
  frequency: "frequency",  // Как часто готов(а) помогать (status)
  attended: "attended",    // Был(а) на наших событиях? (status)
  notes: "notes",          // Комментарий (long text)
  status: "app_status",    // Статус заявки (status): Новая → Связались → …
};

export const ROLES = { lead: "Event lead", planner: "Planner", maker: "Maker", publisher: "Publisher", promoter: "Promoter", keeper: "Keeper" };
export const FREQ = { monthly: "Каждый месяц", bimonthly: "Раз в пару месяцев", flexible: "По возможности" };
export const ATTENDED = { yes: "Да", no: "Нет" };
export const STATUS_NEW = "Новая";
export const RU_MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

const MONTH_RX = /^(20\d\d)-(0[1-9]|1[0-2])$/;
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// "2026-10" → "Октябрь 2026" (метка на доске)
export function monthLabel(code) {
  const m = MONTH_RX.exec(code);
  return m ? `${RU_MONTHS[+m[2] - 1]} ${m[1]}` : null;
}

function monthIndex(code) {
  const m = MONTH_RX.exec(code);
  return m ? +m[1] * 12 + (+m[2] - 1) : null;
}

// Текущий месяц по Нью-Йорку, как индекс год*12+месяц.
export function currentMonthIndex(now = new Date()) {
  const ym = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit" }).format(now);
  return monthIndex(ym.slice(0, 7));
}

// Анкета предлагает шесть месяцев начиная со следующего. Принимаем с запасом —
// от прошлого месяца до года вперёд, — а всё остальное отбрасываем, чтобы
// на доске не появлялись случайные метки.
export function monthAllowed(code, now = new Date()) {
  const i = monthIndex(code);
  if (i == null) return false;
  const cur = currentMonthIndex(now);
  return i >= cur - 1 && i <= cur + 12;
}

// Коды стран по телефонному префиксу — для флажка в колонке «Телефон».
// Самые частые для сообщества; неизвестный префикс не ломает заявку
// (номер тогда остаётся только в апдейте).
const DIAL = {
  1: "US", 7: "RU", 20: "EG", 27: "ZA", 30: "GR", 31: "NL", 32: "BE", 33: "FR", 34: "ES", 36: "HU", 39: "IT", 40: "RO", 41: "CH", 43: "AT",
  44: "GB", 45: "DK", 46: "SE", 47: "NO", 48: "PL", 49: "DE", 52: "MX", 54: "AR", 55: "BR", 57: "CO", 61: "AU", 62: "ID", 63: "PH",
  64: "NZ", 66: "TH", 81: "JP", 82: "KR", 84: "VN", 86: "CN", 90: "TR", 91: "IN", 212: "MA", 351: "PT", 353: "IE", 354: "IS", 358: "FI",
  359: "BG", 370: "LT", 371: "LV", 372: "EE", 373: "MD", 374: "AM", 375: "BY", 380: "UA", 381: "RS", 382: "ME", 385: "HR", 386: "SI",
  420: "CZ", 421: "SK", 971: "AE", 972: "IL", 992: "TJ", 993: "TM", 994: "AZ", 995: "GE", 996: "KG", 998: "UZ",
};

// Телефон: от 10 до 15 цифр, как в остальных формах. Без «+» десять цифр —
// номер США. Возвращает { e164, country } или null, если номер не похож на номер.
export function normPhone(raw) {
  const s = String(raw || "").trim();
  let d = s.replace(/\D/g, "");
  if (d.length < 10 || d.length > 15) return null;
  if (!s.startsWith("+") && !s.startsWith("00") && d.length === 10) d = "1" + d;
  if (!s.startsWith("+") && d.length === 11 && d[0] === "8") d = "7" + d.slice(1); // 8 916 … — российский формат
  if (s.startsWith("00")) d = d.slice(2);
  if (d.length < 10) return null;
  let country = null;
  for (const n of [3, 2, 1]) if (DIAL[+d.slice(0, n)]) { country = DIAL[+d.slice(0, n)]; break; }
  if (country === "RU" && d[1] === "7") country = "KZ"; // +7 7xx — Казахстан
  return { e164: "+" + d, country };
}

// Ник: «@name», «name», «t.me/name», «https://instagram.com/name/» → «@name».
// Если это не похоже на ник (например, человек вписал телефон), оставляем как есть.
export function normHandle(raw, kind) {
  let s = String(raw || "").trim().slice(0, 100);
  if (!s) return "";
  s = s.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  const host = kind === "telegram" ? /^(t\.me|telegram\.me)\//i : /^(instagram\.com|instagr\.am)\//i;
  s = s.replace(host, "").replace(/[/?#].*$/, "").replace(/^@+/, "");
  const ok = kind === "telegram" ? /^[A-Za-z0-9_]{3,32}$/ : /^[A-Za-z0-9._]{1,30}$/;
  return ok.test(s) ? "@" + s : String(raw).trim().slice(0, 100);
}

const text = (v, max) => String(v ?? "").replace(/\s+/g, (m) => (m.includes("\n") ? m : " ")).trim().slice(0, max);
const uniq = (arr) => [...new Set(arr)];

// Разбор и проверка тела запроса. Возвращает { ok, fields: [...ошибочные поля], a }.
export function parseApplication(b, now = new Date()) {
  const a = {
    name: text(b.name, 120).replace(/\n/g, " "),
    pronouns: text(b.pronouns, 60).replace(/\n/g, " "),
    telegram: normHandle(b.telegram, "telegram"),
    instagram: normHandle(b.instagram, "instagram"),
    phoneRaw: text(b.phone, 40),
    phone: normPhone(b.phone),
    email: text(b.email, 200).toLowerCase(),
    roles: uniq((Array.isArray(b.roles) ? b.roles : []).map(String)).filter((r) => ROLES[r]),
    months: uniq((Array.isArray(b.months) ? b.months : []).map(String)).filter((m) => monthAllowed(m, now)).sort(),
    frequency: FREQ[b.frequency] ? b.frequency : "",
    attended: ATTENDED[b.attended] ? b.attended : "",
    notes: text(b.notes, 4000),
    lang: b.lang === "en" ? "en" : "ru",
  };
  const fields = [];
  if (!a.name) fields.push("name");
  if (!a.phone) fields.push("phone");
  if (!EMAIL_RX.test(a.email)) fields.push("email");
  if (!a.roles.length) fields.push("roles");
  if (!a.months.length) fields.push("months");
  return { ok: fields.length === 0, fields, a };
}

// Ответы → значения колонок monday (только заполненные).
export function columnValues(a, { withPhone = true } = {}) {
  const cv = {
    [C.pronouns]: a.pronouns,
    [C.telegram]: a.telegram,
    [C.instagram]: a.instagram,
    [C.email]: { email: a.email, text: a.email },
    [C.roles]: { labels: a.roles.map((r) => ROLES[r]) },
    [C.months]: { labels: a.months.map(monthLabel) },
    [C.status]: { label: STATUS_NEW },
  };
  if (withPhone && a.phone?.country) cv[C.phone] = { phone: a.phone.e164, countryShortName: a.phone.country };
  if (a.frequency) cv[C.frequency] = { label: FREQ[a.frequency] };
  if (a.attended) cv[C.attended] = { label: ATTENDED[a.attended] };
  if (a.notes) cv[C.notes] = { text: a.notes };
  for (const k of Object.keys(cv)) if (cv[k] === "") delete cv[k];
  return cv;
}

// Полный текст заявки — апдейтом в карточку: так его видно целиком, даже если
// какая-то колонка не приняла значение.
export function updateText(a) {
  const lines = [
    `Заявка с формы feedback.qaravan.org/volunteer · язык формы: ${a.lang.toUpperCase()}`,
    "",
    `Имя: ${a.name}`,
    a.pronouns && `Местоимения: ${a.pronouns}`,
    a.telegram && `Telegram: ${a.telegram}`,
    a.instagram && `Instagram: ${a.instagram}`,
    `Телефон: ${a.phone?.country ? a.phone.e164 : a.phoneRaw}`,
    `Email: ${a.email}`,
    `Роли: ${a.roles.map((r) => ROLES[r]).join(", ")}`,
    `Месяцы: ${a.months.map(monthLabel).join(", ")}`,
    a.frequency && `Как часто: ${FREQ[a.frequency]}`,
    a.attended && `Был(а) на наших событиях: ${ATTENDED[a.attended]}`,
    a.notes && `\nКомментарий:\n${a.notes}`,
  ];
  return lines.filter((l) => l !== "" && l != null && l !== false).join("\n").slice(0, 9500);
}

async function createItem(a, withPhone) {
  const d = await monday(
    `mutation ($b: ID!, $g: String!, $n: String!, $v: JSON!) { create_item(board_id:$b, group_id:$g, item_name:$n, column_values:$v, create_labels_if_missing:true) { id } }`,
    { b: BOARD, g: GROUP, n: a.name, v: JSON.stringify(columnValues(a, { withPhone })) }
  );
  return d.create_item.id;
}

export async function volunteerHandler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.statusCode = 405; return res.end("{}"); }

  const chunks = []; for await (const c of req) chunks.push(c);
  let b;
  try { b = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { res.statusCode = 400; return res.end("{}"); }
  if (!b || typeof b !== "object") { res.statusCode = 400; return res.end("{}"); }

  // Honeypot: боты заполняют скрытое поле — вежливо соглашаемся и ничего не пишем.
  if (b.website) return res.end('{"ok":true}');

  const { ok, fields, a } = parseApplication(b);
  if (!ok) { res.statusCode = 400; return res.end(JSON.stringify({ error: "invalid", fields })); }

  let itemId;
  try {
    itemId = await createItem(a, true);
  } catch (e) {
    // Телефон — самое капризное значение для monday. Если строка не создалась,
    // пробуем ещё раз без него: номер всё равно будет в апдейте.
    console.error("volunteer create failed, retrying without phone:", e.message);
    try { itemId = await createItem(a, false); }
    catch (e2) {
      console.error("volunteer create failed:", e2.message);
      res.statusCode = 502; return res.end("{}");
    }
  }
  await monday(`mutation ($i: ID!, $t: String!) { create_update(item_id:$i, body:$t) { id } }`, { i: String(itemId), t: updateText(a) })
    .catch((e) => console.error("volunteer update failed:", e.message)); // заявка уже на доске — не валим отправку
  return res.end('{"ok":true}');
}
