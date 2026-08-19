// Агрегация опроса потребностей 2026 → доска Survey 2026 — Aggregates.
//
// Что делает: читает ВСЕ строки доски Community Needs Survey 2026, берёт
// данные из «⚙️ Raw answers» (JSON с машинными кодами — источник истины;
// метки колонок человек может переименовать, ключи JSON — нет), применяет
// правила баз из плана анализа и переписывает доску агрегатов: одна строка =
// один столбик одного вывода (A1–A6). Группу A7 (темы открытых ответов,
// кодируются руками) скрипт НИКОГДА не трогает. В Run log добавляется строка
// о каждом прогоне.
//
// Правила честных процентов (из плана анализа):
// - База каждого вопроса = отправленные ответы, где вопрос ПОКАЗЫВАЛСЯ
//   (маршрутизация: q5 только у неактивных по q4 и т.д.) И был отвечен.
// - «Эксклюзивные» варианты (none / safe / max / not_participated) — не
//   вариант среди прочих: считаются отдельной строкой и не входят в
//   числители остальных.
// - Подгруппа с базой < 10 подавляется: вместо ячеек пишется одна строка-
//   заглушка «suppressed», чтобы дыра была видна, а не потеряна.
// - Черновики (In progress) в анализ не входят; учитываются только в Run log.
// - lang берётся из JSON; строки без ключа lang считаются "unknown", а не RU.
//
// Запуск:
//   MONDAY_TOKEN=… node tools/aggregate-survey.mjs           # боевой прогон
//   node tools/aggregate-survey.mjs --dry --fixture rows.json # тест без записи
// Еженедельный автозапуск: Vercel cron → api/aggregate.mjs (нужен CRON_SECRET).
import { readFileSync } from "node:fs";
import { L } from "../api/survey.mjs";

const MONDAY = "https://api.monday.com/v2";
const RESPONSES_BOARD = "18426996689";
const RAW_COL = "long_text_mm6bxg7f";
const GROUP_SUBMITTED = "group_mm6bvfyd";

const AGG_BOARD = "18427179045";
const AC = {
  analysis: "color_mm6c1ecr",
  breakdown: "color_mm6ccbs0",
  percent: "numeric_mm6c52cw",
  count: "numeric_mm6c8zd1",
  base: "numeric_mm6ces1x",
  baseDesc: "text_mm6cvqbr",
  sort: "numeric_mm6cmvv7",
  multi: "color_mm6cfpsj",
  suppressed: "color_mm6c1f1s",
  caveat: "long_text_mm6cka9",
  updated: "date_mm6cz5sg",
};
// Группы, которые скрипт стирает и пишет заново. A7 здесь НЕТ намеренно.
const AGG_GROUPS = {
  A1: "group_mm6cyxaq",
  A2a: "group_mm6ceh50",
  A2b: "group_mm6cc3p6",
  A3c: "group_mm6cfna5",
  A4a: "group_mm6c9e19",
  A4b: "group_mm6ck05d",
  "A5-channels": "group_mm6czpha",
  A6: "group_mm6cddcc",
};
const RUNLOG_GROUP = "group_mm6cxb9c";
const SUPPRESS_BELOW = 10; // подгруппы меньше этого не публикуются

async function monday(query, variables = {}) {
  const r = await fetch(MONDAY, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: process.env.MONDAY_TOKEN, "API-Version": "2024-10" },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 500));
  return j.data;
}

// ---------- чтение ответов ----------
export async function fetchRows() {
  const rows = [];
  let cursor = null;
  do {
    const d = await monday(
      `query ($b: [ID!], $c: String) { boards(ids: $b) { items_page(limit: 200, cursor: $c) {
        cursor items { id created_at group { id } column_values(ids: ["${RAW_COL}"]) { text } } } } }`,
      { b: [RESPONSES_BOARD], c: cursor });
    const page = d.boards[0].items_page;
    for (const it of page.items) rows.push({ id: it.id, createdAt: it.created_at, group: it.group.id, raw: it.column_values[0]?.text || "" });
    cursor = page.cursor;
  } while (cursor);
  return rows;
}

// ---------- производные переменные ----------
const TENURE = { lt6m: "New", m6to12: "New", y1to3: "Establishing", y3to5: "Establishing", gt5y: "Settled", usborn: "Settled" };
const PART = { weekly: "Active", fewmonth: "Active", monthly: "Active", few6mo: "Occasional", once: "Occasional", before: "Lapsed", never: "Never" };
const answeredMulti = (a, q) => Array.isArray(a[q]) && a[q].length > 0;

// ---------- расчёт ----------
export function compute(rows, today) {
  const parsed = rows.map((r) => {
    let j = null;
    try { j = JSON.parse(r.raw || "null"); } catch (e) {}
    return { ...r, j };
  });
  const noJson = parsed.filter((r) => !r.j);
  const sub = parsed.filter((r) => r.j && r.group === GROUP_SUBMITTED).map((r) => ({
    ...r, a: r.j.answers || {}, lang: r.j.lang || "unknown",
    minutes: r.j.startedAt && r.j.savedAt ? Math.round((new Date(r.j.savedAt) - r.j.startedAt) / 6000) / 10 : null,
  }));
  const drafts = parsed.filter((r) => r.j && r.group !== GROUP_SUBMITTED);

  const items = [];
  const dateCv = { date: today };
  const push = (analysis, group, name, breakdown, fields) => items.push({
    group, name,
    cv: {
      [AC.analysis]: { label: analysis },
      [AC.breakdown]: { label: breakdown },
      [AC.updated]: dateCv,
      ...fields,
    },
  });

  // Один мультивыборный анализ: доли ответивших по каждому варианту.
  // exclusive-варианты не в числителях; для каждого — своя строка в конце.
  function multiAnalysis({ analysis, q, labels, exclusive = [], rowsIn, breakdown, baseNoun, caveat }) {
    const base = rowsIn.filter((r) => answeredMulti(r.a, q));
    const n = base.length;
    const baseDesc = `of ${n} who answered ${baseNoun}` + (breakdown !== "All" ? ` (${breakdown})` : "");
    if (breakdown !== "All" && n < SUPPRESS_BELOW) {
      push(analysis, AGG_GROUPS[analysis], `${breakdown} — suppressed (base ${n} < ${SUPPRESS_BELOW})`, breakdown, {
        [AC.base]: String(n), [AC.baseDesc]: baseDesc,
        [AC.sort]: "99", [AC.multi]: { label: "Yes" }, [AC.suppressed]: { label: "Yes" },
        [AC.caveat]: { text: "Too few respondents in this subgroup to report percentages." },
      });
      return { n, suppressed: true };
    }
    const scored = Object.keys(labels)
      .filter((c) => !exclusive.includes(c))
      .map((c) => ({ code: c, count: base.filter((r) => r.a[q].includes(c)).length }))
      .sort((x, y) => y.count - x.count);
    scored.forEach((s, i) => {
      push(analysis, AGG_GROUPS[analysis], labels[s.code], breakdown, {
        [AC.percent]: n ? String(Math.round((s.count / n) * 100)) : "",
        [AC.count]: String(s.count), [AC.base]: String(n), [AC.baseDesc]: baseDesc,
        [AC.sort]: String(i + 1), [AC.multi]: { label: "Yes" }, [AC.suppressed]: { label: "No" },
        [AC.caveat]: { text: caveat },
      });
    });
    exclusive.forEach((c, i) => {
      const count = base.filter((r) => r.a[q].includes(c)).length;
      push(analysis, AGG_GROUPS[analysis], labels[c], breakdown, {
        [AC.percent]: n ? String(Math.round((count / n) * 100)) : "",
        [AC.count]: String(count), [AC.base]: String(n), [AC.baseDesc]: baseDesc,
        [AC.sort]: String(90 + i), [AC.multi]: { label: "No" }, [AC.suppressed]: { label: "No" },
        [AC.caveat]: { text: "Exclusive option — counted separately, not among the items above." },
      });
    });
    return { n, suppressed: false };
  }

  const MULTI_CAVEAT = "Up to several choices each — percentages add to more than 100%.";

  // A1 — потребности (топлайн)
  multiAnalysis({ analysis: "A1", q: "q13", labels: L.q13, exclusive: ["none"], rowsIn: sub, breakdown: "All", baseNoun: "Q13", caveat: "Up to 3 choices each — percentages add to more than 100%. Respondents, not the community." });

  // A2a / A2b — потребности по стажу в США и по статусу участия
  for (const g of ["New", "Establishing", "Settled"]) {
    multiAnalysis({ analysis: "A2a", q: "q13", labels: L.q13, exclusive: ["none"], rowsIn: sub.filter((r) => TENURE[r.a.q8] === g), breakdown: g, baseNoun: "Q13", caveat: "Percentages within this tenure group. " + MULTI_CAVEAT });
  }
  for (const g of ["Active", "Occasional", "Lapsed", "Never"]) {
    multiAnalysis({ analysis: "A2b", q: "q13", labels: L.q13, exclusive: ["none"], rowsIn: sub.filter((r) => PART[r.a.q4] === g), breakdown: g, baseNoun: "Q13", caveat: "Percentages within this participation group. " + MULTI_CAVEAT });
  }

  // A3c — что помогло бы чувствовать себя безопаснее
  multiAnalysis({ analysis: "A3c", q: "q19", labels: L.q19, exclusive: ["safe"], rowsIn: sub, breakdown: "All", baseNoun: "Q19", caveat: "The action list: measures respondents chose. " + MULTI_CAVEAT });

  // A4a — барьеры; вопрос показывался только неактивным (q4 ∈ low/none)
  multiAnalysis({ analysis: "A4a", q: "q5", labels: L.q5, rowsIn: sub.filter((r) => ["few6mo", "once", "before", "never"].includes(r.a.q4)), breakdown: "All", baseNoun: "Q5 (asked only of the not-active)", caveat: "Base: respondents who take part rarely or not at all — NOT all respondents. " + MULTI_CAVEAT });

  // A4b — что помогло бы участвовать чаще
  multiAnalysis({ analysis: "A4b", q: "q21", labels: L.q21, exclusive: ["max"], rowsIn: sub, breakdown: "All", baseNoun: "Q21", caveat: MULTI_CAVEAT });

  // A5 — каналы
  multiAnalysis({ analysis: "A5-channels", q: "q22", labels: L.q22, rowsIn: sub, breakdown: "All", baseNoun: "Q22", caveat: "Drives where announcements go. " + MULTI_CAVEAT });

  // A6 — ценность программ, топлайн + по статусу участия
  multiAnalysis({ analysis: "A6", q: "q16", labels: L.q16, exclusive: ["none"], rowsIn: sub, breakdown: "All", baseNoun: "Q16", caveat: "Non-participants answered about what LOOKS most useful — not the same as experienced value. " + MULTI_CAVEAT });
  for (const g of ["Active", "Occasional", "Lapsed", "Never"]) {
    multiAnalysis({ analysis: "A6", q: "q16", labels: L.q16, exclusive: ["none"], rowsIn: sub.filter((r) => PART[r.a.q4] === g), breakdown: g, baseNoun: "Q16", caveat: "Percentages within this participation group. " + MULTI_CAVEAT });
  }

  // ---------- журнал прогона ----------
  const langs = {};
  for (const r of sub) langs[r.lang] = (langs[r.lang] || 0) + 1;
  const pna = (q) => sub.filter((r) => r.a[q] === "pnts").length;
  const speeders = sub.filter((r) => r.minutes != null && r.minutes < 3);
  const log = {
    submitted: sub.length,
    drafts: drafts.length,
    noJson: noJson.length,
    langs,
    missingLang: sub.filter((r) => !r.j.lang).length,
    speedersFlagged: speeders.map((r) => r.id),
    pnaRates: { q7: pna("q7"), q9: pna("q9"), q10: pna("q10"), q12: pna("q12"), q14: pna("q14"), q17: sub.filter((r) => r.a.q17 === "pnts").length },
    medianMinutes: (() => { const m = sub.map((r) => r.minutes).filter((x) => x != null).sort((a, b) => a - b); return m.length ? m[Math.floor(m.length / 2)] : null; })(),
  };
  const logLines = [
    `Submitted: ${log.submitted} · drafts: ${log.drafts}` + (log.noJson ? ` · rows without JSON: ${log.noJson}` : ""),
    `Languages: ${Object.entries(langs).map(([k, v]) => `${k}=${v}`).join(", ") || "—"}` + (log.missingLang ? ` (no lang key, counted as unknown: ${log.missingLang})` : ""),
    `Median minutes: ${log.medianMinutes ?? "—"} · speeders under 3 min flagged (NOT excluded): ${speeders.length ? speeders.map((r) => r.id).join(", ") : "none"}`,
    `Prefer-not-to-answer counts — q7: ${log.pnaRates.q7}, q9: ${log.pnaRates.q9}, q10: ${log.pnaRates.q10}, q12: ${log.pnaRates.q12}, q14: ${log.pnaRates.q14}, q17: ${log.pnaRates.q17}`,
    "Suppression: subgroup cells with base < 10 are written as a single 'suppressed' placeholder row.",
  ];
  const runItem = {
    group: RUNLOG_GROUP,
    name: `Run ${today} — ${sub.length} submitted, ${drafts.length} drafts`,
    cv: {
      [AC.count]: String(sub.length), [AC.base]: String(drafts.length),
      [AC.updated]: dateCv, [AC.caveat]: { text: logLines.join("\n") },
    },
  };
  return { items, runItem, log };
}

// ---------- запись ----------
async function clearOwnedGroups() {
  const d = await monday(
    `query ($b: [ID!]) { boards(ids: $b) { groups(ids: ${JSON.stringify(Object.values(AGG_GROUPS))}) { id items_page(limit: 500) { items { id } } } } }`,
    { b: [AGG_BOARD] });
  const ids = d.boards[0].groups.flatMap((g) => g.items_page.items.map((i) => i.id));
  for (let i = 0; i < ids.length; i += 25) {
    const batch = ids.slice(i, i + 25);
    await monday("mutation {" + batch.map((id, k) => `d${k}: delete_item(item_id: ${id}) { id }`).join(" ") + "}");
  }
  return ids.length;
}

async function writeItems(all) {
  // Пакетами по 10 алиасами — иначе ~80 последовательных create_item не
  // укладываются в лимит времени серверлес-функции.
  // Порядок массива = порядок строк на доске: create_item дописывает В КОНЕЦ
  // группы, а compute() отдаёт варианты от популярных к редким — поэтому
  // партии нельзя пускать параллельно или в другом порядке.
  for (let i = 0; i < all.length; i += 10) {
    const batch = all.slice(i, i + 10);
    const defs = batch.map((_, k) => `$n${k}: String!, $v${k}: JSON!`).join(", ");
    const muts = batch.map((it, k) =>
      `i${k}: create_item(board_id: ${AGG_BOARD}, group_id: "${it.group}", item_name: $n${k}, column_values: $v${k}, create_labels_if_missing: false) { id }`).join(" ");
    const vars = {};
    batch.forEach((it, k) => { vars[`n${k}`] = it.name.slice(0, 255); vars[`v${k}`] = JSON.stringify(it.cv); });
    await monday(`mutation (${defs}) { ${muts} }`, vars);
  }
}

export async function run({ dry = false, fixture = null } = {}) {
  const rows = fixture ? JSON.parse(readFileSync(fixture, "utf8")) : await fetchRows();
  const today = new Date().toISOString().slice(0, 10);
  const { items, runItem, log } = compute(rows, today);
  if (dry) return { items, runItem, log, wrote: false };
  const deleted = await clearOwnedGroups();
  await writeItems(items);
  await writeItems([runItem]);
  return { log, deleted, written: items.length + 1, wrote: true };
}

// CLI
if (process.argv[1] && process.argv[1].endsWith("aggregate-survey.mjs")) {
  const dry = process.argv.includes("--dry");
  const fi = process.argv.indexOf("--fixture");
  const fixture = fi > -1 ? process.argv[fi + 1] : null;
  if (!dry && !process.env.MONDAY_TOKEN) { console.error("MONDAY_TOKEN is required for a live run (use --dry --fixture for testing)"); process.exit(1); }
  run({ dry, fixture }).then((res) => {
    console.log(JSON.stringify(res, null, 1));
  }).catch((e) => { console.error("aggregation failed:", e.message); process.exit(1); });
}
