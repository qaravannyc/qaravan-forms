// POST /api/slack-approve — the Approve button in Slack lands here.
// Slack signs every request (v0 HMAC with the app's signing secret); after the
// signature checks out, the event's status flips to "Digest approved" on the
// calendar board and the Slack message is replaced with a confirmation. The
// send robot picks the approval up on its next run and emails the lead.
import { createHmac, timingSafeEqual } from "node:crypto";

const MONDAY = "https://api.monday.com/v2";
const EVENTS_BOARD = "4774572020";
const STATUS_COL = "color_mm5yxxe3";

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

export default async function handler(req, res) {
  if (req.method !== "POST") { res.statusCode = 405; return res.end(); }
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) { res.statusCode = 500; return res.end("SLACK_SIGNING_SECRET is not set"); }

  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");

  const ts = String(req.headers["x-slack-request-timestamp"] || "");
  const given = String(req.headers["x-slack-signature"] || "");
  if (!ts || Math.abs(Date.now() / 1000 - Number(ts)) > 300) { res.statusCode = 401; return res.end(); }
  const want = "v0=" + createHmac("sha256", secret).update(`v0:${ts}:${raw}`).digest("hex");
  let ok = false;
  try { ok = timingSafeEqual(Buffer.from(want), Buffer.from(given)); } catch { ok = false; }
  if (!ok) { res.statusCode = 401; return res.end(); }

  let payload;
  try { payload = JSON.parse(new URLSearchParams(raw).get("payload")); }
  catch { res.statusCode = 400; return res.end(); }

  const action = payload?.actions?.[0];
  if (payload?.type !== "block_actions" || action?.action_id !== "approve_digest") {
    res.statusCode = 200; return res.end();
  }

  const eventId = String(action.value || "").replace(/\D/g, "");
  const who = payload.user?.name || payload.user?.username || payload.user?.id || "кто-то";

  try {
    await monday(
      `mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v,create_labels_if_missing:true){id} }`,
      { b: EVENTS_BOARD, i: eventId, v: JSON.stringify({ [STATUS_COL]: { label: "Digest approved" } }) }
    );
    if (payload.response_url) {
      await fetch(payload.response_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          replace_original: true,
          text: `✅ Дайджест одобрен (@${who}). Письмо уйдёт ведущему при следующем прогоне робота — он ходит ежедневно в 17:00 по Нью-Йорку.`,
        }),
      }).catch(() => {});
    }
  } catch (e) {
    console.error("slack-approve failed:", e.message);
    if (payload.response_url) {
      await fetch(payload.response_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replace_original: false, text: `Не получилось поставить статус: ${e.message}. Поставь «Digest approved» руками на доске.` }),
      }).catch(() => {});
    }
  }
  res.statusCode = 200;
  res.end();
}
