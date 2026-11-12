// Checks one language of the movie club against English: the page's words (club/index.html STRINGS), the
// welcome page's (club/welcome.html T) and the two emails' (lib/club.mjs T and AGAIN). A language file is
// club/_new/<code>.js: export default { page, welcome, mail, again }. Same keys, the same kind of value (text,
// a function taking as many arguments, a nested list), the same tags and $ amounts, no Cyrillic in a Latin
// language. Usage: node tools/club-langs-check.mjs <code> [file]
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The object literal that follows `name = ` in a file, read as code.
export function objectAfter(text, name) {
  const at = text.indexOf(name);
  if (at < 0) throw new Error(`no ${name}`);
  let i = text.indexOf("{", at), depth = 0, q = null;
  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (q) { if (c === "\\") j++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === "`") q = c;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return Function(`return (${text.slice(i, j + 1)})`)();
  }
  throw new Error(`unclosed ${name}`);
}
export const sources = () => ({
  page: objectAfter(fs.readFileSync("club/index.html", "utf8"), "const STRINGS = "),
  welcome: objectAfter(fs.readFileSync("club/welcome.html", "utf8"), "const T = "),
  mail: objectAfter(fs.readFileSync("lib/club.mjs", "utf8"), "const T = "),
  again: objectAfter(fs.readFileSync("lib/club.mjs", "utf8"), "const AGAIN = "),
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [code, file = `club/_new/${code}.js`] = process.argv.slice(2);
  if (!code) { console.error("usage: node tools/club-langs-check.mjs <code> [file]"); process.exit(2); }
  const src = sources();
  const mine = (await import(pathToFileURL(path.resolve(file)).href + `?t=${process.hrtime.bigint()}`)).default || {};
  const LATIN = new Set(["es", "az", "tk", "uz", "en"]);
  const cyr = /[А-Яа-яЁёІіЇїЄєҒғҚқҲҳҶҷӢӣӮӯҢңӨөҮүЎў]/;
  const bad = [];
  const tags = (s) => (String(s).match(/<\/?[a-z]+/gi) || []).map((t) => t.toLowerCase()).sort().join(",");
  const money = (s) => (String(s).match(/\$\d+/g) || []).sort().join(",");
  const text = (where, en, t) => {
    if (typeof t !== "string" || !t.trim()) return bad.push(`${where}: empty or not text`);
    if (tags(en) !== tags(t)) bad.push(`${where}: tags ${tags(en)} vs ${tags(t)}`);
    if (money(en) !== money(t)) bad.push(`${where}: amounts ${money(en)} vs ${money(t)}`);
    if (LATIN.has(code) && cyr.test(t)) bad.push(`${where}: Cyrillic in a Latin-script language`);
  };
  const walk = (where, en, t) => {
    if (typeof en === "function") {
      if (typeof t !== "function") return bad.push(`${where}: must be a function like the English`);
      if (t.length !== en.length) bad.push(`${where}: takes ${t.length} arguments, English ${en.length}`);
      const args = [[], ["Anna"], [3, 4], [5, 4, 3]][en.length] || [];
      try { text(`${where}()`, en(...args), t(...args)); } catch (e) { bad.push(`${where}: throws ${e.message}`); }
      return;
    }
    if (en && typeof en === "object") {
      if (!t || typeof t !== "object") return bad.push(`${where}: must be a list like the English`);
      for (const k of Object.keys(en)) if (!(k in t)) bad.push(`${where}.${k}: missing`); else walk(`${where}.${k}`, en[k], t[k]);
      for (const k of Object.keys(t)) if (!(k in en)) bad.push(`${where}.${k}: not in English`);
      return;
    }
    text(where, en, t);
  };
  for (const part of ["page", "welcome", "mail", "again"]) {
    if (!mine[part]) { bad.push(`${part}: missing`); continue; }
    walk(part, src[part].en, mine[part]);
  }
  if (bad.length) { console.log(bad.join("\n")); console.log(`${code}: ${bad.length} problems`); process.exit(1); }
  console.log(`${code}: no problems`);
}
