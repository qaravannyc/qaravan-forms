// GET /api/aggregate — пересчёт доски Survey 2026 — Aggregates.
// Еженедельный запуск: Vercel cron (см. vercel.json). Vercel сам добавляет
// заголовок Authorization: Bearer <CRON_SECRET>, когда в переменных окружения
// проекта задан CRON_SECRET — без него эндпоинт честно отказывает, чтобы
// публичный URL нельзя было дёргать посторонним. Ручной запуск: тот же
// заголовок или ?key=<CRON_SECRET>.
import { run } from "../tools/aggregate-survey.mjs";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  const secret = process.env.CRON_SECRET;
  if (!secret) { res.statusCode = 503; return res.end('{"error":"CRON_SECRET is not set in Vercel — add it to enable aggregation runs"}'); }
  const url = new URL(req.url, "https://x");
  if ((req.headers.authorization || "") !== `Bearer ${secret}` && url.searchParams.get("key") !== secret) {
    res.statusCode = 401; return res.end("{}");
  }
  try {
    const out = await run({});
    return res.end(JSON.stringify(out));
  } catch (e) {
    console.error("aggregate failed:", e.message);
    res.statusCode = 502; return res.end(JSON.stringify({ error: String(e.message).slice(0, 300) }));
  }
}
