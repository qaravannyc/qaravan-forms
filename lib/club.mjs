// QARAVAN Movie Club / Киноклуб QARAVAN: sign-up, membership and exceptions (club/index.html,
// club/welcome.html). No function of its own in api/ (Hobby allows 12): vercel.json rewrites
// /api/club and /club/cancel to /api/survey?form=club, /api/club-tick to /api/survey?form=club-tick.
//
// Flow. The join form (name, email, a ranked ballot of 3–5 films, interests, the promise to cancel
// sign-ups when plans change) creates a row on "Movie Club Members" with Membership = Applied and
// a random member key. The membership step then either
//   • sends the person to a Stripe payment link ($5 / $10 / $15 a month) with the key as
//     client_reference_id; Stripe returns them to /club/welcome?session_id=…, which calls
//     action=welcome: we check the Checkout Session with Stripe, mark the row Member / Paid and
//     send the welcome email (WhatsApp link + a signed link to cancel in Stripe's portal); or
//   • takes an exception request: the reasons go to the private "Movie Club Exceptions" board, the
//     row gets Membership = Exception requested and an approval time 0–12 hours ahead
//     (approvalDelayMinutes). The tick (/api/club-tick, every 5 minutes from
//     .github/workflows/meeting-attendance.yml) approves rows whose time has come and emails the
//     WhatsApp link. Nobody gets the link before paying or applying.
// The tick also recounts the film interest scores on "Movie Club Films" from every ballot (Borda:
// 1st place 5 points … 5th place 1) and fills in TMDB ids for films added by hand.
//
// Environment (Vercel): MONDAY_TOKEN, GOOGLE_* (email from info@qaravan.org), UNSUB_SECRET (signs
// the cancel link), STRIPE_SECRET_KEY (a restricted key: read Checkout Sessions, Customers,
// Subscriptions, Invoices, Payment Methods; write Customer portal), TMDB_API_KEY (posters,
// trailers, search; without it the form shows titles only), CLUB_WHATSAPP_URL (the group's invite
// link; until it is set nobody is approved or emailed), CLUB_LINK_5 / CLUB_LINK_10 / CLUB_LINK_15
// (Stripe payment links, test-mode ones until the switch to live).
import crypto from "node:crypto";
import { monday } from "./letter-board.mjs";
import { sendEmail, esc } from "./letter-mail.mjs";
import { isEmail } from "./answers-copy.mjs";
import { frame, para, link, BODY, HEAD, INK, MUTED } from "./support-mail.mjs";

export const BOARD = { members: "18437884339", films: "18437884341", exceptions: "18437884343" };
export const GROUP = "topics"; // Members / Films / Requests
export const M = {
  email: "club_email", status: "club_status", path: "club_path", tier: "club_tier", talk: "club_talk",
  picks: "club_picks", added: "club_added", topics: "club_topics", helps: "club_helps", joined: "club_joined",
  approve: "club_approve", sent: "club_sent", lang: "club_lang", customer: "club_customer", sub: "club_sub",
  key: "club_key", raw: "club_raw",
};
export const F = {
  tmdb: "film_tmdb", year: "film_year", source: "film_source", show: "film_show", score: "film_score",
  first: "film_first", ballots: "film_ballots", noteEn: "film_note_en", noteRu: "film_note_ru",
  trailer: "film_trailer", added: "film_added",
};
export const X = {
  key: "exc_key", member: "exc_member", reasons: "exc_reasons", other: "exc_other", comment: "exc_comment",
  submitted: "exc_submitted", lang: "exc_lang",
};

// code → board label (must match the board character for character)
export const L = {
  status: { applied: "Applied", requested: "Exception requested", member: "Member", failed: "Payment failed", paused: "Paused", ended: "Ended", remove: "Remove from group", removed: "Removed" },
  path: { paid: "Paid", exception: "Exception" },
  tier: { 5: "$5", 10: "$10", 15: "$15" },
  talk: { ru: "Russian", en: "English", both: "Both" },
  topics: { lgbtq: "How LGBTQ+ rights were won", race: "Race and racism", hiv: "HIV/AIDS", women: "Women's rights", politics: "Elections and government", immigration: "Immigration history", justice: "Police and courts", other: "Other" },
  helps: { intro: "Introduce a film", host: "Host a discussion", photo: "Take photos", venue: "Find a venue" },
  reasons: { ead: "Waiting for work permit", job: "Looking for a job", housing: "Need help with housing", family: "Supporting family", other: "Other" },
  lang: { ru: "RU", en: "EN" },
};
export const TIERS = [5, 10, 15];
// Test-mode links (Stripe sandbox) until CLUB_LINK_* point at the live ones. Each returns to
// https://feedback.qaravan.org/club/welcome?session_id={CHECKOUT_SESSION_ID}.
const TEST_LINKS = { 5: "https://buy.stripe.com/test_14A3cvcf0caJbSy5EE1Fe00", 10: "https://buy.stripe.com/test_00w28r4My6QpaOu2ss1Fe01", 15: "https://buy.stripe.com/test_00w4gz5QCcaJ8Gm1oo1Fe02" };
export const paymentLinks = (env = process.env) => ({ 5: env.CLUB_LINK_5 || TEST_LINKS[5], 10: env.CLUB_LINK_10 || TEST_LINKS[10], 15: env.CLUB_LINK_15 || TEST_LINKS[15] });
const SITE = "https://feedback.qaravan.org";

// ---------- small helpers ----------
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, "").replace(/[ \t]+/g, " ").trim().slice(0, max);
const one = (map, v) => (typeof v === "string" && Object.hasOwn(map, v) ? v : "");
const many = (map, v) => [...new Set((Array.isArray(v) ? v : []).map(String))].filter((c) => Object.hasOwn(map, c));
export const newKey = () => crypto.randomBytes(12).toString("hex");
const KEY_RX = /^[a-f0-9]{24}$/;
const dateNY = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
// monday date column with time: the time is stored in UTC
const dateTimeUTC = (d) => ({ date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 19) });

// Signed cancel link: /club/cancel?m=<member item id>&s=<sig>. Same secret as the unsubscribe links.
export function cancelSig(itemId, secret = process.env.UNSUB_SECRET || "") {
  return crypto.createHmac("sha256", secret).update(`club:${itemId}`).digest("hex").slice(0, 32);
}
export const cancelLink = (itemId) => `${SITE}/club/cancel?m=${itemId}&s=${cancelSig(itemId)}`;

// When an exception is approved: about a quarter right away, the rest after 2, 5, 8 or 11 hours
// plus up to 40 minutes, so the wait looks like a person read the request. Never more than 12 hours.
const BUCKETS = [[0, 0.25], [120, 0.25], [300, 0.2], [480, 0.15], [660, 0.15]];
export function approvalDelayMinutes(rand = Math.random) {
  let r = rand(), base = BUCKETS[BUCKETS.length - 1][0];
  for (const [m, w] of BUCKETS) { if (r < w) { base = m; break; } r -= w; }
  return base === 0 ? 0 : Math.min(715, base + Math.floor(rand() * 41));
}

// Borda count over every ballot: a film in 1st place gets 5 points, 5th place 1.
export function scoreBallots(ballots) {
  const s = {};
  for (const b of ballots) {
    (b || []).slice(0, 5).forEach((id, i) => {
      const k = String(id);
      s[k] ||= { score: 0, first: 0, ballots: 0 };
      s[k].score += 5 - i; s[k].ballots += 1; if (i === 0) s[k].first += 1;
    });
  }
  return s;
}

// ---------- TMDB (posters, trailers, search) ----------
const TMDB = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p/";
const cache = new Map(); // tmdb id → { at, data }; lives as long as the function instance
async function tmdb(path, params = {}) {
  const key = process.env.TMDB_API_KEY;
  if (!key) return null;
  const u = new URL(TMDB + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  // v4 read tokens are long JWTs (Bearer), v3 keys are 32 hex characters (query string)
  const bearer = key.length > 40;
  if (!bearer) u.searchParams.set("api_key", key);
  const r = await fetch(u, { headers: bearer ? { Authorization: `Bearer ${key}`, accept: "application/json" } : { accept: "application/json" } });
  if (!r.ok) throw new Error(`TMDB ${path}: ${r.status}`);
  return r.json();
}
// Trailer: an official YouTube trailer, English first, then Russian, then any.
export function pickTrailer(videos = []) {
  const yt = videos.filter((v) => v.site === "YouTube" && v.key);
  const rank = (v) => (v.type === "Trailer" ? 0 : v.type === "Teaser" ? 2 : 4) + (v.official ? 0 : 1);
  return yt.sort((a, b) => rank(a) - rank(b))[0]?.key || "";
}
export async function filmDetails(id) {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < 6 * 3600e3) return hit.data;
  const d = await tmdb(`/movie/${id}`, { language: "en-US", append_to_response: "videos,translations" });
  if (!d) return null;
  const ru = d.translations?.translations?.find((t) => t.iso_639_1 === "ru")?.data?.title || "";
  const data = {
    poster: d.poster_path ? IMG + "w342" + d.poster_path : "",
    trailer: pickTrailer(d.videos?.results),
    titleRu: ru,
    year: (d.release_date || "").slice(0, 4),
  };
  cache.set(id, { at: Date.now(), data });
  return data;
}
export async function searchFilms(q) {
  const d = await tmdb("/search/movie", { query: q, include_adult: "false", language: "en-US", page: "1" });
  return (d?.results || []).slice(0, 6).map((r) => ({
    tmdb: String(r.id), title: r.title, year: (r.release_date || "").slice(0, 4),
    poster: r.poster_path ? IMG + "w154" + r.poster_path : "",
  }));
}

// ---------- Stripe ----------
async function stripe(method, path, form) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw Object.assign(new Error("STRIPE_SECRET_KEY is not set"), { noKey: true });
  const r = await fetch("https://api.stripe.com/v1" + path, {
    method, headers: { Authorization: `Bearer ${key}`, ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: form ? new URLSearchParams(form) : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Stripe ${path}: ${r.status} ${j?.error?.message || ""}`);
  return j;
}

// ---------- monday reads ----------
const ITEM = `id name column_values { id text value }`;
const val = (item, id) => item.column_values.find((c) => c.id === id);
const txt = (item, id) => val(item, id)?.text || "";
async function allItems(board) {
  let out = [], d = await monday(`query ($b: [ID!]) { boards(ids: $b) { items_page(limit: 500) { cursor items { ${ITEM} } } } }`, { b: [board] });
  let page = d.boards[0].items_page;
  out = out.concat(page.items);
  while (page.cursor) {
    d = await monday(`query ($c: String!) { next_items_page(limit: 500, cursor: $c) { cursor items { ${ITEM} } } }`, { c: page.cursor });
    page = d.next_items_page; out = out.concat(page.items);
  }
  return out;
}
async function findBy(board, col, value) {
  const d = await monday(`query ($b: ID!, $c: String!, $v: [String]!) { items_page_by_column_values(board_id: $b, limit: 5, columns: [{column_id: $c, column_values: $v}]) { items { ${ITEM} } } }`,
    { b: board, c: col, v: [value] });
  return d.items_page_by_column_values.items;
}
const setValues = (board, item, cv) => monday(
  `mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id: $b, item_id: $i, column_values: $v, create_labels_if_missing: true) { id } }`,
  { b: board, i: String(item), v: JSON.stringify(cv) });
const createItem = async (board, name, cv) => (await monday(
  `mutation ($b: ID!, $g: String!, $n: String!, $v: JSON!) { create_item(board_id: $b, group_id: $g, item_name: $n, column_values: $v, create_labels_if_missing: true) { id } }`,
  { b: board, g: GROUP, n: name, v: JSON.stringify(cv) })).create_item.id;
const addUpdate = (item, body) => monday(`mutation ($i: ID!, $t: String!) { create_update(item_id: $i, body: $t) { id } }`, { i: String(item), t: body });

// The films in the ranking, as the form shows them.
export function filmFromItem(it) {
  return {
    id: it.id, title: it.name, year: txt(it, F.year).replace(/\.0+$/, ""), tmdb: txt(it, F.tmdb),
    noteEn: txt(it, F.noteEn), noteRu: txt(it, F.noteRu), trailer: txt(it, F.trailer),
    show: txt(it, F.show) !== "No", member: txt(it, F.source) === "Member",
  };
}
async function rankingFilms() {
  return (await allItems(BOARD.films)).map(filmFromItem).filter((f) => f.show);
}

// ---------- parsing the join form ----------
// ranking: up to 5 entries, each "m:<film item id>" (a film on the board) or "t:<tmdb id>" (a film
// the person added through search); added: [{ tmdb, title, year }] for the "t:" entries.
export function parseJoin(b) {
  const a = {
    lang: b.lang === "en" ? "en" : "ru",
    first: clean(b.first, 60).replace(/\s+/g, " "),
    last: clean(b.last, 80).replace(/\s+/g, " "),
    email: clean(b.email, 200).replace(/\s/g, "").toLowerCase(),
    talk: one(L.talk, b.talk),
    topics: many(L.topics, b.topics),
    topicOther: "", helps: many(L.helps, b.helps),
    promise: b.promise === true,
    ranking: [], added: [],
  };
  a.name = `${a.first} ${a.last}`.trim();
  if (a.topics.includes("other")) a.topicOther = clean(b.topic_other, 200).replace(/\n/g, " ");
  const seen = new Set();
  for (const r of Array.isArray(b.ranking) ? b.ranking.slice(0, 20) : []) {
    const m = /^(m|t):(\d{1,15})$/.exec(String(r));
    if (m && !seen.has(r) && a.ranking.length < 5) { seen.add(r); a.ranking.push(r); }
  }
  for (const f of Array.isArray(b.added) ? b.added.slice(0, 3) : []) {
    const id = String(f?.tmdb || "");
    if (/^\d{1,10}$/.test(id) && a.ranking.includes("t:" + id)) a.added.push({ tmdb: id, title: clean(f.title, 160) || "Untitled", year: /^\d{4}$/.test(String(f.year)) ? String(f.year) : "" });
  }
  // every "t:" entry needs its film
  a.ranking = a.ranking.filter((r) => r.startsWith("m:") || a.added.some((f) => "t:" + f.tmdb === r));
  const fields = [];
  if (!a.first) fields.push("first");
  if (!a.last) fields.push("last");
  if (!isEmail(a.email)) fields.push("email");
  if (a.ranking.length < 3) fields.push("ranking");
  if (!a.topics.length) fields.push("topics");
  if (!a.talk) fields.push("talk");
  if (!a.promise) fields.push("promise");
  return { ok: fields.length === 0, fields, a };
}

// ---------- emails ----------
const button = (href, label) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${INK}" style="background:${INK};"><a href="${esc(href)}" style="display:block;padding:12px 18px;font-family:${HEAD};font-weight:600;font-size:17px;line-height:1.15;letter-spacing:.01em;color:#FFFFFF;text-decoration:none;">${esc(label)}</a></td></tr></table>`;
const title = (t) => `<div style="font-family:${HEAD};font-size:28px;font-weight:700;line-height:1.12;letter-spacing:-.005em;color:${INK};padding-top:12px;">${esc(t)}</div>`;
const muted = (t) => `<div style="font-family:${BODY};font-size:15px;line-height:1.45;color:${MUTED};padding-top:12px;">${t}</div>`;
const T = {
  ru: {
    hi: (n) => (n ? `Привет, ${n}!` : "Привет!"),
    paidSubject: "Добро пожаловать в киноклуб QARAVAN", paidTitle: "Вы в киноклубе",
    paidBody: "Спасибо, что поддерживаете клуб. Все взносы идут на клуб.",
    okSubject: "Вы в киноклубе QARAVAN", okTitle: "Ваша заявка одобрена",
    okBody: "Добро пожаловать в клуб! У вас те же права, что у всех участников: голосовать за фильмы, предлагать свои и помогать вести клуб.",
    group: "В группе WhatsApp мы голосуем за фильмы, предлагаем свои и договариваемся о показах.",
    join: "Вступить в группу WhatsApp",
    phones: "В группе WhatsApp участники видят номера телефонов друг друга.",
    promise: "Если запишетесь на показ, а планы изменятся, по возможности заранее отмените запись, чтобы ваше место мог занять кто-то другой.",
    cancel: (l) => `Отменить членство можно в любой момент: ${l}.`, cancelWord: "отменить членство",
    foot: "Это письмо пришло, потому что вы вступили в киноклуб QARAVAN на feedback.qaravan.org. Вопросы: info@qaravan.org",
  },
  en: {
    hi: (n) => (n ? `Hi ${n},` : "Hi,"),
    paidSubject: "Welcome to the QARAVAN Movie Club", paidTitle: "You’re in the movie club",
    paidBody: "Thank you for supporting the club. All membership fees go to the club.",
    okSubject: "You’re in the QARAVAN Movie Club", okTitle: "Your request is approved",
    okBody: "Welcome to the club! You have the same rights as every member: vote on films, propose your own and help run the club.",
    group: "In the WhatsApp group we vote on films, propose new ones and plan screenings.",
    join: "Join the WhatsApp group",
    phones: "Members of a WhatsApp group can see each other’s phone numbers.",
    promise: "If you sign up for a screening and your plans change, please cancel in advance where possible, so someone else can take your spot.",
    cancel: (l) => `You can cancel your membership at any time: ${l}.`, cancelWord: "cancel membership",
    foot: "You’re getting this because you joined the QARAVAN Movie Club at feedback.qaravan.org. Questions: info@qaravan.org",
  },
};
export function memberEmail({ kind, name, lang, whatsapp, cancelUrl }) {
  const t = T[lang] || T.ru;
  const paid = kind === "paid";
  const rows = `<tr><td>${para(t.hi(name))}${title(paid ? t.paidTitle : t.okTitle)}${para(paid ? t.paidBody : t.okBody)}${para(t.group)}</td></tr>`
    + `<tr><td style="padding:24px 0 0;">${button(whatsapp, t.join)}</td></tr>`
    + `<tr><td>${muted(esc(t.phones))}${para(t.promise)}${paid && cancelUrl ? muted(t.cancel(link(cancelUrl, t.cancelWord))) : ""}</td></tr>`;
  const subject = paid ? t.paidSubject : t.okSubject;
  return { subject, html: frame(subject, rows, t.foot, lang === "en" ? "en" : "ru") };
}

// ---------- membership changes ----------
const memberInfo = (it) => {
  let raw = {}; try { raw = JSON.parse(txt(it, M.raw) || "{}"); } catch {}
  return { id: it.id, name: it.name, email: txt(it, M.email), status: txt(it, M.status), path: txt(it, M.path), sent: txt(it, M.sent), customer: txt(it, M.customer), key: txt(it, M.key), lang: raw.lang === "en" ? "en" : "ru", raw };
};
// the first name as typed in the form; rows from before the split, or from a bare payment link, have only the full name
const firstName = (m) => m.raw?.first || String(m.name || "").split(/\s+/)[0];

// Email the WhatsApp link once; "WhatsApp link sent" stops a second email.
async function sendWelcome(m, kind, now = new Date()) {
  const whatsapp = process.env.CLUB_WHATSAPP_URL;
  if (!whatsapp) throw new Error("CLUB_WHATSAPP_URL is not set");
  const mail = memberEmail({ kind, name: firstName(m), lang: m.lang, whatsapp, cancelUrl: kind === "paid" ? cancelLink(m.id) : "" });
  await sendEmail(m.email, mail.subject, mail.html);
  await setValues(BOARD.members, m.id, { [M.sent]: { date: dateNY(now) } });
}

async function approveException(m, now = new Date()) {
  await setValues(BOARD.members, m.id, { [M.status]: { label: L.status.member }, [M.path]: { label: L.path.exception } });
  await sendWelcome(m, "exception", now);
}

// ---------- handlers ----------
async function body(req) {
  const chunks = []; for await (const c of req) chunks.push(c);
  try { const b = JSON.parse(Buffer.concat(chunks).toString("utf8")); return b && typeof b === "object" ? b : null; } catch { return null; }
}
const json = (res, code, obj, cache = "no-store") => { res.statusCode = code; res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", cache); res.end(JSON.stringify(obj)); };

async function films(req, res) {
  const list = await rankingFilms();
  await Promise.all(list.map(async (f) => {
    if (!f.tmdb) return;
    try { const d = await filmDetails(f.tmdb); if (d) { f.poster = d.poster; f.titleRu = d.titleRu; f.trailer ||= d.trailer; f.year ||= d.year; } }
    catch (e) { console.error("club tmdb details:", f.tmdb, e.message); }
  }));
  const out = list.map(({ id, title, year, tmdb, poster = "", trailer, titleRu = "", noteEn, noteRu, member }) => ({ id, title, titleRu, year, tmdb, poster, trailer, noteEn, noteRu, member }));
  // the CDN keeps the list for 5 minutes, so new films and posters show up soon after they're added
  const links = paymentLinks();
  return json(res, 200, { films: out, links, tmdb: !!process.env.TMDB_API_KEY }, "public, s-maxage=300, stale-while-revalidate=600");
}

async function search(req, res, u) {
  const q = clean(u.searchParams.get("q"), 80);
  if (q.length < 2 || !process.env.TMDB_API_KEY) return json(res, 200, { results: [], tmdb: !!process.env.TMDB_API_KEY });
  try { return json(res, 200, { results: await searchFilms(q), tmdb: true }, "public, s-maxage=3600"); }
  catch (e) { console.error("club search:", e.message); return json(res, 502, { results: [] }); }
}

async function join(req, res) {
  const b = await body(req);
  if (!b) return json(res, 400, {});
  if (b.website) return json(res, 200, { ok: true, key: newKey() }); // honeypot
  const { ok, fields, a } = parseJoin(b);
  if (!ok) return json(res, 400, { error: "invalid", fields });
  const now = new Date();
  try {
    // someone who already belongs gets told so instead of a second row
    const existing = (await findBy(BOARD.members, M.email, a.email)).map(memberInfo);
    const live = existing.find((m) => [L.status.member, L.status.requested].includes(m.status));
    if (live) return json(res, 200, { ok: true, state: live.status === L.status.member ? "member" : "requested" });

    // films added through search join the ranking pool (one row per TMDB id)
    const pool = await allItems(BOARD.films);
    const byTmdb = new Map(pool.map((it) => [txt(it, F.tmdb), it.id]).filter(([k]) => k));
    const known = new Set(pool.map((it) => it.id));
    const titleOf = new Map(pool.map((it) => [it.id, `${it.name}${txt(it, F.year) ? ` (${txt(it, F.year).replace(/\.0+$/, "")})` : ""}`]));
    for (const f of a.added) {
      if (byTmdb.has(f.tmdb)) continue;
      const id = await createItem(BOARD.films, f.title, {
        [F.tmdb]: f.tmdb, ...(f.year ? { [F.year]: f.year } : {}), [F.source]: { label: "Member" }, [F.show]: { label: "Yes" },
        [F.score]: "0", [F.first]: "0", [F.ballots]: "0", [F.added]: { date: dateNY(now) },
      });
      byTmdb.set(f.tmdb, id); known.add(id); titleOf.set(id, `${f.title}${f.year ? ` (${f.year})` : ""}`);
    }
    const ballot = a.ranking.map((r) => (r.startsWith("m:") ? r.slice(2) : byTmdb.get(r.slice(2)))).filter((id) => id && known.has(id));
    if (ballot.length < 3) return json(res, 400, { error: "invalid", fields: ["ranking"] });

    const key = existing[0]?.key && KEY_RX.test(existing[0].key) ? existing[0].key : newKey();
    const cv = {
      [M.email]: { email: a.email, text: a.email }, [M.status]: { label: L.status.applied },
      ...(a.talk ? { [M.talk]: { label: L.talk[a.talk] } } : {}),
      [M.picks]: { text: ballot.map((id, i) => `${i + 1}. ${titleOf.get(id) || id}`).join("\n") },
      [M.added]: a.added.length ? { text: a.added.map((f) => `${f.title}${f.year ? ` (${f.year})` : ""}`).join("\n") } : "",
      [M.topics]: a.topics.length ? { labels: a.topics.map((c) => L.topics[c]) } : "",
      [M.helps]: a.helps.length ? { labels: a.helps.map((c) => L.helps[c]) } : "",
      [M.joined]: { date: dateNY(now) }, [M.lang]: { label: L.lang[a.lang] }, [M.key]: key,
      [M.raw]: { text: JSON.stringify({ lang: a.lang, first: a.first, last: a.last, ballot, topics: a.topics, topicOther: a.topicOther, helps: a.helps, talk: a.talk, promise: true, at: now.toISOString() }) },
    };
    let itemId = existing[0]?.id;
    if (itemId) await setValues(BOARD.members, itemId, cv);
    else itemId = await createItem(BOARD.members, a.name, cv);
    if (a.topicOther) await addUpdate(itemId, `Wants to understand (other): ${a.topicOther}`).catch((e) => console.error("club update:", e.message));
    return json(res, 200, { ok: true, key, state: "applied" });
  } catch (e) {
    console.error("club join failed:", e.message);
    return json(res, 502, {});
  }
}

async function exception(req, res) {
  const b = await body(req);
  if (!b) return json(res, 400, {});
  const key = String(b.key || "");
  const reasons = many(L.reasons, b.reasons);
  if (!KEY_RX.test(key) || !reasons.length) return json(res, 400, { error: "invalid", fields: reasons.length ? ["key"] : ["reasons"] });
  const other = reasons.includes("other") ? clean(b.other, 200).replace(/\n/g, " ") : "";
  const comment = clean(b.comment, 2000);
  const now = new Date();
  try {
    const m = (await findBy(BOARD.members, M.key, key)).map(memberInfo)[0];
    if (!m) return json(res, 404, { error: "unknown" });
    if (m.status === L.status.member) return json(res, 200, { ok: true, state: "member" });
    if (m.status !== L.status.requested) {
      await createItem(BOARD.exceptions, m.name, {
        [X.key]: key, [X.member]: { url: `https://qaravan.monday.com/boards/${BOARD.members}/pulses/${m.id}`, text: "Member row" },
        [X.reasons]: { labels: reasons.map((c) => L.reasons[c]) }, ...(other ? { [X.other]: other } : {}),
        ...(comment ? { [X.comment]: { text: comment } } : {}), [X.submitted]: { date: dateNY(now) }, [X.lang]: { label: L.lang[m.lang] },
      });
      const delay = approvalDelayMinutes();
      await setValues(BOARD.members, m.id, { [M.status]: { label: L.status.requested }, [M.path]: { label: L.path.exception }, [M.approve]: dateTimeUTC(new Date(now.getTime() + delay * 60e3)) });
      if (delay === 0 && process.env.CLUB_WHATSAPP_URL) await approveException(m, now).catch((e) => console.error("club instant approval:", e.message)); // the tick retries
    }
    return json(res, 200, { ok: true, state: "requested" });
  } catch (e) {
    console.error("club exception failed:", e.message);
    return json(res, 502, {});
  }
}

// After Stripe Checkout: /club/welcome?session_id=… asks here whether the payment went through.
async function welcome(req, res, u) {
  const sid = String(u.searchParams.get("session_id") || "");
  if (!/^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(sid)) return json(res, 400, {});
  let s;
  try { s = await stripe("GET", `/checkout/sessions/${sid}`); }
  catch (e) { console.error("club welcome:", e.message); return json(res, 200, { ok: false, state: "pending" }); }
  if (s.status !== "complete" || !["paid", "no_payment_required"].includes(s.payment_status)) return json(res, 200, { ok: false, state: "unpaid" });
  try {
    const result = await recordPayment(s);
    return json(res, 200, result);
  } catch (e) {
    console.error("club welcome record:", e.message);
    return json(res, 200, { ok: true, state: "paid", whatsapp: "" });
  }
}

// One paid Checkout Session → the member's row. Idempotent: run again on the same session, nothing changes.
export async function recordPayment(s, now = new Date()) {
  let m = KEY_RX.test(s.client_reference_id || "") ? (await findBy(BOARD.members, M.key, s.client_reference_id)).map(memberInfo)[0] : null;
  const email = String(s.customer_details?.email || s.customer_email || "").toLowerCase();
  if (!m && email) m = (await findBy(BOARD.members, M.email, email)).map(memberInfo)[0];
  if (!m) {
    // paid through the link without the form: a row so the team sees them
    const id = await createItem(BOARD.members, s.customer_details?.name || email || "Unknown", { [M.email]: email ? { email, text: email } : "", [M.joined]: { date: dateNY(now) }, [M.key]: newKey(), [M.raw]: { text: JSON.stringify({ lang: "ru", via: "payment link" }) } });
    m = { id, name: s.customer_details?.name || "", email, lang: "ru", sent: "" };
  }
  const dollars = Math.round((s.amount_total || 0) / 100);
  await setValues(BOARD.members, m.id, {
    [M.status]: { label: L.status.member }, [M.path]: { label: L.path.paid },
    ...(L.tier[dollars] ? { [M.tier]: { label: L.tier[dollars] } } : {}),
    ...(s.customer ? { [M.customer]: String(s.customer) } : {}), ...(s.subscription ? { [M.sub]: String(s.subscription) } : {}),
  });
  if (!m.sent && m.email && process.env.CLUB_WHATSAPP_URL) await sendWelcome({ ...m, customer: s.customer }, "paid", now).catch((e) => console.error("club welcome email:", e.message));
  return { ok: true, state: "paid", name: firstName(m), lang: m.lang, whatsapp: process.env.CLUB_WHATSAPP_URL || "" };
}

// /club/cancel?m=&s= → Stripe's customer portal, where the member cancels or updates the card.
async function cancel(req, res, u) {
  const id = String(u.searchParams.get("m") || ""), sig = String(u.searchParams.get("s") || "");
  const page = (msg) => { res.statusCode = 200; res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QARAVAN</title><body style="font:16px/1.5 'Fira Sans',Helvetica,Arial,sans-serif;color:#333;max-width:560px;margin:48px auto;padding:0 20px">${msg}<p><a href="mailto:info@qaravan.org" style="color:#333">info@qaravan.org</a></p></body>`); };
  if (!/^\d{1,15}$/.test(id) || !crypto.timingSafeEqual(Buffer.from(sig.padEnd(32, "0").slice(0, 32)), Buffer.from(cancelSig(id)))) return page("<p>Ссылка не работает. Напишите нам, и мы отменим членство. / This link doesn’t work. Write to us and we’ll cancel your membership.</p>");
  try {
    const d = await monday(`query ($i: [ID!]) { items(ids: $i) { ${ITEM} } }`, { i: [id] });
    const m = d.items[0] ? memberInfo(d.items[0]) : null;
    if (!m?.customer) return page("<p>Мы не нашли оплату для этого членства. Напишите нам. / We couldn’t find a payment for this membership. Please write to us.</p>");
    const p = await stripe("POST", "/billing_portal/sessions", { customer: m.customer, return_url: "https://events.qaravan.org/club/", locale: m.lang === "en" ? "en" : "ru" });
    res.statusCode = 303; res.setHeader("Location", p.url); res.setHeader("Cache-Control", "no-store"); return res.end();
  } catch (e) {
    console.error("club cancel:", e.message);
    return page("<p>Не получилось открыть страницу отмены. Напишите нам, и мы отменим членство. / We couldn’t open the cancel page. Write to us and we’ll cancel your membership.</p>");
  }
}

export async function clubHandler(req, res) {
  const u = new URL(req.url, "https://x");
  const action = u.searchParams.get("action") || (/\/club\/cancel/.test(u.pathname) ? "cancel" : "");
  try {
    if (req.method === "GET" && action === "films") return await films(req, res);
    if (req.method === "GET" && action === "search") return await search(req, res, u);
    if (req.method === "GET" && action === "welcome") return await welcome(req, res, u);
    if (req.method === "GET" && action === "cancel") return await cancel(req, res, u);
    if (req.method === "POST" && action === "join") return await join(req, res);
    if (req.method === "POST" && action === "exception") return await exception(req, res);
    return json(res, 404, {});
  } catch (e) {
    console.error("club:", action, e.message);
    return json(res, 502, {});
  }
}

// ---------- the 5-minute tick ----------
// 1) approve exceptions whose time has come and resend any WhatsApp email that failed;
// 2) recount film scores from all ballots; 3) fill in missing TMDB ids.
// Safe to run any number of times.
export async function clubTickHandler(req, res, now = new Date()) {
  const done = { approved: 0, resent: 0, scored: 0, tmdb: 0, errors: 0 };
  try {
    const members = (await allItems(BOARD.members)).map((it) => ({ ...memberInfo(it), approveAt: val(it, M.approve)?.value }));
    const whatsapp = !!process.env.CLUB_WHATSAPP_URL;
    for (const m of whatsapp ? members : []) {
      if (!m.email) continue;
      try {
        if (m.status === L.status.requested) {
          let at = null; try { const v = JSON.parse(m.approveAt || "null"); if (v?.date) at = new Date(`${v.date}T${v.time || "00:00:00"}Z`); } catch {}
          if (!at || at <= now) { await approveException(m, now); done.approved++; }
        } else if (m.status === L.status.member && !m.sent && m.path) {
          await sendWelcome(m, m.path === L.path.paid ? "paid" : "exception", now); done.resent++;
        }
      } catch (e) { done.errors++; console.error("club tick member", m.id, e.message); }
    }
    // scores
    const ballots = members.map((m) => m.raw?.ballot).filter((b) => Array.isArray(b) && b.length);
    const scores = scoreBallots(ballots);
    const filmItems = await allItems(BOARD.films);
    for (const it of filmItems) {
      const s = scores[it.id] || { score: 0, first: 0, ballots: 0 };
      const cur = [F.score, F.first, F.ballots].map((c) => Number(txt(it, c) || 0));
      if (cur[0] !== s.score || cur[1] !== s.first || cur[2] !== s.ballots) {
        await setValues(BOARD.films, it.id, { [F.score]: String(s.score), [F.first]: String(s.first), [F.ballots]: String(s.ballots) })
          .then(() => done.scored++).catch((e) => { done.errors++; console.error("club tick score", it.id, e.message); });
      }
      if (!txt(it, F.tmdb) && process.env.TMDB_API_KEY) {
        try {
          const year = txt(it, F.year).replace(/\.0+$/, "");
          const d = await tmdb("/search/movie", { query: it.name, include_adult: "false", ...(year ? { year } : {}) });
          const hit = d?.results?.[0];
          if (hit) { await setValues(BOARD.films, it.id, { [F.tmdb]: String(hit.id) }); done.tmdb++; }
        } catch (e) { done.errors++; console.error("club tick tmdb", it.id, e.message); }
      }
    }
    if (!whatsapp) done.note = "CLUB_WHATSAPP_URL is not set: no approvals or emails";
    return json(res, 200, done);
  } catch (e) {
    console.error("club tick failed:", e.message);
    return json(res, 502, { ...done, error: true });
  }
}
