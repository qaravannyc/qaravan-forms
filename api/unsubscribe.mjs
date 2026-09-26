// GET /api/unsubscribe?e=<base64url email>&s=<signature>
// Registers an unsubscribe: marks the person "Unsubscribed" in the «Рассылка»
// column on the Community Members board (creates the row if the email is not
// there yet), so the send robot never emails them again.
// The link is signed — HMAC-SHA256 of the lowercased email, keyed with
// UNSUB_SECRET (set in Vercel and in GitHub Actions) — so nobody can
// unsubscribe someone else by guessing their address.
import { createHmac, timingSafeEqual } from "node:crypto";
import { statusPage as page } from "../lib/status-page.mjs";

const MONDAY = "https://api.monday.com/v2";
const ATTENDEES_BOARD = "18425190164";
const EMAIL_COL = "email_mm5ysnnh";
const SUB_COL = "color_mm63k40g"; // «Рассылка»

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
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const u = new URL(req.url, "http://localhost");
  const secret = process.env.UNSUB_SECRET;

  let email = "";
  try { email = Buffer.from(u.searchParams.get("e") || "", "base64url").toString("utf8").trim().toLowerCase(); } catch {}
  const sig = u.searchParams.get("s") || "";

  let ok = false;
  if (secret && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && /^[0-9a-f]{64}$/.test(sig)) {
    const want = createHmac("sha256", secret).update(email).digest("hex");
    try { ok = timingSafeEqual(Buffer.from(want, "hex"), Buffer.from(sig, "hex")); } catch { ok = false; }
  }
  if (!ok) {
    res.statusCode = 400;
    return res.end(page("Ссылка не сработала", "Похоже, ссылка повреждена или устарела. Напишите нам на info@qaravan.org — отпишем вручную.<br><br>This link didn't work. Email info@qaravan.org and we'll unsubscribe you by hand."));
  }

  try {
    const d = await monday(
      `query ($b: ID!, $v: [String]!) { items_page_by_column_values(board_id: $b, limit: 5, columns: [{column_id: "${EMAIL_COL}", column_values: $v}]) { items { id } } }`,
      { b: ATTENDEES_BOARD, v: [email] }
    );
    const found = d.items_page_by_column_values?.items || [];
    if (found.length) {
      for (const it of found) {
        await monday(
          `mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v,create_labels_if_missing:true){id} }`,
          { b: ATTENDEES_BOARD, i: String(it.id), v: JSON.stringify({ [SUB_COL]: { label: "Unsubscribed" } }) }
        );
      }
    } else {
      await monday(
        `mutation ($b: ID!, $n: String!, $v: JSON!) { create_item(board_id:$b,item_name:$n,column_values:$v,create_labels_if_missing:true){id} }`,
        { b: ATTENDEES_BOARD, n: email, v: JSON.stringify({ [EMAIL_COL]: { email, text: email }, [SUB_COL]: { label: "Unsubscribed" } }) }
      );
    }
  } catch (e) {
    console.error("unsubscribe failed:", e.message);
    res.statusCode = 500;
    return res.end(page("Что-то пошло не так", "Не получилось сохранить отписку. Напишите нам на info@qaravan.org — отпишем вручную.<br><br>Something broke on our side. Email info@qaravan.org and we'll unsubscribe you by hand."));
  }

  res.end(page("Готово, вы отписаны", "Больше писем с опросами не будет. Передумаете — просто ответьте на любое наше письмо.<br><br>You're unsubscribed — no more survey emails. Changed your mind? Just reply to any of our emails."));
}
