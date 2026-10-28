// «Копия ваших ответов» — письмо человеку, который отправил анкету, если у нас есть его почта:
// он вписал её в анкету или она известна по подписанной ссылке из нашего письма.
// Вопросы и ответы присылает сама страница (поле `copy` в теле запроса: [{ q, a }, …]) —
// на том языке и в тех формулировках, которые человек видел. Здесь они только чистятся:
// не больше 80 пар, длина ограничена, ссылки в ответах скрыты, чтобы через форму нельзя
// было разослать чужие ссылки от имени info@qaravan.org. Письмо уходит с info@qaravan.org
// (lib/letter-mail.mjs), вёрстка — та же, что у остальных писем (lib/support-mail.mjs).
// Отправка никогда не валит саму анкету: вызывающий код ловит ошибку и пишет её в лог.
import { sendEmail } from "./letter-mail.mjs";
import { frame, section, pairs, eyebrow, text, BODY, HEAD, INK, MUTED } from "./support-mail.mjs";

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const isEmail = (s) => EMAIL_RX.test(String(s || "").trim());

// http(s)://…, www.… и голые домены вида example.com/путь → «[ссылка]»
// (почтовые адреса не трогаем: домен после «@» ссылкой не считается)
const URL_RX = /\b(?:https?:\/\/|www\.)\S+|(?<![@\w.-])[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|ru|io|me|info|biz|xyz|top|link|click|app|site|online|ly|co)\b(?:\/\S*)?/gi;
const LINK_WORD = { ru: "[ссылка]", en: "[link]", uk: "[посилання]", ka: "[ბმული]", uz: "[havola]", kk: "[сілтеме]" };

export function cleanPairs(raw, lang = "ru") {
  if (!Array.isArray(raw)) return [];
  const hide = (s) => s.replace(URL_RX, LINK_WORD[lang] || LINK_WORD.ru);
  return raw.slice(0, 80)
    .map((p) => ({
      q: hide(String(p?.q ?? "").replace(/\s+/g, " ").trim().slice(0, 400)),
      a: hide(String(p?.a ?? "").replace(/[ \t]+/g, " ").trim().slice(0, 3000)),
    }))
    .filter((p) => p.q && p.a);
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
export async function sendAnswersCopy({ to, lang = "ru", form, copy, now = new Date() }) {
  const pairsList = cleanPairs(copy, lang);
  if (!isEmail(to) || !pairsList.length || !form) return false;
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
