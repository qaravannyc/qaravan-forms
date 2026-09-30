// POST /api/support-groups — анкеты групп поддержки (support/gina.html, support/simon.html).
// Своей функции в api/ у анкет нет: на плане Hobby Vercel не собирает деплой
// больше чем с 12 функциями, поэтому vercel.json переписывает /api/support-groups на
// /api/survey?form=support-groups, а api/survey.mjs сразу отдаёт запрос сюда.
//
// Одна анкета — одна строка на доске группы плюс апдейт с полным текстом ответов:
//  • gina  — «Support Group with Gina — Sign-ups» (id 18433061986), группа «New sign-ups».
//    Доску сделали под эту анкету; история из старого Typeform (dbH75jNe, 2023–2026)
//    лежит там же, в группе «Typeform sign-ups, 2023–2026».
//  • simon — «Группа равной поддержки с Саймоном: регистрация на участие» (id 5469799506).
//    Старая доска со старой формой monday: колонки названы по-русски ещё до правила
//    «структура доски — по-английски», их не переименовываем. Анкета пишет в те же
//    колонки, что и форма monday, поэтому автоматизация доски (письмо Эзре о новой
//    регистрации) продолжает работать.
//
// Клиент шлёт короткие коды (местоимения, да/нет, идентичности, формат встреч);
// здесь они переводятся в метки. Метки должны СИМВОЛ В СИМВОЛ совпадать с доской,
// иначе monday откажет или наплодит дубликаты. Остальное — текстом как есть.
import { monday } from "./letter-board.mjs";
import { normPhone, normHandle } from "./event-volunteers.mjs";
import { sendSignupEmail } from "./support-mail.mjs";
import { lookupPerson, withoutItem, dossierText } from "./person-lookup.mjs";

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const text = (v, max) => String(v ?? "").replace(/\s+/g, (m) => (m.includes("\n") ? m : " ")).trim().slice(0, max);
const line = (v, max) => text(v, max).replace(/\n/g, " ");
const YES_NO = { yes: "Yes", no: "No" };

// ---- Джина -------------------------------------------------------------------

// Местоимения — текстом, как их писал Typeform: так старые и новые строки выглядят одинаково.
export const PRONOUNS = { she: "Она/Её", he: "Он/Его", they: "Они/Их" };
export const IN_US = { yes: "Yes", partly: "Not exactly" };
// «Что вам сейчас нужнее всего?» — метки колонки Needs (dropdown). Список и порядок —
// из ответов на старый Typeform 2023–2026 про «три главные потребности» (только люди
// в США, 82 ответа, темы размечены вручную): сначала то, что называли чаще всего.
// Порядок здесь не важен — его задаёт анкета (support/app.js, FORMS.gina).
export const NEEDS = {
  talk: "Talking with people", mental: "Psychological help", support: "Support & understanding", friends: "Friends & new people",
  growth: "Growth & learning", work: "Work", calm: "Calm, less anxiety", acceptance: "Self-acceptance",
  belonging: "Community & belonging", money: "Money & steady income", legal: "Papers & legal status", safety: "Safety",
  health: "Health", love: "Relationships & love", housing: "Housing", adaptation: "Settling in",
  loneliness: "Feeling less alone", basics: "Food & basics", family: "Family relationships",
  other: "Something else", // своими словами — в колонке «Needs — in their words»
};
export const NEEDS_MAX = 3;

const GINA = {
  board: "18433061986",
  group: "topics", // New sign-ups
  // Column ids on the board. If a column is deleted and re-created its id
  // changes and must be updated here.
  C: {
    status: "sg_status",     // Status: New → Contacted → Intro call done → Joined / Not now
    submitted: "submitted",  // Submitted (date + time, UTC)
    pronouns: "pronouns",    // Pronouns (text)
    email: "email",          // Email
    phone: "phone",          // Phone
    telegram: "telegram",    // Telegram (text, optional)
    instagram: "instagram",  // Instagram (text, optional)
    inUs: "in_us",           // Russian-speaking LGBTQ+ in the US: Yes | Not exactly
    inUsNote: "in_us_note",  // Community / US — details (text)
    regular: "regular",      // Will attend regularly: Yes | No
    // immig_mh (Interested: immigration & mental health) — только в старых ответах: с 30.09.2026 анкета об этом не спрашивает
    intro: "intro_call",     // OK with 15-min intro call: Yes | No
    rules: "rules",          // Agrees to rules & confidentiality: Yes | No
    expect: "expect",        // Expectations (long text)
    needsPick: "needs_pick", // Needs (dropdown, up to three)
    needs: "needs",          // Needs — in their words (long text)
    notes: "notes",          // Anything else (long text)
    source: "source",        // Source: feedback.qaravan.org | Typeform
    lang: "form_lang",       // Form language: RU | EN
  },
  parse(b) {
    const a = {
      pronouns: PRONOUNS[b.pronouns] ? PRONOUNS[b.pronouns] : b.pronouns === "other" ? line(b.pronouns_other, 60) : "",
      inUs: IN_US[b.in_us] ? b.in_us : "",
      inUsNote: b.in_us === "partly" ? line(b.in_us_note, 1000) : "",
      regular: YES_NO[b.regular] ? b.regular : "",
      intro: YES_NO[b.intro] ? b.intro : "",
      rules: b.rules === true,
      expect: text(b.expect, 4000),
      needs: [...new Set((Array.isArray(b.needs) ? b.needs : []).map(String))].filter((x) => NEEDS[x]).slice(0, NEEDS_MAX),
      needsText: "",
      notes: text(b.notes, 4000),
    };
    const bad = [];
    if (!a.pronouns) bad.push(b.pronouns === "other" ? "pronouns_other" : "pronouns");
    if (!a.inUs) bad.push("in_us");
    if (a.inUs === "partly" && !a.inUsNote) bad.push("in_us_note");
    for (const k of ["regular", "intro"]) if (!a[k]) bad.push(k);
    if (!a.rules) bad.push("rules");
    if (!a.expect) bad.push("expect");
    if (a.needs.includes("other")) a.needsText = text(b.needs_text, 2000); // «Другое» — тогда своими словами
    if (!a.needs.length) bad.push("needs");
    else if (a.needs.includes("other") && !a.needsText) bad.push("needs_text");
    return { a, bad };
  },
  columns(p, now) {
    const { C } = GINA, a = p.a;
    const iso = now.toISOString();
    const cv = {
      [C.status]: { label: "New" },
      [C.submitted]: { date: iso.slice(0, 10), time: iso.slice(11, 19) },
      [C.pronouns]: a.pronouns,
      [C.inUs]: { label: IN_US[a.inUs] },
      [C.inUsNote]: a.inUsNote,
      [C.regular]: { label: YES_NO[a.regular] },
      [C.intro]: { label: YES_NO[a.intro] },
      [C.rules]: { label: "Yes" },
      [C.expect]: { text: a.expect },
      [C.source]: { label: "feedback.qaravan.org" },
      [C.lang]: { label: p.lang.toUpperCase() },
    };
    if (a.needs.length) cv[C.needsPick] = { labels: a.needs.map((x) => NEEDS[x]) };
    if (a.needsText) cv[C.needs] = { text: a.needsText };
    if (a.notes) cv[C.notes] = { text: a.notes };
    return { cv, email: C.email, phone: C.phone, telegram: C.telegram, instagram: C.instagram };
  },
  update(p) {
    const a = p.a, yn = (v) => (v === "yes" ? "да" : "нет");
    return [
      `Местоимения: ${a.pronouns}`,
      `Русскоязычный ЛГБТК+ человек в США: ${a.inUs === "yes" ? "да" : "не совсем"}${a.inUsNote ? ` — ${a.inUsNote}` : ""}`,
      `Будет ходить регулярно: ${yn(a.regular)}`,
      `Готов(а) к 15-минутному знакомству в Zoom: ${yn(a.intro)}`,
      "Обещает соблюдать правила группы: да",
      `\nЧего ждёт от группы:\n${a.expect}`,
      `\nЧто нужнее всего: ${a.needs.map((x) => NEEDS[x]).join(", ")}`,
      a.needsText && `Другое, своими словами:\n${a.needsText}`,
      a.notes && `\nЧто ещё важно знать:\n${a.notes}`,
    ];
  },
};

// ---- Саймон ------------------------------------------------------------------

// Метки колонки «В плане сексуальной ориентации и гендерной идентичности…» (dropdown).
export const IDENTITIES = {
  agender: "Agender", asexual: "Asexual", bisexual: "Bisexual", cisgender: "Cisgender", demisexual: "Demisexual",
  gay_lesbian: "Gay / Lesbian", genderfluid: "Genderfluid", genderqueer: "Genderqueer", heterosexual: "Heterosexual",
  nonbinary: "Nonbinary", pansexual: "Pansexual", queer: "Queer", transgender: "Transgender", prefer_not: "Prefer not to say",
};
// Метки колонки «Как, в идеале, вы хотели бы встречаться…» (status).
export const FORMAT = { remote: "Remote only", in_person: "In-person only", both: "Remote and in-person" };
const FORMAT_RU = { remote: "только онлайн", in_person: "только вживую", both: "и так, и так" };

const SIMON = {
  board: "5469799506",
  group: "new_group", // Website submissions | Participant Sign Up for peer to peer support group
  C: {
    phone: "phone_2",         // Телефон
    email: "email_2",         // Электронная почта
    telegram: "telegram",     // Telegram (text, добавлена для этой анкеты)
    instagram: "instagram",   // Instagram (text, добавлена для этой анкеты)
    city: "short_text39",     // Где вы живете (город, штат)?
    identities: "multi_select", // В плане сексуальной ориентации и гендерной идентичности вы определяете себя как…
    format: "color",          // Как, в идеале, вы хотели бы встречаться — онлайн или лично?
    question: "long_text",    // Какой вопрос вы хотели бы задать на группе?
    notes: "long_text7",      // Что-то еще, чем вы хотели бы поделиться?
  },
  parse(b) {
    let ids = [...new Set((Array.isArray(b.identities) ? b.identities : []).map(String))].filter((x) => IDENTITIES[x]);
    if (ids.includes("prefer_not")) ids = ["prefer_not"]; // «Предпочитаю не отвечать» — отдельно от остальных
    const a = {
      city: line(b.city, 200),
      identities: ids,
      format: FORMAT[b.format] ? b.format : "",
      question: text(b.question, 4000),
      notes: text(b.notes, 4000),
    };
    return { a, bad: a.city ? [] : ["city"] };
  },
  columns(p) {
    const { C } = SIMON, a = p.a;
    const cv = { [C.city]: a.city };
    if (a.identities.length) cv[C.identities] = { labels: a.identities.map((x) => IDENTITIES[x]) };
    if (a.format) cv[C.format] = { label: FORMAT[a.format] };
    if (a.question) cv[C.question] = { text: a.question };
    if (a.notes) cv[C.notes] = { text: a.notes };
    return { cv, email: C.email, phone: C.phone, telegram: C.telegram, instagram: C.instagram };
  },
  update(p) {
    const a = p.a;
    return [
      `Где живёт: ${a.city}`,
      a.identities.length && `Как себя определяет: ${a.identities.map((x) => IDENTITIES[x]).join(", ")}`,
      a.format && `Как удобнее встречаться: ${FORMAT_RU[a.format]}`,
      a.question && `\nВопрос для группы:\n${a.question}`,
      a.notes && `\nЧем ещё хочет поделиться:\n${a.notes}`,
    ];
  },
};

export const GROUPS = { gina: GINA, simon: SIMON };

// Разбор и проверка тела запроса. Возвращает { ok, fields: [...ошибочные поля], p }.
export function parseSignup(b) {
  const g = GROUPS[b?.group];
  if (!g) return { ok: false, fields: ["group"], p: null };
  const p = {
    group: b.group,
    name: line(b.name, 120),
    email: text(b.email, 200).toLowerCase(),
    phoneRaw: line(b.phone, 40),
    phone: normPhone(b.phone),
    telegram: normHandle(b.telegram, "telegram"),
    instagram: normHandle(b.instagram, "instagram"),
    lang: b.lang === "en" ? "en" : "ru",
  };
  const { a, bad } = g.parse(b);
  p.a = a;
  const fields = [];
  if (!p.name) fields.push("name");
  if (!EMAIL_RX.test(p.email)) fields.push("email");
  if (!p.phone) fields.push("phone");
  fields.push(...bad);
  return { ok: fields.length === 0, fields, p };
}

// Ответы → значения колонок monday (только заполненные).
export function columnValues(p, { withPhone = true, now = new Date() } = {}) {
  const { cv, email, phone, telegram, instagram } = GROUPS[p.group].columns(p, now);
  cv[email] = { email: p.email, text: p.email };
  cv[telegram] = p.telegram;
  cv[instagram] = p.instagram;
  if (withPhone && p.phone?.country) cv[phone] = { phone: p.phone.e164, countryShortName: p.phone.country };
  for (const k of Object.keys(cv)) if (cv[k] === "") delete cv[k];
  return cv;
}

// Полный текст анкеты — апдейтом в карточку: так его видно целиком, даже если
// какая-то колонка не приняла значение.
export function updateText(p, known) {
  const lines = [
    `Анкета с формы feedback.qaravan.org/support/${p.group}, язык формы: ${p.lang.toUpperCase()}`,
    "",
    `Имя: ${p.name}`,
    `Email: ${p.email}`,
    `Телефон: ${p.phone?.country ? p.phone.e164 : p.phoneRaw}`,
    p.telegram && `Telegram: ${p.telegram}`,
    p.instagram && `Instagram: ${p.instagram}`,
    ...GROUPS[p.group].update(p),
  ];
  let out = lines.filter((l) => l !== "" && l != null && l !== false).join("\n");
  if (known) out += `\n\n${dossierText(known, { group: p.group })}`;
  return out.slice(0, 9500);
}

async function createItem(p, withPhone) {
  const g = GROUPS[p.group];
  const d = await monday(
    `mutation ($b: ID!, $g: String!, $n: String!, $v: JSON!) { create_item(board_id:$b, group_id:$g, item_name:$n, column_values:$v) { id } }`,
    { b: g.board, g: g.group, n: p.name, v: JSON.stringify(columnValues(p, { withPhone })) }
  );
  return d.create_item.id;
}

export async function supportGroupsHandler(req, res) {
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

  const { ok, fields, p } = parseSignup(b);
  if (!ok) { res.statusCode = 400; return res.end(JSON.stringify({ error: "invalid", fields })); }

  // Что о человеке уже есть в monday (lib/person-lookup.mjs) — ищем, пока создаётся строка:
  // это попадёт в апдейт и в письмо команде. Ошибка или таймаут поиска анкету не валят.
  const g = GROUPS[p.group];
  const lookup = lookupPerson(p, { group: { board: g.board, email: g.C.email, status: g.C.status, submitted: g.C.submitted } });
  let itemId;
  try {
    itemId = await createItem(p, true);
  } catch (e) {
    // Телефон — самое капризное значение для monday. Если строка не создалась,
    // пробуем ещё раз без него: номер всё равно будет в апдейте.
    console.error(`support group (${p.group}) create failed, retrying without phone:`, e.message);
    try { itemId = await createItem(p, false); }
    catch (e2) {
      console.error(`support group (${p.group}) create failed:`, e2.message);
      res.statusCode = 502; return res.end("{}");
    }
  }
  const known = withoutItem(await lookup, itemId);
  await monday(`mutation ($i: ID!, $t: String!) { create_update(item_id:$i, body:$t) { id } }`, { i: String(itemId), t: updateText(p, known) })
    .catch((e) => console.error(`support group (${p.group}) update failed:`, e.message)); // анкета уже на доске — не валим отправку
  // письмо команде (lib/support-mail.mjs); если не ушло — анкета всё равно на доске
  await sendSignupEmail(p, itemId, known).catch((e) => console.error(`support group (${p.group}) email failed:`, e.message));
  return res.end('{"ok":true}');
}
