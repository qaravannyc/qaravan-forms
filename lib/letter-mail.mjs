// Emails for the letter intake form, sent from info@qaravan.org through the
// Gmail API with the same GOOGLE_* refresh token the photo upload uses (scope
// gmail.send is part of tools/google-auth.mjs). Two emails, both in the
// language the person filled the form in:
//   resume — right after the contact step: the personal link that reopens the draft anywhere
//   submit — after Submit: confirmation
// Missing Google credentials → the send throws and the caller logs it; the form keeps working.
// Layout: the QARAVAN design system, 2026-09 revision, like the other emails (lib/support-mail.mjs,
// lib/meetings.mjs): white page, a 560px column at the left, the official wordmark, ink text on
// white, a square ink button, links in ink with a 2px sky underline, no rounded corners or tints.
// esc is shared with the support group notifications (lib/support-mail.mjs).
const FROM = process.env.MAIL_FROM || "QARAVAN <info@qaravan.org>";
// Tokens of the design system: q-ink, q-muted, q-line, q-sky. Gmail loads no web fonts, so both
// faces fall back to Helvetica/Arial of normal width (no Arial Narrow: it squeezes headlines).
const INK = "#333333", MUTED = "#5e5a53", SKY = "#0099cc";
const BODY = `'Fira Sans','Helvetica Neue',Helvetica,Arial,sans-serif`;
const HEAD = `'Fira Sans Condensed','Fira Sans','Helvetica Neue',Helvetica,Arial,sans-serif`;
const LOGO = `<img src="https://feedback.qaravan.org/logo-email.png" width="140" height="26" alt="qaravan" style="display:block;border:0;outline:none;text-decoration:none;width:140px;height:auto;">`;
export const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function accessToken() {
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID || "", client_secret: process.env.GOOGLE_CLIENT_SECRET || "", refresh_token: process.env.GOOGLE_REFRESH_TOKEN || "", grant_type: "refresh_token", scope: "https://www.googleapis.com/auth/gmail.send" }) });
  const j = await r.json();
  if (!j.access_token) throw new Error("Google auth failed: " + JSON.stringify(j).slice(0, 200));
  return j.access_token;
}
export const MAIL_FROM = FROM;
// Готовое письмо целиком (MIME) — когда в нём своя картинка или текстовая часть
// (приглашение подписать Соглашение, lib/agreement-invite.mjs).
export async function sendMime(to, mime) {
  if (!process.env.GOOGLE_REFRESH_TOKEN) throw new Error("GOOGLE_REFRESH_TOKEN is not set");
  const token = await accessToken();
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ raw: Buffer.from(mime).toString("base64url") }) });
  if (!res.ok) throw new Error(`Gmail send to ${to}: ${res.status} ${await res.text()}`);
}
export async function sendEmail(to, subject, html) {
  if (!process.env.GOOGLE_REFRESH_TOKEN) throw new Error("GOOGLE_REFRESH_TOKEN is not set");
  const token = await accessToken();
  const raw = Buffer.from([`From: ${FROM}`, `To: ${to}`, `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`, "MIME-Version: 1.0", "Content-Type: text/html; charset=UTF-8", "", html].join("\r\n")).toString("base64url");
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ raw }) });
  if (!res.ok) throw new Error(`Gmail send to ${to}: ${res.status} ${await res.text()}`);
}

const T = {
  en: { hi: (n) => (n ? `Hi ${n},` : "Hi,"),
    rSubject: "Your link to continue the QARAVAN letter form", rTitle: "Your answers are saved", rBody: "Open this link on any device to pick up where you stopped. Keep it to yourself: it opens your answers.", rBtn: "Continue the form",
    sSubject: "We have everything to start your letter", sTitle: "Thank you. We have everything to start.", sBody: "We'll read your answers and start the letter. If something is unclear, we'll write or call.", luck: "Best of luck!", foot: "You're getting this because you filled in the QARAVAN support letter form. Questions: info@qaravan.org" },
  ru: { hi: (n) => (n ? `Привет, ${n}!` : "Привет!"),
    rSubject: "Ссылка, чтобы продолжить анкету QARAVAN", rTitle: "Ваши ответы сохранены", rBody: "Откройте эту ссылку на любом устройстве и продолжите с того места, где остановились. Никому её не пересылайте: по ней открываются ваши ответы.", rBtn: "Продолжить анкету",
    sSubject: "У нас есть всё, чтобы начать ваше письмо", sTitle: "Спасибо. У нас есть всё, чтобы начать.", sBody: "Мы прочитаем ответы и начнём писать письмо. Если что-то будет неясно, напишем или позвоним.", luck: "Удачи!", foot: "Это письмо пришло, потому что вы заполнили анкету на письмо поддержки от QARAVAN. Вопросы: info@qaravan.org" },
  uk: { hi: (n) => (n ? `Привіт, ${n}!` : "Привіт!"),
    rSubject: "Посилання, щоб продовжити анкету QARAVAN", rTitle: "Ваші відповіді збережено", rBody: "Відкрийте це посилання на будь-якому пристрої й продовжте з того місця, де зупинилися. Нікому його не пересилайте: за ним відкриваються ваші відповіді.", rBtn: "Продовжити анкету",
    sSubject: "У нас є все, щоб почати ваш лист", sTitle: "Дякуємо. У нас є все, щоб почати.", sBody: "Ми прочитаємо відповіді й почнемо писати лист. Якщо щось буде незрозуміло, напишемо або подзвонимо.", luck: "Успіхів!", foot: "Цей лист надійшов, бо ви заповнили анкету на лист підтримки від QARAVAN. Запитання: info@qaravan.org" },
  ka: { hi: (n) => (n ? `გამარჯობა, ${n}!` : "გამარჯობა!"),
    rSubject: "ბმული QARAVAN-ის ფორმის გასაგრძელებლად", rTitle: "თქვენი პასუხები შენახულია", rBody: "გახსენით ეს ბმული ნებისმიერ მოწყობილობაზე და გააგრძელეთ იქიდან, სადაც შეჩერდით. არავის გაუზიაროთ: ის თქვენს პასუხებს ხსნის.", rBtn: "ფორმის გაგრძელება",
    sSubject: "ყველაფერი გვაქვს თქვენი წერილის დასაწყებად", sTitle: "გმადლობთ. ყველაფერი გვაქვს დასაწყებად.", sBody: "წავიკითხავთ თქვენს პასუხებს და დავიწყებთ წერილს. თუ რამე გაუგებარი იქნება, მოგწერთ ან დაგირეკავთ.", luck: "წარმატებები!", foot: "ეს წერილი მოგივიდათ, რადგან შეავსეთ QARAVAN-ის მხარდაჭერის წერილის ფორმა. კითხვები: info@qaravan.org" },
  uz: { hi: (n) => (n ? `Salom, ${n}!` : "Salom!"),
    rSubject: "QARAVAN anketasini davom ettirish uchun havola", rTitle: "Javoblaringiz saqlandi", rBody: "Bu havolani istalgan qurilmada oching va to‘xtagan joyingizdan davom eting. Uni hech kimga bermang: havola orqali javoblaringiz ochiladi.", rBtn: "Anketani davom ettirish",
    sSubject: "Xatingizni boshlash uchun hamma narsa bor", sTitle: "Rahmat. Boshlash uchun hamma narsa bor.", sBody: "Javoblaringizni o‘qib, xatni yozishni boshlaymiz. Nimadir noaniq bo‘lsa, yozamiz yoki qo‘ng‘iroq qilamiz.", luck: "Omad tilaymiz!", foot: "Bu xat sizga QARAVAN qo‘llab-quvvatlash xati anketasini to‘ldirganingiz uchun keldi. Savollar: info@qaravan.org" },
  kk: { hi: (n) => (n ? `Сәлем, ${n}!` : "Сәлем!"),
    rSubject: "QARAVAN сауалнамасын жалғастыру сілтемесі", rTitle: "Жауаптарыңыз сақталды", rBody: "Осы сілтемені кез келген құрылғыда ашып, тоқтаған жеріңізден жалғастырыңыз. Оны ешкімге бермеңіз: сілтеме сіздің жауаптарыңызды ашады.", rBtn: "Сауалнаманы жалғастыру",
    sSubject: "Хатыңызды бастауға бәрі бар", sTitle: "Рақмет. Бастауға бәрі бар.", sBody: "Жауаптарыңызды оқып, хатты жазуды бастаймыз. Бірдеңе түсініксіз болса, жазамыз немесе хабарласамыз.", luck: "Сәттілік!", foot: "Бұл хат сізге QARAVAN қолдау хатының сауалнамасын толтырғаныңыз үшін келді. Сұрақтар: info@qaravan.org" },
};

// Button md: square, ink, white Fira Sans Condensed 600 17px, 44px tall.
const button = (href, label) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${INK}" style="background:${INK};"><a href="${esc(href)}" style="display:block;padding:12px 18px;font-family:${HEAD};font-weight:600;font-size:17px;line-height:1.15;letter-spacing:.01em;color:#FFFFFF;text-decoration:none;">${esc(label)}</a></td></tr></table>`;
function shell(title, rows, foot, lang) {
  return `<!doctype html><html lang="${esc(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light">
<link href="https://fonts.googleapis.com/css2?family=Fira+Sans:wght@400;600;700&family=Fira+Sans+Condensed:wght@600;700&display=swap" rel="stylesheet"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#FFFFFF;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FFFFFF;"><tr><td style="padding:32px 20px 48px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;width:100%;"><tr><td style="padding:0 0 32px;">${LOGO}</td></tr>${rows}
<tr><td style="padding:48px 0 0;font-family:${BODY};font-size:15px;line-height:1.4;color:${MUTED};">${esc(foot)}</td></tr>
<tr><td style="padding:12px 0 0;"><a href="https://qaravan.org" style="font-family:${BODY};font-size:15px;font-weight:600;color:${INK};text-decoration:underline;text-decoration-color:${SKY};text-decoration-thickness:2px;text-underline-offset:4px;">qaravan.org</a></td></tr></table>
</td></tr></table></body></html>`;
}
const P = (t, extra = "") => `<div style="font-family:${BODY};font-size:16px;line-height:1.5;color:${INK};${extra}">${t}</div>`;
const H = (t) => `<div style="font-family:${HEAD};font-size:28px;font-weight:700;line-height:1.12;letter-spacing:-.005em;color:${INK};padding-top:12px;">${t}</div>`;

export function resumeEmail({ name, lang, link }) {
  const t = T[lang] || T.en;
  const rows = `<tr><td>${P(esc(t.hi(name)))}${H(esc(t.rTitle))}${P(esc(t.rBody), "padding-top:12px;")}</td></tr><tr><td style="padding:24px 0 0;">${button(link, t.rBtn)}</td></tr>`;
  return { subject: t.rSubject, html: shell(t.rSubject, rows, t.foot, T[lang] ? lang : "en") };
}
export function submitEmail({ name, lang }) {
  const t = T[lang] || T.en;
  const rows = `<tr><td>${P(esc(t.hi(name)))}${H(esc(t.sTitle))}${P(esc(t.sBody), "padding-top:12px;")}${P(esc(t.luck), "padding-top:16px;font-weight:600;")}</td></tr>`;
  return { subject: t.sSubject, html: shell(t.sSubject, rows, t.foot, T[lang] ? lang : "en") };
}
export async function sendResumeEmail(o) { const m = resumeEmail(o); return sendEmail(o.to, m.subject, m.html); }
export async function sendSubmitEmail(o) { const m = submitEmail(o); return sendEmail(o.to, m.subject, m.html); }
