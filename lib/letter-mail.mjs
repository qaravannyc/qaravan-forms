// Emails for the letter intake form, sent from info@qaravan.org through the
// Gmail API with the same GOOGLE_* refresh token the photo upload uses (scope
// gmail.send is part of tools/google-auth.mjs). Two emails, both in the
// language the person filled the form in:
//   resume — right after the contact step: the personal link that reopens the draft anywhere
//   submit — after Submit: confirmation; if a case document is still owed, the link to add it
// Missing Google credentials → the send throws and the caller logs it; the form keeps working.
const FROM = process.env.MAIL_FROM || "QARAVAN <info@qaravan.org>";
const FONT = `'Montserrat','Avenir Next','Avenir','Century Gothic','Futura','Segoe UI',Roboto,Helvetica,Arial,sans-serif`;
const LOGO = `<img src="https://feedback.qaravan.org/logo-email.png" width="110" height="20" alt="qaravan" style="display:block;border:0;outline:none;text-decoration:none;width:110px;height:auto;">`;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function accessToken() {
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID || "", client_secret: process.env.GOOGLE_CLIENT_SECRET || "", refresh_token: process.env.GOOGLE_REFRESH_TOKEN || "", grant_type: "refresh_token", scope: "https://www.googleapis.com/auth/gmail.send" }) });
  const j = await r.json();
  if (!j.access_token) throw new Error("Google auth failed: " + JSON.stringify(j).slice(0, 200));
  return j.access_token;
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
    sSubject: "We have everything to start your letter", sTitle: "Thank you. We have everything to start.", sBody: "We'll read your answers and start the letter. If something is unclear, we'll write or call.", dTitle: "A case document, whenever you have it", dBody: "You said you'd send a document from your case later. Open this link whenever you have it: the file attaches to your answers automatically.", dBtn: "Add the document", luck: "Best of luck!", foot: "You're getting this because you filled in the QARAVAN support letter form. Questions: info@qaravan.org" },
  ru: { hi: (n) => (n ? `Привет, ${n}!` : "Привет!"),
    rSubject: "Ссылка, чтобы продолжить анкету QARAVAN", rTitle: "Ваши ответы сохранены", rBody: "Откройте эту ссылку на любом устройстве и продолжите с того места, где остановились. Никому её не пересылайте: по ней открываются ваши ответы.", rBtn: "Продолжить анкету",
    sSubject: "У нас есть всё, чтобы начать ваше письмо", sTitle: "Спасибо. У нас есть всё, чтобы начать.", sBody: "Мы прочитаем ответы и начнём писать письмо. Если что-то будет неясно, напишем или позвоним.", dTitle: "Документ из дела — когда будет под рукой", dBody: "Вы написали, что пришлёте документ по делу позже. Откройте эту ссылку, когда он будет под рукой: файл сам добавится к вашим ответам.", dBtn: "Добавить документ", luck: "Удачи!", foot: "Это письмо пришло, потому что вы заполнили анкету на письмо поддержки от QARAVAN. Вопросы: info@qaravan.org" },
  uk: { hi: (n) => (n ? `Привіт, ${n}!` : "Привіт!"),
    rSubject: "Посилання, щоб продовжити анкету QARAVAN", rTitle: "Ваші відповіді збережено", rBody: "Відкрийте це посилання на будь-якому пристрої й продовжте з того місця, де зупинилися. Нікому його не пересилайте: за ним відкриваються ваші відповіді.", rBtn: "Продовжити анкету",
    sSubject: "У нас є все, щоб почати ваш лист", sTitle: "Дякуємо. У нас є все, щоб почати.", sBody: "Ми прочитаємо відповіді й почнемо писати лист. Якщо щось буде незрозуміло, напишемо або подзвонимо.", dTitle: "Документ зі справи — коли буде під рукою", dBody: "Ви написали, що надішлете документ у справі пізніше. Відкрийте це посилання, коли він буде під рукою: файл сам додасться до ваших відповідей.", dBtn: "Додати документ", luck: "Успіхів!", foot: "Цей лист надійшов, бо ви заповнили анкету на лист підтримки від QARAVAN. Запитання: info@qaravan.org" },
  ka: { hi: (n) => (n ? `გამარჯობა, ${n}!` : "გამარჯობა!"),
    rSubject: "ბმული QARAVAN-ის ფორმის გასაგრძელებლად", rTitle: "თქვენი პასუხები შენახულია", rBody: "გახსენით ეს ბმული ნებისმიერ მოწყობილობაზე და გააგრძელეთ იქიდან, სადაც შეჩერდით. არავის გაუზიაროთ: ის თქვენს პასუხებს ხსნის.", rBtn: "ფორმის გაგრძელება",
    sSubject: "ყველაფერი გვაქვს თქვენი წერილის დასაწყებად", sTitle: "გმადლობთ. ყველაფერი გვაქვს დასაწყებად.", sBody: "წავიკითხავთ თქვენს პასუხებს და დავიწყებთ წერილს. თუ რამე გაუგებარი იქნება, მოგწერთ ან დაგირეკავთ.", dTitle: "საქმის დოკუმენტი — როცა ხელთ გექნებათ", dBody: "თქვენ დაწერეთ, რომ საქმის დოკუმენტს მოგვიანებით გამოგზავნიდით. გახსენით ეს ბმული, როცა ხელთ გექნებათ: ფაილი ავტომატურად დაერთვება თქვენს პასუხებს.", dBtn: "დოკუმენტის დამატება", luck: "წარმატებები!", foot: "ეს წერილი მოგივიდათ, რადგან შეავსეთ QARAVAN-ის მხარდაჭერის წერილის ფორმა. კითხვები: info@qaravan.org" },
  uz: { hi: (n) => (n ? `Salom, ${n}!` : "Salom!"),
    rSubject: "QARAVAN anketasini davom ettirish uchun havola", rTitle: "Javoblaringiz saqlandi", rBody: "Bu havolani istalgan qurilmada oching va to‘xtagan joyingizdan davom eting. Uni hech kimga bermang: havola orqali javoblaringiz ochiladi.", rBtn: "Anketani davom ettirish",
    sSubject: "Xatingizni boshlash uchun hamma narsa bor", sTitle: "Rahmat. Boshlash uchun hamma narsa bor.", sBody: "Javoblaringizni o‘qib, xatni yozishni boshlaymiz. Nimadir noaniq bo‘lsa, yozamiz yoki qo‘ng‘iroq qilamiz.", dTitle: "Ish hujjati — qo‘lingizda bo‘lganda", dBody: "Ish bo‘yicha hujjatni keyinroq yuborishingizni yozgan edingiz. Hujjat qo‘lingizda bo‘lganda bu havolani oching: fayl javoblaringizga o‘zi qo‘shiladi.", dBtn: "Hujjat qo‘shish", luck: "Omad tilaymiz!", foot: "Bu xat sizga QARAVAN qo‘llab-quvvatlash xati anketasini to‘ldirganingiz uchun keldi. Savollar: info@qaravan.org" },
  kk: { hi: (n) => (n ? `Сәлем, ${n}!` : "Сәлем!"),
    rSubject: "QARAVAN сауалнамасын жалғастыру сілтемесі", rTitle: "Жауаптарыңыз сақталды", rBody: "Осы сілтемені кез келген құрылғыда ашып, тоқтаған жеріңізден жалғастырыңыз. Оны ешкімге бермеңіз: сілтеме сіздің жауаптарыңызды ашады.", rBtn: "Сауалнаманы жалғастыру",
    sSubject: "Хатыңызды бастауға бәрі бар", sTitle: "Рақмет. Бастауға бәрі бар.", sBody: "Жауаптарыңызды оқып, хатты жазуды бастаймыз. Бірдеңе түсініксіз болса, жазамыз немесе хабарласамыз.", dTitle: "Іс құжаты — қолыңызда болғанда", dBody: "Іс бойынша құжатты кейін жіберемін дедіңіз. Құжат қолыңызда болғанда осы сілтемені ашыңыз: файл жауаптарыңызға өзі қосылады.", dBtn: "Құжат қосу", luck: "Сәттілік!", foot: "Бұл хат сізге QARAVAN қолдау хатының сауалнамасын толтырғаныңыз үшін келді. Сұрақтар: info@qaravan.org" },
};

const button = (href, label) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#333333" style="border-radius:999px;"><a href="${href}" style="display:block;padding:16px 34px;font-family:${FONT};font-weight:bold;font-size:16px;line-height:1;color:#FFFFFF;text-decoration:none;border-radius:999px;">${esc(label)}</a></td></tr></table>`;
function shell(title, rows, foot) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#F1EEE3;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F1EEE3;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background:#FFFDF5;border-radius:16px;"><tr><td style="padding:36px 40px 0;">${LOGO}</td></tr>${rows}</table>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;"><tr><td style="padding:22px 40px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:#6E6E6E;">${esc(foot)}</td></tr>
<tr><td style="padding:20px 40px 8px;"><a href="https://qaravan.org" style="font-family:${FONT};font-weight:900;font-size:15px;color:#333333;text-decoration:none;">qaravan<span style="color:#6E6E6E;">.org</span></a></td></tr></table></td></tr></table></body></html>`;
}
const P = (t, extra = "") => `<div style="font-family:${FONT};font-size:16px;line-height:1.5;color:#333333;${extra}">${t}</div>`;

export function resumeEmail({ name, lang, link }) {
  const t = T[lang] || T.en;
  const rows = `<tr><td style="padding:32px 40px 8px;">${P(esc(t.hi(name)), "padding-bottom:12px;")}<div style="font-family:${FONT};font-weight:bold;font-size:24px;line-height:1.3;color:#333333;">${esc(t.rTitle)}</div>${P(esc(t.rBody), "color:#6E6E6E;padding-top:10px;")}</td></tr><tr><td style="padding:22px 40px 38px;">${button(link, t.rBtn)}</td></tr>`;
  return { subject: t.rSubject, html: shell(t.rSubject, rows, t.foot) };
}
export function submitEmail({ name, lang, link, docLater }) {
  const t = T[lang] || T.en;
  const doc = docLater ? `<tr><td style="padding:0 40px 8px;"><div style="background:#FFFFFF;border-radius:16px;padding:20px;"><div style="font-family:${FONT};font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#C4691A;padding-bottom:10px;">${esc(t.dTitle)}</div>${P(esc(t.dBody), "font-size:15px;padding-bottom:16px;")}${button(link, t.dBtn)}</div></td></tr>` : "";
  const rows = `<tr><td style="padding:32px 40px 8px;">${P(esc(t.hi(name)), "padding-bottom:12px;")}<div style="font-family:${FONT};font-weight:bold;font-size:24px;line-height:1.3;color:#333333;">${esc(t.sTitle)}</div>${P(esc(t.sBody), "color:#6E6E6E;padding-top:10px;padding-bottom:20px;")}</td></tr>${doc}<tr><td style="padding:14px 40px 38px;">${P(`<b>${esc(t.luck)}</b>`)}</td></tr>`;
  return { subject: t.sSubject, html: shell(t.sSubject, rows, t.foot) };
}
export async function sendResumeEmail(o) { const m = resumeEmail(o); return sendEmail(o.to, m.subject, m.html); }
export async function sendSubmitEmail(o) { const m = submitEmail(o); return sendEmail(o.to, m.subject, m.html); }
