// GET /api/event?id=NNN — the form asks who it is talking about.
// Returns name, a human date for the eyebrow, and the event's custom question.
const MONDAY = "https://api.monday.com/v2";
const EVENTS_BOARD = "4774572020";
const DATE_COL = "date4";
// «Свой вопрос гостям» на календаре: один дополнительный вопрос про конкретное
// событие. Пусто — форма показывает обычный набор вопросов.
const CUSTOM_COL = "long_text_mm64tyb5";

const MONTHS_RU = ["января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря"];

function ruDate(text) {
  // monday gives "2026-08-09 18:00" (or just the date); time shown as AM/PM
  const m = (text || "").match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}))?/);
  if (!m) return "";
  const [, y, mo, d, hh, mm] = m;
  let t = "";
  if (hh !== undefined) {
    const h = Number(hh);
    t = `, ${h % 12 || 12}:${mm} ${h < 12 ? "AM" : "PM"}`;
  }
  return `${Number(d)} ${MONTHS_RU[Number(mo) - 1]} ${y}${t}`;
}

export default async function handler(req, res) {
  const id = String(new URL(req.url, "https://x").searchParams.get("id") || "").replace(/\D/g, "");
  if (!id) { res.statusCode = 400; return res.end("{}"); }
  const r = await fetch(MONDAY, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: process.env.MONDAY_TOKEN, "API-Version": "2024-10" },
    body: JSON.stringify({
      query: `query ($ids: [ID!]) { items(ids: $ids) { id name board { id } column_values(ids: ["${DATE_COL}","${CUSTOM_COL}"]) { id text } } }`,
      variables: { ids: [id] },
    }),
  });
  const j = await r.json();
  const item = j.data?.items?.[0];
  if (!item || String(item.board.id) !== EVENTS_BOARD) { res.statusCode = 404; return res.end("{}"); }
  const cols = Object.fromEntries(item.column_values.map((c) => [c.id, c.text || ""]));
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=600");
  res.end(JSON.stringify({ name: item.name, date: ruDate(cols[DATE_COL]), custom: (cols[CUSTOM_COL] || "").trim() }));
}
