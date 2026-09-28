// Checks for the volunteer sign-up handler (lib/event-volunteers.mjs) with a fake
// monday API: code → label mapping, phone and handle clean-up, the month
// window, validation, the honeypot and the retry without the phone column.
// Run: node --test tools/event-volunteers.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

process.env.MONDAY_TOKEN = "fake";
const calls = [];
let failFirstCreate = false;
globalThis.fetch = async (url, opts = {}) => {
  const { query, variables } = JSON.parse(opts.body);
  calls.push({ query, variables });
  if (query.includes("create_item")) {
    if (failFirstCreate) { failFirstCreate = false; return new Response(JSON.stringify({ errors: [{ message: "bad phone" }] })); }
    return new Response(JSON.stringify({ data: { create_item: { id: "777" } } }));
  }
  if (query.includes("create_update")) return new Response(JSON.stringify({ data: { create_update: { id: "u1" } } }));
  return new Response(JSON.stringify({ errors: [{ message: "unexpected" }] }));
};

const V = await import("../lib/event-volunteers.mjs");
const survey = (await import("../api/survey.mjs")).default;

function fakeReq(body, url = "/api/survey?form=event-volunteers", method = "POST") {
  const buf = Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  return { method, url, async *[Symbol.asyncIterator]() { yield buf; } };
}
function fakeRes() {
  const r = { statusCode: 200, headers: {}, body: "", setHeader(k, v) { r.headers[k] = v; }, end(b) { r.body = b || ""; } };
  return r;
}
const NOW = new Date("2026-09-28T12:00:00-04:00");
const nextMonths = () => {
  const out = [], start = V.currentMonthIndex() + 1;
  for (let i = 0; i < 6; i++) { const n = start + i; out.push(`${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}`); }
  return out;
};
const valid = () => ({
  name: "  Алекс  ", pronouns: "они/их", telegram: "https://t.me/alex_q", instagram: "instagram.com/alex.q/",
  phone: "(212) 555-0123", email: "Alex@Example.com", roles: ["maker", "planner", "maker", "nope"],
  months: nextMonths().slice(0, 2), frequency: "bimonthly", attended: "yes", notes: "Рисую в Figma.", lang: "ru",
});

test("month labels match the board", () => {
  assert.equal(V.monthLabel("2026-10"), "Октябрь 2026");
  assert.equal(V.monthLabel("2027-03"), "Март 2027");
  assert.equal(V.monthLabel("2027-13"), null);
});

test("month window: last month to a year ahead", () => {
  assert.equal(V.monthAllowed("2026-10", NOW), true);
  assert.equal(V.monthAllowed("2026-08", NOW), true);
  assert.equal(V.monthAllowed("2026-07", NOW), false);
  assert.equal(V.monthAllowed("2027-09", NOW), true);
  assert.equal(V.monthAllowed("2027-10", NOW), false);
});

test("phones: US default, +7, 8-prefix, Kazakhstan, too short", () => {
  assert.deepEqual(V.normPhone("(212) 555-0123"), { e164: "+12125550123", country: "US" });
  assert.deepEqual(V.normPhone("+7 916 123-45-67"), { e164: "+79161234567", country: "RU" });
  assert.deepEqual(V.normPhone("8 916 123 45 67"), { e164: "+79161234567", country: "RU" });
  assert.deepEqual(V.normPhone("+7 701 123 4567"), { e164: "+77011234567", country: "KZ" });
  assert.deepEqual(V.normPhone("+380 67 123 4567"), { e164: "+380671234567", country: "UA" });
  assert.equal(V.normPhone("12345"), null);
});

test("handles: links and bare names become @name, anything else stays as typed", () => {
  assert.equal(V.normHandle("https://t.me/alex_q", "telegram"), "@alex_q");
  assert.equal(V.normHandle("alex_q", "telegram"), "@alex_q");
  assert.equal(V.normHandle("@@alex_q", "telegram"), "@alex_q");
  assert.equal(V.normHandle("+1 212 555 0123", "telegram"), "+1 212 555 0123");
  assert.equal(V.normHandle("www.instagram.com/alex.q/?hl=ru", "instagram"), "@alex.q");
  assert.equal(V.normHandle("", "instagram"), "");
});

test("a valid application becomes one row with the board's labels and an update", async () => {
  calls.length = 0;
  const res = fakeRes();
  await survey(fakeReq(valid()), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, '{"ok":true}');
  const create = calls.find((c) => c.query.includes("create_item"));
  assert.equal(create.variables.b, "18432838181");
  assert.equal(create.variables.g, "topics");
  assert.equal(create.variables.n, "Алекс");
  assert.match(create.query, /create_labels_if_missing:true/);
  const cv = JSON.parse(create.variables.v);
  assert.equal(cv.pronouns, "они/их");
  assert.equal(cv.telegram, "@alex_q");
  assert.equal(cv.instagram, "@alex.q");
  assert.deepEqual(cv.phone, { phone: "+12125550123", countryShortName: "US" });
  assert.deepEqual(cv.email, { email: "alex@example.com", text: "alex@example.com" });
  assert.deepEqual(cv.roles, { labels: ["Maker", "Planner"] });
  assert.deepEqual(cv.months, { labels: nextMonths().slice(0, 2).map(V.monthLabel) });
  assert.deepEqual(cv.frequency, { label: "Раз в пару месяцев" });
  assert.deepEqual(cv.attended, { label: "Да" });
  assert.deepEqual(cv.notes, { text: "Рисую в Figma." });
  assert.deepEqual(cv.app_status, { label: "Новая" });
  const upd = calls.find((c) => c.query.includes("create_update"));
  assert.equal(upd.variables.i, "777");
  assert.match(upd.variables.t, /Роли: Maker, Planner/);
  assert.match(upd.variables.t, /Телефон: \+12125550123/);
});

test("optional answers left empty are not written", async () => {
  calls.length = 0;
  const b = { ...valid(), pronouns: "", telegram: "", instagram: "", frequency: "", attended: "", notes: "" };
  const res = fakeRes();
  await survey(fakeReq(b), res);
  const cv = JSON.parse(calls.find((c) => c.query.includes("create_item")).variables.v);
  for (const k of ["pronouns", "telegram", "instagram", "frequency", "attended", "notes"]) assert.equal(k in cv, false, k);
});

test("missing required fields → 400 with the list, nothing written", async () => {
  calls.length = 0;
  const res = fakeRes();
  await survey(fakeReq({ name: " ", phone: "123", email: "nope", roles: [], months: ["1999-01"] }), res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(JSON.parse(res.body), { error: "invalid", fields: ["name", "phone", "email", "roles", "months"] });
  assert.equal(calls.length, 0);
});

test("honeypot: polite ok, nothing written", async () => {
  calls.length = 0;
  const res = fakeRes();
  await survey(fakeReq({ ...valid(), website: "http://spam" }), res);
  assert.equal(res.body, '{"ok":true}');
  assert.equal(calls.length, 0);
});

test("if monday rejects the phone, the row is created without it and the number stays in the update", async () => {
  calls.length = 0; failFirstCreate = true;
  const res = fakeRes();
  await survey(fakeReq(valid()), res);
  assert.equal(res.body, '{"ok":true}');
  const creates = calls.filter((c) => c.query.includes("create_item"));
  assert.equal(creates.length, 2);
  assert.equal("phone" in JSON.parse(creates[1].variables.v), false);
  assert.match(calls.find((c) => c.query.includes("create_update")).variables.t, /Телефон: \+12125550123/);
});

test("the plain /api/event-volunteers path is routed too; other survey requests are untouched", async () => {
  calls.length = 0;
  const res = fakeRes();
  await survey(fakeReq(valid(), "/api/event-volunteers"), res);
  assert.equal(res.body, '{"ok":true}');
  const res2 = fakeRes();
  await survey(fakeReq({}, "/api/survey", "PUT"), res2);
  assert.equal(res2.statusCode, 405);
});
