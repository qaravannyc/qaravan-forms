// POST /api/photos-token {eventId, p?, ticket?, turnstile?} — hands the browser a short-lived Google
// access token that can ONLY upload bytes to Google Photos (scope photoslibrary.appendonly, downscoped
// at the token endpoint). The full-scope refresh token never leaves the server, and the Gmail scope is
// never minted into browser tokens: the token goes out only when Google's answer names exactly the
// append-only scope (503 otherwise). Uploading straight from the phone to Google is what makes photos
// and videos fast: the bytes skip our serverless functions (and their 4.5 MB body limit) entirely.
//
// Who gets one (audit, 2026-11-10): an event on the calendar board, and a real visitor: the personal
// link from our emails (p, signed for this event or the weekly form), a ticket from an earlier answer
// for this event, or a passed Turnstile check. The Turnstile check is required only once
// TURNSTILE_SECRET_KEY is set (with TURNSTILE_SITE_KEY, which api/page.mjs puts on the pages); until
// then a page without a personal link (the photo page, the lead's page, a QR code) still gets a token.
// The answer carries a 24-hour ticket for this event, which the rescue upload shows (api/rescue-file.mjs).
import { personalLinkOk, photoTicket, photoTicketOk, turnstileOk, clientIp } from "../lib/gate.mjs";

const MONDAY = "https://api.monday.com/v2";
const EVENTS_BOARD = "4774572020";
export const APPEND_ONLY = "https://www.googleapis.com/auth/photoslibrary.appendonly";

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.statusCode = 405; return res.end("{}"); }
  const chunks = []; for await (const c of req) chunks.push(c);
  let b;
  try { b = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { res.statusCode = 400; return res.end("{}"); }
  if (!b || typeof b !== "object") { res.statusCode = 400; return res.end("{}"); }

  const id = String(b.eventId || "").replace(/\D/g, "");
  if (!id) { res.statusCode = 400; return res.end("{}"); }

  const human = personalLinkOk(id, b.p) || photoTicketOk(id, b.ticket) || (await turnstileOk(b.turnstile, clientIp(req)));
  if (!human && process.env.TURNSTILE_SECRET_KEY) { res.statusCode = 403; return res.end('{"error":"verify"}'); }

  // Only hand out tokens for real events on the calendar board.
  const r = await fetch(MONDAY, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: process.env.MONDAY_TOKEN, "API-Version": "2024-10" },
    body: JSON.stringify({
      query: `query ($ids: [ID!]) { items(ids: $ids) { id board { id } } }`,
      variables: { ids: [id] },
    }),
  });
  const j = await r.json();
  const item = j.data?.items?.[0];
  if (!item || String(item.board.id) !== EVENTS_BOARD) { res.statusCode = 404; return res.end("{}"); }

  const t = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
      scope: APPEND_ONLY,
    }),
  }).then((x) => x.json());
  if (!t.access_token) {
    console.error("photos-token: Google refused", String(t.error || "").slice(0, 100));
    res.statusCode = 502; return res.end("{}");
  }
  // A token that can do more than add photos (Gmail, reading the library) never reaches a browser.
  const scopes = String(t.scope || "").split(/\s+/).filter(Boolean);
  if (scopes.length !== 1 || scopes[0] !== APPEND_ONLY) {
    console.error("photos-token: Google did not narrow the token to append-only; scopes:", scopes.join(" ") || "(none named)");
    res.statusCode = 503; return res.end('{"error":"scope"}');
  }
  res.end(JSON.stringify({ token: t.access_token, expiresIn: t.expires_in || 3600, ticket: photoTicket(id) }));
}
