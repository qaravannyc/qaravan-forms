// /api/letter — the letter intake form (letter/index.html, feedback.qaravan.org/letter).
//
// POST {rid, mode, lang, a, log, step, startedAt, website}
//   mode "draft"  — autosave after every answer; creates the person's row in
//                   "Form — started, not finished" on first save, then updates it.
//   mode "submit" — final submission: row moves to "Form — answers received",
//                   Letter Status → Answers received, a readable update is posted.
//   mode "doc"    — the person came back through the emailed link and attached
//                   the case document they had promised.
// GET ?rid=… — the draft for the personal resume link (answers, step, language,
//   file names already uploaded), or {submitted:true} once it was sent.
// POST ?file=1&rid=…&kind=caseFiles|idFiles&name=… with the file bytes as
//   the body — uploads into the row's Files column (see uploadHandler below). It
//   lives in this same function because Vercel's Hobby plan allows at most 12
//   serverless functions per deployment and the repository already has 11.
//
// One person = one row, found by the intake id (⚙️ Intake id). The browser
// invents the id (UUID); it is unguessable, so the resume link is private.
// Free text is stored verbatim in whatever language the person wrote;
// board labels are English (repository rule). Column ids: lib/letter-board.mjs.
import { C, L, LANGS, RID_RX, MONDAY_FILE, GROUP_ANSWERS, monday, findByRid, createRow } from "../lib/letter-board.mjs";
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
    dobD: str(s.dobD, 2), dobM: str(s.dobM, 2), dobY: str(s.dobY, 4),
    pronouns: pick(L.pronouns, s.pronouns), pronounsText: str(s.pronounsText, 60),
    phone: str(s.phone, 30), email: str(s.email, 120).toLowerCase(), telegram: str(s.telegram, 60), whatsapp: str(s.whatsapp, 30), instagram: str(s.instagram, 60),
    followLang: pick(L.followLang, s.followLang),
    proceeding: pick(L.proceeding, s.proceeding), proceedingText: str(s.proceedingText, 200),
    country1: str(s.country1, 2).toUpperCase(),
    caseLater: bool(s.caseLater),
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
    anythingElse: str(s.anythingElse, 2000),
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
const dob = (a) => (a.dobY.length === 4 && a.dobM && a.dobD ? `${a.dobY}-${a.dobM.padStart(2, "0")}-${a.dobD.padStart(2, "0")}` : "");
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
const attorneyText = (a) => (a.noAttorney ? "No attorney yet (letter goes to the person)" : [[a.attFirst, a.attLast].filter(Boolean).join(" "), a.attFirm, a.attEmail, a.attPhone].filter(Boolean).join(" · "));
const firstContact = (a) => [a.cameM && a.cameY ? `${MONTHS[+a.cameM - 1]} ${a.cameY}` : a.cameY || "", a.found ? `via ${L.found[a.found]}${a.found === "other" && a.foundText ? ` (${a.foundText})` : ""}` : ""].filter(Boolean).join(" · ");


// Every column the form fills. `files` = names uploaded so far (from the row's raw JSON).
export function columnValues(a, meta) {
  const submitted = meta.mode === "submit" || meta.submitted;
  const messengers = [a.telegram && `Telegram ${a.telegram}`, a.whatsapp && `WhatsApp ${a.whatsapp}`, a.instagram && `Instagram ${a.instagram}`].filter(Boolean).join(" · ");
  const known = [a.knownAs.filter(Boolean).join(", "), pronounsText(a)].filter(Boolean).join(" · ");
  const partner = a.partner ? [L.partner[a.partner], partnerText(a)].filter(Boolean).join("\n") : "";
  const other = othersText(a);
  const anything = [a.anythingElse, other ? `Details for “Other”:\n${other}` : ""].filter(Boolean).join("\n\n");
  const progress = submitted
    ? `Submitted ${(meta.submittedAt || new Date().toISOString()).slice(0, 10)} · ${meta.minutes != null ? meta.minutes + " min" : "time unknown"} · ${L.lang[meta.lang]}`
    : `Q ${meta.lastQ} of 20 · ${meta.progress}% · ${L.lang[meta.lang]}`;
  const cv = {
    [C.rid]: meta.rid,
    [C.formStatus]: { label: submitted ? "Submitted" : "In progress" },
    [C.progress]: progress,
    [C.firstName]: a.firstName, [C.lastName]: a.lastName, [C.known]: known,
    [C.dob]: dateVal(dob(a)),
    [C.phone]: phoneVal(a.phone), [C.email]: emailVal(a.email), [C.messengers]: messengers,
    [C.followLang]: a.followLang ? { label: L.followLang[a.followLang] } : "",
    [C.proceeding]: a.proceeding ? { label: L.proceeding[a.proceeding] } : "",
    [C.caseType]: a.proceeding ? { label: L.caseType[a.proceeding] } : "", [C.venue]: a.proceeding ? { label: L.venue[a.proceeding] } : "",
    [C.country]: countryName(a.country1),
    [C.caseDoc]: meta.files.caseFiles.length ? { label: meta.docLater ? "Added later" : "Uploaded" } : a.caseLater ? { label: "Will send later" } : "",
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
  const body = { rid: meta.rid, savedAt: new Date().toISOString(), lang: meta.lang, step: Math.max(0, meta.lastQ - 1), progress: meta.progress, startedAt: meta.startedAt, submitted: !!meta.submitted || meta.mode === "submit", submittedAt: meta.submittedAt || null, minutes: meta.minutes ?? null, emailSent: meta.emailSent || null, docLater: !!meta.docLater, files: meta.files, a };
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
    line("Legal name", fullName(a)), line("Known as", a.knownAs.filter(Boolean).join(", ")), line("Date of birth", dob(a)), line("Pronouns", pronounsText(a)),
    line("Phone", a.phone), line("Email", a.email), line("Telegram", a.telegram), line("WhatsApp", a.whatsapp), line("Instagram", a.instagram), line("Follow-up language", L.followLang[a.followLang]),
    "", "CASE",
    line("Proceeding", a.proceeding ? L.proceeding[a.proceeding] + (a.proceeding === "other" && a.proceedingText ? ` — ${a.proceedingText}` : "") : ""),
    line("Country", countryName(a.country1)),
    line("Case document", meta.files.caseFiles.length ? meta.files.caseFiles.join(", ") : a.caseLater ? "will send later (personal link emailed)" : "—"),
    line("ID photo", meta.files.idFiles.join(", ")),
    "(files are in the Files column, prefixed case- / id-)",
    line("Identities & experiences", Object.keys(a.claim).map((k) => L.identities[k] + (a.claimWhich[k] ? ` (${a.claimWhich[k]})` : "")).join("; ")),
    line("Attorney", attorneyText(a)), line("Letter needed by", a.deadlineUnknown ? "date not known yet" : a.deadline),
    line("Key events at home", a.incidents), line("Other support letters", lettersText(a)),
    "", "YOU AND QARAVAN",
    line("First came", firstContact(a)), line("Who knows them", refsText(a)), line("Takes part", L.freq[a.frequency]),
    line("Events and programs", eventsText(a) ? "\n" + eventsText(a) : ""), line("Community involvement", involvementText(a) ? "\n" + involvementText(a) : ""),
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
      return res.end(JSON.stringify({ found: true, submitted: !!r.submitted, a: r.a || {}, step: r.step || 0, lang: langOf(r.lang), startedAt: r.startedAt || 0, files: r.files || { caseFiles: [], idFiles: [] }, docLater: !!r.docLater, emailSent: !!r.emailSent }));
    } catch (e) { console.error("letter draft read failed:", e.message); res.statusCode = 502; return res.end("{}"); }
  }

  if (req.method !== "POST") { res.statusCode = 405; return res.end("{}"); }
  if (new URL(req.url, "https://x").searchParams.get("file") === "1") return uploadHandler(req, res);
  const chunks = []; for await (const c of req) chunks.push(c);
  let b; try { b = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { res.statusCode = 400; return res.end("{}"); }
  if (b.website) return res.end('{"ok":true}'); // honeypot: agree politely, write nothing
  const rid = String(b.rid || "").trim();
  if (!RID_RX.test(rid)) { res.statusCode = 400; return res.end("{}"); }
  const mode = ["draft", "submit", "doc"].includes(b.mode) ? b.mode : "draft";
  const a = cleanAnswers(b.a);
  const log = cleanLog(b.log);
  const hasAny = Object.values(a).some((v) => (typeof v === "string" ? v : Array.isArray(v) ? v.some((x) => (typeof x === "string" ? x : Object.values(x || {}).some(Boolean))) : v && typeof v === "object" ? Object.keys(v).length : v));
  if (mode === "draft" && !hasAny && !log.length) return res.end('{"ok":true}');

  try {
    const existing = await findByRid(rid);
    const prev = existing && existing.raw ? existing.raw : {};
    const wasSubmitted = !!prev.submitted;
    if (mode === "doc" && !existing) { res.statusCode = 404; return res.end('{"ok":false}'); }
    const files = prev.files && typeof prev.files === "object" ? { caseFiles: prev.files.caseFiles || [], idFiles: prev.files.idFiles || [] } : { caseFiles: [], idFiles: [] };
    const startedAt = Number(b.startedAt) || Number(prev.startedAt) || Date.now();
    const meta = {
      rid, mode, lang: langOf(b.lang), log, files, startedAt,
      submitted: wasSubmitted || mode === "submit",
      docLater: mode === "doc" ? true : !!prev.docLater,
      lastQ: Math.min(20, Math.max(0, Math.round(Number(b.step) || 0) + 1)),
      progress: Math.min(100, Math.max(0, Math.round(Number(b.progress) || 0))),
      minutes: mode === "submit" ? Math.min(1440, Math.max(0, Math.round((Date.now() - startedAt) / 6000) / 10)) : (prev.minutes ?? null),
      emailSent: prev.emailSent || null,
      submittedAt: mode === "submit" ? new Date().toISOString() : prev.submittedAt || null,
    };
    // In "doc" mode only the file list changed; answers stay as they were.
    const answers = mode === "doc" && prev.a ? { ...cleanAnswers(prev.a), caseLater: false } : a;
    if (mode === "doc") { meta.submitted = wasSubmitted; meta.progress = wasSubmitted ? 100 : Number(prev.progress) || 0; meta.lastQ = Math.min(20, (Number(prev.step) || 0) + 1); }

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
      if (EMAIL_RX.test(answers.email)) await sendSubmitEmail({ to: answers.email, name: answers.firstName, lang: meta.lang, link: `${FORM_BASE}/letter?r=${rid}&doc=1`, docLater: answers.caseLater && !files.caseFiles.length, attorney: answers.noAttorney ? "" : answers.attEmail }).catch((e) => console.error("submit email failed:", e.message));
    }
    if (mode === "doc") {
      await monday(`mutation ($i: ID!, $t: String!) { create_update(item_id:$i, body:$t) { id } }`, { i: String(itemId), t: `Case document added later through the personal link: ${files.caseFiles.join(", ") || "(see Case documents)"}` }).catch((e) => console.error("doc update failed:", e.message));
    }
    return res.end(JSON.stringify({ ok: true, emailed }));
  } catch (e) {
    console.error("letter save failed:", e.message);
    res.statusCode = 502; return res.end("{}");
  }
}

// ---- file uploads (formerly api/letter-file.mjs) ----
const KIND = { caseFiles: C.files, idFiles: C.files }; // one Files column; the kind is kept in the row's raw JSON
const MAX_BYTES = 4 * 1024 * 1024;

async function uploadHandler(req, res) {
  const u = new URL(req.url, "https://x");
  const rid = String(u.searchParams.get("rid") || "").trim();
  const kind = String(u.searchParams.get("kind") || "");
  const name = String(u.searchParams.get("name") || "file").replace(/[\r\n"\\/]/g, "").slice(0, 120) || "file";
  if (!RID_RX.test(rid) || !KIND[kind]) { res.statusCode = 400; return res.end('{"ok":false,"error":"bad request"}'); }

  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > MAX_BYTES) { res.statusCode = 413; return res.end('{"ok":false,"error":"too big"}'); } chunks.push(c); }
  const buf = Buffer.concat(chunks);
  if (!buf.length) { res.statusCode = 400; return res.end('{"ok":false,"error":"empty"}'); }

  try {
    let row = await findByRid(rid);
    const itemId = row ? row.id : await createRow(rid);
    const form = new FormData();
    form.append("query", `mutation ($file: File!) { add_file_to_column (item_id: ${itemId}, column_id: "${KIND[kind]}", file: $file) { id } }`);
    form.append("map", '{"f":"variables.file"}');
    form.append("f", new Blob([buf]), ({ caseFiles: "case-", idFiles: "id-" }[kind] || "") + name);
    const up = await fetch(MONDAY_FILE, { method: "POST", headers: { Authorization: process.env.MONDAY_TOKEN, "API-Version": "2024-10" }, body: form }).then((r) => r.json());
    if (!up.data?.add_file_to_column?.id) { console.error("letter file upload failed:", JSON.stringify(up).slice(0, 300)); res.statusCode = 502; return res.end('{"ok":false,"error":"upload failed"}'); }

    // Remember the name in the row's raw JSON so the resume link and staff summary know about it.
    const raw = (row && row.raw) || { rid, files: {} };
    raw.files = raw.files && typeof raw.files === "object" ? raw.files : {};
    raw.files[kind] = (raw.files[kind] || []).concat([name]).slice(-12);
    if (kind === "caseFiles" && raw.submitted) raw.docLater = true;
    await monday(`mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id:$b, item_id:$i, column_values:$v) { id } }`,
      { b: "18429448469", i: String(itemId), v: JSON.stringify({ [C.raw]: { text: JSON.stringify(raw).slice(0, 9000) }, ...(kind === "caseFiles" ? { [C.caseDoc]: { label: raw.submitted ? "Added later" : "Uploaded" } } : {}) }) });
    return res.end(JSON.stringify({ ok: true, name, assetId: up.data.add_file_to_column.id }));
  } catch (e) {
    console.error("letter-file failed:", e.message);
    res.statusCode = 500; return res.end('{"ok":false}');
  }
}
