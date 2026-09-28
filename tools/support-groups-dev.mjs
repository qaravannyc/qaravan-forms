// Local dev/test server for the support group sign-up pages (/support/gina, /support/simon):
// serves the repo's static files and mounts api/survey.mjs the way vercel.json does
// (/api/support-groups → /api/survey?form=support-groups) against an in-memory fake of
// the monday API (no token needed, nothing is written anywhere).
// Usage: node tools/support-groups-dev.mjs [port]   — then open http://localhost:3997/support/gina
// GET /__db shows what the forms would have written to the boards.
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const port = +(process.argv[2] || 3997);
process.env.MONDAY_TOKEN = "fake";
const DB = { items: [], updates: [], failPhoneOnce: process.env.FAIL_PHONE === "1", down: process.env.MONDAY_DOWN === "1" };

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  if (String(url).startsWith("https://api.monday.com/v2")) {
    if (DB.down) return new Response(JSON.stringify({ errors: [{ message: "monday is down (fake)" }] }));
    const { query, variables: v } = JSON.parse(opts.body);
    if (query.includes("create_item")) {
      const cv = JSON.parse(v.v);
      if (DB.failPhoneOnce && (cv.phone || cv.phone_2)) { DB.failPhoneOnce = false; return new Response(JSON.stringify({ errors: [{ message: "invalid phone (fake)" }] })); }
      const id = String(7000 + DB.items.length);
      DB.items.push({ id, board: v.b, group: v.g, name: v.n, cv });
      return new Response(JSON.stringify({ data: { create_item: { id } } }));
    }
    if (query.includes("create_update")) { DB.updates.push({ item: v.i, body: v.t }); return new Response(JSON.stringify({ data: { create_update: { id: "u" + DB.updates.length } } })); }
    return new Response(JSON.stringify({ errors: [{ message: "unknown query in fake: " + query.slice(0, 60) }] }));
  }
  return realFetch(url, opts);
};

const survey = (await import("../api/survey.mjs")).default;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2" };
const PAGES = { "/support/gina": "/support/gina.html", "/support/simon": "/support/simon.html" };

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  try {
    if (u.pathname === "/api/support-groups") { req.url = "/api/survey?form=support-groups"; return await survey(req, res); }
    if (u.pathname === "/__db") { res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify(DB, null, 1)); }
    const f = join(root, PAGES[u.pathname] || u.pathname);
    if (existsSync(f) && statSync(f).isFile()) { res.setHeader("Content-Type", TYPES[extname(f)] || "application/octet-stream"); return res.end(readFileSync(f)); }
    res.statusCode = 404; res.end("not found");
  } catch (e) { console.error(e); res.statusCode = 500; res.end("error"); }
}).listen(port, () => console.log("support groups dev server on http://localhost:" + port + "/support/gina and /support/simon"));
