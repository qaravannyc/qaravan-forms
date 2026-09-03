/* QARAVAN letter intake form — feedback.qaravan.org/letter
 * Vanilla JS build of the Claude Design prototype (Letter Intake Form.dc.html).
 * 20 questions in 4 sections, one per screen. Answers live in `S.a`, every change
 * is saved to localStorage at once and to the board (POST /api/letter) with a
 * short debounce. Strings: letter/strings.js; events: letter/intake-events.js
 * (+ events-i18n.js); countries: letter/countries.js.
 */
(function () {
"use strict";
const LANGS = [["ru", "Русский"], ["en", "English"], ["uk", "Українська"], ["ka", "ქართული"], ["uz", "O‘zbekcha"], ["kk", "Қазақша"]];
const STEPS = [
  ["name", 0], ["age", 0], ["contact", 0],
  ["proceeding", 1], ["country", 1], ["claim", 1], ["attorney", 1], ["deadline", 1], ["incidents", 1], ["otherLetters", 1],
  ["firstCame", 2], ["knows", 2], ["frequency", 2], ["events", 2], ["beyond", 2], ["role", 2], ["partner", 2],
  ["consent", 3], ["anything", 3]
];
const WEIGHT = { name: 1, age: 1, contact: 2, proceeding: 1, country: 1, claim: 1, attorney: 2, deadline: 1, incidents: 3, otherLetters: 1, firstCame: 1, knows: 3, frequency: 1, events: 6, beyond: 3, role: 1, partner: 1, consent: 1, anything: 1 };
const SECTIONS = 4;
const TOTAL_WEIGHT = STEPS.reduce((t, x) => t + WEIGHT[x[0]], 0);
const OPTIONAL = new Set(["anything", "incidents", "otherLetters", "beyond", "partner", "deadline", "knows", "frequency", "firstCame", "role"]);
const KEY = "qaravan-intake-draft-v2"; // v2: age instead of date of birth, no document steps
const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const COUNTS = ["1-2", "3-5", "6-10", "10+"];
const EMAIL_RX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const RID_RX = /^[0-9a-zA-Z-]{12,64}$/;
const A0 = () => ({
  firstName: "", lastName: "", knownAs: [""], age: "", pronouns: "", pronounsText: "",
  phone: "", email: "", telegram: "", whatsapp: "", instagram: "", followLang: "",
  proceeding: "", proceedingText: "", country1: "",
  claim: {}, claimWhich: {}, noAttorney: false, attFirst: "", attLast: "", attEmail: "", attPhone: "", attFirm: "",
  deadline: "", deadlineUnknown: false, incidents: "", otherLetters: "", otherLettersList: [{ name: "", status: "" }],
  cameM: "", cameY: "", found: "", foundText: "", knowsPeople: [{ name: "", phone: "", email: "", handle: "" }, { name: "", phone: "", email: "", handle: "" }], knowsVia: {}, knowsViaText: "", frequency: "",
  events: {}, eventCounts: {}, eventsOther: {}, eventsNone: {},
  beyond: [{ what: "", since: "", howOften: "" }], role: {},
  partner: "", partnerIn: "", partnerStmt: "", partnerName: "", partnerContact: "",
  consent: {}, anythingElse: ""
});

// ---------- i18n ----------
const STRINGS = window.QARAVAN_STRINGS || {};
const EVI = window.QARAVAN_EVENTS_I18N || {};
let lang = "en";
const t = (k, vars) => {
  let s = (STRINGS[lang] && STRINGS[lang][k] != null ? STRINGS[lang][k] : STRINGS.en && STRINGS.en[k]);
  if (s == null) s = k;
  if (vars) for (const v in vars) s = s.split("{" + v + "}").join(vars[v]);
  return s;
};
// Plural forms: strings holds arrays; plural(n) picks the index per language.
const tn = (k, n, vars) => {
  const forms = (STRINGS[lang] && STRINGS[lang][k]) || (STRINGS.en && STRINGS.en[k]) || [k];
  const pf = (STRINGS[lang] && STRINGS[lang].plural) || STRINGS.en.plural;
  const s = Array.isArray(forms) ? forms[Math.min(pf(n), forms.length - 1)] : forms;
  return s.split("{n}").join(n).replace(/\{(\w+)\}/g, (m, v) => (vars && v in vars ? vars[v] : m));
};
const months = () => t("months").split("|");
const stepLabel = (id) => t("st_" + id);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const eventName = (id, en) => { const v = EVI[lang] && EVI[lang][id]; return Array.isArray(v) ? v[0] : v || en; };
let dnCache = {};
function countryName(code, en) {
  try { if (!dnCache[lang]) dnCache[lang] = new Intl.DisplayNames([lang], { type: "region" }); const n = dnCache[lang].of(code); if (n && n !== code) return n; } catch (e) {}
  return en;
}
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---------- state ----------
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 3) | 8).toString(16); }));
let S = { view: "welcome", step: 0, langOpen: false, filter: "", a: A0(), errs: {}, log: [], rid: uuid(), savedAt: null, startedAt: 0, linkNotice: null, submitted: false, calView: null, saveState: "" };
let saved = null;
try { saved = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) {}
if (saved && typeof saved === "object") {
  S.a = Object.assign(A0(), saved.a || {});
  if (!Array.isArray(S.a.knownAs) || !S.a.knownAs.length) S.a.knownAs = [""];
  S.log = Array.isArray(saved.log) ? saved.log : [];
  S.rid = RID_RX.test(saved.rid || "") ? saved.rid : S.rid;
  S.savedAt = saved.savedAt || null; S.startedAt = saved.startedAt || 0; S.submitted = !!saved.submitted;
  S.savedStep = typeof saved.step === "number" ? saved.step : null; S.savedView = saved.view || null;
  if (saved.lang && LANGS.some((l) => l[0] === saved.lang)) lang = saved.lang;
} else { S.savedStep = null; S.savedView = null; }
const urlLang = new URLSearchParams(location.search).get("lang");
if (!saved && urlLang && LANGS.some((l) => l[0] === urlLang)) lang = urlLang;

function persist() {
  const savedAt = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify({ rid: S.rid, a: S.a, step: S.step, view: S.view, log: S.log, lang, savedAt, startedAt: S.startedAt, submitted: S.submitted })); } catch (e) {}
  S.savedAt = savedAt;
  return savedAt;
}
function addLog(s, d) { S.log.push({ t: Date.now(), s, d }); if (S.log.length > 400) S.log = S.log.slice(-400); persist(); }

// ---------- saving to the board ----------
let dirty = false, inflight = false, timer = 0, pendingResolve = [];
function setSaveState(st) { S.saveState = st; const el = document.getElementById("stamp"); if (el) el.textContent = stampText(); }
function stampText() {
  if (S.saveState === "saving") return t("saving");
  if (S.saveState === "local") return t("saved_local");
  return S.savedAt ? t("saved_at", { time: new Date(S.savedAt).toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" }) }) : "";
}
function progressPct() { const done = STEPS.slice(0, S.step).reduce((n, x) => n + WEIGHT[x[0]], 0); return Math.round(done / TOTAL_WEIGHT * 100); }
function payload(mode) {
  return { rid: S.rid, mode, lang, a: S.a, log: S.log.slice(-300), step: S.step, startedAt: S.startedAt || Date.now(), progress: mode === "submit" ? 100 : progressPct(), website: (document.getElementById("hp") || {}).value || "" };
}
function hasAnswers() { const a = S.a; return !!(a.firstName || a.lastName || a.phone || a.email || a.proceeding || a.country1 || Object.keys(a.claim).length || Object.keys(a.events).length || a.incidents); }
function schedule() {
  if (S.submitted) return;
  if (!hasAnswers() && !S.log.length) return;
  dirty = true; setSaveState("saving");
  clearTimeout(timer); timer = setTimeout(() => save("draft"), 1200);
}
async function save(mode) {
  if (inflight) { dirty = true; return new Promise((r) => pendingResolve.push(r)); }
  inflight = true; dirty = false;
  let out = null;
  try {
    const r = await fetch("/api/letter", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload(mode)) });
    if (!r.ok) throw new Error("http " + r.status);
    out = await r.json().catch(() => ({ ok: true }));
    setSaveState("");
  } catch (e) { dirty = true; setSaveState("local"); }
  finally {
    inflight = false;
    const rs = pendingResolve; pendingResolve = []; rs.forEach((r) => r(out));
    if (dirty && !S.submitted && mode === "draft") { clearTimeout(timer); timer = setTimeout(() => save("draft"), 4000); }
  }
  return out;
}
window.addEventListener("pagehide", () => { if (!dirty || S.submitted) return; try { navigator.sendBeacon("/api/letter", new Blob([JSON.stringify(payload("draft"))], { type: "application/json" })); } catch (e) {} });
window.addEventListener("online", () => { if (dirty) schedule(); });

// ---------- answers: setters, formatters, files ----------
function setPath(obj, path, value) {
  const parts = path.split("."); let o = obj;
  for (let i = 0; i < parts.length - 1; i++) { const k = parts[i]; if (o[k] == null || typeof o[k] !== "object") o[k] = /^\d+$/.test(parts[i + 1]) ? [] : {}; o = o[k]; }
  o[parts[parts.length - 1]] = value;
}
function getPath(obj, path) { return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj); }
function clearErr(path) {
  const k = path.split(".")[0];
  delete S.errs[path]; delete S.errs[k];
  if (k === "knowsPeople") { const i = path.split(".")[1]; delete S.errs["knowsPhone" + i]; }
}
function touched() { if (!S.startedAt) S.startedAt = Date.now(); persist(); schedule(); }
// Answer change from a click (chips, rows, add/remove): re-render.
function setA(patch) { Object.assign(S.a, patch); Object.keys(patch).forEach(clearErr); touched(); render(); }

function fmtPhone(raw) {
  let s = raw.replace(/[^\d+]/g, ""); const plus = s.startsWith("+"); s = s.replace(/\D/g, "");
  if (!plus && s.length <= 10) return [s.slice(0, 3), s.slice(3, 6), s.slice(6, 10)].filter(Boolean).join("-");
  if (!plus && s.length === 11 && s[0] === "1") return "+1 " + [s.slice(1, 4), s.slice(4, 7), s.slice(7, 11)].filter(Boolean).join("-");
  if (plus && s.startsWith("1")) return "+1 " + [s.slice(1, 4), s.slice(4, 7), s.slice(7, 11)].filter(Boolean).join("-") + (s.length > 11 ? " " + s.slice(11, 15) : "");
  return (plus ? "+" : "") + s.replace(/(\d{1,3})(?=\d)/g, "$1 ").slice(0, 20);
}
function ageError(a) {
  if (!a.age) return "";
  const n = +a.age;
  if (!/^\d{1,3}$/.test(a.age) || n < 1 || n > 110) return t("e_age");
  if (n < 14) return t("e_young");
  return "";
}
// Typing: update the answer without re-rendering the whole screen (keeps the caret).
function onInput(el) {
  const path = el.dataset.f; let v = el.value;
  if (el.dataset.fmt === "phone") { v = fmtPhone(v); el.value = v; }
  if (el.dataset.fmt === "digits") { v = v.replace(/\D/g, "").slice(0, +el.maxLength || 4); el.value = v; }
  if (el.maxLength > 0 && v.length > el.maxLength) { v = v.slice(0, el.maxLength); el.value = v; }
  setPath(S.a, path, v); clearErr(path);
  if (path === "age") { const e = ageError(S.a); if (e) S.errs.age = e; }
  touched();
  // small dependent bits
  const errEl = document.querySelector('[data-err="' + path.split(".")[0] + '"]'); if (errEl && !S.errs[path.split(".")[0]]) { errEl.textContent = ""; }
  const ageEl = document.querySelector('[data-err="age"]'); if (ageEl) ageEl.textContent = S.errs.age || "";
  if (path === "incidents") { const c = document.getElementById("inc-count"); if (c) c.textContent = tn("chars_left", 300 - v.length); }
  if (path === "anythingElse") { const c = document.getElementById("any-count"); if (c) c.textContent = tn("chars_left", 1000 - v.length); }
  document.querySelectorAll("[data-err]").forEach((n) => { if (!S.errs[n.dataset.err]) n.textContent = ""; });
  document.querySelectorAll(".in.err").forEach((n) => { const k = (n.dataset.f || "").split(".")[0]; if (!S.errs[k]) n.classList.remove("err"); });
  const stamp = document.getElementById("stamp"); if (stamp) stamp.textContent = stampText();
}


// ---------- navigation, validation ----------
const stepIdx = (id) => STEPS.findIndex((x) => x[0] === id);
function go(i, dir) {
  const view = i >= STEPS.length ? "done" : "step";
  S.view = view; S.step = Math.min(i, STEPS.length - 1); S.errs = {}; S.filter = ""; S.langOpen = false;
  if (dir !== "contact-next") S.linkNotice = null;
  addLog(view === "done" ? "submitted" : STEPS[S.step][0], dir === "contact-next" ? "next" : dir);
  render(); window.scrollTo({ top: 0 });
  const h = document.querySelector("main h1"); if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); }
  if (view === "step") schedule();
}
function validate() {
  const a = S.a, id = STEPS[S.step][0], e = {};
  const req = (k, msg) => { if (!String(a[k] || "").trim()) e[k] = msg; };
  if (id === "name") { req("firstName", t("e_first")); req("lastName", t("e_last")); }
  if (id === "age") { const err = ageError(a); if (err) e.age = err; else if (!a.age) e.age = t("e_age"); }
  if (id === "contact") { req("phone", t("e_phone")); if (a.phone && a.phone.replace(/\D/g, "").length < 10) e.phone = t("e_phoneshort"); if (!EMAIL_RX.test(a.email.trim())) e.email = t("e_email"); }
  if (id === "proceeding" && !a.proceeding) e.proceeding = t("e_proc");
  if (id === "country") req("country1", t("e_country"));
  if (id === "claim" && !Object.values(a.claim).some(Boolean)) e.claim = t("e_claim");
  if (id === "attorney" && !a.noAttorney) { req("attFirst", t("e_attfirst")); req("attLast", t("e_attlast")); if (!EMAIL_RX.test(a.attEmail.trim())) e.attEmail = t("e_attemail"); }
  if (id === "knows") a.knowsPeople.forEach((k, i) => { if (k.name.trim() && !k.phone.trim()) e["knowsPhone" + i] = t("e_knowsphone", { name: k.name.trim() }); });
  if (id === "consent" && !(a.consent.truth && a.consent.share && a.consent.contact)) e.consent = t("e_consent");
  if (S.step === STEPS.length - 1) { const m = missingRequired(); if (m.length) e.missing = m; }
  return e;
}
function missingRequired() {
  const a = S.a;
  const checks = { name: a.firstName.trim() && a.lastName.trim(), age: !!a.age && !ageError(a), contact: a.phone.trim() && EMAIL_RX.test(a.email.trim()), proceeding: !!a.proceeding, country: !!a.country1, claim: Object.values(a.claim).some(Boolean), attorney: a.noAttorney || (a.attFirst.trim() && a.attLast.trim() && EMAIL_RX.test(a.attEmail.trim())), consent: a.consent.truth && a.consent.share && a.consent.contact };
  return STEPS.filter((x) => x[0] in checks && !checks[x[0]]).map((x) => ({ id: x[0], idx: stepIdx(x[0]) }));
}
function stepIsEmpty(id) {
  const a = S.a;
  switch (id) {
    case "anything": return !a.anythingElse.trim(); case "incidents": return !a.incidents.trim(); case "otherLetters": return !a.otherLetters;
    case "deadline": return !a.deadline && !a.deadlineUnknown; case "beyond": return a.beyond.every((b) => !b.what.trim());
    case "partner": return !a.partner; case "knows": return a.knowsPeople.every((k) => !k.name.trim() && !k.phone.trim()) && !Object.values(a.knowsVia).some(Boolean);
    case "frequency": return !a.frequency; case "firstCame": return !a.cameM && !a.cameY && !a.found; case "role": return !Object.values(a.role).some(Boolean);
    default: return false;
  }
}
// A step counts as answered by what is in it, not by whether the person passed it.
function stepAnswered(id) {
  const a = S.a;
  switch (id) {
    case "name": return !!(a.firstName.trim() && a.lastName.trim());
    case "age": return !!a.age;
    case "contact": return !!(a.phone.trim() && a.email.trim());
    case "proceeding": return !!a.proceeding;
    case "country": return !!a.country1;
    case "claim": return Object.values(a.claim).some(Boolean);
    case "attorney": return a.noAttorney || !!(a.attFirst.trim() || a.attLast.trim() || a.attEmail.trim());
    case "events": return Object.keys(a.events).length > 0 || !!a.eventsNone.all || Object.values(a.eventsOther).some((v) => v && String(v).trim());
    case "consent": return !!(a.consent.truth && a.consent.share && a.consent.contact);
    default: return !stepIsEmpty(id);
  }
}
function maxReached() { let m = S.step; for (const l of S.log) { const i = stepIdx(l.s); if (i > m) m = i; } return m; }
async function next() {
  const id = STEPS[S.step][0], isLast = S.step === STEPS.length - 1;
  const e = validate();
  if (Object.keys(e).length) { S.errs = e; addLog(id, "error:" + Object.keys(e).join(",")); render(); const first = document.querySelector(".ferr, .note.red"); if (first) first.scrollIntoView({ block: "center" }); return; }
  if (isLast) return submit();
  if (id === "contact") {
    const btn = document.getElementById("nextbtn"); if (btn) { btn.disabled = true; btn.textContent = t("saving"); }
    clearTimeout(timer); const out = await save("draft");
    S.linkNotice = out && out.emailed === false ? "failed" : "sent";
    go(S.step + 1, "contact-next"); return;
  }
  go(S.step + 1, "next");
}
async function submit() {
  const btn = document.getElementById("nextbtn"); if (btn) { btn.disabled = true; btn.textContent = t("sending"); }
  clearTimeout(timer);
  const out = await save("submit");
  if (!out || !out.ok) { S.errs = { net: t("e_net") }; render(); return; }
  S.submitted = true; dirty = false; persist();
  go(STEPS.length, "submit");
}

// ---------- rendering ----------
const $ = (id) => document.getElementById(id);
const svgTick = (c) => '<svg width="14" height="11" viewBox="0 0 14 11" aria-hidden="true"><polygon points="5.2,10.4 0.6,6 2.6,4 5.2,6.6 11.4,0.4 13.4,2.4" fill="' + c + '"></polygon></svg>';
const svgDown = '<svg width="12" height="8" viewBox="0 0 12 8" aria-hidden="true"><polygon points="0,0 12,0 6,8" fill="#333"></polygon></svg>';
const svgLeft = '<svg width="9" height="14" viewBox="0 0 9 14" aria-hidden="true"><polygon points="9,0 9,14 0,7" fill="#333"></polygon></svg>';
const svgRight = '<svg width="9" height="14" viewBox="0 0 9 14" aria-hidden="true"><polygon points="0,0 0,14 9,7" fill="#333"></polygon></svg>';
const svgX = (c) => '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><polygon points="2,0.6 0.6,2 4.6,6 0.6,10 2,11.4 6,7.4 10,11.4 11.4,10 7.4,6 11.4,2 10,0.6 6,4.6" fill="' + (c || "#333") + '"></polygon></svg>';
const svgPlus = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><polygon points="5.5,0 8.5,0 8.5,5.5 14,5.5 14,8.5 8.5,8.5 8.5,14 5.5,14 5.5,8.5 0,8.5 0,5.5 5.5,5.5" fill="#333"></polygon></svg>';
const wordmark = (size) => '<a class="wordmark" href="https://qaravan.org" aria-label="qaravan.org" style="font-size:' + size + 'px"><span class="q">q</span><span class="a1">a</span><span class="r">r</span><span class="a2">a</span><span class="v">v</span><span class="a3">a</span><span class="n">n</span></a>';
const cb = (on, green) => '<span class="cb' + (on ? " on" : "") + (green ? " green" : "") + '">' + (on ? svgTick("#fff") : "") + "</span>";
const rd = (on) => '<span class="rd' + (on ? " on" : "") + '">' + (on ? "<i></i>" : "") + "</span>";
const opt = () => ' <span class="opt">' + t("optional") + "</span>";
const wide = () => window.innerWidth >= 900;
const inStep = () => S.view === "step";
const isSaved = () => S.savedStep !== null && (S.savedView === "step" || S.savedView === "saved") && !S.submitted && hasAnswers();

function input(path, o) {
  o = o || {}; const v = getPath(S.a, path); const errKey = o.errKey || path.split(".")[0]; const bad = !!S.errs[errKey];
  return '<input class="in' + (bad ? " err" : "") + '" data-f="' + path + '" value="' + esc(v == null ? "" : v) + '"' + (o.type ? ' type="' + o.type + '"' : "") + (o.mode ? ' inputmode="' + o.mode + '"' : "") + (o.ac ? ' autocomplete="' + o.ac + '"' : ' autocomplete="off"') + (o.fmt ? ' data-fmt="' + o.fmt + '"' : "") + (o.max ? ' maxlength="' + o.max + '"' : "") + (o.ph ? ' placeholder="' + esc(o.ph) + '"' : "") + (o.aria ? ' aria-label="' + esc(o.aria) + '"' : "") + (o.nocap ? ' autocapitalize="none"' : "") + (bad ? ' aria-invalid="true"' : "") + (o.style ? ' style="' + o.style + '"' : "") + ">";
}
const ferr = (key) => '<span class="ferr" role="alert" data-err="' + key + '">' + esc(S.errs[key] || "") + "</span>";
const field = (label, path, o, hint) => '<label class="field"><span class="lbl">' + label + "</span>" + input(path, o) + (hint ? '<span class="hint">' + hint + "</span>" : "") + ferr((o && o.errKey) || path.split(".")[0]) + "</label>";
const chips = (list, key, o) => '<div class="chips" role="' + (o && o.multi ? "group" : "radiogroup") + '">' + list.map(([v, label], i) => { const on = o && o.multi ? !!S.a[key][v] : S.a[key] === v; return '<button type="button" class="chip' + (on ? " on" : "") + (o && o.tall ? " tall" : "") + (o && o.color ? " c" + (i % 5) : "") + '" role="' + (o && o.multi ? "checkbox" : "radio") + '" aria-checked="' + on + '" data-act="' + (o && o.multi ? "check" : "chip") + '" data-k="' + key + '" data-v="' + v + '">' + esc(label) + "</button>"; }).join("") + "</div>";
const rowCheck = (on, act, arg, title, sub) => '<div class="row' + (on ? " on" : "") + '" role="checkbox" tabindex="0" aria-checked="' + on + '" data-act="' + act + '"' + (arg ? ' data-v="' + arg + '"' : "") + ">" + cb(on) + '<span class="col"><span>' + title + "</span>" + (sub ? '<span class="sub">' + sub + "</span>" : "") + "</span></div>";
const addBtn = (act, label) => '<button type="button" class="btn outline md" data-act="' + act + '">' + svgPlus + "<span>" + esc(label) + "</span></button>";
const sec = (i) => t("sec_" + i);

function renderHeader() {
  const showSave = inStep();
  const pct = progressPct();
  const cur = LANGS.find((l) => l[0] === lang);
  $("hdr").innerHTML = '<div class="hdr-in">' + wordmark(26) + '<div class="hdr-r">' +
    (showSave ? '<button type="button" class="linkbtn" data-act="saveLater"><span class="full">' + t("save_later") + '</span><span class="short">' + t("save_short") + "</span></button>" : "") +
    '<div class="langwrap"><button type="button" class="langbtn" data-act="toggleLang" aria-haspopup="listbox" aria-expanded="' + S.langOpen + '"><span>' + cur[1] + "</span>" + svgDown + "</button>" +
    (S.langOpen ? '<div class="langbg" data-act="closeLang"></div><div class="langlist" role="listbox" aria-label="Language">' + LANGS.map((l) => '<div class="langopt' + (l[0] === lang ? " on" : "") + '" role="option" tabindex="0" aria-selected="' + (l[0] === lang) + '" data-act="lang" data-v="' + l[0] + '"><span class="tick">' + (l[0] === lang ? svgTick("#0099CC") : "") + "</span><span>" + l[1] + "</span></div>").join("") + "</div>" : "") +
    "</div></div></div>" +
    (inStep() && !wide() ? '<div class="pprog"><div class="bar"><i style="width:' + Math.max(pct, 3) + '%"></i></div><div class="pmeta"><span class="eyebrow">' + esc(sec(STEPS[S.step][1])) + '</span><span style="flex:none">' + esc(t("q_of", { n: S.step + 1, total: STEPS.length })) + "</span></div></div>" : "");
}

function renderRail() {
  const st = STEPS[S.step], secIdx = st[1], id = st[0], mr = maxReached(), pct = progressPct();
  const secSteps = STEPS.filter((x) => x[1] === secIdx), pos = secSteps.findIndex((x) => x[0] === id) + 1;
  let html = '<nav class="railnav" aria-label="Sections"><div class="rail-p"><div class="top"><span class="cap">' + t("your_progress") + '</span><span style="font-size:13px;font-weight:800">' + esc(t("q_of", { n: S.step + 1, total: STEPS.length })) + '</span></div><div class="bar"><i style="width:' + Math.max(pct, 3) + '%"></i></div></div><div>';
  for (let i = 0; i < SECTIONS; i++) {
    const items = STEPS.filter((x) => x[1] === i), first = stepIdx(items[0][0]);
    const cur = i === secIdx, done = items.every((x) => stepAnswered(x[0])) && !cur, expand = cur && id !== "events";
    html += '<div class="rsec' + (cur ? "" : " go") + '"' + (cur ? "" : ' data-act="go" data-v="' + first + '" data-dir="' + (first > mr ? "peek" : "jump") + '"') + '><span class="dotcol"><span class="rdot' + (done ? " done" : cur ? " cur" : "") + '">' + (done ? svgTick("#fff") : i + 1) + "</span>" + (i < SECTIONS - 1 ? '<span class="rline' + (done ? " done" : "") + '"></span>' : "") + '</span><span class="rbody"><span class="rname"><b' + (cur ? ' class="cur"' : "") + ">" + esc(sec(i)) + "</b><span>" + esc(cur ? t("n_of_m", { n: pos, m: items.length }) : tn("n_questions", items.length)) + "</span></span>";
    if (expand) html += '<span class="ritems">' + items.map((x) => { const ii = stepIdx(x[0]), isCur = ii === S.step, isDone = stepAnswered(x[0]); return '<span class="ritem' + (isCur ? " cur" : isDone ? " done" : "") + '"' + (isCur ? "" : ' data-act="go" data-v="' + ii + '" data-dir="' + (ii > mr ? "peek" : "jump") + '"') + "><i></i><span>" + esc(cap(stepLabel(x[0]))) + "</span></span>"; }).join("") + "</span>";
    html += "</span></div>";
  }
  return html + '</div><div class="rail-f">' + t("rail_foot") + "</div></nav>";
}

function renderWelcome() {
  const has = isSaved();
  const where = has ? sec(STEPS[S.savedStep][1]) + ", " + stepLabel(STEPS[S.savedStep][0]) : "";
  return '<div class="stack fade"><div class="eyebrow">' + t("w_eyebrow") + '</div><h1 class="big">' + t("w_title") + "</h1><p>" + t("w_p1") + "</p><p>" + t("w_p2") + '</p><div class="card ink">' +
    [1, 2].map((n) => '<div class="li"><span class="n">' + n + "</span><span>" + t("w_card" + n) + "</span></div>").join("") +
    '</div><p class="small">' + t("w_disclaimer") + "</p>" +
    (has ? '<div class="note green">' + esc(t("w_started", { where })) + "</div>" : "") +
    '<div class="stack" style="gap:10px;margin-top:4px">' + (has ? '<button type="button" class="btn full" data-act="resume">' + t("w_resume") + '</button><button type="button" class="textbtn" data-act="startOver">' + t("w_startover") + "</button>" : '<button type="button" class="btn full" data-act="start">' + t("w_start") + "</button>") + "</div>" +
    '<footer class="site">qaravan.org</footer></div>';
}
function renderSavedScreen() {
  const a = S.a;
  return '<div class="stack fade"><div class="eyebrow green">' + t("sv_eyebrow") + "</div><h1>" + t("sv_title") + "</h1><p>" + esc(a.email ? t("sv_explain_email", { email: a.email }) : t("sv_explain_noemail")) + '</p><p class="small">' + t("sv_followup") + '</p><button type="button" class="btn full" data-act="resume">' + t("sv_keep") + "</button></div>";
}
function renderDone() {
  const a = S.a, name = a.firstName || t("friend");
  return '<div class="stack fade">' + wordmark(44) + '<h1 class="big">' + esc(t("d_title", { name })) + "</h1><p>" + esc(t("d_body", { email: a.email, phone: a.phone ? t("d_or_call", { phone: a.phone }) : "" })) + "</p>" +
    '<p style="font-weight:800;font-size:20px;letter-spacing:-.01em">' + t("d_luck") + '</p><p class="small">' + t("d_close") + "</p>" + renderTrBlock() + "</div>";
}

// ---------- the 19 steps ----------
const STEP_RENDER = {
  name() {
    const kn = S.a.knownAs;
    return "<h1>" + t("q1_title") + '</h1><p class="help">' + t("q1_help") + "</p>" +
      field(t("q1_first"), "firstName", { ac: "given-name" }) + field(t("q1_last"), "lastName", { ac: "family-name" }) +
      '<div><span class="lbl">' + t("q1_known") + opt() + '</span><div class="stack" style="gap:10px">' +
      kn.map((v, i) => '<div style="display:flex;gap:8px;align-items:center">' + input("knownAs." + i, { ac: "nickname", aria: t("q1_known_aria", { n: i + 1 }), style: "flex:1;min-width:0" }) + (kn.length > 1 ? '<button type="button" class="iconbtn" data-act="rmKnown" data-v="' + i + '" aria-label="' + esc(t("q1_known_rm")) + '">' + svgX() + "</button>" : "") + "</div>").join("") +
      '</div><span class="hint">' + t("q1_known_hint") + '</span><div style="margin-top:12px">' + addBtn("addKnown", t("q1_known_add")) + "</div></div>";
  },
  age() {
    const a = S.a, bad = !!S.errs.age;
    return "<h1>" + t("q2_title") + '</h1><p class="help">' + t("q2_help") + '</p><label class="field" style="max-width:220px"><span class="lbl">' + t("q2_age") + '</span><input class="in' + (bad ? " err" : "") + '" data-f="age" data-fmt="digits" value="' + esc(a.age) + '" inputmode="numeric" autocomplete="off" maxlength="3"' + (bad ? ' aria-invalid="true"' : "") + ">" + ferr("age") + "</label>" +
      '<div><span class="lbl">' + t("q2_pronouns") + opt() + "</span>" + chips([["he", "he/him"], ["she", "she/her"], ["they", "they/them"], ["hethey", "he/they"], ["shethey", "she/they"], ["any", t("pr_any")], ["none", t("pr_none")], ["other", t("pr_other")]], "pronouns") +
      (a.pronouns === "other" ? '<div style="margin-top:12px">' + input("pronounsText", { aria: t("q2_pronouns"), max: 60 }) + "</div>" : "") + "</div>";
  },
  contact() {
    return "<h1>" + t("q3_title") + '</h1><p class="help">' + t("q3_help") + "</p>" +
      field(t("q3_phone"), "phone", { type: "tel", mode: "tel", ac: "tel", fmt: "phone" }, t("q3_phone_hint")) +
      field(t("q3_email"), "email", { type: "email", mode: "email", ac: "email", nocap: true }) +
      field("Telegram" + opt(), "telegram", { nocap: true, max: 60 }, t("q3_handle_hint")) +
      field("WhatsApp" + opt(), "whatsapp", { type: "tel", mode: "tel", fmt: "phone" }, t("q3_wa_hint")) +
      field("Instagram" + opt(), "instagram", { nocap: true, max: 60 }, t("q3_handle_hint")) +
      '<div><span class="lbl">' + t("q3_followlang") + "</span>" + chips([["ru", t("lang_ru")], ["en", t("lang_en")]], "followLang", { tall: true }) + "</div>";
  },
  proceeding() {
    return "<h1>" + t("q4_title") + '</h1><p class="help">' + t("q4_help") + "</p>" +
      chips([["removal", t("pc_removal")], ["affirmative", t("pc_affirmative")], ["withholding", t("pc_withholding")], ["cat", t("pc_cat")], ["parole", t("pc_parole")], ["uvisa", t("pc_uvisa")], ["other", t("other")]], "proceeding", { tall: true }) +
      (S.a.proceeding === "other" ? input("proceedingText", { aria: t("q4_other_aria"), ph: t("q4_other_ph"), max: 200 }) : "") + ferr("proceeding");
  },
  country() {
    const C = window.QARAVAN_COUNTRIES || { region: [], others: [] };
    const loc = (list) => list.map(([c, en]) => [c, countryName(c, en)]).sort((p, q) => p[1].localeCompare(q[1], lang));
    const opts = (list) => list.map(([c, n]) => '<option value="' + c + '"' + (S.a.country1 === c ? " selected" : "") + ">" + esc(n) + "</option>").join("");
    return "<h1>" + t("q5_title") + '</h1><p class="help">' + t("q5_help") + '</p><label class="field"><span class="lbl">' + t("q5_country") + '</span><span class="selwrap"><select class="in' + (S.errs.country1 ? " err" : "") + '" data-f="country1" autocomplete="country"' + (S.errs.country1 ? ' aria-invalid="true"' : "") + '><option value="">' + t("q5_choose") + '</option><optgroup label="' + esc(t("q5_region")) + '">' + opts(loc(C.region)) + '</optgroup><optgroup label="' + esc(t("q5_others")) + '">' + opts(loc(C.others)) + "</optgroup></select>" + svgDown + "</span>" + ferr("country1") + "</label>";
  },
  claim() {
    const a = S.a;
    const CL = [["gay", "id_gay"], ["lesbian", "id_lesbian"], ["bi", "id_bi"], ["transw", "id_transw"], ["transm", "id_transm"], ["nb", "id_nb"], ["intersex", "id_intersex"], ["ethnic", "id_ethnic"], ["religious", "id_religious"], ["activist", "id_activist"], ["journalist", "id_journalist"], ["gbv", "id_gbv"], ["trafficking", "id_trafficking"], ["family", "id_family"], ["other", "other"]];
    const which = [["ethnic", "q8_which_ethnic"], ["religious", "q8_which_religious"], ["other", "q8_which_other"]].filter(([k]) => a.claim[k]);
    return "<h1>" + t("q8_title") + '</h1><p class="help">' + t("q8_help") + "</p>" + chips(CL.map(([v, k]) => [v, t(k)]), "claim", { multi: true, color: true, tall: true }) +
      which.map(([k, lk]) => '<label class="field fade"><span class="lbl">' + t(lk) + "</span>" + input("claimWhich." + k, { max: 120 }) + "</label>").join("") + ferr("claim");
  },
  attorney() {
    const a = S.a;
    return "<h1>" + t("q9_title") + "</h1>" + rowCheck(a.noAttorney, "toggle", "noAttorney", t("q9_none")) +
      (a.noAttorney ? "" : '<div class="flex"><label class="field grow"><span class="lbl">' + t("q9_first") + "</span>" + input("attFirst", { ac: "off" }) + ferr("attFirst") + '</label><label class="field grow"><span class="lbl">' + t("q9_last") + "</span>" + input("attLast", { ac: "off" }) + ferr("attLast") + "</label></div>" +
        field(t("q9_email"), "attEmail", { type: "email", mode: "email", nocap: true }) + field(t("q9_phone") + opt(), "attPhone", { type: "tel", mode: "tel", fmt: "phone" }) + field(t("q9_firm") + opt(), "attFirm", { ac: "organization", max: 120 }));
  },
  deadline() {
    const a = S.a; let cal = "";
    if (!a.deadlineUnknown) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const sel = a.deadline ? new Date(a.deadline + "T00:00:00") : null;
      const view = S.calView || (sel ? { y: sel.getFullYear(), m: sel.getMonth() } : { y: today.getFullYear(), m: today.getMonth() });
      const first = new Date(view.y, view.m, 1), lead = (first.getDay() + 6) % 7, days = new Date(view.y, view.m + 1, 0).getDate();
      let cells = t("dow").split("|").map((d) => '<span class="dow">' + d + "</span>").join("");
      for (let i = 0; i < lead; i++) cells += "<span></span>";
      for (let d = 1; d <= days; d++) {
        const dt = new Date(view.y, view.m, d), past = dt < today, on = sel && dt.getTime() === sel.getTime(), isToday = dt.getTime() === today.getTime();
        const iso = view.y + "-" + String(view.m + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
        cells += '<button type="button"' + (past ? " disabled" : "") + ' class="' + (on ? "on" : isToday ? "today" : past ? "past" : "") + '" data-act="calPick" data-v="' + iso + '" aria-label="' + esc(fmtDate(iso)) + '" aria-pressed="' + !!on + '">' + d + "</button>";
      }
      cal = '<div class="stack" style="gap:12px"><span class="lbl" style="margin:0">' + t("q10_date") + '</span><div class="cal"><div class="cal-h"><button type="button" class="iconbtn sm" data-act="calPrev" aria-label="' + esc(t("prev_month")) + '">' + svgLeft + "</button><span>" + esc(cap(months()[view.m]) + " " + view.y) + '</span><button type="button" class="iconbtn sm" data-act="calNext" aria-label="' + esc(t("next_month")) + '">' + svgRight + '</button></div><div class="cal-g">' + cells + '</div><div class="cal-f"><span>' + esc(sel ? t("q10_needed_by", { date: fmtDate(a.deadline) }) : t("q10_nodate")) + "</span>" + (sel ? '<button type="button" class="textbtn sm" data-act="clearDeadline">' + t("clear") + "</button>" : "") + "</div></div></div>";
    }
    return "<h1>" + t("q10_title") + '</h1><p class="help">' + t("q10_help") + "</p>" + cal + rowCheck(a.deadlineUnknown, "toggleDeadline", "", t("q10_unknown"));
  },
  incidents() {
    return '<div class="eyebrow gray">' + t("optional_skip") + "</div><h1>" + t("q11_title") + '</h1><p class="help">' + t("q11_help") + '</p><p style="font-size:15px;font-weight:700;color:var(--q-sky)">' + t("q11_norepeat") + '</p><textarea class="in" data-f="incidents" rows="6" maxlength="300" aria-label="' + esc(t("q11_aria")) + '">' + esc(S.a.incidents) + '</textarea><span class="hint" id="inc-count" style="margin-top:-14px">' + tn("chars_left", 300 - S.a.incidents.length) + "</span>";
  },
  otherLetters() {
    const a = S.a, ol = a.otherLettersList;
    return '<div class="eyebrow gray">' + t("optional_cap") + "</div><h1>" + t("q12_title") + '</h1><p class="help">' + t("q12_help") + "</p>" + chips([["yes", t("yes")], ["no", t("no")]], "otherLetters") +
      (a.otherLetters === "yes" ? '<div class="stack fade" style="gap:14px">' + ol.map((o, i) => '<div class="card"><div class="card-h"><span class="card-t">' + esc(ol.length > 1 ? t("q12_letter_n", { n: i + 1 }) : t("q12_letter")) + "</span>" + (ol.length > 1 ? '<button type="button" class="textbtn sm" data-act="rmLetter" data-v="' + i + '">' + t("remove") + "</button>" : "") + '</div><label class="field"><span class="lbl">' + t("q12_who") + "</span>" + input("otherLettersList." + i + ".name", { max: 120 }) + '</label><div><span class="lbl">' + t("q12_received") + '</span><div class="chips">' + [["received", "q12_s_received"], ["waiting", "q12_s_waiting"], ["notasked", "q12_s_notasked"]].map(([v, k]) => '<button type="button" class="chip' + (o.status === v ? " on" : "") + '" role="radio" aria-checked="' + (o.status === v) + '" data-act="letterStatus" data-i="' + i + '" data-v="' + v + '">' + t(k) + "</button>").join("") + "</div></div></div>").join("") + addBtn("addLetter", t("add_another")) + "</div>" : "");
  },
  firstCame() {
    const a = S.a, M = months();
    const sel = (path, optsHtml) => '<span class="selwrap"><select class="in" data-f="' + path + '">' + optsHtml + "</select>" + svgDown + "</span>";
    return '<div class="eyebrow">' + t("heart") + "</div><h1>" + t("q13_title") + '</h1><p class="help">' + t("q13_help") + '</p><div class="flex"><label class="field grow" style="flex-basis:160px"><span class="lbl">' + t("q13_month") + "</span>" + sel("cameM", '<option value="">' + t("q13_month") + "</option>" + M.map((m, i) => '<option value="' + (i + 1) + '"' + (a.cameM === String(i + 1) ? " selected" : "") + ">" + esc(m) + "</option>").join("")) + '</label><label class="field grow" style="flex-basis:120px"><span class="lbl">' + t("q13_year") + "</span>" + sel("cameY", '<option value="">' + t("q13_year") + "</option>" + Array.from({ length: 15 }, (_, i) => 2026 - i).map((y) => '<option value="' + y + '"' + (a.cameY === String(y) ? " selected" : "") + ">" + y + "</option>").join("")) + "</label></div>" +
      '<div><span class="lbl">' + t("q13_found") + "</span>" + chips([["friend", t("f_friend")], ["event", t("f_event")], ["group", t("f_group")], ["helpdesk", t("f_helpdesk")], ["telegram", "Telegram"], ["org", t("f_org")], ["other", t("other")]], "found") + (a.found === "other" ? '<div style="margin-top:12px">' + input("foundText", { aria: t("q13_found"), ph: t("tell_us_how"), max: 200 }) + "</div>" : "") + "</div>";
  },
  knows() {
    const a = S.a, kp = a.knowsPeople;
    return "<h1>" + t("q14_title") + '</h1><p class="help">' + t("q14_help") + "</p>" + kp.map((k, i) => { const err = S.errs["knowsPhone" + i]; return '<div class="card"><div class="card-h"><span class="card-t">' + esc(t("q14_person", { n: i + 1 })) + "</span>" + (kp.length > 2 ? '<button type="button" class="textbtn sm" data-act="rmPerson" data-v="' + i + '">' + t("remove") + "</button>" : "") + "</div>" +
      '<label class="field"><span class="lbl">' + t("q14_name") + "</span>" + input("knowsPeople." + i + ".name", { max: 80 }) + "</label>" +
      '<label class="field"><span class="lbl">' + t("q14_phone") + '</span><input class="in' + (err ? " err" : "") + '" data-f="knowsPeople.' + i + '.phone" data-fmt="phone" type="tel" inputmode="tel" autocomplete="off" value="' + esc(k.phone) + '">' + '<span class="ferr" role="alert" data-err="knowsPhone' + i + '">' + esc(err || "") + "</span></label>" +
      '<label class="field"><span class="lbl">' + t("q14_email") + opt() + "</span>" + input("knowsPeople." + i + ".email", { type: "email", mode: "email", nocap: true }) + "</label>" +
      '<label class="field"><span class="lbl">' + t("q14_handle") + opt() + "</span>" + input("knowsPeople." + i + ".handle", { nocap: true, ph: t("q14_handle_ph"), max: 60 }) + "</label></div>"; }).join("") +
      addBtn("addPerson", t("q14_add")) +
      '<div><span class="lbl">' + t("q14_activities") + ' <span class="opt">' + t("select_all") + "</span></span>" + chips([["groups", t("ac_groups")], ["events", t("ac_events")], ["oneonone", t("ac_oneonone")], ["volunteer", t("ac_volunteer")], ["chats", t("ac_chats")], ["before", t("ac_before")], ["other", t("other")]], "knowsVia", { multi: true }) + (a.knowsVia.other ? '<div style="margin-top:12px">' + input("knowsViaText", { aria: t("q14_activities"), ph: t("tell_us_how"), max: 200 }) + "</div>" : "") + "</div>";
  },
  frequency() { return "<h1>" + t("q15_title") + '</h1><p class="help">' + t("q15_help") + "</p>" + chips([["week", t("fr_week")], ["month", t("fr_month")], ["year", t("fr_year")], ["rarely", t("fr_rarely")]], "frequency", { tall: true }); },
  events() {
    const a = S.a, YE = window.QARAVAN_EVENTS || [], f = S.filter.trim().toLowerCase();
    const idx = eventIndex();
    const countFor = (y) => Object.keys(a.events).filter((k) => a.events[k] && idx[k] && idx[k].year === y).length + (a.eventsOther[y] ? 1 : 0);
    // Search: the English name, the name in all six languages, and the invisible synonym groups
    // (letter/search-synonyms.js) — «хайк» finds a hike even though the calendar says «поход».
    const SYN = window.QARAVAN_SEARCH_SYNONYMS || [];
    const terms = f.length >= 3 ? Array.from(new Set(SYN.filter((g) => g.some((w) => w.includes(f) || (w.length >= 3 && f.includes(w)))).flat())) : [];
    const allNames = (id) => Object.keys(EVI).map((l) => { const v = EVI[l] && EVI[l][id]; return Array.isArray(v) ? v.join(" ") : v || ""; }).join(" ");
    const match = (n, id, det) => { if (!f) return true; const hay = (n + " " + (det || "") + " " + allNames(id)).toLowerCase(); return hay.includes(f) || terms.some((w) => hay.includes(w)); };
    const pills = YE.map((yr) => { const c = countFor(yr.y); return '<button type="button" class="ypill' + (c ? " on" : "") + '" data-act="jumpYear" data-v="' + yr.y + '"><span>' + yr.y + "</span>" + (c ? '<span class="badge">' + c + "</span>" : "") + "</button>"; }).join("");
    const pickedIds = Object.keys(a.events).filter((k) => a.events[k] && idx[k]).sort((p, q) => idx[q].year - idx[p].year);
    const picked = pickedIds.map((k) => '<button type="button" class="pchip" data-act="event" data-v="' + k + '" aria-label="' + esc(t("remove")) + '"><span class="y">' + idx[k].year + "</span><span>" + esc(eventName(k, idx[k].name) + (a.eventCounts[k] ? ", " + t("cnt_" + a.eventCounts[k].replace("-", "_").replace("+", "p")) : "")) + "</span>" + svgX("#0099CC") + "</button>")
      .concat(Object.keys(a.eventsOther).filter((y) => a.eventsOther[y]).map((y) => '<button type="button" class="pchip" data-act="eventOtherClear" data-v="' + y + '"><span class="y">' + y + "</span><span>" + esc(t("other") + ": " + a.eventsOther[y]) + "</span>" + svgX("#0099CC") + "</button>"));
    const row = (id, name, det, cls) => { const on = !!a.events[id]; return '<div class="lrow ' + cls + (on ? " on" : "") + '" role="checkbox" tabindex="0" aria-checked="' + on + '" data-act="event" data-v="' + id + '">' + cb(on) + '<span class="col"><span>' + esc(name) + "</span>" + (det ? '<span class="det">' + esc(det) + "</span>" : "") + "</span></div>"; };
    let tl = "", any = false;
    YE.forEach((yr) => {
      const programs = yr.programs.map((p, i) => ({ id: yr.y + "-p" + i, name: p[0], detail: p[1] })).filter((p) => match(p.name, p.id, p.detail));
      const ms = yr.months.map((m, mi) => ({ mi, name: m[0], events: m[1].map((n, ei) => ({ id: yr.y + "-m" + mi + "-" + ei, name: n })).filter((e) => match(e.name, e.id)) })).filter((m) => m.events.length);
      if (f && !programs.length && !ms.length) return; any = true;
      const c = countFor(yr.y), otherOn = a.eventsOther[yr.y] !== undefined;
      tl += '<section class="yr" id="year-' + yr.y + '"><div class="yr-h"><b>' + yr.y + '</b><span class="cnt">' + (c ? esc(tn("n_selected", c)) : "") + "</span></div>";
      if (programs.length) tl += '<div class="grp"><div class="mo-h m0">' + t("regular_programs") + "</div>" + programs.map((p) => { const ev = EVI[lang] && EVI[lang][p.id]; const nm = Array.isArray(ev) ? ev[0] : ev || p.name; const dt = Array.isArray(ev) ? ev[1] : p.detail; return "<div>" + row(p.id, nm, dt, "m0") + (a.events[p.id] ? '<div class="counts fade"><span class="q">' + t("how_many") + '</span><div class="chips">' + COUNTS.map((cc) => '<button type="button" class="chip sm' + (a.eventCounts[p.id] === cc ? " on" : "") + '" aria-pressed="' + (a.eventCounts[p.id] === cc) + '" data-act="count" data-i="' + p.id + '" data-v="' + cc + '">' + t("cnt_" + cc.replace("-", "_").replace("+", "p")) + "</button>").join("") + "</div></div>" : "") + "</div>"; }).join("") + "</div>";
      tl += ms.map((m) => { const cls = "m" + ((m.mi + 1) % 5); return '<div class="grp"><div class="mo-h ' + cls + '">' + esc(months()[MONTHS_EN.indexOf(m.name)] || m.name) + "</div>" + m.events.map((e) => row(e.id, eventName(e.id, e.name), "", cls)).join("") + "</div>"; }).join("");
      tl += '<div class="stack" style="gap:10px;margin-top:4px"><div class="lrow m0' + (otherOn ? " on" : "") + '" role="checkbox" tabindex="0" aria-checked="' + otherOn + '" data-act="eventOther" data-v="' + yr.y + '">' + cb(otherOn) + '<span style="color:var(--q-gray)">' + esc(t("something_else", { year: yr.y })) + "</span></div>" + (otherOn ? '<textarea class="in" data-f="eventsOther.' + yr.y + '" rows="3" maxlength="400" aria-label="' + esc(t("describe")) + '" placeholder="' + esc(t("something_else_ph")) + '" style="min-height:90px">' + esc(a.eventsOther[yr.y] || "") + "</textarea>" : "") + "</div></section>";
    });
    const noneOn = !!a.eventsNone.all;
    return "<h1>" + t("q16_title") + '</h1><p class="help">' + t("q16_help") + '</p><label class="field"><span class="lbl">' + t("q16_search") + '</span><input class="in" id="evfilter" value="' + esc(S.filter) + '" autocomplete="off" placeholder="' + esc(t("q16_search_ph")) + '"></label>' +
      '<div class="stack" style="gap:8px"><span class="card-t">' + t("jump_year") + '</span><div class="yearpills">' + pills + "</div></div>" +
      '<div class="picked"><div class="eyebrow">' + esc(picked.length ? tn("selected_so_far", picked.length) : t("nothing_selected")) + "</div>" + (picked.length ? '<div class="chips" style="gap:8px">' + picked.join("") + "</div>" : "") + "</div>" +
      '<div id="evbody">' + (f && !any ? '<p class="help">' + esc(t("q16_nomatch", { q: S.filter })) + "</p>" : "") + '<div class="timeline">' + tl + "</div></div>" +
      '<div class="divider"><div class="lrow m0' + (noneOn ? " on" : "") + '" role="checkbox" tabindex="0" aria-checked="' + noneOn + '" data-act="eventsNone">' + cb(noneOn) + '<span class="col"><span>' + t("q16_none") + '</span><span class="det" style="font-weight:500">' + t("q16_none_sub") + "</span></span></div></div>";
  },
  beyond() {
    const b = S.a.beyond;
    return '<div class="eyebrow gray">' + t("optional_skip") + "</div><h1>" + t("q17_title") + '</h1><p class="help">' + t("q17_help") + "</p>" + b.map((x, i) => '<div class="card"><div class="card-h"><span class="card-t q">' + esc(b.length > 1 ? t("q17_activity_n", { n: i + 1 }) : t("q17_activity")) + "</span>" + (b.length > 1 ? '<button type="button" class="textbtn sm" data-act="rmBeyond" data-v="' + i + '">' + t("remove") + "</button>" : "") + '</div><label class="field"><span class="lbl">' + t("q17_what") + "</span>" + input("beyond." + i + ".what", { max: 200 }) + '</label><label class="field"><span class="lbl">' + t("q17_since") + "</span>" + input("beyond." + i + ".since", { max: 60 }) + '</label><label class="field"><span class="lbl">' + t("q17_often") + "</span>" + input("beyond." + i + ".howOften", { max: 200 }) + "</label></div>").join("") + '<button type="button" class="btn outline md" data-act="addBeyond">' + t("add_another") + "</button>";
  },
  role() { return "<h1>" + t("q18_title") + '</h1><p class="help">' + t("select_all") + "</p>" + chips([["volunteer", t("r_volunteer")], ["lead", t("r_lead")], ["facilitator", t("r_facilitator")], ["board", t("r_board")], ["none", t("r_none")]], "role", { multi: true, tall: true }); },
  partner() {
    const a = S.a;
    return "<h1>" + t("q19_title") + '</h1><p class="help">' + t("q19_help") + "</p>" + chips([["yes", t("yes")], ["no", t("no")], ["pnts", t("pnts")]], "partner", { tall: true }) +
      (a.partner === "yes" ? '<div class="stack fade" style="gap:18px"><div><span class="lbl">' + t("q19_in") + "</span>" + chips([["yes", t("yes")], ["no", t("no")]], "partnerIn") + '</div><div><span class="lbl">' + t("q19_stmt") + "</span>" + chips([["yes", t("yes")], ["maybe", t("q19_maybe")], ["no", t("no")]], "partnerStmt") + "</div>" + field(t("q19_name") + opt(), "partnerName", { max: 80 }) + field(t("q19_contact") + opt(), "partnerContact", { ph: t("q19_contact_ph"), max: 120 }) + "</div>" : "");
  },
  consent() {
    const a = S.a;
    return "<h1>" + t("q20_title") + '</h1><div class="card plain">' + [["truth", "c_truth", "c_truth_sub"], ["share", "c_share", ""], ["contact", "c_contact", "c_contact_sub"]].map(([v, tk, sk]) => '<div class="consent' + (a.consent[v] ? " on" : "") + '" role="checkbox" tabindex="0" aria-checked="' + !!a.consent[v] + '" data-act="consent" data-v="' + v + '"><span class="txt"><span class="t">' + t(tk) + "</span>" + (sk ? '<span class="s">' + t(sk) + "</span>" : "") + '</span><span style="flex:none;padding-top:2px">' + cb(!!a.consent[v], true) + "</span></div>").join("") + "</div>" + ferr("consent");
  },
  anything() {
    return '<div class="eyebrow gray">' + t("optional_skip") + "</div><h1>" + t("q21_title") + '</h1><p class="help">' + t("q21_help") + '</p><textarea class="in" data-f="anythingElse" rows="6" maxlength="1000" aria-label="' + esc(t("q21_title")) + '">' + esc(S.a.anythingElse) + '</textarea><span class="hint" id="any-count" style="margin-top:-14px">' + tn("chars_left", 1000 - S.a.anythingElse.length) + "</span>";
  }

};
let EVIDX = null;
function eventIndex() {
  if (EVIDX) return EVIDX; EVIDX = {};
  (window.QARAVAN_EVENTS || []).forEach((yr) => { yr.programs.forEach((p, i) => { EVIDX[yr.y + "-p" + i] = { year: yr.y, name: p[0], program: true }; }); yr.months.forEach((m, mi) => m[1].forEach((n, ei) => { EVIDX[yr.y + "-m" + mi + "-" + ei] = { year: yr.y, name: n, month: m[0] }; })); });
  return EVIDX;
}
function fmtDate(iso) { const d = new Date(iso + "T00:00:00"); try { return d.toLocaleDateString(lang, { day: "numeric", month: "long", year: "numeric" }); } catch (e) { return iso; } }

// ---------- step frame + footer nav ----------
function renderStep() {
  const id = STEPS[S.step][0], isLast = S.step === STEPS.length - 1;
  let html = '<div class="stack step fade"><button type="button" class="backbtn" data-act="back">' + svgLeft + "<span>" + t("back") + "</span></button>";
  if (S.linkNotice === "sent") html += '<div class="note green">' + esc(t("link_sent", { email: S.a.email })) + "</div>";
  if (S.linkNotice === "failed") html += '<div class="note orange">' + esc(t("link_failed")) + '<div class="linkbox"><input class="in" readonly value="' + esc(resumeURL()) + '" aria-label="' + esc(t("your_link")) + '"><button type="button" class="btn outline md" data-act="copyLink">' + t("copy") + "</button></div></div>";
  html += STEP_RENDER[id]();
  // footer
  const nextTitle = isLast ? "" : stepLabel(STEPS[S.step + 1][0]);
  const errKeys = Object.keys(S.errs).filter((k) => k !== "missing");
  const missing = S.errs.missing || [];
  let foot = '<div class="footnav">';
  if (S.errs.net) foot += '<div class="note red" role="alert">' + esc(S.errs.net) + "</div>";
  else if (errKeys.length) foot += '<div class="note red" role="alert">' + esc(t("fix_above", { msg: S.errs[errKeys[0]] })) + "</div>";
  if (missing.length) foot += '<div class="missing" role="alert"><span style="font-size:15px;font-weight:700">' + t("missing_intro") + '</span><div class="chips" style="gap:8px">' + missing.map((m) => '<button type="button" class="pill" data-act="go" data-v="' + m.idx + '" data-dir="fix-missing">' + esc(cap(stepLabel(m.id))) + "</button>").join("") + "</div></div>";
  if (isLast) { const now = missingRequired(); if (now.length) foot += '<div class="note orange">' + esc(tn("peek_note", now.length)) + "</div>"; }
  let label;
  if (id === "events") { const n = Object.keys(S.a.events).length; label = t("next_to", { step: nextTitle }) + (n ? " (" + tn("n_selected", n) + ")" : ""); }
  else if (isLast) label = t("submit");
  else if (id === "contact") label = t("save_next_to", { step: nextTitle });
  else label = t("next_to", { step: nextTitle });
  foot += '<button type="button" id="nextbtn" class="btn full' + (isLast ? " green" : "") + '" data-act="next">' + esc(label) + "</button>";
  if (OPTIONAL.has(id) && stepIsEmpty(id)) foot += '<button type="button" class="textbtn" data-act="skip">' + t("skip") + "</button>";
  foot += '<div class="stamp" id="stamp">' + esc(stampText()) + "</div></div>";
  return html + foot + renderTrBlock() + "</div>";
}
const resumeURL = () => location.origin + "/letter?r=" + S.rid;
// «Заметили ошибку в переводе?» — как в опросе, но на всех шести языках: все версии анкеты написаны с помощью ИИ.
// Текст уходит в колонку Translation feedback той же строки на доске.
function renderTrBlock() {
  const open = !!S.trOpen, st = S.trState || "";
  return '<div class="trfb"><button type="button" class="trfb-link' + (open ? " on" : "") + '" data-act="trToggle" aria-expanded="' + open + '">' + esc(t("tr_link")) + "</button>" +
    (open ? '<div class="trfb-panel"><p>' + esc(t("tr_note")) + '</p><textarea class="in" id="trtext" rows="3" maxlength="2000" placeholder="' + esc(t("tr_ph")) + '" aria-label="' + esc(t("tr_link")) + '">' + esc(S.trText || "") + '</textarea><button type="button" class="btn outline md" data-act="trSend"' + (st === "sending" ? " disabled" : "") + ">" + esc(st === "sent" ? t("tr_sent") : st === "err" ? t("tr_err") : t("tr_send")) + "</button></div>" : "") + "</div>";
}

function render() {
  S.step = Math.min(Math.max(S.step | 0, 0), STEPS.length - 1); if (S.savedStep != null) S.savedStep = Math.min(S.savedStep, STEPS.length - 1);
  document.documentElement.lang = lang; document.title = t("title");
  renderHeader();
  const app = $("app");
  const rail = inStep() && wide();
  app.className = "wrap" + (rail ? " rail" : "");
  let main;
  if (S.view === "welcome") main = renderWelcome();
  else if (S.view === "saved") main = renderSavedScreen();
  else if (S.view === "done") main = renderDone();
  else main = renderStep();
  app.innerHTML = (rail ? renderRail() : "") + "<main>" + main + "</main>";
}

// ---------- events (delegated) ----------
function toggleEvent(id) {
  const a = S.a, on = !a.events[id];
  if (on) a.events[id] = true; else { delete a.events[id]; delete a.eventCounts[id]; }
  if (on) a.eventsNone = {};
  touched(); render();
}
const ACT = {
  toggleLang() { S.langOpen = !S.langOpen; render(); },
  closeLang() { S.langOpen = false; render(); },
  lang(el) { lang = el.dataset.v; S.langOpen = false; dnCache = {}; persist(); render(); if (hasAnswers()) schedule(); },
  saveLater() { S.view = "saved"; S.savedStep = S.step; S.savedView = "saved"; persist(); addLog("saved-for-later", "exit:" + STEPS[S.step][0]); clearTimeout(timer); save("draft"); render(); window.scrollTo({ top: 0 }); },
  start() { S.startedAt = S.startedAt || Date.now(); go(0, "start"); },
  resume() { const i = S.savedStep === null ? S.step : S.savedStep; S.savedStep = null; go(i, "resume"); },
  startOver() { if (!confirm(t("confirm_startover"))) return; try { localStorage.removeItem(KEY); } catch (e) {} S.a = A0(); S.log = []; S.rid = uuid(); S.savedStep = null; S.submitted = false; S.startedAt = Date.now(); persist(); go(0, "start-over"); },
  go(el) { go(+el.dataset.v, el.dataset.dir || "jump"); },
  back() { if (S.step === 0) { S.view = "welcome"; S.savedStep = 0; S.savedView = "step"; persist(); render(); window.scrollTo({ top: 0 }); return; } go(S.step - 1, "back"); },
  next() { next(); },
  skip() { go(S.step + 1, "skip"); },
  chip(el) { const k = el.dataset.k, v = el.dataset.v; const p = {}; p[k] = S.a[k] === v ? "" : v; setA(p); },
  check(el) { const k = el.dataset.k, v = el.dataset.v; const cur = Object.assign({}, S.a[k]); if (k === "role") { if (v === "none") { const on = cur.none; for (const x in cur) delete cur[x]; if (!on) cur.none = true; } else { cur[v] = !cur[v]; if (!cur[v]) delete cur[v]; delete cur.none; } } else { cur[v] = !cur[v]; if (!cur[v]) delete cur[v]; } const p = {}; p[k] = cur; setA(p); },
  toggle(el) { const k = el.dataset.v; const p = {}; p[k] = !S.a[k]; setA(p); },
  toggleDeadline() { setA({ deadlineUnknown: !S.a.deadlineUnknown, deadline: S.a.deadlineUnknown ? S.a.deadline : "" }); },
  addKnown() { setA({ knownAs: S.a.knownAs.concat([""]) }); },
  rmKnown(el) { setA({ knownAs: S.a.knownAs.filter((_, j) => j !== +el.dataset.v) }); },
  addLetter() { setA({ otherLettersList: S.a.otherLettersList.concat([{ name: "", status: "" }]) }); },
  rmLetter(el) { setA({ otherLettersList: S.a.otherLettersList.filter((_, j) => j !== +el.dataset.v) }); },
  letterStatus(el) { const i = +el.dataset.i, v = el.dataset.v; const list = S.a.otherLettersList.map((o, j) => (j === i ? Object.assign({}, o, { status: o.status === v ? "" : v }) : o)); setA({ otherLettersList: list }); },
  addPerson() { setA({ knowsPeople: S.a.knowsPeople.concat([{ name: "", phone: "", email: "", handle: "" }]) }); },
  rmPerson(el) { setA({ knowsPeople: S.a.knowsPeople.filter((_, j) => j !== +el.dataset.v) }); },
  addBeyond() { setA({ beyond: S.a.beyond.concat([{ what: "", since: "", howOften: "" }]) }); },
  rmBeyond(el) { setA({ beyond: S.a.beyond.filter((_, j) => j !== +el.dataset.v) }); },
  calPrev() { const v = calView(); S.calView = { y: v.m === 0 ? v.y - 1 : v.y, m: (v.m + 11) % 12 }; render(); },
  calNext() { const v = calView(); S.calView = { y: v.m === 11 ? v.y + 1 : v.y, m: (v.m + 1) % 12 }; render(); },
  calPick(el) { setA({ deadline: el.dataset.v }); },
  clearDeadline() { setA({ deadline: "" }); },
  jumpYear(el) { const y = el.dataset.v; const n = document.getElementById("year-" + y); if (!n) return; const top = n.getBoundingClientRect().top + window.scrollY - (wide() ? 88 : 128); window.scrollTo({ top, behavior: "smooth" }); addLog("events", "jump-year:" + y); },
  event(el) { toggleEvent(el.dataset.v); },
  count(el) { const c = Object.assign({}, S.a.eventCounts); c[el.dataset.i] = el.dataset.v; setA({ eventCounts: c }); },
  eventOther(el) { const y = el.dataset.v, o = Object.assign({}, S.a.eventsOther); if (o[y] !== undefined) delete o[y]; else o[y] = ""; setA({ eventsOther: o, eventsNone: {} }); },
  eventOtherClear(el) { const o = Object.assign({}, S.a.eventsOther); delete o[el.dataset.v]; setA({ eventsOther: o }); },
  eventsNone() { const on = !S.a.eventsNone.all; setA(on ? { eventsNone: { all: true }, events: {}, eventCounts: {}, eventsOther: {} } : { eventsNone: {} }); },
  consent(el) { const c = Object.assign({}, S.a.consent); c[el.dataset.v] = !c[el.dataset.v]; setA({ consent: c }); },
  trToggle() { const ta = $("trtext"); if (ta) S.trText = ta.value; S.trOpen = !S.trOpen; S.trState = ""; render(); },
  async trSend() {
    const ta = $("trtext"), text = ta ? ta.value.trim() : ""; S.trText = ta ? ta.value : "";
    if (!text) { if (ta) ta.focus(); return; }
    S.trState = "sending"; render();
    try {
      const r = await fetch("/api/letter", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rid: S.rid, mode: "feedback", lang, step: inStep() ? S.step + 1 : 0, text: text.slice(0, 2000), website: ($("hp") || {}).value || "" }) });
      if (!r.ok) throw new Error("http " + r.status);
      S.trText = ""; S.trState = "sent"; render();
      setTimeout(() => { S.trState = ""; S.trOpen = false; render(); }, 2000);
    } catch (e) { S.trState = "err"; render(); setTimeout(() => { S.trState = ""; render(); }, 2400); }
  },
  copyLink() { const v = resumeURL(); navigator.clipboard && navigator.clipboard.writeText(v).catch(() => {}); const b = document.querySelector('[data-act="copyLink"]'); if (b) b.textContent = t("copied"); }
};
function calView() { const a = S.a; if (S.calView) return S.calView; const sel = a.deadline ? new Date(a.deadline + "T00:00:00") : new Date(); return { y: sel.getFullYear(), m: sel.getMonth() }; }

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]"); if (!el) return;
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return;
  if (e.target.closest("input,textarea,select,label.upload")) return;
  const fn = ACT[el.dataset.act]; if (fn) { e.preventDefault(); fn(el); }
});
document.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches('[data-act][role="checkbox"],[data-act][role="radio"],[data-act][role="option"],.rsec[data-act],.ritem[data-act]')) { e.preventDefault(); e.target.click(); }
  if (e.key === "Escape" && S.langOpen) { S.langOpen = false; render(); }
});
document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.id === "evfilter") { S.filter = el.value; const tpl = document.createElement("template"); tpl.innerHTML = STEP_RENDER.events(); const nb = tpl.content.querySelector("#evbody"), ob = $("evbody"); if (nb && ob) ob.replaceWith(nb); else render(); return; }
  if (el.id === "trtext") { S.trText = el.value; return; }
  if (el.dataset && el.dataset.f && el.tagName !== "SELECT") onInput(el);
});
document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.tagName === "SELECT" && el.dataset.f) { setA({ [el.dataset.f]: el.value }); return; }
});
// Re-render on resize only when the layout really changes (phone ↔ laptop rail). A phone keyboard
// changes just the height; re-rendering then would replace the focused field and close the keyboard.
let rw = 0, lastWide = wide();
window.addEventListener("resize", () => {
  clearTimeout(rw);
  rw = setTimeout(() => {
    if (wide() === lastWide) return;
    lastWide = wide();
    const ae = document.activeElement, f = ae && ae.dataset ? ae.dataset.f || ae.id : "";
    render();
    if (f) { const n = document.querySelector('[data-f="' + f + '"], #' + f); if (n) n.focus({ preventScroll: true }); }
  }, 120);
});

// ---------- boot: local draft, personal link (?r=) ----------
(async function boot() {
  const q = new URLSearchParams(location.search);
  const r = (q.get("r") || "").trim();
  if (r && RID_RX.test(r)) {
    let d = null;
    try { const resp = await fetch("/api/letter?rid=" + encodeURIComponent(r)); if (resp.ok) d = await resp.json(); } catch (e) {}
    if (d && d.found) {
      const localBusy = r !== S.rid && hasAnswers() && !S.submitted;
      if (!localBusy || confirm(t("confirm_adopt"))) {
        S.rid = r; S.a = Object.assign(A0(), d.a || {}); if (!Array.isArray(S.a.knownAs) || !S.a.knownAs.length) S.a.knownAs = [""];
        S.submitted = !!d.submitted; S.startedAt = d.startedAt || Date.now(); S.log = []; S.savedStep = null;
        if (d.lang && LANGS.some((l) => l[0] === d.lang) && !q.get("lang")) lang = d.lang;
        if (S.submitted) { S.view = "done"; }
        else { S.view = "welcome"; S.savedStep = Math.min(Math.max(+d.step || 0, 0), STEPS.length - 1); S.savedView = "step"; }
        persist(); addLog("resume", "link");
      }
    }
    history.replaceState(null, "", location.pathname);
  } else if (S.submitted) {
    S.view = "done";
  }
  render();
})();
})();
