// Checks for the status page behind «Изменить статус» in the team email about a new support group
// sign-up (lib/status.mjs, lib/support-mail.mjs): the key opens only this page and only for its row,
// the statuses are the board's own labels in monday's order, a choice is written to the board with
// an update, anything else is refused. In-memory store instead of monday.
// Run: node --test tools/status.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

process.env.MONDAY_TOKEN = "fake-token";
globalThis.fetch = async (url) => { throw new Error("unexpected fetch " + url); };
const M = await import("../lib/meetings.mjs");
const S = await import("../lib/status.mjs");
const Mail = await import("../lib/support-mail.mjs");
const SG = await import("../lib/support-groups.mjs");
const survey = (await import("../api/survey.mjs")).default;

// колонка Status доски Джины, как её отдаёт monday (settings_str)
const SETTINGS = JSON.stringify({ labels: { 0: "Contacted", 1: "Joined", 4: "Intro call done", 7: "New", 17: "Not now", 9: "Old label" },
  labels_positions_v2: { 0: 1, 1: 3, 4: 2, 7: 0, 17: 4, 9: 5 }, deactivated_labels: [9] });
function fake() {
  const s = {
    rows: { "13165851018": { id: "13165851018", name: "Stanislav", status: "New", email: "goldenstas.ua@gmail.com", date: "2026-09-29 18:07" } },
    set: [], notes: [],
    async load(group, id) { return { item: s.rows[id] ? { ...s.rows[id] } : null, labels: S.labelsOf(SETTINGS) }; },
    async setStatus(group, id, label) { s.set.push([group, id, label]); s.rows[id].status = label; },
    async note(id, text) { s.notes.push({ id, text }); },
  };
  return s;
}
const NOW = new Date("2026-09-30T16:00:00Z");
const key = (item = "13165851018", group = "gina", exp = NOW.getTime() + 86400000) => M.signToken({ item, group, exp, kind: "st" });

async function call(method, url, body) {
  const chunks = body === undefined ? [] : [Buffer.from(typeof body === "string" ? body : JSON.stringify(body))];
  const req = { method, url, headers: {}, async *[Symbol.asyncIterator]() { yield* chunks; } };
  const res = { statusCode: 200, body: "", setHeader() {}, end(b) { this.body = b || ""; } };
  await survey(req, res);
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
}

test("labels: the board's own statuses in monday's order, without switched-off ones", () => {
  assert.deepEqual(S.labelsOf(SETTINGS), ["New", "Contacted", "Intro call done", "Joined", "Not now"]);
  assert.deepEqual(S.labelsOf(""), []);
  assert.equal(S.hasStatus("gina"), true);
  assert.equal(S.hasStatus("simon"), false); // у доски Саймона статуса нет
});

test("key: a year long, only for the status page and only for its row", async () => {
  {
    const url = S.statusUrl("13165851018", "gina", NOW);
    assert.match(url, /^https:\/\/feedback\.qaravan\.org\/support\/status\?t=[\w-]+\.[\w-]+$/);
    const t = new URL(url).searchParams.get("t");
    assert.deepEqual(M.verifyToken(t, NOW.getTime() + 364 * 86400000, process.env, "st"), { item: "13165851018", group: "gina" });
    assert.deepEqual(M.verifyToken(t, NOW.getTime() + 366 * 86400000, process.env, "st"), { error: "expired" });
    assert.deepEqual(M.verifyToken(t, NOW.getTime()), { error: "bad" }); // страницу отправки письма не открывает
    assert.deepEqual(M.verifyToken(t, NOW.getTime(), process.env, "att"), { error: "bad" }); // и отметки пришедших тоже
  }
  S.setStore(fake());
  assert.deepEqual(await S.statusData(M.signToken({ item: "13165851018", group: "gina", exp: NOW.getTime() + 86400000, kind: "att" }), NOW), { error: "bad" });
  assert.deepEqual(await S.statusData(key("13165851018", "simon"), NOW), { error: "bad" });
  assert.deepEqual(await S.statusData(key("999"), NOW), { error: "gone" });
});

test("page: name, email, date, the current status and every status with its meaning", async () => {
  S.setStore(fake());
  const d = await S.statusData(key(), NOW);
  assert.equal(d.name, "Stanislav");
  assert.equal(d.email, "goldenstas.ua@gmail.com");
  assert.equal(d.date, "2026-09-29");
  assert.equal(d.status, "New");
  assert.deepEqual(d.options.map((o) => o.label), ["New", "Contacted", "Intro call done", "Joined", "Not now"]);
  assert.match(d.options.find((o) => o.label === "Joined").hint, /получает письма со ссылкой на встречу/);
  assert.equal(d.url, "https://qaravan.monday.com/boards/18433061986/pulses/13165851018");
});

test("save: the chosen status goes to the board with an update; the same one writes nothing; others refused", async () => {
  const s = fake(); S.setStore(s);
  const r = await S.saveStatus(key(), { status: "Joined" }, NOW);
  assert.deepEqual([r.status, r.label, r.was, r.changed], [200, "Joined", "New", true]);
  assert.deepEqual(s.set, [["gina", "13165851018", "Joined"]]);
  assert.match(s.notes[0].text, /^Статус: New → Joined\. По кнопке «Изменить статус» из письма о новой анкете\.$/);
  const same = await S.saveStatus(key(), { status: "Joined" }, NOW);
  assert.equal(same.changed, false); assert.equal(s.set.length, 1); assert.equal(s.notes.length, 1);
  assert.equal((await S.saveStatus(key(), { status: "Old label" }, NOW)).status, 400); // выключенный
  assert.equal((await S.saveStatus(key(), { status: "Whatever" }, NOW)).status, 400);
  assert.equal((await S.saveStatus("nope", { status: "Joined" }, NOW)).status, 403);
  assert.equal((await S.saveStatus(key(undefined, undefined, NOW.getTime() - 1), { status: "Joined" }, NOW)).status, 403);
  assert.equal(s.set.length, 1);
});

test("routes: /api/status through the survey function", async () => {
  const s = fake(); S.setStore(s);
  const t = M.signToken({ item: "13165851018", group: "gina", exp: Date.now() + 86400000, kind: "st" });
  const g = await call("GET", `/api/survey?form=status&t=${t}`);
  assert.equal(g.status, 200); assert.equal(g.json.status, "New");
  assert.equal((await call("GET", "/api/survey?form=status&t=bad")).status, 403);
  const p = await call("POST", "/api/survey?form=status", { t, status: "Contacted" });
  assert.equal(p.status, 200); assert.equal(s.rows["13165851018"].status, "Contacted");
  assert.equal((await call("POST", "/api/survey?form=status", "{x")).status, 400);
  // ссылка для старой анкеты — только с секретом
  process.env.CRON_SECRET = "cron";
  assert.equal((await call("GET", "/api/survey?form=status&key=nope&item=42")).status, 401);
  assert.equal((await call("GET", "/api/survey?form=status&key=cron&item=42&group=simon")).status, 400);
  const l = await call("GET", "/api/survey?form=status&key=cron&item=42");
  assert.equal(l.status, 200);
  assert.deepEqual(M.verifyToken(new URL(l.json.url).searchParams.get("t"), Date.now(), process.env, "st"), { item: "42", group: "gina" });
  delete process.env.CRON_SECRET;
  assert.equal((await call("GET", "/api/survey?form=status&key=&item=42")).status, 401); // без секрета в Vercel — никогда
});

test("team email: Gina's has «Изменить статус» leading to the status page and monday as a link; Simon's keeps the monday button", () => {
  const { p } = SG.parseSignup({ group: "gina", lang: "ru", name: "Алекс", email: "alex@example.com", phone: "2125550123", pronouns: "they", in_us: "yes", regular: "yes", intro: "yes", rules: true, expect: "Поддержки.", needs: ["work"] });
  const statusUrl = S.statusUrl("42", "gina", NOW);
  const { html } = Mail.signupEmail(p, { itemUrl: "https://qaravan.monday.com/boards/18433061986/pulses/42", statusUrl, now: NOW });
  const btn = html.indexOf(">Изменить статус</a>"), mon = html.indexOf(">Открыть в monday</a>");
  assert.ok(btn > 0 && mon > btn);
  // кнопка — в конце письма: после ответов и «Чего ждёт от группы», перед подписью
  assert.ok(btn > html.indexOf(">Чего ждёт от группы<") && btn > html.indexOf(">Контакты<") && btn < html.indexOf("Письмо отправила анкета"));
  assert.ok(html.includes(`href="${statusUrl}"`));
  assert.match(html, /Статус на доске сейчас — New/);
  assert.match(Mail.signupEmail(p, { itemUrl: "https://x/1", statusUrl, status: "Joined", now: NOW }).html, /Статус на доске сейчас — Joined/); // пересылка старой анкеты
  const { p: ps } = SG.parseSignup({ group: "simon", lang: "ru", name: "Боря", email: "b@example.com", phone: "2125550123", format: "remote", city: "NYC" });
  const simon = Mail.signupEmail(ps, { itemUrl: "https://qaravan.monday.com/boards/5469799506/pulses/7", now: NOW }).html;
  assert.doesNotMatch(simon, /Изменить статус/);
  assert.match(simon, /background:#333333;"><a href="https:\/\/qaravan\.monday\.com\/boards\/5469799506\/pulses\/7"/);
  assert.ok(simon.indexOf(">Открыть в monday</a>") < simon.indexOf(">Контакты<")); // у Саймона кнопка — наверху, как раньше
});
