// POST /api/photos-token {eventId} — hands the browser a short-lived Google
// access token that can ONLY upload bytes to Google Photos (scope
// photoslibrary.appendonly, downscoped at the token endpoint). The full-scope
// refresh token never leaves the server, and the Gmail scope is never minted
// into browser tokens. Uploading straight from the phone to Google is what
// makes photos and videos fast: the bytes skip our serverless functions (and
// their 4.5 MB body limit) entirely.
const MONDAY = "https://api.monday.com/v2";
const EVENTS_BOARD = "4774572020";

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "POST") { res.statusCode = 405; return res.end("{}"); }
  const chunks = []; for await (const c of req) chunks.push(c);
  let b;
  try { b = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { res.statusCode = 400; return res.end("{}"); }

  const id = String(b.eventId || "").replace(/\D/g, "");
  if (!id) { res.statusCode = 400; return res.end("{}"); }

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
      scope: "https://www.googleapis.com/auth/photoslibrary.appendonly",
    }),
  }).then((x) => x.json());
  if (!t.access_token) {
    console.error("photos-token: Google refused", JSON.stringify(t).slice(0, 300));
    res.statusCode = 502; return res.end("{}");
  }
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify({ token: t.access_token, expiresIn: t.expires_in || 3600 }));
}
