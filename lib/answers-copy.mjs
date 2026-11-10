// «Копия ваших ответов» — письмо человеку, который отправил анкету, если у нас есть его почта:
// он вписал её в анкету или она известна по подписанной ссылке из нашего письма.
// Вопросы и ответы присылает сама страница (поле `copy` в теле запроса: [{ q, a }, …]) —
// на том языке и в тех формулировках, которые человек видел. Здесь они только чистятся:
// не больше 80 пар, длина ограничена, ссылки в ответах скрыты, чтобы через форму нельзя
// было разослать чужие ссылки от имени info@qaravan.org. Письмо уходит с info@qaravan.org
// (lib/letter-mail.mjs), вёрстка — та же, что у остальных писем (lib/support-mail.mjs).
// Отправка никогда не валит саму анкету: вызывающий код ловит ошибку и пишет её в лог.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { sendEmail } from "./letter-mail.mjs";
import { frame, section, pairs, eyebrow, text, BODY, HEAD, INK, MUTED } from "./support-mail.mjs";
import { allow, maskEmail } from "./gate.mjs";

// ---------- the questions a copy may carry (audit D3) ----------
// The page sends {q, a}; a copy built from a request that isn't vouched for (see lib/gate.mjs formGate) keeps
// only the pairs whose question is one of the form's own texts, read from the form's own string table here
// (exactly what the page shows), so nobody can make info@qaravan.org send headings of their choosing.
// The URLs are literal so that Vercel bundles the files with the functions.
const norm = (s) => String(s ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, 400);
function leaves(x, out) {
  if (typeof x === "string") { const t = norm(x); if (t) out.add(t); }
  else if (x && typeof x === "object") for (const v of Object.values(x)) leaves(v, out);
  return out;
}
// Run the part of a page that declares its texts (from `start` up to `end`) and collect every string in `expr`.
function texts(url, start, end, expr) {
  try {
    let src = readFileSync(url, "utf8");
    if (start) { const i = src.indexOf(start), j = src.indexOf(end, i + 1); if (i < 0 || j < 0) throw new Error("markers not found"); src = src.slice(i, j); }
    const ctx = vm.createContext({ window: {} });
    return leaves(vm.runInContext(`${src}\n;(${expr})`, ctx, { timeout: 1000 }), new Set());
  } catch (e) { console.error("answers copy: question list unreadable:", String(url).split("/").slice(-2).join("/"), e.message); return new Set(); }
}
const SOURCES = {
  letter: () => texts(new URL("../letter/strings.js", import.meta.url), "", "", "window.QARAVAN_STRINGS"),
  "legal-help": () => texts(new URL("../legal-help/index.html", import.meta.url), "const YN =", "// ===== состояние", "STRINGS"),
  "event-volunteers": () => texts(new URL("../event-volunteers/index.html", import.meta.url), "const STRINGS =", "// ===== состояние", "STRINGS"),
  "support-groups": () => texts(new URL("../support/app.js", import.meta.url), "const COMMON =", "// ===== состояние", "{ COMMON, TEXTS }"),
  feedback: () => new Set([...texts(new URL("../pages/attendee.html", import.meta.url), "const STRINGS =", "const params =", "STRINGS"),
    ...texts(new URL("../pages/multi.html", import.meta.url), "const STRINGS =", "const params =", "STRINGS")]),
};
// labels the pages write as plain words next to the table's own
const EXTRA = ["Telegram", "WhatsApp", "Instagram", "Email"];
const known = new Map();
export function formQuestions(form, more = []) {
  if (!known.has(form)) known.set(form, SOURCES[form] ? SOURCES[form]() : new Set());
  const set = new Set(known.get(form));
  for (const t of [...EXTRA, ...more]) if (norm(t)) set.add(norm(t));
  return set;
}

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const isEmail = (s) => EMAIL_RX.test(String(s || "").trim());

// http(s)://…, www.… и голые домены вида example.com/путь → «[ссылка]»
// (почтовые адреса не трогаем: домен после «@» ссылкой не считается)
const URL_RX = /\b(?:https?:\/\/|www\.)\S+|(?<![@\w.-])[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|ru|io|me|info|biz|xyz|top|link|click|app|site|online|ly|co)\b(?:\/\S*)?/gi;
const LINK_WORD = { ru: "[ссылка]", en: "[link]", uk: "[посилання]", ka: "[ბმული]", uz: "[havola]", kk: "[сілтеме]" };

// questions: optional Set (formQuestions); a pair whose question isn't in it is left out.
export function cleanPairs(raw, lang = "ru", questions = null) {
  if (!Array.isArray(raw)) return [];
  const hide = (s) => s.replace(URL_RX, LINK_WORD[lang] || LINK_WORD.ru);
  let total = 0;
  return raw.slice(0, 80)
    .filter((p) => !questions || questions.has(norm(p?.q)))
    .map((p) => ({
      q: hide(String(p?.q ?? "").replace(/\s+/g, " ").trim().slice(0, 400)),
      a: hide(String(p?.a ?? "").replace(/[ \t]+/g, " ").trim().slice(0, 3000)),
    }))
    .filter((p) => p.q && p.a)
    .filter((p) => (total += p.a.length) <= 20000); // at most 20,000 characters of answers in one email
}

const fmt = (locale, opts) => (d) => { try { return new Intl.DateTimeFormat(locale, { timeZone: "America/New_York", ...opts }).format(d); } catch { return d.toISOString().slice(0, 10); } };
const LONG = { day: "numeric", month: "long", year: "numeric" };
// Языки писем — как у анкет: RU и EN везде, ещё UK, KA, UZ, KK у анкеты на письмо поддержки.
const T = {
  ru: {
    subject: (f) => `Копия ваших ответов: ${f}`,
    eyebrow: "Копия ответов",
    title: "Спасибо! Вот что вы отправили",
    intro: (f, d) => `Это копия анкеты «${f}», которую вы отправили ${d}. Сохраните её, если хотите, отвечать на это письмо не нужно.`,
    answers: "Ваши ответы",
    foot: "Это письмо пришло, потому что этот адрес указали в анкете QARAVAN на feedback.qaravan.org. Если это были не вы, просто удалите письмо. Вопросы: info@qaravan.org",
    date: (d) => new Intl.DateTimeFormat("ru-RU", { timeZone: "America/New_York", day: "numeric", month: "long", year: "numeric" }).format(d).replace(/\s*г\.$/, ""),
  },
  en: {
    subject: (f) => `A copy of your answers: ${f}`,
    eyebrow: "Copy of your answers",
    title: "Thank you! Here’s what you sent",
    intro: (f, d) => `This is a copy of the “${f}” form you sent on ${d}. Keep it if you like; there’s no need to reply.`,
    answers: "Your answers",
    foot: "You’re getting this because this address was entered in a QARAVAN form at feedback.qaravan.org. If that wasn’t you, just delete this email. Questions: info@qaravan.org",
    date: (d) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "long", day: "numeric", year: "numeric" }).format(d),
  },
  uk: {
    subject: (f) => `Копія ваших відповідей: ${f}`,
    eyebrow: "Копія відповідей",
    title: "Дякуємо! Ось що ви надіслали",
    intro: (f, d) => `Це копія анкети «${f}», яку ви надіслали ${d}. Збережіть її, якщо хочете, відповідати на цей лист не потрібно.`,
    answers: "Ваші відповіді",
    foot: "Цей лист надійшов, бо цю адресу вказали в анкеті QARAVAN на feedback.qaravan.org. Якщо це були не ви, просто видаліть лист. Запитання: info@qaravan.org",
    date: fmt("uk-UA", LONG),
  },
  ka: {
    subject: (f) => `თქვენი პასუხების ასლი: ${f}`,
    eyebrow: "პასუხების ასლი",
    title: "გმადლობთ! აი, რა გამოგზავნეთ",
    intro: (f, d) => `ეს არის ფორმის „${f}“ ასლი, რომელიც გამოგზავნეთ ${d}. შეგიძლიათ შეინახოთ, ამ წერილზე პასუხი საჭირო არ არის.`,
    answers: "თქვენი პასუხები",
    foot: "ეს წერილი მოგივიდათ, რადგან ეს მისამართი მიუთითეს QARAVAN-ის ფორმაში feedback.qaravan.org-ზე. თუ ეს თქვენ არ იყავით, უბრალოდ წაშალეთ წერილი. კითხვები: info@qaravan.org",
    date: fmt("ka-GE", LONG),
  },
  uz: {
    subject: (f) => `Javoblaringiz nusxasi: ${f}`,
    eyebrow: "Javoblar nusxasi",
    title: "Rahmat! Mana siz yuborgan javoblar",
    intro: (f, d) => `Bu siz ${d} kuni yuborgan «${f}» anketasining nusxasi. Xohlasangiz, uni saqlab qo‘ying, bu xatga javob berish shart emas.`,
    answers: "Javoblaringiz",
    foot: "Bu xat sizga keldi, chunki bu manzil feedback.qaravan.org saytidagi QARAVAN anketasida ko‘rsatilgan. Agar bu siz bo‘lmasangiz, xatni o‘chirib tashlang. Savollar: info@qaravan.org",
    date: fmt("uz-Latn-UZ", LONG),
  },
  kk: {
    subject: (f) => `Жауаптарыңыздың көшірмесі: ${f}`,
    eyebrow: "Жауаптар көшірмесі",
    title: "Рақмет! Міне, сіз жіберген жауаптар",
    intro: (f, d) => `Бұл сіз ${d} жіберген «${f}» сауалнамасының көшірмесі. Қаласаңыз, оны сақтап қойыңыз, бұл хатқа жауап берудің қажеті жоқ.`,
    answers: "Сіздің жауаптарыңыз",
    foot: "Бұл хат сізге келді, себебі бұл мекенжай feedback.qaravan.org сайтындағы QARAVAN сауалнамасында көрсетілген. Егер бұл сіз болмасаңыз, хатты жойып жіберіңіз. Сұрақтар: info@qaravan.org",
    date: fmt("kk-KZ", LONG),
  },
};

// form — название анкеты на языке письма; pairs — уже очищенные [{q, a}]
export function answersCopyEmail({ lang = "ru", form, pairs: list, now = new Date() }) {
  const t = T[lang] || T.ru;
  const head = `<tr><td>${eyebrow("#7668AA", t.eyebrow)}<div style="font-family:${HEAD};font-size:28px;font-weight:700;line-height:1.12;letter-spacing:-.005em;color:${INK};padding-top:12px;">${text(t.title)}</div>`
    + `<div style="font-family:${BODY};font-size:16px;line-height:1.5;color:${INK};padding-top:12px;">${text(t.intro(form, t.date(now)))}</div></td></tr>`;
  const body = section(t.answers, pairs(list.map((p) => [p.q, text(p.a)])));
  return { subject: t.subject(form), html: frame(t.subject(form), head + body, t.foot, T[lang] ? lang : "ru") };
}

// Отправляет копию, если адрес похож на адрес и есть что прислать. Возвращает true/false.
// questions — список вопросов формы (formQuestions), когда запросу нельзя верить на слово; ip — адрес
// отправителя для ограничения. Не больше 3 копий на один адрес и 10 с одного IP за сутки (в памяти
// экземпляра функции: это тормоз, не жёсткий счётчик).
export async function sendAnswersCopy({ to, lang = "ru", form, copy, now = new Date(), questions = null, ip = "" }) {
  const pairsList = cleanPairs(copy, lang, questions);
  if (!isEmail(to) || !pairsList.length || !form) return false;
  const addr = String(to).trim().toLowerCase();
  if (!allow("copy-to", addr, 3, 864e5) || !allow("copy-ip", ip, 10, 864e5)) { console.error("answers copy: daily cap reached for", maskEmail(addr)); return false; }
  const m = answersCopyEmail({ lang, form: String(form).slice(0, 120), pairs: pairsList, now });
  await sendEmail(String(to).trim(), m.subject, m.html);
  return true;
}

// Для писем команде с теми же ответами (например, копия анкеты /legal-help Эзре).
export function teamCopyEmail({ title, intro, pairs: list }) {
  const head = `<tr><td><div style="font-family:${HEAD};font-size:28px;font-weight:700;line-height:1.12;letter-spacing:-.005em;color:${INK};">${text(title)}</div>`
    + (intro ? `<div style="font-family:${BODY};font-size:15px;line-height:1.4;color:${MUTED};padding-top:8px;">${text(intro)}</div>` : "") + `</td></tr>`;
  return frame(title, head + section("Answers", pairs(list.map((p) => [p.q, text(p.a)]))), "Sent by feedback.qaravan.org", "en");
}
