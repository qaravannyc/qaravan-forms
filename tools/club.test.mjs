// node --test tools/club.test.mjs — the movie club (lib/club.mjs) against fake monday, Stripe,
// Gmail and TMDB (tools/club-fake.mjs). Nothing leaves this machine.
import test from "node:test";
import assert from "node:assert/strict";
import { makeDB, install, seedFilms } from "./club-fake.mjs";
import { parseJoin, approvalDelayMinutes, scoreBallots, cancelSig, cancelLink, pickTrailer, memberEmail, clubHandler, clubTickHandler, BOARD, M, L } from "../lib/club.mjs";

process.env.UNSUB_SECRET = "test-secret";
process.env.GOOGLE_REFRESH_TOKEN = "fake";
process.env.CLUB_WHATSAPP_URL = "https://chat.whatsapp.com/TESTLINK";
process.env.STRIPE_SECRET_KEY = "rk_test_fake";
process.env.TMDB_API_KEY = "0123456789abcdef0123456789abcdef";

function call(url, { method = "GET", body } = {}) {
  const chunks = body ? [Buffer.from(JSON.stringify(body))] : [];
  const req = { url, method, async *[Symbol.asyncIterator]() { yield* chunks; } };
  return new Promise((resolve) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b = "") { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: this.statusCode, headers: this.headers, body: j ?? b }); } };
    (url.includes("club-tick") ? clubTickHandler(req, res) : clubHandler(req, res));
  });
}
function fresh() {
  const DB = makeDB();
  install(DB);
  seedFilms(DB, [{ title: "Milk", year: 2008, tmdb: "10139" }, { title: "Selma", year: 2014 }, { title: "Loving", year: 2016 }, { title: "Rustin", year: 2023 }]);
  return DB;
}
const films = (DB) => DB.boards[BOARD.films];
const members = (DB) => DB.boards[BOARD.members];
const joinBody = (DB, extra = {}) => ({ lang: "ru", name: "Анна Петрова", email: "Anna@Example.com ", ranking: films(DB).slice(0, 3).map((f) => "m:" + f.id), topics: ["race", "other"], topic_other: "суды присяжных", talk: "both", helps: ["food"], promise: true, ...extra });

test("parseJoin needs a name, an email, three films and the promise", () => {
  assert.deepEqual(parseJoin({}).fields, ["name", "email", "ranking", "promise"]);
  const { ok, a } = parseJoin({ name: " Ann ", email: "A@B.co", ranking: ["m:1", "m:1", "m:2", "t:55", "x:3", "m:4"], added: [{ tmdb: "55", title: "Pride", year: 2014 }], promise: true, topics: ["race", "nope"] });
  assert.equal(ok, true);
  assert.deepEqual(a.ranking, ["m:1", "m:2", "t:55", "m:4"]);
  assert.equal(a.email, "a@b.co");
  assert.deepEqual(a.topics, ["race"]);
  // a "t:" entry without its film is dropped
  assert.deepEqual(parseJoin({ ranking: ["t:7", "m:1", "m:2"], added: [] }).a.ranking, ["m:1", "m:2"]);
});

test("exceptions are approved within 12 hours, about a quarter at once", () => {
  let zero = 0;
  for (let i = 0; i < 5000; i++) { const d = approvalDelayMinutes(); assert.ok(d >= 0 && d < 720); if (d === 0) zero++; }
  assert.ok(zero > 1000 && zero < 1500, `instant approvals: ${zero}`);
});

test("Borda scores", () => {
  const s = scoreBallots([["a", "b", "c"], ["b", "a", "c", "d", "e"]]);
  assert.deepEqual(s.a, { score: 9, first: 1, ballots: 2 });
  assert.deepEqual(s.c, { score: 6, first: 0, ballots: 2 });
  assert.deepEqual(s.e, { score: 1, first: 0, ballots: 1 });
});

test("trailer pick prefers an official YouTube trailer", () => {
  assert.equal(pickTrailer([{ site: "YouTube", type: "Teaser", official: true, key: "t" }, { site: "Vimeo", type: "Trailer", key: "v" }, { site: "YouTube", type: "Trailer", official: false, key: "u" }, { site: "YouTube", type: "Trailer", official: true, key: "ok" }]), "ok");
  assert.equal(pickTrailer([]), "");
});

test("emails: Russian and English, WhatsApp link, cancel link only for paid members, no RUSA", () => {
  const paid = memberEmail({ kind: "paid", name: "Анна", lang: "ru", whatsapp: "https://chat.whatsapp.com/X", cancelUrl: "https://feedback.qaravan.org/club/cancel?m=1&s=2" });
  assert.match(paid.subject, /киноклуб/i);
  assert.ok(paid.html.includes("https://chat.whatsapp.com/X") && paid.html.includes("club/cancel"));
  const ok = memberEmail({ kind: "exception", name: "Ann", lang: "en", whatsapp: "https://chat.whatsapp.com/X" });
  assert.ok(!ok.html.includes("club/cancel") && ok.html.includes('lang="en"'));
  for (const h of [paid.html, ok.html]) { assert.ok(!/rusa/i.test(h)); assert.ok(!/[·•]/.test(h)); }
});

test("films list: board films plus TMDB posters, trailers and Russian titles", async () => {
  const DB = fresh();
  process.env.CLUB_LINK_10 = "https://buy.stripe.com/test_ten";
  const r = await call("/api/club?action=films");
  assert.equal(r.status, 200);
  assert.equal(r.body.films.length, 4);
  const milk = r.body.films.find((f) => f.title === "Milk");
  assert.equal(milk.trailer, "yt10139"); assert.equal(milk.titleRu, "Фильм 10139");
  assert.equal(r.body.links[10], "https://buy.stripe.com/test_ten");
  assert.match(r.headers["cache-control"], /s-maxage/);
});

test("join → exception → approval by the tick → one email with the WhatsApp link", async () => {
  const DB = fresh();
  const j = await call("/api/club?action=join", { method: "POST", body: { ...joinBody(DB), ranking: [...joinBody(DB).ranking, "t:4242"], added: [{ tmdb: "4242", title: "Pride", year: "2014" }] } });
  assert.equal(j.status, 200); assert.match(j.body.key, /^[a-f0-9]{24}$/);
  assert.equal(films(DB).length, 5, "the added film joins the pool");
  const row = members(DB)[0];
  assert.equal(row.name, "Анна Петрова"); assert.equal(row.cv[M.email].email, "anna@example.com"); assert.equal(row.cv[M.status].label, "Applied");
  assert.match(row.cv[M.picks].text, /^1\. Milk \(2008\)\n2\. Selma/); assert.match(row.cv[M.picks].text, /4\. Pride \(2014\)$/);
  assert.equal(DB.updates.length, 1);

  // exception without reasons is refused
  assert.equal((await call("/api/club?action=exception", { method: "POST", body: { key: j.body.key, reasons: [] } })).status, 400);
  const x = await call("/api/club?action=exception", { method: "POST", body: { key: j.body.key, reasons: ["ead", "job"], comment: "Жду EAD с весны" } });
  assert.equal(x.body.state, "requested");
  const exc = DB.boards[BOARD.exceptions][0];
  assert.deepEqual(exc.cv.exc_reasons.labels, [L.reasons.ead, L.reasons.job]);
  assert.ok(row.cv[M.approve].date);
  const before = DB.mails.length; // 0 or 1: an instant approval mails at once

  // force the approval time into the past and run the tick twice: one email in total
  row.cv[M.approve] = { date: "2020-01-01", time: "00:00:00" };
  if (row.cv[M.status].label === "Member") assert.equal(before, 1);
  await call("/api/club-tick"); await call("/api/club-tick");
  assert.equal(row.cv[M.status].label, "Member"); assert.equal(row.cv[M.path].label, "Exception");
  assert.equal(DB.mails.length, 1);
  assert.equal(DB.mails[0].to, "anna@example.com");
  assert.ok(DB.mails[0].html.includes("https://chat.whatsapp.com/TESTLINK"));
  assert.ok(!DB.mails[0].html.includes("club/cancel"));

  // scores: Milk first on the only ballot
  const milk = films(DB).find((f) => f.name === "Milk");
  assert.equal(milk.cv.film_score, "5"); assert.equal(milk.cv.film_first, "1"); assert.equal(milk.cv.film_ballots, "1");
  // a second join with the same email is told it's already a member
  const again = await call("/api/club?action=join", { method: "POST", body: joinBody(DB) });
  assert.equal(again.body.state, "member"); assert.equal(members(DB).length, 1);
});

test("nobody is approved or emailed while the WhatsApp link isn't set", async () => {
  const DB = fresh();
  const j = await call("/api/club?action=join", { method: "POST", body: joinBody(DB) });
  const saved = process.env.CLUB_WHATSAPP_URL; delete process.env.CLUB_WHATSAPP_URL;
  await call("/api/club?action=exception", { method: "POST", body: { key: j.body.key, reasons: ["housing"] } });
  members(DB)[0].cv[M.approve] = { date: "2020-01-01", time: "00:00:00" };
  const tick = await call("/api/club-tick");
  assert.match(tick.body.note, /CLUB_WHATSAPP_URL/);
  assert.equal(members(DB)[0].cv[M.status].label, "Exception requested"); assert.equal(DB.mails.length, 0);
  process.env.CLUB_WHATSAPP_URL = saved;
});

test("paid: welcome checks the Checkout Session, marks the row and emails once with a cancel link", async () => {
  const DB = fresh();
  const j = await call("/api/club?action=join", { method: "POST", body: joinBody(DB, { lang: "en" }) });
  DB.sessions.cs_test_abcdefghijk = { id: "cs_test_abcdefghijk", status: "complete", payment_status: "paid", client_reference_id: j.body.key, amount_total: 1000, customer: "cus_123", subscription: "sub_123", customer_details: { email: "anna@example.com" } };
  DB.sessions.cs_test_unpaid00000 = { id: "cs_test_unpaid00000", status: "open", payment_status: "unpaid" };
  assert.equal((await call("/api/club?action=welcome&session_id=cs_test_unpaid00000")).body.state, "unpaid");
  const w = await call("/api/club?action=welcome&session_id=cs_test_abcdefghijk");
  assert.equal(w.body.state, "paid"); assert.equal(w.body.whatsapp, "https://chat.whatsapp.com/TESTLINK"); assert.equal(w.body.name, "Анна");
  await call("/api/club?action=welcome&session_id=cs_test_abcdefghijk"); // reload of the page
  const row = members(DB)[0];
  assert.equal(row.cv[M.tier].label, "$10"); assert.equal(row.cv[M.path].label, "Paid"); assert.equal(row.cv[M.customer], "cus_123");
  assert.equal(DB.mails.length, 1);
  assert.ok(DB.mails[0].html.includes(cancelLink(row.id).replace(/&/g, "&amp;")));
  assert.match(DB.mails[0].subject, /Welcome/);
  // the cancel link opens Stripe's portal for this customer; a forged one doesn't
  const c = await call(`/club/cancel?m=${row.id}&s=${cancelSig(row.id)}`);
  assert.equal(c.status, 303); assert.equal(DB.portal[0].customer, "cus_123"); assert.equal(DB.portal[0].locale, "en");
  const bad = await call(`/club/cancel?m=${row.id}&s=${"0".repeat(32)}`);
  assert.equal(bad.status, 200); assert.equal(DB.portal.length, 1);
});

test("welcome without a Stripe key answers 'pending' instead of failing", async () => {
  fresh();
  const saved = process.env.STRIPE_SECRET_KEY; delete process.env.STRIPE_SECRET_KEY;
  const w = await call("/api/club?action=welcome&session_id=cs_test_abcdefghijk");
  assert.equal(w.body.state, "pending");
  process.env.STRIPE_SECRET_KEY = saved;
});

test("search goes through TMDB and the tick fills in missing TMDB ids", async () => {
  const DB = fresh();
  const s = await call("/api/club?action=search&q=pride");
  assert.equal(s.body.results[0].tmdb, "999001");
  await call("/api/club-tick");
  assert.ok(films(DB).every((f) => f.cv.film_tmdb), "every film got an id");
});
