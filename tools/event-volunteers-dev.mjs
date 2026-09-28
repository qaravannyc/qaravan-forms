// Local dev/test server for the event volunteers sign-up page (/event-volunteers): serves the
// repo's static files and mounts api/survey.mjs the way vercel.json does
// (/api/event-volunteers → /api/survey?form=event-volunteers) against an in-memory fake of
// the monday API (no token needed, nothing is written anywhere).
// Usage: node tools/event-volunteers-dev.mjs [port]   — then open http://localhost:3998/event-volunteers
// GET /__db shows what the form would have written to the board.
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const port = +(process.argv[2] || 3998);
process.env.MONDAY_TOKEN = "fake";
const DB = { items: [], updates: [], failPhoneOnce: process.env.FAIL_PHONE === "1" };

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  if (String(url).startsWith("https://api.monday.com/v2")) {
    const { query, variables: v } = JSON.parse(opts.body);
    if (query.includes("create_item")) {
      const cv = JSON.parse(v.v);
      if (DB.failPhoneOnce && cv.phone) { DB.failPhoneOnce = false; return new Response(JSON.stringify({ errors: [{ message: "invalid phone (fake)" }] })); }
      const id = String(5000 + DB.items.length);
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

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  try {
    if (u.pathname === "/api/event-volunteers") { req.url = "/api/survey?form=event-volunteers"; return await survey(req, res); }
    if (u.pathname === "/__db") { res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify(DB, null, 1)); }
    const p = u.pathname === "/event-volunteers" ? "/event-volunteers/index.html" : u.pathname;
    const f = join(root, p);
    if (existsSync(f) && statSync(f).isFile()) { res.setHeader("Content-Type", TYPES[extname(f)] || "application/octet-stream"); return res.end(readFileSync(f)); }
    res.statusCode = 404; res.end("not found");
  } catch (e) { console.error(e); res.statusCode = 500; res.end("error"); }
}).listen(port, () => console.log("event volunteers dev server on http://localhost:" + port + "/event-volunteers"));
