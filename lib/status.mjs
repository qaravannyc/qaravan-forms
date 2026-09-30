// Статус анкеты группы поддержки — по кнопке «Изменить статус» из письма команде о новой
// анкете (lib/support-mail.mjs). Кнопка открывает /support/status?t=<ключ> (support/status.js):
// имя, почта, дата анкеты и те же статусы, что в колонке Status на доске группы в monday, —
// читаем их с доски, так что новый статус, добавленный в monday, появится и здесь. Выбор
// (POST /api/status) пишется в эту колонку строки анкеты, и на строке остаётся апдейт.
// У Джины статус — это и рассылка: с «Joined» человек получает письма со ссылкой на встречу
// (lib/meetings.mjs). У доски Саймона статуса нет, поэтому кнопка — только в письмах Джины.
// Ключ — тот же HMAC, что у страниц встречи, с назначением "st": номер строки и группа;
// работает год, по нему видно только имя, почту и статус этого человека.
import { GROUPS, signToken, verifyToken } from "./meetings.mjs";
import { monday } from "./letter-board.mjs";

const FORM_BASE = process.env.FORM_BASE || "https://feedback.qaravan.org";
const DAYS = 365;
export const hasStatus = (group) => !!GROUPS[group]?.C?.status;
export const statusUrl = (item, group, now = new Date(), env = process.env) =>
  `${FORM_BASE}/support/status?t=${signToken({ item, group, exp: now.getTime() + DAYS * 86400000, kind: "st" }, env)}`;

// что значит статус (на доске — по-английски)
export const HINTS = {
  New: "Новая анкета, с человеком ещё не связывались",
  Contacted: "Связались, договариваемся о знакомстве",
  "Intro call done": "Знакомство прошло",
  Joined: "В группе: получает письма со ссылкой на встречу",
  "Not now": "Не сейчас: писем со ссылкой на встречу не получает",
};

// метки колонки статуса в том порядке, как в monday, без выключенных
export function labelsOf(settingsStr) {
  let s = {};
  try { s = JSON.parse(settingsStr || "{}") || {}; } catch {}
  const off = new Set((s.deactivated_labels || []).map(String));
  const pos = s.labels_positions_v2 || {};
  return Object.entries(s.labels || {}).filter(([k, v]) => v && !off.has(String(k)))
    .sort(([a], [b]) => (pos[a] ?? 1e9) - (pos[b] ?? 1e9) || Number(a) - Number(b)).map(([, v]) => v);
}

// ---------- monday ----------
export const mondayStore = {
  // строка анкеты и метки статуса одним запросом
  async load(group, id) {
    const { board, C } = GROUPS[group];
    const cols = [C.status, C.email, C.submitted].filter(Boolean);
    const d = await monday(`query ($i: [ID!], $b: [ID!]) { items(ids: $i) { id name created_at board { id } column_values(ids: ${JSON.stringify(cols)}) { id text } } boards(ids: $b) { columns(ids: ["${C.status}"]) { settings_str } } }`,
      { i: [String(id)], b: [board] });
    const it = d.items?.[0];
    const labels = labelsOf(d.boards?.[0]?.columns?.[0]?.settings_str);
    if (!it || String(it.board?.id) !== String(board)) return { item: null, labels };
    const cv = Object.fromEntries((it.column_values || []).map((c) => [c.id, c.text || ""]));
    return { item: { id: String(it.id), name: it.name, status: cv[C.status] || "", email: (cv[C.email] || "").toLowerCase(), date: C.submitted ? cv[C.submitted] || "" : it.created_at || "" }, labels };
  },
  async setStatus(group, id, label) {
    const { board, C } = GROUPS[group];
    await monday(`mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id: $b, item_id: $i, column_values: $v) { id } }`,
      { b: board, i: String(id), v: JSON.stringify({ [C.status]: { label } }) });
  },
  async note(id, text) {
    await monday(`mutation ($i: ID!, $t: String!) { create_update(item_id: $i, body: $t) { id } }`, { i: String(id), t: text });
  },
};
let store = mondayStore;
export const setStore = (s) => { store = s || mondayStore; };

async function open(t, now) {
  const v = verifyToken(t, now.getTime(), process.env, "st");
  if (v.error) return { error: v.error };
  if (!hasStatus(v.group)) return { error: "bad" };
  const { item, labels } = await store.load(v.group, v.item);
  if (!item) return { error: "gone" };
  return { group: v.group, item, labels };
}

export async function statusData(t, now = new Date()) {
  const r = await open(t, now);
  if (r.error) return r;
  const { group, item, labels } = r, G = GROUPS[group];
  return {
    group, title: G.title, name: item.name, email: item.email, date: String(item.date).slice(0, 10), status: item.status,
    options: labels.map((label) => ({ label, hint: HINTS[label] || "" })),
    url: `https://qaravan.monday.com/boards/${G.board}/pulses/${item.id}`,
  };
}

export async function saveStatus(t, body, now = new Date()) {
  const r = await open(t, now);
  if (r.error) return { status: r.error === "gone" ? 404 : 403, error: r.error };
  const { group, item, labels } = r;
  const label = String(body?.status ?? "").trim();
  if (!labels.includes(label)) return { status: 400, error: "invalid" };
  if (label !== item.status) {
    await store.setStatus(group, item.id, label);
    await store.note(item.id, `Статус: ${item.status || "без статуса"} → ${label}. По кнопке «Изменить статус» из письма о новой анкете.`)
      .catch((e) => console.error("status note failed:", e.message));
  }
  return { status: 200, ok: true, label, was: item.status, changed: label !== item.status, at: now.toISOString() };
}

// ---------- HTTP ----------
async function readJson(req) {
  const chunks = []; for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return null; }
}
const reply = (res, status, obj) => { res.statusCode = status; res.end(JSON.stringify(obj)); };

// GET /api/status?t=… → человек и статусы; POST /api/status { t, status } → записать.
// Вручную, только с секретом: GET /api/status?key=<CRON_SECRET>&item=<id строки>[&group=gina] —
// ссылка на страницу статуса для анкеты, пришедшей до этой кнопки (строку не читает).
export async function statusHandler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  const u = new URL(req.url, "https://x");
  try {
    if (req.method === "GET" && u.searchParams.has("key")) {
      const key = process.env.CRON_SECRET;
      if (!key || u.searchParams.get("key") !== key) return reply(res, 401, { error: "unauthorized" });
      const item = u.searchParams.get("item") || "", group = u.searchParams.get("group") || "gina";
      if (!/^\d+$/.test(item) || !hasStatus(group)) return reply(res, 400, { error: "item and a group with a status column" });
      return reply(res, 200, { url: statusUrl(item, group) });
    }
    if (req.method === "GET") {
      const d = await statusData(u.searchParams.get("t"));
      return reply(res, d.error ? (d.error === "gone" ? 404 : 403) : 200, d);
    }
    if (req.method === "POST") {
      const b = await readJson(req);
      if (!b) return reply(res, 400, { error: "invalid" });
      const { status, ...rest } = await saveStatus(b.t, b);
      return reply(res, status, rest);
    }
    return reply(res, 405, {});
  } catch (e) {
    console.error("status:", e.message);
    return reply(res, 502, { error: "failed" });
  }
}
