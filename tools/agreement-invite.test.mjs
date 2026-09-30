// Checks for the Community Agreement webhook (lib/agreement-invite.mjs) against a fake
// monday and a fake Gmail: the invite goes out once, right after a sign-up, with the
// personal link; nobody signed, already invited, outside the window or on another board
// is written to; a parallel call steps back; a failed email marks the row Send failed.
// Run: node --test tools/agreement-invite.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

process.env.MONDAY_TOKEN = "fake-token";
process.env.GOOGLE_REFRESH_TOKEN = "fake";

const VOLUNTEERS = "4806484412", EVENT_VOLUNTEERS = "18432838181", EPM = "9710026121", CM = "9710142984";
const AGREEMENT = "5451306001", INVITES = "18433064516", MEMBERS = "18425190164";
const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();
const cv = (id, text, extra = {}) => ({ id, text, value: null, ...extra });
const emailCol = (id, e) => cv(id, e, { value: e ? JSON.stringify({ email: e, text: e }) : null });
const signup = (id, name, email, { created = minutesAgo(0.2), old = "", member = [] } = {}) => ({
  id: String(id), name, created_at: created, state: "active", group: { id: "topics" },
  column_values: [emailCol("email", email), cv("short_text", old), cv("status88", ""), cv("board_relation_mm635h5j", "", { linked_item_ids: member.map(String) }), cv("location", ""), cv("phone", "")],
});
const signature = (id, name, email, { code = "" } = {}) => ({
  id: String(id), name, created_at: "2026-09-29T15:00:00Z", state: "active", group: { id: "topics" },
  column_values: [cv("short_text", name), cv("short_text6", email), cv("date_1", "2026-09-29"), cv("board_relation_mm639r9e", "", { linked_item_ids: [] }), cv("short_textifj2izd7", code)],
});
const invite = (id, name, email) => ({ id: String(id), name, created_at: "2026-09-29T15:00:00Z", group: { id: "topics" }, column_values: [emailCol("email", email), cv("invite_status", "Invited")] });

let S;
function reset(boards = {}) {
  S = { boards: { [VOLUNTEERS]: [], [EVENT_VOLUNTEERS]: [], [EPM]: [], [CM]: [], [AGREEMENT]: [], [INVITES]: [], [MEMBERS]: [], ...boards },
    reads: [], writes: [], mails: [], nextId: 1000, gmailFails: false, beforeRecheck: null };
}
const boardOf = (id) => Object.keys(S.boards).find((b) => S.boards[b].some((it) => it.id === String(id)));
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith("https://oauth2.googleapis.com/")) return new Response(JSON.stringify({ access_token: "tok" }));
  if (u.startsWith("https://gmail.googleapis.com/")) {
    if (S.gmailFails) return new Response("quota", { status: 429 });
    S.mails.push(Buffer.from(JSON.parse(opts.body).raw, "base64url").toString("utf8"));
    return new Response("{}");
  }
  if (u !== "https://api.monday.com/v2") throw new Error("unexpected fetch " + u);
  const { query, variables = {} } = JSON.parse(opts.body);
  const ok = (data) => new Response(JSON.stringify({ data }));
  if (/items\(ids: \$id\)/.test(query)) {
    const id = variables.id[0], b = boardOf(id);
    return ok({ items: b ? [{ ...S.boards[b].find((it) => it.id === id), board: { id: b } }] : [] });
  }
  let m;
  if ((m = query.match(/boards\(ids: \[(\d+)\]\) \{ items_page/))) {
    S.reads.push(m[1]);
    if (m[1] === INVITES && S.reads.filter((r) => r === INVITES).length === 2 && S.beforeRecheck) S.beforeRecheck();
    return ok({ boards: [{ items_page: { cursor: null, items: S.boards[m[1]] || [] } }] });
  }
  if (/create_item/.test(query)) {
    const id = String(S.nextId++), v = JSON.parse(variables.v);
    S.writes.push({ kind: "create", id, name: variables.n, v });
    S.boards[variables.b].push({ id, name: variables.n, created_at: new Date().toISOString(), group: { id: "topics" }, column_values: [emailCol("email", v.email.email)] });
    return ok({ create_item: { id } });
  }
  if (/delete_item/.test(query)) {
    S.writes.push({ kind: "delete", id: variables.id });
    S.boards[INVITES] = S.boards[INVITES].filter((it) => it.id !== variables.id);
    return ok({ delete_item: { id: variables.id } });
  }
  if (/change_multiple_column_values/.test(query)) { S.writes.push({ kind: "change", id: variables.i, v: JSON.parse(variables.v) }); return ok({ change_multiple_column_values: { id: variables.i } }); }
  throw new Error("unexpected monday query " + query.slice(0, 80));
};

const survey = (await import("../api/survey.mjs")).default;
const { parseCall } = await import("../lib/agreement-invite.mjs");

async function call(body, { method = "POST", path = "/api/survey?form=agreement-invite" } = {}) {
  const raw = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
  const req = { method, url: path, headers: { "content-type": "application/json" }, async *[Symbol.asyncIterator]() { if (raw) yield Buffer.from(raw); } };
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(s) { this.body = s; } };
  await survey(req, res);
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") };
}
const htmlOf = (mime) => {
  const part = mime.split(/\r\n--rel_/)[1];
  return Buffer.from(part.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf8");
};

test("monday's challenge comes back as is", async () => {
  reset();
  const r = await call({ challenge: "abc123" });
  assert.deepEqual([r.status, r.json], [200, { challenge: "abc123" }]);
});

test("a sign-up made seconds ago, unsigned, gets one invite with the personal link", async () => {
  reset({ [VOLUNTEERS]: [signup(1, "Maria Milosh", "Maria@Example.com")] });
  const r = await call({ itemId: 1, boardId: VOLUNTEERS });
  assert.deepEqual([r.status, r.json], [200, { ok: true, result: "sent", why: "Volunteer sign-up form" }]);
  assert.equal(JSON.stringify(r.json).includes("maria"), false, "no names or addresses in the answer");
  const [row] = S.writes;
  assert.equal(row.kind, "create");
  assert.deepEqual([row.name, row.v.email.email, row.v.invite_status, row.v.reminders], ["Maria Milosh", "maria@example.com", { label: "Invited" }, "0"]);
  assert.match(row.v.invite_code, /^[0-9a-f]{12}$/);
  assert.equal(S.mails.length, 1);
  assert.match(S.mails[0], /^From: QARAVAN <info@qaravan\.org>\r\nTo: maria@example\.com\r\n/);
  const html = htmlOf(S.mails[0]);
  assert.ok(html.includes(`?r=use1&amp;name=Maria%20Milosh&amp;email=maria%40example.com&amp;invite=${row.v.invite_code}`));
  assert.ok(html.includes("Hi Maria!"));
});

test("monday's webhook shape, a plain { itemId } and ?item= are all understood", () => {
  const url = (s) => new URL(s, "https://x");
  assert.deepEqual(parseCall({ event: { pulseId: 42, boardId: 4806484412 } }, url("/")), { itemId: "42", boardId: "4806484412" });
  assert.deepEqual(parseCall({}, url("/?item=7&board=18432838181")), { itemId: "7", boardId: "18432838181" });
  assert.deepEqual(parseCall({ itemId: "12 " }, url("/")), { itemId: "12", boardId: "" });
  assert.deepEqual(parseCall({ itemId: "12; drop" }, url("/")), { itemId: "", boardId: "" });
});

test("monday's own webhook body: sent; a row from before START or older than two weeks: nothing read, nothing written", async () => {
  reset({ [VOLUNTEERS]: [signup(1, "Gleb Orlov", "gleb@example.com"), signup(2, "Dina Old", "dina@example.com", { created: "2026-09-20T10:00:00Z" }),
    signup(3, "Lev Late", "lev@example.com", { created: minutesAgo(15 * 24 * 60) })] });
  const r = await call({ event: { type: "create_pulse", boardId: Number(VOLUNTEERS), pulseId: 1, pulseName: "Gleb Orlov" } });
  assert.equal(r.json.result, "sent");
  S.reads = []; S.writes = []; S.mails = [];
  for (const id of [2, 3]) assert.equal((await call({ itemId: id })).json.why, "outside the invite window");
  assert.deepEqual([S.reads, S.writes, S.mails], [[], [], []]);
});

test("already on the invites board — by email or by full name — stops before the member registry", async () => {
  reset({ [VOLUNTEERS]: [signup(1, "Vera Sokolova", "vera@example.com"), signup(2, "Vera Sokolova", "vera.work@example.com")], [INVITES]: [invite(70, "Vera Sokolova", "vera@example.com")] });
  for (const id of [1, 2]) {
    const r = await call({ itemId: id });
    assert.equal(r.json.why, "already invited");
  }
  assert.deepEqual([S.reads.includes(MEMBERS), S.writes, S.mails], [false, [], []]);
});

test("signed on the agreement board, or on the old form: no invite", async () => {
  reset({
    [VOLUNTEERS]: [signup(1, "Anna Ivanova", "anna@example.com"), signup(2, "Boris Petrov", "boris@example.com", { old: "signed" })],
    [AGREEMENT]: [signature(50, "Anna Ivanova", "ANNA@example.com")],
  });
  assert.match((await call({ itemId: 1 })).json.why, /^signed \(email/);
  assert.match((await call({ itemId: 2 })).json.why, /^signed \(email/);
  assert.deepEqual([S.writes, S.mails], [[], []]);
});

test("signed under the member card's other email: no invite", async () => {
  reset({
    [VOLUNTEERS]: [signup(1, "Masha Ivanova", "masha@example.com", { member: [900] })],
    [MEMBERS]: [{ id: "900", name: "Maria Ivanova", created_at: "2026-01-01T00:00:00Z", group: { id: "topics" }, column_values: [emailCol("email_mm5ysnnh", "maria@example.com"), cv("text_mm63j91w", ""), cv("date_mm63tz8c", "2026-08-10")] }],
  });
  assert.match((await call({ itemId: 1 })).json.why, /^signed \(member/);
  assert.deepEqual(S.mails, []);
});

test("rows from other boards, deleted rows and a wrong board are refused", async () => {
  reset({ [AGREEMENT]: [signature(50, "Anna Ivanova", "anna@example.com")],
    [EVENT_VOLUNTEERS]: [signup(3, "Ira Lee", "ira@example.com"), { ...signup(6, "Olga Gone", "olga@example.com"), state: "deleted" }] });
  assert.equal((await call({ itemId: 6 })).json.why, "no such item");
  assert.deepEqual([(await call({ itemId: 50 })).status, (await call({ itemId: 50 })).json.why], [400, "not a volunteer sign-up board"]);
  const wrong = await call({ itemId: 3, boardId: VOLUNTEERS });
  assert.deepEqual([wrong.status, wrong.json.why], [400, "item is on another board"]);
  assert.equal((await call({ itemId: 999 })).json.why, "no such item");
  assert.equal((await call({})).status, 400);
  assert.equal((await call("{not json")).status, 400);
  assert.deepEqual([S.writes, S.mails], [[], []]);
});

test("a second call racing the first steps back and removes its own row", async () => {
  reset({ [EVENT_VOLUNTEERS]: [signup(3, "Irina Knyazeva", "irina@example.com")] });
  // The other call's row lands between our create and our second look.
  S.beforeRecheck = () => S.boards[INVITES].unshift(invite(999, "Irina Knyazeva", "irina@example.com"));
  const r = await call({ itemId: 3 });
  assert.equal(r.json.why, "already invited (a parallel call)");
  assert.deepEqual(S.writes.map((w) => w.kind), ["create", "delete"]);
  assert.deepEqual(S.mails, []);
});

test("Gmail refuses: the row turns Send failed and monday sees an error", async () => {
  reset({ [EPM]: [signup(4, "Dina Rose", "dina@example.com")] });
  S.gmailFails = true;
  const r = await call({ itemId: 4 });
  assert.deepEqual([r.status, r.json.result], [502, "failed"]);
  assert.deepEqual(S.writes.map((w) => [w.kind, w.v?.invite_status]), [["create", { label: "Invited" }], ["change", { label: "Send failed" }]]);
  S.gmailFails = false;
  assert.equal((await call({ itemId: 4 })).json.why, "already invited", "a retry does not send again");
});

test("?dry=1 says what would happen and writes nothing; GET without it is refused", async () => {
  reset({ [CM]: [signup(5, "Lev Tal", "lev@example.com")] });
  const r = await call(undefined, { method: "GET", path: "/api/survey?form=agreement-invite&dry=1&item=5" });
  assert.deepEqual(r.json, { ok: true, result: "would send", why: "Community Manager application" });
  assert.equal((await call(undefined, { method: "GET", path: "/api/survey?form=agreement-invite&item=5" })).status, 405);
  assert.deepEqual([S.writes, S.mails], [[], []]);
});
