// Checks one language of the letter form against English (strings) and Russian (event names):
// the same keys, the same {placeholders} and tags, one plural form per number shape, 12 months,
// 7 weekdays, no Cyrillic in a Latin-script language. Usage:
//   node tools/letter-langs-check.mjs <code> [strings-file] [events-file]
// With no files it reads the language from letter/strings.js and letter/events-i18n.js.
import fs from "node:fs";
import vm from "node:vm";

const [code, sFile = "letter/strings.js", eFile = "letter/events-i18n.js"] = process.argv.slice(2);
if (!code) { console.error("usage: node tools/letter-langs-check.mjs <code> [strings-file] [events-file]"); process.exit(2); }
const load = (files) => { const w = { window: {} }; vm.createContext(w); for (const f of files) vm.runInContext(fs.readFileSync(f, "utf8"), w); return w.window; };
const base = load(["letter/strings.js", "letter/events-i18n.js"]);
const mine = load([...new Set([sFile, eFile])].filter((f) => fs.existsSync(f)));
const en = base.QARAVAN_STRINGS.en, ruEv = base.QARAVAN_EVENTS_I18N.ru;
const S = (mine.QARAVAN_STRINGS || {})[code], E = (mine.QARAVAN_EVENTS_I18N || {})[code];
const LATIN = new Set(["es", "az", "tk", "uz", "en"]);
const bad = [];
const ph = (s) => (String(s).match(/\{[a-z_]+\}/g) || []).sort().join(",");
const tags = (s) => (String(s).match(/<\/?[a-z]+/gi) || []).map((t) => t.toLowerCase()).sort().join(",");
// Titles quoted as they were, in «» or „“ (a Russian event name), may keep their Cyrillic.
const cyr = (s) => /[А-Яа-яЁёІіЇїЄєҒғҚқҲҳҶҷӢӣӮӯҢңӨөҮүЎў]/.test(String(s).replace(/«[^»]*»|„[^“”]*[“”]/g, ""));
const look = (where, src, t) => {
  if (typeof t !== "string" || !t.trim()) return bad.push(`${where}: empty`);
  if (ph(src) !== ph(t)) bad.push(`${where}: placeholders ${ph(src)} vs ${ph(t)}`);
  if (tags(src) !== tags(t)) bad.push(`${where}: tags ${tags(src)} vs ${tags(t)}`);
  if (LATIN.has(code) && cyr(t)) bad.push(`${where}: Cyrillic in a Latin-script language`);
};
if (!S) bad.push(`no QARAVAN_STRINGS.${code}`);
else {
  if (typeof S.plural !== "function") bad.push("plural: not a function");
  const forms = new Set([0, 1, 2, 3, 4, 5, 11, 21, 22, 25, 101].map((n) => S.plural(n)));
  const nForms = Math.max(...forms) + 1;
  for (const k of Object.keys(en)) if (!(k in S)) bad.push(`${k}: missing`);
  for (const k of Object.keys(S)) if (!(k in en)) bad.push(`${k}: not in English`);
  for (const [k, v] of Object.entries(en)) {
    if (k === "plural" || !(k in S)) continue;
    const t = S[k];
    if (Array.isArray(v)) {
      if (!Array.isArray(t)) { bad.push(`${k}: must be a list of plural forms`); continue; }
      if (t.length !== nForms) bad.push(`${k}: ${t.length} forms, plural() gives ${nForms}`);
      t.forEach((x, i) => look(`${k}[${i}]`, v[0], x));
    } else {
      look(k, v, t);
      if (k === "months" && String(t).split("|").length !== 12) bad.push("months: need 12");
      if (k === "dow" && String(t).split("|").length !== 7) bad.push("dow: need 7");
    }
  }
}
if (!E) bad.push(`no QARAVAN_EVENTS_I18N.${code}`);
else {
  for (const [k, v] of Object.entries(ruEv)) {
    const t = E[k];
    if (t === undefined) { bad.push(`event ${k}: missing`); continue; }
    if (Array.isArray(v) !== Array.isArray(t)) { bad.push(`event ${k}: shape`); continue; }
    (Array.isArray(v) ? v : [v]).forEach((x, i) => look(`event ${k}${Array.isArray(v) ? `[${i}]` : ""}`, x, Array.isArray(t) ? t[i] : t));
  }
  for (const k of Object.keys(E)) if (!(k in ruEv)) bad.push(`event ${k}: not in Russian`);
}
if (bad.length) { console.log(bad.join("\n")); console.log(`${code}: ${bad.length} problems`); process.exit(1); }
console.log(`${code}: no problems`);
