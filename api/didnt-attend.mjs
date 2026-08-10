// GET /api/didnt-attend?i=<eventId>&a=<attendeeId>&s=<signature>
// The "I didn't attend" link from survey emails. Records the fact on the
// Отзывы board under the person's respondent key, so a later real submission
// through their personal link lands in the same row. The link is signed with
// UNSUB_SECRET; nobody can mark другого человека by guessing ids.
import { createHmac, timingSafeEqual } from "node:crypto";

const MONDAY = "https://api.monday.com/v2";
const EVENTS_BOARD = "4774572020";
const FEEDBACK_BOARD = "18423848983";
const ATTENDEES_BOARD = "18425190164";
const RESPONDENT_COL = "text_mm63r903";
const F_EVENT_NAME = "text_mm5nfyst";
const F_EVENT_REL = "board_relation_mm5nbv55";

async function monday(query, variables = {}) {
  const r = await fetch(MONDAY, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: process.env.MONDAY_TOKEN, "API-Version": "2024-10" },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
}

const LOGO = `<span style="font-family:'Montserrat',Arial,Helvetica,sans-serif;font-weight:900;font-size:26px;letter-spacing:-1px;"><span style="color:#000000;">q</span><span style="color:#FF3333;">a</span><span style="color:#FF9933;">r</span><span style="color:#EBC53F;">a</span><span style="color:#0099CC;">v</span><span style="color:#66CC66;">a</span><span style="color:#7668AA;">n</span></span>`;

function page(h1, sub) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700;900&display=swap" rel="stylesheet"><title>${h1} — QARAVAN</title></head>
<body style="margin:0;padding:32px 16px;background:#F1EEE3;font-family:'Montserrat',Arial,Helvetica,sans-serif;">
<div style="max-width:560px;margin:0 auto;background:#FFFDF5;border-radius:16px;padding:36px 40px;">
${LOGO}
<div style="font-weight:bold;font-size:22px;line-height:1.3;color:#333;padding-top:28px;">${h1}</div>
<div style="font-size:15px;line-height:1.6;color:#6E6E6E;padding-top:10px;">${sub}</div>
</div></body></html>`;
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const u = new URL(req.url, "http://localhost");
  const i = String(u.searchParams.get("i") || "").replace(/\D/g, "");
  const a = String(u.searchParams.get("a") || "").replace(/\D/g, "");
  const sig = u.searchParams.get("s") || "";
  const secret = process.env.UNSUB_SECRET;

  let ok = false;
  if (secret && i && a && /^[0-9a-f]{16}$/.test(sig)) {
    const want = createHmac("sha256", secret).update(`na:${i}:${a}`).digest("hex").slice(0, 16);
    try { ok = timingSafeEqual(Buffer.from(want, "utf8"), Buffer.from(sig, "utf8")); } catch { ok = false; }
  }
  if (!ok) {
    res.statusCode = 400;
    return res.end(page("Ссылка не сработала", "Похоже, ссылка повреждена. Напиши нам на info@qaravan.org.<br><br>This link didn't work. Email info@qaravan.org."));
  }

  try {
    const d = await monday(
      `query ($e: [ID!], $p: [ID!]) { event: items(ids: $e) { id name board { id } } person: items(ids: $p) { id name board { id } } }`,
      { e: [i], p: [a] }
    );
    const ev = d.event?.[0];
    if (!ev || String(ev.board.id) !== EVENTS_BOARD) throw new Error("event not found");
    const person = d.person?.[0] && String(d.person[0].board.id) === ATTENDEES_BOARD ? d.person[0] : null;

    const key = `${i}:${a}`;
    const found = await monday(
      `query ($b: ID!, $v: [String]!) { items_page_by_column_values(board_id: $b, limit: 1, columns: [{column_id: "${RESPONDENT_COL}", column_values: $v}]) { items { id } } }`,
      { b: FEEDBACK_BOARD, v: [key] }
    );
    const existing = found.items_page_by_column_values?.items?.[0]?.id;
    if (existing) {
      await monday(`mutation ($i: ID!, $t: String!) { create_update(item_id:$i, body:$t){id} }`,
        { i: String(existing), t: "Отметил(а) по ссылке из письма: не был(а) на событии" });
    } else {
      const cv = { [RESPONDENT_COL]: key, [F_EVENT_NAME]: ev.name, [F_EVENT_REL]: { item_ids: [Number(ev.id)] } };
      const c = await monday(
        `mutation ($b: ID!, $n: String!, $v: JSON!) { create_item(board_id:$b,item_name:$n,column_values:$v,create_labels_if_missing:true){id} }`,
        { b: FEEDBACK_BOARD, n: `No show — ${ev.name}${person ? ` — ${person.name}` : ""}`, v: JSON.stringify(cv) });
      await monday(`mutation ($i: ID!, $t: String!) { create_update(item_id:$i, body:$t){id} }`,
        { i: String(c.create_item.id), t: "Отметил(а) по ссылке из письма: не был(а) на событии" });
    }
  } catch (e) {
    console.error("didnt-attend failed:", e.message);
    res.statusCode = 500;
    return res.end(page("Что-то пошло не так", "Не получилось сохранить. Напиши нам на info@qaravan.org.<br><br>Something broke. Email info@qaravan.org."));
  }

  res.end(page("Принято!", "Мы отметили, что тебя не было на этом событии, и учтём это. Если это ошибка — просто открой форму из письма и оставь отзыв.<br><br>Got it — we've noted you didn't attend. If that's a mistake, just open the form from the email and leave your feedback."));
}
