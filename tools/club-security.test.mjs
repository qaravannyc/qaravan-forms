// node --test tools/club-security.test.mjs — the movie club's privacy and payment rules (audit D5), against the
// fakes in tools/club-fake.mjs. Nothing leaves this machine.
//   a) the join answer is the same for a new address, a member, a pending request and a removed member;
//   b) a removed member is never reset or reinstated, not by the form and not by a payment;
//   d) a film title someone adds is cleaned, and TMDB's own title is used when TMDB knows the film;
//   e) no cancel link is signed or accepted without UNSUB_SECRET;
//   f) only movie club payments count, and only for the row the form's key names;
//   C7) after canceling, Stripe sends people to qaravan.org's club page.
import test from "node:test";
import assert from "node:assert/strict";
import { makeDB, install, seedFilms } from "./club-fake.mjs";
import { clubHandler, cancelSig, cancelLink, memberEmail, clubSession, cleanTitle, BOARD, M, L } from "../lib/club.mjs";
import { resetLimits } from "../lib/gate.mjs";

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
    clubHandler(req, res);
  });
}
function fresh() {
  resetLimits();
  const DB = makeDB();
  install(DB);
  seedFilms(DB, [{ title: "Milk", year: 2008, tmdb: "10139" }, { title: "Selma", year: 2014 }, { title: "Loving", year: 2016 }]);
  return DB;
}
const members = (DB) => DB.boards[BOARD.members];
const ranking = (DB) => DB.boards[BOARD.films].slice(0, 3).map((f) => "m:" + f.id);
const join = (DB, email, extra = {}) => call("/api/club?action=join", { method: "POST", body: { lang: "en", name: "Test Person", email, ranking: ranking(DB), promise: true, ...extra } });
const row = (DB, email, status, key) => { const it = { id: String(++DB.seq), name: "Someone", cv: { [M.email]: { email, text: email }, [M.status]: { label: status }, [M.key]: key, [M.raw]: { text: "{}" } } }; members(DB).push(it); return it; };
const shape = (r) => ({ status: r.status, keys: Object.keys(r.body).sort(), state: r.body.state, ok: r.body.ok, keyOk: /^[a-f0-9]{24}$/.test(r.body.key) });

test("a) the join answer doesn't tell who is in the club; the address hears it instead, once a day", async () => {
  const DB = fresh();
  const KEY_M = "a".repeat(24), KEY_R = "b".repeat(24), KEY_X = "c".repeat(24);
  const member = row(DB, "member@example.org", L.status.member, KEY_M);
  const pending = row(DB, "pending@example.org", L.status.requested, KEY_R);
  const removed = row(DB, "removed@example.org", L.status.removed, KEY_X);
  const answers = [await join(DB, "new@example.org"), await join(DB, "member@example.org"), await join(DB, "pending@example.org"), await join(DB, "removed@example.org"),
    await call("/api/club?action=join", { method: "POST", body: { website: "bot" } })];
  for (const r of answers) assert.deepEqual(shape(r), shape(answers[0]));
  for (const r of answers.slice(1, 4)) assert.ok(![KEY_M, KEY_R, KEY_X].includes(r.body.key), "never the row's own key");
  assert.equal(member.cv[M.status].label, "Member"); assert.equal(pending.cv[M.status].label, "Exception requested");
  assert.equal(DB.mails.filter((m) => m.to === "member@example.org").length, 1);
  assert.ok(DB.mails.find((m) => m.to === "member@example.org").html.includes("https://chat.whatsapp.com/TESTLINK"));
  assert.equal(DB.mails.filter((m) => m.to === "pending@example.org").length, 1);
  assert.ok(!DB.mails.find((m) => m.to === "pending@example.org").html.includes("whatsapp"));
  await join(DB, "member@example.org");
  assert.equal(DB.mails.filter((m) => m.to === "member@example.org").length, 1, "at most one such email a day");
  // the key a member's address got leads nowhere, with the same answer as a real request
  const x = await call("/api/club?action=exception", { method: "POST", body: { key: answers[1].body.key, reasons: ["job"] } });
  assert.deepEqual(x.body, { ok: true, state: "requested" });
  assert.equal(DB.boards[BOARD.exceptions].length, 0);
});

test("b) a removed member is never reset or reinstated: not by the form, an exception or a payment", async () => {
  const DB = fresh();
  const KEY = "d".repeat(24);
  const r = row(DB, "removed@example.org", L.status.removed, KEY);
  await join(DB, "removed@example.org"); await join(DB, "removed@example.org");
  assert.equal(r.cv[M.status].label, "Removed"); assert.equal(r.cv[M.key], KEY);
  assert.equal(DB.updates.filter((u) => u.item === r.id).length, 1, "one note for the team per day");
  assert.match(DB.updates[0].body, /after being removed/);
  const x = await call("/api/club?action=exception", { method: "POST", body: { key: KEY, reasons: ["job"] } });
  assert.equal(x.body.state, "requested"); assert.equal(r.cv[M.status].label, "Removed"); assert.equal(DB.boards[BOARD.exceptions].length, 0);
  DB.sessions.cs_test_removed0001 = { id: "cs_test_removed0001", status: "complete", payment_status: "paid", client_reference_id: KEY, amount_total: 500, customer: "cus_r", customer_details: { email: "removed@example.org" } };
  const w = await call("/api/club?action=welcome&session_id=cs_test_removed0001");
  await call("/api/club?action=welcome&session_id=cs_test_removed0001");
  assert.equal(w.body.state, "paid"); assert.equal(w.body.whatsapp, "");
  assert.equal(r.cv[M.status].label, "Removed");
  assert.equal(DB.updates.filter((u) => /Paid through Stripe/.test(u.body)).length, 1, "a reload adds no second note");
  assert.equal(DB.mails.length, 0);
});

test("f) only movie club payments count, and only for the row the form's key names", async () => {
  const DB = fresh();
  const j = await join(DB, "anna@example.org");
  const paid = (id, extra) => { DB.sessions[id] = { id, status: "complete", payment_status: "paid", amount_total: 1000, customer: "cus_1", customer_details: { email: "anna@example.org" }, ...extra }; return call(`/api/club?action=welcome&session_id=${id}`); };
  // another product of the same Stripe account
  const other = await paid("cs_test_otherprod01", { client_reference_id: j.body.key, line_items: { data: [{ price: { product: { metadata: { qaravan_product: "donation" } } } }] } });
  assert.equal(other.body.ok, false); assert.equal(members(DB)[0].cv[M.status].label, "Applied"); assert.equal(DB.mails.length, 0);
  // a payment link that isn't one of the club's, when the list is set
  process.env.CLUB_PAYMENT_LINK_IDS = "plink_club5, plink_club10";
  assert.equal((await paid("cs_test_otherlink01", { client_reference_id: j.body.key, payment_link: "plink_shop" })).body.ok, false);
  delete process.env.CLUB_PAYMENT_LINK_IDS;
  // no key of ours (straight through the link): a row for the team, no membership, no WhatsApp link
  const nokey = await paid("cs_test_nokeyabc001", { customer_details: { email: "stranger@example.org", name: "<b>Stranger</b>" } });
  assert.equal(nokey.body.whatsapp, ""); await paid("cs_test_nokeyabc001", { customer_details: { email: "stranger@example.org" } });
  const s = members(DB).filter((m) => m.cv[M.email]?.email === "stranger@example.org");
  assert.equal(s.length, 1); assert.equal(s[0].cv[M.status], undefined); assert.equal(s[0].name, "Stranger");
  assert.equal(DB.updates.filter((u) => u.item === s[0].id).length, 1);
  // the club's own payment, marked on its product
  const ok = await paid("cs_test_clubprod001", { client_reference_id: j.body.key, line_items: { data: [{ price: { product: { metadata: { qaravan_product: "movie_club" } } } }] } });
  assert.equal(ok.body.whatsapp, "https://chat.whatsapp.com/TESTLINK"); assert.equal(members(DB)[0].cv[M.status].label, "Member");
  assert.equal(clubSession({ metadata: { qaravan_product: "movie_club" } }), true);
  assert.equal(clubSession({}), null);
});

test("d) an added film's title: TMDB's own when TMDB knows it, else the typed one without tags or control characters", async () => {
  const DB = fresh();
  DB.tmdbTitles = { 4242: "Pride" };
  await join(DB, "a@example.org", { ranking: [...ranking(DB), "t:4242", "t:5151"], added: [{ tmdb: "4242", title: "<img src=x onerror=alert(1)>Totally different", year: "2014" }, { tmdb: "5151", title: "<script>x</script>Good‮ Film\u0007" + "x".repeat(300), year: "1999" }] });
  const names = DB.boards[BOARD.films].map((f) => f.name);
  assert.ok(names.includes("Pride"));
  const typed = names.find((n) => n.startsWith("x Good") || n.includes("Good"));
  assert.ok(typed && !/[<>‮\u0007]/.test(typed) && typed.length <= 120, typed);
  assert.equal(cleanTitle("  <i>Milk</i>\n(2008) "), "Milk (2008)");
});

test("e) no cancel link is signed or accepted without UNSUB_SECRET; C7) the portal returns to qaravan.org", async () => {
  const DB = fresh();
  const r = row(DB, "m@example.org", L.status.member, "e".repeat(24));
  r.cv[M.customer] = "cus_9"; r.cv[M.raw] = { text: '{"lang":"en"}' };
  const ok = await call(`/club/cancel?m=${r.id}&s=${cancelSig(r.id)}`);
  assert.equal(ok.status, 303); assert.equal(DB.portal[0].return_url, "https://www.qaravan.org/forms/club/");
  const saved = process.env.UNSUB_SECRET; delete process.env.UNSUB_SECRET;
  assert.equal(cancelSig(r.id), ""); assert.equal(cancelLink(r.id), "");
  const forged = await call(`/club/cancel?m=${r.id}&s=${"0".repeat(32)}`);
  const empty = await call(`/club/cancel?m=${r.id}&s=`);
  assert.equal(forged.status, 200); assert.equal(empty.status, 200); assert.equal(DB.portal.length, 1);
  assert.ok(!memberEmail({ kind: "paid", name: "A", lang: "en", whatsapp: "https://chat.whatsapp.com/x", cancelUrl: cancelLink(r.id) }).html.includes("club/cancel"));
  process.env.UNSUB_SECRET = saved;
});
