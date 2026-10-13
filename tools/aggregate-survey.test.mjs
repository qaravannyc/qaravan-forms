// Checks for the survey aggregation (tools/aggregate-survey.mjs → board Survey 2026 — Aggregates):
// bases follow the routing, exclusive options stay out of the numerators, small subgroups are
// suppressed, and a live run keeps every group in rank order while writing groups in parallel
// (a sequential write of ~180 rows does not fit in the 60 s of the cron function).
// Synthetic answers only: this repository is public. Fake monday instead of the API.
// Run: node --test tools/aggregate-survey.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

process.env.MONDAY_TOKEN = "fake-token";
globalThis.fetch = async (url) => { throw new Error("unexpected fetch " + url); };
const { compute, run } = await import("./aggregate-survey.mjs");

const SUBMITTED = "group_mm6bvfyd";
const A1 = "group_mm6cyxaq", A4a = "group_mm6c9e19", A2a = "group_mm6ceh50";
const row = (i, answers, group = SUBMITTED) => ({
  id: String(1000 + i), createdAt: "2026-10-01T00:00:00Z", group,
  raw: JSON.stringify({ lang: "ru", startedAt: 0, savedAt: "1970-01-01T00:06:00Z", answers }),
});
// 30 submitted: needs mostly social, some housing; 4 say "no help needed";
// 12 not-active (q4 = never) answered q5; all settled except 3 establishing.
function fixture() {
  const rows = [];
  for (let i = 0; i < 30; i++) {
    const q13 = i < 4 ? ["none"] : i < 20 ? ["social", "housing"] : ["social"];
    const a = { q13, q4: i < 12 ? "never" : "weekly", q8: i < 3 ? "y1to3" : "gt5y" };
    if (i < 12) a.q5 = i < 9 ? ["time"] : ["unsafe"];
    rows.push(row(i, a));
  }
  rows.push(row(99, { q13: ["housing"] }, "group_mm6bbh6g")); // draft: never counted
  return rows;
}

test("A1: base = answered q13; exclusive 'none' is not in the numerators and comes last", () => {
  const { items } = compute(fixture(), "2026-10-13");
  const a1 = items.filter((it) => it.group === A1);
  const get = (name) => a1.find((it) => it.name === name)?.cv;
  assert.equal(get("Social connection").numeric_mm6c8zd1, "26");
  assert.equal(get("Social connection").numeric_mm6ces1x, "30");
  assert.equal(get("Social connection").numeric_mm6c52cw, "87");
  assert.equal(get("Housing").numeric_mm6c8zd1, "16"); // the draft's housing is not counted
  assert.equal(a1[0].name, "Social connection");
  assert.equal(a1.at(-1).name, "No help needed now");
  assert.equal(a1.at(-1).cv.numeric_mm6cmvv7, "90");
  const ranks = a1.slice(0, -1).map((it) => Number(it.cv.numeric_mm6cmvv7));
  assert.deepEqual(ranks, ranks.slice().sort((x, y) => x - y));
});

test("A4a: base is only the not-active, who were the only ones shown q5", () => {
  const { items } = compute(fixture(), "2026-10-13");
  const time = items.find((it) => it.group === A4a && it.name === "No free time");
  assert.equal(time.cv.numeric_mm6ces1x, "12");
  assert.equal(time.cv.numeric_mm6c8zd1, "9");
});

test("subgroups under 10 become one suppressed placeholder row", () => {
  const { items } = compute(fixture(), "2026-10-13");
  const est = items.filter((it) => it.group === A2a && it.cv.color_mm6ccbs0.label === "Establishing");
  assert.equal(est.length, 1);
  assert.match(est[0].name, /suppressed \(base 3 < 10\)/);
  assert.equal(est[0].cv.color_mm6c1f1s.label, "Yes");
  assert.equal(est[0].cv.numeric_mm6c52cw, undefined);
});

test("live run: each group written in rank order, groups in parallel, A7 never touched", async () => {
  const rows = fixture();
  const created = [];   // [group, name] in the order monday received them
  const deleted = [];
  let inFlight = 0, maxInFlight = 0;
  globalThis.fetch = async (url, init) => {
    const { query, variables = {} } = JSON.parse(init.body);
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 15));
    inFlight--;
    let data;
    if (query.includes("items_page(limit: 200")) {
      data = { boards: [{ items_page: { cursor: null, items: rows.map((r) => ({ id: r.id, created_at: r.createdAt, group: { id: r.group }, column_values: [{ text: r.raw }] })) } }] };
    } else if (query.includes("items_page(limit: 500)")) {
      assert.ok(!query.includes("group_mm6csa51"), "A7 must not be cleared");
      assert.ok(!query.includes("group_mm6cxb9c"), "Run log must not be cleared");
      data = { boards: [{ groups: [{ id: A1, items_page: { items: [{ id: "1" }, { id: "2" }] } }] }] };
    } else if (query.includes("delete_item")) {
      for (const m of query.matchAll(/delete_item\(item_id: (\d+)\)/g)) deleted.push(m[1]);
      data = {};
    } else if (query.includes("create_item")) {
      const groups = [...query.matchAll(/group_id: "([^"]+)", item_name: \$n(\d+)/g)];
      for (const [, g, k] of groups) created.push([g, variables["n" + k]]);
      data = {};
    } else throw new Error("unexpected query " + query.slice(0, 80));
    return { json: async () => ({ data }) };
  };
  const out = await run({});
  assert.equal(out.wrote, true);
  assert.deepEqual(deleted, ["1", "2"]);
  assert.ok(maxInFlight > 1, "groups should be written concurrently");

  const { items, runItem } = compute(rows, new Date().toISOString().slice(0, 10));
  assert.equal(created.length, items.length + 1);
  for (const g of new Set(items.map((it) => it.group))) {
    assert.deepEqual(created.filter(([cg]) => cg === g).map(([, n]) => n),
      items.filter((it) => it.group === g).map((it) => it.name), `order in ${g}`);
  }
  assert.deepEqual(created.at(-1), ["group_mm6cxb9c", runItem.name]); // run log after everything
});
