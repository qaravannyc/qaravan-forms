// POST /api/legal-help — анкета «Вам нужен иммиграционный адвокат?» (legal-help/index.html).
// Ответы — доказательства для заявки QARAVAN в городской фонд юридической помощи
// ЛГБТК+ иммигрантам (LGBT Immigrant Legal Services Fund, коалиция NYCTQC).
// Своей функции в api/ у анкеты нет (на Hobby не больше 12 функций): vercel.json
// переписывает /api/legal-help на /api/survey?form=legal-help, а api/survey.mjs
// отдаёт запрос сюда.
//
// Одна отправка — одна строка на доске monday «Legal Help Needs 2026»
// (id 18437438152, приватная). Анкета анонимная: имя и контакт приходят, только
// если человек попросил связаться с ним (Q26). Клиент шлёт короткие коды ответов,
// здесь они переводятся в английские метки (структура доски — по-английски).
// Метки должны СИМВОЛ В СИМВОЛ совпадать с доской, иначе monday создаст дубликаты.
// Коды должны совпадать с конфигом Q в legal-help/index.html.
import { monday } from "./letter-board.mjs";

export const BOARD = "18437438152";
export const GROUP = "topics"; // "Answers"

// code → board label
export const L = {
  help: { asylum: "File for asylum", interview: "Prepare for USCIS interview", court: "Immigration court case", ead: "Work permit (EAD)", greencard: "Green card after asylum", appeal: "Appeal or reopening", detention: "Help related to ICE detention", temp: "Parole, TPS or other temporary status", other: "Other" },
  stage: { not_filed: "Not filed yet", thin: "Filed without a detailed story", filed: "Filed, no interview yet", interviewed: "Interviewed, no decision", ref_after: "Sent to court after interview", ref_noint: "Sent to court without interview", court: "In court from the start, no decision", dismissed: "Court case dismissed at ICE's request", order_appeal: "Removal order, appeal filed or planned", order_absentia: "Removal order in absentia", order_no_appeal: "Removal order, no appeal", granted: "Asylum granted", not_asylum: "Not applying for asylum", unsure: "Doesn't know", other: "Other" },
  arrived: { y2026: "2026", y2025: "2025", y2024: "2024", y2023: "2023", y2022: "2022", before: "Before 2022" },
  deadline: { month: "Within a month", m1_3: "In 1–3 months", later: "In more than 3 months", none: "No deadline", unsure: "Doesn't know" },
  detained: { yes: "Yes", no: "No", pnts: "Rather not say" },
  lawyer: { free: "Yes, free (organization)", paid: "Yes, paid", had: "Had one, not now", never: "Never had one" },
  search: { lt1: "Under a month", m1_3: "1–3 months", m3_6: "3–6 months", gt6: "Over 6 months", alone: "Not looking, handling it alone" },
  tried: { ark: "Ark Immigration Clinic (CBST)", lsnyc: "Legal Services NYC", ie: "Immigration Equality", las: "The Legal Aid Society", otherfree: "Other free organizations", private: "Private attorneys", none: "Nowhere yet", other: "Other" },
  result: { noreply: "No reply", full: "Turned away: no capacity", notcase: "Turned away: don't take such cases", waitlist: "Put on a waitlist", consult: "Consultation only", nolang: "No Russian speaker or interpreter", cost: "Private attorney unaffordable", other: "Other" },
  scam: { yes: "Yes", no: "No", pnts: "Rather not say" },
  lgbtqexp: { very: "Very important", rather: "Somewhat important", not: "Not important" },
  badexp: { yes: "Yes", no: "No", pnts: "Rather not say" },
  impact: { deadline: "Missed or may miss a deadline", nowork: "No work permit, informal work", fees: "Can't pay USCIS fees", alone: "Preparing documents alone", court: "Afraid of losing in court", deport: "Risk of deportation", other: "Other" },
  fees: { yes: "Yes", hard: "With difficulty", no: "No", unsure: "Doesn't know" },
  borough: { bk: "Brooklyn", qn: "Queens", mn: "Manhattan", bx: "Bronx", si: "Staten Island", outside: "Outside NYC" },
  meet: { south_bk: "South Brooklyn", bk: "Other parts of Brooklyn", mn: "Manhattan", qn: "Queens", online: "Online", any: "No preference" },
  langs: { ru: "Russian", uk: "Ukrainian", en: "English", uz: "Uzbek", tg: "Tajik", other: "Other" },
  country: { ru: "Russia", ua: "Ukraine", by: "Belarus", kz: "Kazakhstan", uz: "Uzbekistan", tj: "Tajikistan", kg: "Kyrgyzstan", am: "Armenia", az: "Azerbaijan", ge: "Georgia", md: "Moldova", other: "Other country" },
  lgbtq: { yes: "Yes", no: "No", pnts: "Rather not say" },
  trans: { yes: "Yes", no: "No", pnts: "Rather not say" },
  consent: { yes: "Yes", no: "No" },
  quote: { yes: "Yes", no: "No" },
  speak: { yes: "Yes", maybe: "Maybe", no: "No" },
  followup: { yes: "Yes", no: "No" },
  staff: { new: "New", contacted: "Contacted", referred: "Referred", done: "Done" },
  lang: { ru: "RU", en: "EN" },
};

// Questions that take several answers (dropdown columns); the rest are one answer (status).
export const MULTI = ["help", "tried", "result", "impact", "meet", "langs"];
// "Other" answers that come with typed text: question → field in the request body.
export const OTHER = { help: "help_other", stage: "stage_other", tried: "tried_other", result: "result_other", impact: "impact_other", langs: "langs_other", country: "country_other" };
// Answers that cannot go with any other answer to the same question.
const EXCLUSIVE = { tried: "none", meet: "any" };

// Board columns: [key, type, title]. Order = order on the board. tools/legal-help.test.mjs
// checks that every key in L that is a question has a column here.
export const COLUMNS = [
  ["help", "dropdown", "Q1 Help needed"],
  ["stage", "status", "Q2 Asylum case stage"],
  ["arrived", "status", "Q3 Year arrived"],
  ["deadline", "status", "Q4 Next deadline"],
  ["detained", "status", "Q5 Ever detained"],
  ["lawyer", "status", "Q6 Lawyer now"],
  ["search", "status", "Q7 Searching for"],
  ["tried", "dropdown", "Q8 Where they tried"],
  ["result", "dropdown", "Q9 What happened"],
  ["price", "numbers", "Q10 Price quoted ($)"],
  ["scam", "status", "Q11 Lost money to a paid helper"],
  ["lgbtqexp", "status", "Q12 LGBTQ+ experience matters"],
  ["badexp", "status", "Q13 Bad experience as LGBTQ+"],
  ["impact", "dropdown", "Q14 Effects of no lawyer"],
  ["fees", "status", "Q15 Can pay USCIS fees"],
  ["story", "long_text", "Q16 What a lawyer would change"],
  ["borough", "status", "Q17 Borough"],
  ["meet", "dropdown", "Q18 Where to meet a lawyer"],
  ["langs", "dropdown", "Q19 Languages"],
  ["country", "status", "Q20 Country"],
  ["lgbtq", "status", "Q21 LGBTQ+"],
  ["trans", "status", "Q22 Trans or nonbinary"],
  ["consent", "status", "Q23 Consent: use anonymously"],
  ["quote", "status", "Q24 Consent: quote Q16"],
  ["speak", "status", "Q25 Will speak to Council"],
  ["followup", "status", "Q26 Wants follow-up"],
  ["contactName", "text", "Contact name"],
  ["contact", "text", "Contact"],
  ["staff", "status", "Follow-up status"],
  ["others", "long_text", "Other answers (verbatim)"],
  ["lang", "status", "Language"],
  ["submitted", "date", "Submitted"],
  ["rid", "text", "⚙️ Response id"],
  ["raw", "long_text", "⚙️ Raw answers (JSON)"],
];

// Column ids on the board. If a column is deleted and re-created its id changes
// and must be updated here.
export const C = {
  help: "dropdown_mm8jc0hd", stage: "color_mm8jm79", arrived: "color_mm8j756p", deadline: "color_mm8jcrr2",
  detained: "color_mm8j2ac9", lawyer: "color_mm8jwh6h", search: "color_mm8jcf0j", tried: "dropdown_mm8j65vp",
  result: "dropdown_mm8j91d6", price: "numeric_mm8jp602", scam: "color_mm8jvn1t", lgbtqexp: "color_mm8jr5f1",
  badexp: "color_mm8jxzym", impact: "dropdown_mm8jafwb", fees: "color_mm8jwp6x", story: "long_text_mm8jgchj",
  borough: "color_mm8j84d0", meet: "dropdown_mm8j7fxn", langs: "dropdown_mm8jcnyw", country: "color_mm8j7bvq",
  lgbtq: "color_mm8jt58r", trans: "color_mm8jbnaa", consent: "color_mm8j9ft5", quote: "color_mm8jyfhp",
  speak: "color_mm8ja6qt", followup: "color_mm8jbyne", contactName: "text_mm8j3shk", contact: "text_mm8jtv5e",
  staff: "color_mm8j97qv", others: "long_text_mm8jtz99", lang: "color_mm8jw9a5", submitted: "date_mm8js6mx",
  rid: "text_mm8j5c6d", raw: "long_text_mm8jmben",
};

// English question text for the update on the item (full answers in one place).
const QTEXT = {
  help: "Q1 Legal help needed now", stage: "Q2 Asylum case stage", arrived: "Q3 Year arrived in the US",
  deadline: "Q4 Next hearing, interview or filing deadline", detained: "Q5 Ever in immigration detention",
  lawyer: "Q6 Has a lawyer now", search: "Q7 Searching for a lawyer for", tried: "Q8 Where they tried",
  result: "Q9 What happened", price: "Q10 Price a private lawyer quoted ($)", scam: "Q11 A paid helper took money and did not help, or made errors",
  lgbtqexp: "Q12 Lawyer's experience with LGBTQ+ cases matters", badexp: "Q13 A lawyer or interpreter did not understand or judged their LGBTQ+ story",
  impact: "Q14 What has happened or may happen without a lawyer", fees: "Q15 Can pay USCIS fees now",
  story: "Q16 What a lawyer would change", borough: "Q17 Borough", meet: "Q18 Where to meet a lawyer",
  langs: "Q19 Languages for talking to a lawyer", country: "Q20 Country", lgbtq: "Q21 LGBTQ+",
  trans: "Q22 Trans or nonbinary", consent: "Q23 Consent to use the answers anonymously in funding applications and with Council members",
  quote: "Q24 Consent to quote Q16 anonymously", speak: "Q25 Ready to speak to a Council member or at a coalition action",
  followup: "Q26 Wants follow-up",
};

const RID_RX = /^[a-z0-9]{8,40}$/i;
const text = (v, max) => String(v ?? "").replace(/\s+/g, (m) => (m.includes("\n") ? m : " ")).trim().slice(0, max);
const one = (q, v) => (typeof v === "string" && Object.hasOwn(L[q], v) ? v : "");
function many(q, v) {
  let out = [...new Set((Array.isArray(v) ? v : []).map(String))].filter((c) => Object.hasOwn(L[q], c));
  const ex = EXCLUSIVE[q];
  if (ex && out.includes(ex) && out.length > 1) out = out.filter((c) => c !== ex);
  return out;
}

const SINGLE = Object.keys(L).filter((q) => !MULTI.includes(q) && !["staff", "lang"].includes(q));

// Разбор и проверка тела запроса. Возвращает { ok, fields: [...ошибочные поля], a }.
export function parseAnswers(b) {
  const a = { lang: b.lang === "en" ? "en" : "ru", rid: RID_RX.test(String(b.rid || "")) ? String(b.rid) : "" };
  for (const q of MULTI) a[q] = many(q, b[q]);
  for (const q of SINGLE) a[q] = one(q, b[q]);
  const p = Number(String(b.price ?? "").replace(/[^\d.]/g, ""));
  a.price = String(b.price ?? "").trim() !== "" && Number.isFinite(p) && p > 0 && p <= 1_000_000 ? Math.round(p) : null;
  a.story = text(b.story, 4000);
  a.other = {};
  for (const [q, f] of Object.entries(OTHER)) {
    const has = MULTI.includes(q) ? a[q].includes("other") : a[q] === "other";
    const t = has ? text(b[f], 300).replace(/\n/g, " ") : "";
    if (t) a.other[q] = t;
  }
  // a quote needs a story; contact details only when follow-up was asked for
  if (!a.story) a.quote = "";
  a.contactName = a.followup === "yes" ? text(b.contactName, 120).replace(/\n/g, " ") : "";
  a.contact = a.followup === "yes" ? text(b.contact, 200).replace(/\n/g, " ") : "";

  const fields = [];
  if (!a.consent) fields.push("consent");
  if (a.followup === "yes" && !a.contact) fields.push("contact");
  return { ok: fields.length === 0, fields, a };
}

const dateNY = (now) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);

export function itemName(a, now = new Date()) {
  return a.contactName || `Anonymous — ${dateNY(now)}`;
}

// Ответы → значения колонок monday (только заполненные).
export function columnValues(a, now = new Date()) {
  const cv = {};
  for (const q of MULTI) if (a[q].length) cv[C[q]] = { labels: a[q].map((c) => L[q][c]) };
  for (const q of SINGLE) if (a[q]) cv[C[q]] = { label: L[q][a[q]] };
  if (a.price != null) cv[C.price] = String(a.price);
  if (a.story) cv[C.story] = { text: a.story };
  if (a.contactName) cv[C.contactName] = a.contactName;
  if (a.contact) cv[C.contact] = a.contact;
  if (a.followup === "yes") cv[C.staff] = { label: L.staff.new };
  const others = Object.entries(a.other).map(([q, t]) => `${QTEXT[q].split(" ")[0]}: ${t}`).join("\n");
  if (others) cv[C.others] = { text: others };
  cv[C.lang] = { label: L.lang[a.lang] };
  cv[C.submitted] = { date: dateNY(now) };
  if (a.rid) cv[C.rid] = a.rid;
  const raw = { ...a }; delete raw.contactName; delete raw.contact; // no contact details in the raw copy
  cv[C.raw] = { text: JSON.stringify(raw).slice(0, 9000) };
  return cv;
}

// Полный текст ответов — апдейтом в карточку.
export function updateText(a) {
  const lines = [`Answers from feedback.qaravan.org/legal-help, form language: ${a.lang.toUpperCase()}`, ""];
  for (const q of Object.keys(QTEXT)) {
    let v;
    if (q === "price") v = a.price != null ? `$${a.price}` : "";
    else if (q === "story") v = a.story ? `\n${a.story}` : "";
    else if (MULTI.includes(q)) v = a[q].map((c) => L[q][c]).join(", ");
    else v = a[q] ? L[q][a[q]] : "";
    if (a.other[q]) v += ` (${a.other[q]})`;
    if (v) lines.push(`${QTEXT[q]}: ${v}`);
  }
  if (a.contact) lines.push("", `Contact: ${a.contactName ? a.contactName + ", " : ""}${a.contact}`);
  return lines.join("\n").slice(0, 9500);
}

export async function legalHelpHandler(req, res) {
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

  const { ok, fields, a } = parseAnswers(b);
  if (!ok) { res.statusCode = 400; return res.end(JSON.stringify({ error: "invalid", fields })); }

  const now = new Date();
  let itemId;
  try {
    const d = await monday(
      `mutation ($b: ID!, $g: String!, $n: String!, $v: JSON!) { create_item(board_id:$b, group_id:$g, item_name:$n, column_values:$v, create_labels_if_missing:true) { id } }`,
      { b: BOARD, g: GROUP, n: itemName(a, now), v: JSON.stringify(columnValues(a, now)) }
    );
    itemId = d.create_item.id;
  } catch (e) {
    console.error("legal-help create failed:", e.message);
    res.statusCode = 502; return res.end("{}");
  }
  await monday(`mutation ($i: ID!, $t: String!) { create_update(item_id:$i, body:$t) { id } }`, { i: String(itemId), t: updateText(a) })
    .catch((e) => console.error("legal-help update failed:", e.message)); // строка уже на доске — не валим отправку
  return res.end('{"ok":true}');
}
