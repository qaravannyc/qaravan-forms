// Local dev/test server for the letter intake form: serves the repo's static
// files and mounts api/letter.mjs against an in-memory
// fake of the monday API (no token needed). Usage: node tools/letter-dev.mjs [port]
// Not used in production — Vercel serves the real thing.
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const port = +(process.argv[2] || 3999);
process.env.MONDAY_TOKEN = "fake";
const DB = { items: {}, seq: 1, updates: [], files: [] };
globalThis.__LETTER_DB = DB;

// Fake monday: enough GraphQL to run the handlers end to end.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith("https://api.monday.com/v2/file")) {
    const fd = opts.body; const f = fd.get("f"); const q = fd.get("query");
    const m = /item_id: (\d+), column_id: "([^"]+)"/.exec(q);
    DB.files.push({ item: m[1], col: m[2], name: f.name, size: f.size });
    return new Response(JSON.stringify({ data: { add_file_to_column: { id: "asset" + DB.files.length } } }));
  }
  if (u.startsWith("https://api.monday.com/v2")) {
    const { query, variables: v } = JSON.parse(opts.body);
    if (query.includes("items_page_by_column_values")) {
      const rid = v.v[0]; const it = Object.values(DB.items).find((x) => x.cv.text_mm6vmdw4 === rid);
      return new Response(JSON.stringify({ data: { items_page_by_column_values: { items: it ? [{ id: it.id, group: { id: it.group }, column_values: [{ id: "long_text_mm6vtrcm", text: it.cv.long_text_mm6vtrcm?.text || "" }] }] : [] } } }));
    }
    if (query.includes("create_item")) { const id = String(1000 + DB.seq++); DB.items[id] = { id, name: v.n, group: v.g, cv: JSON.parse(v.v) }; return new Response(JSON.stringify({ data: { create_item: { id } } })); }
    if (query.includes("change_multiple_column_values")) { const it = DB.items[v.i]; const cv = JSON.parse(v.v); if (cv.name) { it.name = cv.name; delete cv.name; } Object.assign(it.cv, cv); return new Response(JSON.stringify({ data: { change_multiple_column_values: { id: v.i } } })); }
    if (query.includes("move_item_to_group")) { const g = /group_id:"([^"]+)"/.exec(query)[1]; DB.items[v.i].group = g; return new Response(JSON.stringify({ data: { move_item_to_group: { id: v.i } } })); }
    if (query.includes("create_update")) { DB.updates.push({ item: v.i, body: v.t }); return new Response(JSON.stringify({ data: { create_update: { id: "u" + DB.updates.length } } })); }
    return new Response(JSON.stringify({ errors: [{ message: "unknown query in fake: " + query.slice(0, 60) }] }));
  }
  return realFetch(url, opts);
};

const letter = (await import("../api/letter.mjs")).default;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  try {
    if (u.pathname === "/api/letter") return await letter(req, res);
    if (u.pathname === "/__db") { res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify(DB, null, 1)); }
    let p = u.pathname === "/letter" ? "/letter/index.html" : u.pathname;
    const f = join(root, p);
    if (existsSync(f) && statSync(f).isFile()) { res.setHeader("Content-Type", TYPES[extname(f)] || "application/octet-stream"); return res.end(readFileSync(f)); }
    res.statusCode = 404; res.end("not found");
  } catch (e) { console.error(e); res.statusCode = 500; res.end("error"); }
}).listen(port, () => console.log("letter dev server on http://localhost:" + port + "/letter"));
