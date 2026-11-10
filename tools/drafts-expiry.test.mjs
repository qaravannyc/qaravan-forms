// Drafts kept in the browser (audit D7): every form that keeps a draft on the device drops it once it has not
// been touched for 8 weeks, so answers don't stay on a shared phone for ever. Each page carries the same small
// helper, draftFresh(); this runs each page's own copy against a fake localStorage and checks that its draft
// is saved with a time and read through the helper. The letter form has its own test (letter-device.test.mjs).
// Run: node --test tools/drafts-expiry.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const PAGES = ["legal-help/index.html", "event-volunteers/index.html", "support/app.js", "support/send.js", "club/index.html", "survey/index.html"];
const WEEK = 7 * 864e5;

function helper(file) {
  const src = readFileSync(new URL("../" + file, import.meta.url), "utf8");
  const start = src.indexOf("const DRAFT_TTL = ");
  const end = src.indexOf("\n}\n", src.indexOf("function draftFresh(", start)) + 2;
  assert.ok(start > 0 && end > start, `${file}: the draft helper is there`);
  const store = new Map();
  const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const ctx = vm.createContext({ localStorage, Date, JSON });
  vm.runInContext(src.slice(start, end) + "\nthis.draftFresh = draftFresh; this.DRAFT_TTL = DRAFT_TTL;", ctx);
  return { src, ctx, store };
}

for (const file of PAGES) {
  test(`${file}: a draft untouched for 8 weeks is deleted, a newer one stays, an old one without a time gets 8 weeks from now`, () => {
    const { src, ctx, store } = helper(file);
    assert.equal(ctx.DRAFT_TTL, 8 * WEEK);
    store.set("k", "x");
    assert.equal(ctx.draftFresh("k", { at: Date.now() - 8 * WEEK - 1000, A: { a: 1 } }), false);
    assert.equal(store.has("k"), false, "the old draft is gone from the device");
    store.set("k", "x");
    assert.equal(ctx.draftFresh("k", { at: Date.now() - 7 * WEEK }), true);
    assert.equal(store.get("k"), "x");
    const legacy = { A: { a: 1 } };
    assert.equal(ctx.draftFresh("k", legacy), true);
    assert.ok(Math.abs(JSON.parse(store.get("k")).at - Date.now()) < 5000, "the clock starts now");
    assert.equal(ctx.draftFresh("k", null), false);
    // the page saves its draft with a time and reads it through the helper
    assert.match(src, /at: Date\.now\(\)|S\.at = Date\.now\(\)/);
    assert.match(src, /draftFresh\((DRAFT_KEY|DRAFT|LSKEY), d\)/);
  });
}

test("support groups: the pages here always move to qaravan.org, so a draft left here is deleted on the way", () => {
  for (const g of ["gina", "simon"]) {
    const s = readFileSync(new URL(`../support/${g}.html`, import.meta.url), "utf8");
    assert.match(s, new RegExp(`localStorage\\.removeItem\\("qaravan\\.support\\.${g}\\.v1"\\)[^\\n]*\\n\\s*location\\.replace`));
  }
});
