// POST /api/rescue-file?event=<id>&name=<filename> — последний рубеж.
//
// Если Google Photos не принял файл гостя ни в альбом, ни в библиотеку, форма
// присылает сюда сами байты, и мы кладём их в колонку «📎 Rescued photos» на
// строке события в monday. Ничего не пропадает: файл лежит у нас, человек
// потом разложит его руками.
//
// Ограничение: тело запроса у Vercel — 4.5 МБ, поэтому больший файл сюда не
// доедет. Форма это знает и о таких файлах пишет прямо в отзыв и в Slack.
const MONDAY_FILE = "https://api.monday.com/v2/file";
const MONDAY = "https://api.monday.com/v2";
const EVENTS_BOARD = "4774572020";
const RESCUE_COL = "file_mm64jejp";
const MAX_BYTES = 4 * 1024 * 1024;

async function slackNotify(text) {
  const tok = process.env.SLACK_BOT_TOKEN, ch = process.env.SLACK_CHANNEL_ID;
  if (!tok || !ch) return;
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ channel: ch, text, unfurl_links: false }),
  }).catch(() => {});
}

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "POST") { res.statusCode = 405; return res.end('{"ok":false}'); }

  const u = new URL(req.url, "https://x");
  const eventId = String(u.searchParams.get("event") || "").replace(/\D/g, "");
  const name = String(u.searchParams.get("name") || "file").replace(/[\r\n"\\]/g, "").slice(0, 120);
  if (!eventId) { res.statusCode = 400; return res.end('{"ok":false,"error":"no event"}'); }

  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BYTES) { res.statusCode = 413; return res.end('{"ok":false,"error":"too big"}'); }
    chunks.push(c);
  }
  const buf = Buffer.concat(chunks);
  if (!buf.length) { res.statusCode = 400; return res.end('{"ok":false,"error":"empty"}'); }

  // Событие должно быть настоящим — иначе эндпоинт станет свалкой для чужих файлов.
  try {
    const check = await fetch(MONDAY, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: process.env.MONDAY_TOKEN, "API-Version": "2024-10" },
      body: JSON.stringify({ query: `query ($ids: [ID!]) { items(ids: $ids) { id name board { id } } }`, variables: { ids: [eventId] } }),
    }).then((r) => r.json());
    const item = check.data?.items?.[0];
    if (!item || String(item.board.id) !== EVENTS_BOARD) { res.statusCode = 404; return res.end('{"ok":false,"error":"event not found"}'); }

    // monday принимает файлы отдельным multipart-эндпоинтом
    const form = new FormData();
    form.append("query", `mutation ($file: File!) { add_file_to_column (item_id: ${eventId}, column_id: "${RESCUE_COL}", file: $file) { id } }`);
    form.append("map", '{"image":"variables.file"}');
    form.append("image", new Blob([buf]), name);
    const up = await fetch(MONDAY_FILE, {
      method: "POST",
      headers: { Authorization: process.env.MONDAY_TOKEN, "API-Version": "2024-10" },
      body: form,
    }).then((r) => r.json());

    if (!up.data?.add_file_to_column?.id) {
      console.error("rescue upload failed:", JSON.stringify(up).slice(0, 300));
      await slackNotify(`⚠️ Файл гостя «${name}» (${Math.round(buf.length / 1024)} КБ) не принял ни Google Photos, ни monday — событие «${item.name}». Нужно попросить прислать заново.`);
      res.statusCode = 502;
      return res.end('{"ok":false,"error":"monday upload failed"}');
    }
    await slackNotify(`📎 Google Photos не принял файл «${name}» с события «${item.name}» — сохранил его в колонку «📎 Rescued photos» на строке события: https://qaravan.monday.com/boards/${EVENTS_BOARD}/pulses/${eventId}`);
    return res.end('{"ok":true}');
  } catch (e) {
    console.error("rescue-file failed:", e.message);
    res.statusCode = 500;
    return res.end('{"ok":false}');
  }
}
