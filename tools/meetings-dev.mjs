// Local dev server for the meeting-link send page (/support/send) and the after-meeting
// attendance page (/support/attendance): serves the repo's static files and mounts
// api/survey.mjs the way vercel.json does (/api/meetings, /api/meeting-prompts,
// /api/attendance, /api/meeting-attendance) against in-memory stores with sample people and a
// fake Gmail — nothing is written or sent.
// Usage: node tools/meetings-dev.mjs [port] — it prints both page links for sample meetings.
// GET /__mail shows the emails that would have gone out; GET /__store the board state.
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const port = +(process.argv[2] || 3996);
process.env.MONDAY_TOKEN ||= "dev-token";
process.env.GOOGLE_REFRESH_TOKEN ||= "dev";
process.env.FORM_BASE ||= `http://localhost:${port}`;
const MAIL = [];

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  if (String(url).startsWith("https://oauth2.googleapis.com/")) return new Response(JSON.stringify({ access_token: "dev" }));
  if (String(url).startsWith("https://gmail.googleapis.com/")) { MAIL.push(Buffer.from(JSON.parse(opts.body).raw, "base64url").toString("utf8")); return new Response("{}"); }
  return realFetch(url, opts);
};

const M = await import("../lib/meetings.mjs");
const A = await import("../lib/attendance.mjs");
const survey = (await import("../api/survey.mjs")).default;
const start = new Date(Date.now() + 26 * 3600000); start.setUTCMinutes(30, 0, 0);
const names = ["Алекс", "Мария Фомина", "Глеб Руденко", "Надежда", "Sasha Su", "Lana K", "Maksim", "Юлия", "Акжол (Nate)", "Людмила"];
const S = {
  meetings: { "900": { id: "900", name: "Support Group with Gina", group: "gina", start, status: "Confirmed", link: "", mail: {} } },
  rows: { gina: names.map((n, k) => ({ id: String(k + 1), name: n, email: `person${k + 1}@example.com`, checked: k < 4, status: k === 0 ? "New" : k < 4 ? "Joined" : "", source: k < 2 ? "feedback.qaravan.org" : "Typeform", date: `2026-0${9 - (k % 8)}-1${k % 9} 10:00` })), simon: [] },
  async meeting(id) { return S.meetings[id] || null; },
  async meetingsBetween() { return Object.values(S.meetings); },
  async previousMeetings() { return []; },
  async saveMeeting(id, v) { if (v.mail) S.meetings[id].mail = v.mail; if (v.link !== undefined) S.meetings[id].link = v.link; },
  async note() {},
  async people(g) { return S.rows[g].map((r) => ({ ...r })); },
  async setMailing(g, ch) { for (const c of ch) S.rows[g].find((r) => r.id === c.id).checked = c.checked; },
  async addPerson(g, p) { S.rows[g].push({ id: "n" + S.rows[g].length, name: p.name, email: p.email, checked: true, status: "", source: "Added by hand", date: new Date().toISOString().slice(0, 16) }); },
};
M.setStore(S);

// прошедшая встреча для страницы отметок: двое уже отмечены, у троих — прошлые встречи
const past = new Date(Date.now() - 2 * 3600000); past.setUTCMinutes(30, 0, 0);
const card = (k) => ({ id: "c" + (k + 1), name: names[k], email: `person${k + 1}@example.com`, other: [] });
const AS = {
  meetings: { "901": { id: "901", name: "Support Group with Gina", group: "gina", start: past, status: "Confirmed", mail: {}, confirmed: [card(1), card(2)], excluded: [] } },
  past: [{ id: "801", start: new Date(past.getTime() - 7 * 86400000), confirmed: [card(1), card(2), card(4)] }, { id: "800", start: new Date(past.getTime() - 14 * 86400000), confirmed: [card(1), card(4), card(6)] }],
  cards: names.map((n, k) => card(k)), created: [],
  async meeting(id) { const m = AS.meetings[id]; return m ? { ...m, confirmed: [...m.confirmed], excluded: [...m.excluded] } : null; },
  async pastMeetings() { return AS.past; },
  async people(g) { return S.rows[g].map((r) => ({ ...r })); },
  async findCards(emails) { return new Map(emails.map((e) => [e, AS.cards.find((c) => c.email === e)]).filter(([, c]) => c)); },
  async createCard(p) { const c = { id: "new" + AS.cards.length, name: p.name, email: p.email, other: [] }; AS.cards.push(c); AS.created.push(p); return c.id; },
  async setEvidence(id, v) { AS.meetings[id].confirmed = v.confirmed.map((cid) => AS.cards.find((c) => c.id === cid)); if (v.excluded) AS.meetings[id].excluded = v.excluded; },
  async saveMail(id, mail) { AS.meetings[id].mail = mail; },
  async note() {},
};
A.setStore(AS);

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  try {
    if (["/api/meetings", "/api/meeting-prompts", "/api/attendance", "/api/meeting-attendance"].includes(u.pathname)) return await survey(req, res);
    if (u.pathname === "/__mail") { res.setHeader("Content-Type", "text/plain; charset=utf-8"); return res.end(MAIL.join("\n\n=====\n\n")); }
    if (u.pathname === "/__store") { res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify({ ...S, attendance: AS }, null, 1)); }
    const page = { "/support/send": "/support/send.html", "/support/attendance": "/support/attendance.html" }[u.pathname];
    const f = join(root, page || u.pathname);
    if (existsSync(f) && statSync(f).isFile()) { res.setHeader("Content-Type", TYPES[extname(f)] || "application/octet-stream"); return res.end(readFileSync(f)); }
    res.statusCode = 404; res.end("not found");
  } catch (e) { console.error(e); res.statusCode = 500; res.end("error"); }
}).listen(port, () => console.log(`meetings dev server:\n  send: ${M.sendUrl("900", "gina", start)}\n  attendance: ${M.attendanceUrl("901", "gina", past)}`));
