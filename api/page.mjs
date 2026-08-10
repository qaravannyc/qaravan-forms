// Serves the two survey pages. The event id rides in the path
// (feedback.qaravan.org/12345 or /12345/lead), so every event's link is unique
// with no machinery; the page itself is static except two injected globals.
import { readFileSync } from "node:fs";

const attendee = readFileSync(new URL("../pages/attendee.html", import.meta.url), "utf8");
const lead = readFileSync(new URL("../pages/lead.html", import.meta.url), "utf8");

export default function handler(req, res) {
  const url = new URL(req.url, "https://x");
  const id = String(url.searchParams.get("id") || "").replace(/\D/g, "");
  const isLead = url.searchParams.get("lead") === "1";
  const p = String(url.searchParams.get("p") || "").replace(/[^0-9a-zA-Z.]/g, "").slice(0, 80);
  const inject = `<script>window.__EVENT_ID__=${JSON.stringify(id)};window.__P__=${JSON.stringify(p)};window.__DONATE_URL__=${JSON.stringify(process.env.DONATE_URL || "https://givebutter.com/qaravan")}</script>`;
  const html = (isLead ? lead : attendee).replace("</head>", inject + "\n</head>");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(html);
}
