// /api/letter — the letter intake form (letter/index.html, feedback.qaravan.org/letter).
//
// POST {rid, mode, lang, a, log, step, startedAt, website}
//   mode "draft"  — autosave after every answer; creates the person's row in
//                   "Form — started, not finished" on first save, then updates it.
//   mode "submit" — final submission: row moves to "Form — answers received",
//                   Letter Status → Answers received, a readable update is posted.
//   mode "feedback" — "Spotted a translation problem?": text goes to the row's Translation feedback column.
// GET ?rid=… — the draft for the personal resume link (answers, step, language),
//   or {submitted:true} once it was sent.
// Everything lives in this one function: Vercel's Hobby plan allows at most 12
// serverless functions per deployment and the repository already has 11.
//
// One person = one row, found by the intake id (⚙️ Intake id). The browser
// invents the id (UUID); it is unguessable, so the resume link is private.
// Free text is stored verbatim in whatever language the person wrote;
// board labels are English (repository rule). Column ids: lib/letter-board.mjs.
import { C, L, LANGS, RID_RX, GROUP_ANSWERS, monday, findByRid, createRow } from "../lib/letter-board.mjs";
import { sendResumeEmail, sendSubmitEmail } from "../lib/letter-mail.mjs";

const FORM_BASE = process.env.FORM_BASE || "https://feedback.qaravan.org";
const RAW_MAX = 9000; // long_text columns keep about 10k characters; the raw JSON is trimmed to fit

const str = (v, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const bool = (v) => v === true;
const langOf = (v) => (LANGS.includes(v) ? v : "en");
const EMAIL_RX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const pick = (map, v) => (typeof v === "string" && map[v] ? v : "");
const keys = (map, obj) => (obj && typeof obj === "object" ? Object.keys(obj).filter((k) => obj[k] && map[k]) : []);
const list = (v, n, fn) => (Array.isArray(v) ? v.slice(0, n).map(fn).filter(Boolean) : []);

// Whitelist + trim everything the browser sent. Unknown codes are dropped.
export function cleanAnswers(src) {
  const s = src && typeof src === "object" ? src : {};
  const a = {
    firstName: str(s.firstName, 80), lastName: str(s.lastName, 80),
    knownAs: list(s.knownAs, 6, (x) => str(x, 80)),
    age: /^\d{1,3}$/.test(s.age || "") && +s.age >= 1 && +s.age <= 110 ? String(+s.age) : "",
    pronouns: pick(L.pronouns, s.pronouns), pronounsText: str(s.pronounsText, 60),
    phone: str(s.phone, 30), email: str(s.email, 120).toLowerCase(), telegram: str(s.telegram, 60), whatsapp: str(s.whatsapp, 30), instagram: str(s.instagram, 60),
    followLang: pick(L.followLang, s.followLang),
    proceeding: pick(L.proceeding, s.proceeding), proceedingText: str(s.proceedingText, 200),
    country1: str(s.country1, 2).toUpperCase(),
    claim: Object.fromEntries(keys(L.identities, s.claim).map((k) => [k, true])),
    claimWhich: {},
    noAttorney: bool(s.noAttorney), attFirst: str(s.attFirst, 80), attLast: str(s.attLast, 80), attEmail: str(s.attEmail, 120).toLowerCase(), attPhone: str(s.attPhone, 30), attFirm: str(s.attFirm, 120),
    deadline: /^\d{4}-\d{2}-\d{2}$/.test(s.deadline || "") ? s.deadline : "", deadlineUnknown: bool(s.deadlineUnknown),
    incidents: str(s.incidents, 300),
    otherLetters: pick(L.yesno, s.otherLetters),
    otherLettersList: list(s.otherLettersList, 8, (o) => o && typeof o === "object" ? { name: str(o.name, 120), status: pick(L.letterStatus, o.status) } : null),
    cameM: /^([1-9]|1[0-2])$/.test(s.cameM || "") ? s.cameM : "", cameY: /^20(1[2-9]|2[0-6])$/.test(s.cameY || "") ? s.cameY : "",
    found: pick(L.found, s.found), foundText: str(s.foundText, 200),
    knowsPeople: list(s.knowsPeople, 6, (k) => k && typeof k === "object" ? { name: str(k.name, 80), phone: str(k.phone, 30), email: str(k.email, 120), handle: str(k.handle, 60) } : null),
    knowsVia: Object.fromEntries(keys(L.activities, s.knowsVia).map((k) => [k, true])), knowsViaText: str(s.knowsViaText, 200),
    frequency: pick(L.freq, s.frequency),
    events: {}, eventCounts: {}, eventsOther: {}, eventsNone: bool(s.eventsNone && s.eventsNone.all) ? { all: true } : {},
    beyond: list(s.beyond, 8, (b) => b && typeof b === "object" ? { what: str(b.what, 200), since: str(b.since, 60), howOften: str(b.howOften, 200) } : null),
    role: Object.fromEntries(keys(L.roles, s.role).map((k) => [k, true])),
    partner: pick(L.partner, s.partner), partnerIn: pick(L.yesno, s.partnerIn), partnerStmt: pick(L.pstatement, s.partnerStmt), partnerName: str(s.partnerName, 80), partnerContact: str(s.partnerContact, 120),
    consent: { truth: bool(s.consent && s.consent.truth), share: bool(s.consent && s.consent.share), contact: bool(s.consent && s.consent.contact) },
    anythingElse: str(s.anythingElse, 1000),
  };
  for (const k of ["ethnic", "religious", "other"]) if (a.claim[k] && s.claimWhich && typeof s.claimWhich[k] === "string") a.claimWhich[k] = str(s.claimWhich[k], 120);
  const EV_ID = /^20(1[2-9]|2[0-6])-(p\d{1,2}|m\d{1,2}-\d{1,2})$/;
  if (s.events && typeof s.events === "object") for (const k of Object.keys(s.events).slice(0, 400)) if (s.events[k] && EV_ID.test(k)) a.events[k] = true;
  if (s.eventCounts && typeof s.eventCounts === "object") for (const k of Object.keys(s.eventCounts)) if (a.events[k] && L.counts[s.eventCounts[k]]) a.eventCounts[k] = s.eventCounts[k];
  if (s.eventsOther && typeof s.eventsOther === "object") for (const k of Object.keys(s.eventsOther)) if (/^20(1[2-9]|2[0-6])$/.test(k) && typeof s.eventsOther[k] === "string" && s.eventsOther[k].trim()) a.eventsOther[k] = str(s.eventsOther[k], 400);
  return a;
}

// Path log entries: [t, step, direction]. Kept short and readable for staff.
export function cleanLog(v) {
  if (!Array.isArray(v)) return [];
  return v.slice(-300).map((e) => (e && typeof e === "object" && Number.isFinite(e.t) ? { t: Math.round(e.t), s: str(e.s, 30), d: str(e.d, 60) } : null)).filter(Boolean);
}

// ---- event names for staff-facing text (same file the page loads) ----
import { readFileSync } from "node:fs";
let EV = null;
function eventIndex() {
  if (EV) return EV;
  const w = {};
  try { new Function("window", readFileSync(new URL("../letter/intake-events.js", import.meta.url), "utf8"))(w); } catch (e) { console.error("events file unreadable:", e.message); }
  EV = {};
  for (const yr of w.QARAVAN_EVENTS || []) {
    yr.programs.forEach((p, i) => { EV[`${yr.y}-p${i}`] = { year: yr.y, name: p[0], program: true }; });
    yr.months.forEach((m, mi) => m[1].forEach((n, ei) => { EV[`${yr.y}-m${mi}-${ei}`] = { year: yr.y, name: `${m[0]}: ${n}` }; }));
  }
  return EV;
}
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const fullName = (a) => [a.firstName, a.lastName].filter(Boolean).join(" ");
const phoneVal = (p) => { const d = p.replace(/[^\d+]/g, ""); if (!d) return ""; const digits = d.replace(/\D/g, ""); const us = !d.startsWith("+") ? digits.length === 10 || (digits.length === 11 && digits[0] === "1") : digits.startsWith("1") && digits.length === 11; return { phone: (d.startsWith("+") ? "+" : (digits.length === 10 ? "+1" : "")) + digits, countryShortName: us ? "US" : "" }; };
const emailVal = (e) => (EMAIL_RX.test(e) ? { email: e, text: e } : "");
const dateVal = (d) => (d ? { date: d } : "");
const check = (b) => (b ? { checked: "true" } : { checked: "false" });

export function eventsText(a) {
  const idx = eventIndex(), byYear = {};
  for (const id of Object.keys(a.events)) { const e = idx[id]; if (!e) continue; (byYear[e.year] ||= []).push(e.program ? `${e.name}${a.eventCounts[id] ? ` (${L.counts[a.eventCounts[id]]})` : ""}` : e.name); }
  for (const y of Object.keys(a.eventsOther)) (byYear[y] ||= []).push(`Something else: ${a.eventsOther[y]}`);
  const years = Object.keys(byYear).sort((p, q) => q - p);
  if (!years.length) return a.eventsNone.all ? "Has not attended any listed events." : "";
  return years.map((y) => `${y}\n` + byYear[y].map((s) => `  • ${s}`).join("\n")).join("\n");
}
export function eventsCount(a) { return Object.keys(a.events).length + Object.keys(a.eventsOther).length; }

function refsText(a) {
  const people = a.knowsPeople.filter((k) => k.name || k.phone || k.email || k.handle).map((k, i) => `${i + 1}. ${k.name || "(no name)"}${k.phone ? ` · ${k.phone}` : ""}${k.email ? ` · ${k.email}` : ""}${k.handle ? ` · ${k.handle}` : ""}`);
  const via = Object.keys(a.knowsVia).map((k) => L.activities[k]); if (a.knowsVia.other && a.knowsViaText) via.push(`Other: ${a.knowsViaText}`);
  return [people.join("\n"), via.length ? `Brought together by: ${via.join("; ")}` : ""].filter(Boolean).join("\n");
}
function involvementText(a) { return a.beyond.filter((b) => b.what).map((b) => `• ${b.what}${b.since ? ` — since ${b.since}` : ""}${b.howOften ? ` — ${b.howOften}` : ""}`).join("\n"); }
function lettersText(a) { if (a.otherLetters === "no") return "No other support letters."; if (a.otherLetters !== "yes") return ""; const rows = a.otherLettersList.filter((o) => o.name || o.status).map((o) => `• ${o.name || "(not named)"}${o.status ? ` — ${L.letterStatus[o.status]}` : ""}`); return rows.length ? rows.join("\n") : "Has other support letters (none listed)."; }
function partnerText(a) { if (a.partner !== "yes") return ""; return [a.partnerIn ? `Part of the community: ${L.yesno[a.partnerIn]}` : "", a.partnerStmt ? `Own statement: ${L.pstatement[a.partnerStmt]}` : "", a.partnerName ? `Name: ${a.partnerName}` : "", a.partnerContact ? `Contact: ${a.partnerContact}` : ""].filter(Boolean).join("\n"); }
function othersText(a) {
  const o = [];
  if (a.proceeding === "other" && a.proceedingText) o.push(`Q4 proceeding: ${a.proceedingText}`);
  if (a.pronouns === "other" && a.pronounsText) o.push(`Q2 pronouns: ${a.pronounsText}`);
  for (const k of ["ethnic", "religious", "other"]) if (a.claimWhich[k]) o.push(`Q8 ${L.identities[k]}: ${a.claimWhich[k]}`);
  if (a.found === "other" && a.foundText) o.push(`Q13 found us: ${a.foundText}`);
  if (a.knowsVia.other && a.knowsViaText) o.push(`Q14 activities: ${a.knowsViaText}`);
  return o.join("\n");
}
const pronounsText = (a) => (a.pronouns === "other" ? a.pronounsText : L.pronouns[a.pronouns] || "");
const countryName = (code) => { try { return code && code !== "XK" ? new Intl.DisplayNames(["en"], { type: "region" }).of(code) : code === "XK" ? "Kosovo" : ""; } catch { return code; } };
const attorneyText = (a) => (a.noAttorney ? "No attorney yet" : [[a.attFirst, a.attLast].filter(Boolean).join(" "), a.attFirm, a.attEmail, a.attPhone].filter(Boolean).join(" · "));
const firstContact = (a) => [a.cameM && a.cameY ? `${MONTHS[+a.cameM - 1]} ${a.cameY}` : a.cameY || "", a.found ? `via ${L.found[a.found]}${a.found === "other" && a.foundText ? ` (${a.foundText})` : ""}` : ""].filter(Boolean).join(" · ");


// Every column the form fills.
export function columnValues(a, meta) {
  const submitted = meta.mode === "submit" || meta.submitted;
  const messengers = [a.telegram && `Telegram ${a.telegram}`, a.whatsapp && `WhatsApp ${a.whatsapp}`, a.instagram && `Instagram ${a.instagram}`].filter(Boolean).join(" · ");
  const known = [a.knownAs.filter(Boolean).join(", "), pronounsText(a)].filter(Boolean).join(" · ");
  const partner = a.partner ? [L.partner[a.partner], partnerText(a)].filter(Boolean).join("\n") : "";
  const other = othersText(a);
  const anything = [a.anythingElse, other ? `Details for “Other”:\n${other}` : ""].filter(Boolean).join("\n\n");
  const progress = submitted
    ? `Submitted ${(meta.submittedAt || new Date().toISOString()).slice(0, 10)} · ${meta.minutes != null ? meta.minutes + " min" : "time unknown"} · ${L.lang[meta.lang]}`
    : `Q ${meta.lastQ} of 19 · ${meta.progress}% · ${L.lang[meta.lang]}`;
  const cv = {
    [C.rid]: meta.rid,
    [C.formStatus]: { label: submitted ? "Submitted" : "In progress" },
    [C.progress]: progress,
    [C.firstName]: a.firstName, [C.lastName]: a.lastName, [C.known]: known,
    [C.age]: a.age || "",
    [C.phone]: phoneVal(a.phone), [C.email]: emailVal(a.email), [C.messengers]: messengers,
    [C.followLang]: a.followLang ? { label: L.followLang[a.followLang] } : "",
    [C.proceeding]: a.proceeding ? { label: L.proceeding[a.proceeding] } : "",
    [C.caseType]: a.proceeding ? { label: L.caseType[a.proceeding] } : "", [C.venue]: a.proceeding ? { label: L.venue[a.proceeding] } : "",
    [C.country]: countryName(a.country1),
    [C.identities]: Object.keys(a.claim).length ? { labels: Object.keys(a.claim).map((k) => L.identities[k]) } : "",
    [C.attorney]: attorneyText(a), [C.attEmail]: a.noAttorney ? "" : emailVal(a.attEmail),
    [C.deadline]: dateVal(a.deadlineUnknown ? "" : a.deadline),
    [C.keyEvents]: a.incidents ? { text: a.incidents } : "",
    [C.otherLetters]: lettersText(a) ? { text: lettersText(a) } : "",
    [C.firstContact]: firstContact(a),
    [C.refs]: refsText(a) ? { text: refsText(a) } : "",
    [C.roles]: Object.keys(a.role).length ? { labels: Object.keys(a.role).map((k) => L.roles[k]) } : "",
    [C.partner]: partner ? { text: partner } : "",
    [C.consents]: check(a.consent.truth && a.consent.share && a.consent.contact),
    [C.anythingElse]: anything ? { text: anything } : "",
    [C.resumeLink]: { url: `${FORM_BASE}/letter?r=${meta.rid}`, text: "Open this person's form" },
    [C.source]: `Intake form (feedback.qaravan.org/letter)${a.found ? ` · found us via ${L.found[a.found]}` : ""}`,
    [C.involvement]: { text: involvementSummary(a).slice(0, RAW_MAX) },
    [C.path]: { text: pathText(meta.log).slice(0, RAW_MAX) },
    [C.raw]: { text: rawJson(a, meta) },
  };
  if (submitted) cv[C.letterStatus] = { label: "Answers received" };
  return cv;
}

// Everything about the person's life in the community, in one column staff can read top to bottom.
export function involvementSummary(a) {
  const n = eventsCount(a);
  return [
    a.frequency ? `Takes part: ${L.freq[a.frequency]}` : "",
    firstContact(a) ? `First came: ${firstContact(a)}` : "",
    Object.keys(a.role).length ? `Roles: ${Object.keys(a.role).map((k) => L.roles[k]).join(", ")}` : "",
    eventsText(a) ? `\nEvents and programs${n ? ` (${n})` : ""}:\n${eventsText(a)}` : "",
    involvementText(a) ? `\nCommunity involvement:\n${involvementText(a)}` : "",
  ].filter(Boolean).join("\n");
}

// The raw JSON is what the resume link reads back; trimmed only at the very end.
function rawJson(a, meta) {
  const body = { rid: meta.rid, feedback: meta.feedback, savedAt: new Date().toISOString(), lang: meta.lang, step: Math.max(0, meta.lastQ - 1), progress: meta.progress, startedAt: meta.startedAt, submitted: !!meta.submitted || meta.mode === "submit", submittedAt: meta.submittedAt || null, minutes: meta.minutes ?? null, emailSent: meta.emailSent || null, a };
  let s = JSON.stringify(body);
  if (s.length > RAW_MAX) { body.a = { ...a, anythingElse: a.anythingElse.slice(0, 300), incidents: a.incidents }; s = JSON.stringify(body); }
  return s.slice(0, RAW_MAX);
}

function pathText(log) {
  const fmt = (t) => new Date(t).toISOString().replace("T", " ").slice(0, 19) + "Z";
  return log.map((e) => `${fmt(e.t)}  ${e.s}  ${e.d}`).join("\n");
}

// Readable summary posted as an update on submit — the archive that survives
// any later column change. English labels, the person's own words verbatim.
export function updateText(a, meta) {
  const line = (k, v) => (v ? `${k}: ${v}` : null);
  const parts = [
    meta.repeat ? "UPDATED SUBMISSION — the form was submitted again; columns were overwritten, the earlier text stays above." : "Answers from the letter intake form (feedback.qaravan.org/letter)",
    "",
    "WHO",
    line("Legal name", fullName(a)), line("Known as", a.knownAs.filter(Boolean).join(", ")), line("Age", a.age), line("Pronouns", pronounsText(a)),
    line("Phone", a.phone), line("Email", a.email), line("Telegram", a.telegram), line("WhatsApp", a.whatsapp), line("Instagram", a.instagram), line("Follow-up language", L.followLang[a.followLang]),
    "", "CASE",
    line("Proceeding", a.proceeding ? L.proceeding[a.proceeding] + (a.proceeding === "other" && a.proceedingText ? ` — ${a.proceedingText}` : "") : ""),
    line("Country", countryName(a.country1)),
    line("Identities & experiences", Object.keys(a.claim).map((k) => L.identities[k] + (a.claimWhich[k] ? ` (${a.claimWhich[k]})` : "")).join("; ")),
    line("Attorney", attorneyText(a)), line("Letter needed by", a.deadlineUnknown ? "date not known yet" : a.deadline),
    line("Key events at home", a.incidents), line("Other support letters", lettersText(a)),
    "", "YOU AND QARAVAN",
    line("First came", firstContact(a)), line("Who knows them", refsText(a)), line("Takes part", L.freq[a.frequency]),
    line("Events and programs", eventsText(a) ? "\n" + eventsText(a) : ""), line("Volunteering at QARAVAN", involvementText(a) ? "\n" + involvementText(a) : ""),
    line("Roles", Object.keys(a.role).map((k) => L.roles[k]).join(", ")),
    line("Partner", a.partner ? L.partner[a.partner] + (partnerText(a) ? "\n" + partnerText(a) : "") : ""),
    "", "CONSENT",
    `Answers true: ${a.consent.truth ? "yes" : "NO"} · Share with attorney: ${a.consent.share ? "yes" : "NO"} · May contact: ${a.consent.contact ? "yes" : "NO"}`,
    line("Anything else", a.anythingElse),
    "",
    `Form language: ${L.lang[meta.lang]} · ${meta.minutes != null ? meta.minutes + " min" : "time unknown"} · went back ${meta.log.filter((e) => e.d === "back" || e.d === "jump").length} times · reached the last step: ${meta.log.some((e) => e.s === "consent") ? "yes" : "no"}`,
  ].filter((x) => x !== null);
  return parts.join("\n").slice(0, 9500);
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    const rid = String(new URL(req.url, "https://x").searchParams.get("rid") || "").trim();
    if (!RID_RX.test(rid)) { res.statusCode = 400; return res.end("{}"); }
    try {
      const row = await findByRid(rid);
      if (!row || !row.raw) return res.end('{"found":false}');
      const r = row.raw;
      return res.end(JSON.stringify({ found: true, submitted: !!r.submitted, a: r.a || {}, step: r.step || 0, lang: langOf(r.lang), startedAt: r.startedAt || 0, emailSent: !!r.emailSent }));
    } catch (e) { console.error("letter draft read failed:", e.message); res.statusCode = 502; return res.end("{}"); }
  }

  if (req.method !== "POST") { res.statusCode = 405; return res.end("{}"); }
  const chunks = []; for await (const c of req) chunks.push(c);
  let b; try { b = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { res.statusCode = 400; return res.end("{}"); }
  if (b.website) return res.end('{"ok":true}'); // honeypot: agree politely, write nothing
  const rid = String(b.rid || "").trim();
  if (!RID_RX.test(rid)) { res.statusCode = 400; return res.end("{}"); }
  // «Заметили ошибку в переводе?» — текст ложится в колонку Translation feedback той же строки
  // (строку создаём, если человек ещё ничего не отвечал); история хранится в raw.feedback.
  if (b.mode === "feedback") {
    const text = String(b.text || "").trim().slice(0, 2000);
    if (!text) return res.end('{"ok":true}');
    const q = Math.min(19, Math.max(0, Math.round(Number(b.step) || 0)));
    try {
      const existing = await findByRid(rid);
      const prev = existing && existing.raw ? existing.raw : { rid };
      const list = [...(Array.isArray(prev.feedback) ? prev.feedback : []), { at: new Date().toISOString(), lang: langOf(b.lang), q, text }].slice(-20);
      const col = list.map((f) => `[${f.at.slice(0, 16).replace("T", " ")} · ${f.lang.toUpperCase()}${f.q ? ` · Q${f.q}` : ""}] ${f.text}`).join("\n\n").slice(0, 9000);
      const cv = { [C.translationFeedback]: { text: col }, [C.raw]: { text: JSON.stringify({ ...prev, rid, feedback: list }).slice(0, 9000) } };
      const itemId = existing ? existing.id : await createRow(rid, `Intake ${rid.slice(0, 8)}`);
      await monday(`mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id:$b, item_id:$i, column_values:$v) { id } }`, { b: "18429448469", i: String(itemId), v: JSON.stringify(cv) });
      return res.end('{"ok":true}');
    } catch (e) { console.error("translation feedback failed:", e.message); res.statusCode = 502; return res.end("{}"); }
  }
  const mode = b.mode === "submit" ? "submit" : "draft";
  const a = cleanAnswers(b.a);
  const log = cleanLog(b.log);
  const hasAny = Object.values(a).some((v) => (typeof v === "string" ? v : Array.isArray(v) ? v.some((x) => (typeof x === "string" ? x : Object.values(x || {}).some(Boolean))) : v && typeof v === "object" ? Object.keys(v).length : v));
  if (mode === "draft" && !hasAny && !log.length) return res.end('{"ok":true}');

  try {
    const existing = await findByRid(rid);
    const prev = existing && existing.raw ? existing.raw : {};
    const wasSubmitted = !!prev.submitted;
    const startedAt = Number(b.startedAt) || Number(prev.startedAt) || Date.now();
    const meta = {
      rid, mode, lang: langOf(b.lang), log, startedAt,
      submitted: wasSubmitted || mode === "submit",
      lastQ: Math.min(19, Math.max(0, Math.round(Number(b.step) || 0) + 1)),
      progress: Math.min(100, Math.max(0, Math.round(Number(b.progress) || 0))),
      minutes: mode === "submit" ? Math.min(1440, Math.max(0, Math.round((Date.now() - startedAt) / 6000) / 10)) : (prev.minutes ?? null),
      emailSent: prev.emailSent || null,
      feedback: Array.isArray(prev.feedback) ? prev.feedback : [],
      submittedAt: mode === "submit" ? new Date().toISOString() : prev.submittedAt || null,
    };
    const answers = a;

    // Personal resume link — emailed once, as soon as we have a valid email.
    let emailed = null;
    if (mode === "draft" && EMAIL_RX.test(answers.email) && !meta.emailSent) {
      emailed = await sendResumeEmail({ to: answers.email, name: answers.firstName, lang: meta.lang, link: `${FORM_BASE}/letter?r=${rid}` }).then(() => true).catch((e) => { console.error("resume email failed:", e.message); return false; });
      if (emailed) meta.emailSent = new Date().toISOString();
    }

    const cv = columnValues(answers, meta);
    const name = fullName(answers) || `Intake ${rid.slice(0, 8)}`;
    let itemId;
    if (existing) {
      itemId = existing.id;
      await monday(`mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id:$b, item_id:$i, column_values:$v, create_labels_if_missing:true) { id } }`, { b: "18429448469", i: String(itemId), v: JSON.stringify({ ...cv, name }) });
    } else {
      itemId = await createRow(rid, name);
      await monday(`mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id:$b, item_id:$i, column_values:$v, create_labels_if_missing:true) { id } }`, { b: "18429448469", i: String(itemId), v: JSON.stringify(cv) });
    }
    if (mode === "submit") {
      if (!existing || existing.group !== GROUP_ANSWERS) await monday(`mutation ($i: ID!) { move_item_to_group(item_id:$i, group_id:"${GROUP_ANSWERS}") { id } }`, { i: String(itemId) }).catch((e) => console.error("move failed:", e.message));
      await monday(`mutation ($i: ID!, $t: String!) { create_update(item_id:$i, body:$t) { id } }`, { i: String(itemId), t: updateText(answers, { ...meta, repeat: wasSubmitted }) }).catch((e) => console.error("update failed:", e.message));
      if (EMAIL_RX.test(answers.email)) await sendSubmitEmail({ to: answers.email, name: answers.firstName, lang: meta.lang }).catch((e) => console.error("submit email failed:", e.message));
    }
    return res.end(JSON.stringify({ ok: true, emailed }));
  } catch (e) {
    console.error("letter save failed:", e.message);
    res.statusCode = 502; return res.end("{}");
  }
}

