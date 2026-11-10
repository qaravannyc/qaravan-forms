// Typed text never becomes markup (audit D6): what people type reaches Slack (mrkdwn: `<…>` is a link or a
// mention, `&` an entity) and monday updates (HTML) with & < > escaped, and the consent column takes only the
// three labels the pages send (a label column is written with create_labels_if_missing, so any other value would
// add a label to the board). Against a fake monday and a fake Slack.
// Run: node --test tools/escaping.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

process.env.MONDAY_TOKEN = "fake-token";
process.env.SLACK_BOT_TOKEN = "xoxb-fake";
process.env.SLACK_CHANNEL_ID = "C123";
delete process.env.UNSUB_SECRET;

let S;
const reset = () => { S = { slack: [], updates: [], cv: [], files: 0 }; };
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u === "https://slack.com/api/chat.postMessage") { S.slack.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ ok: true, ts: "1.2" })); }
  if (u === "https://api.monday.com/v2/file") { S.files++; return new Response(JSON.stringify({ data: { add_file_to_column: { id: "f1" } } })); }
  if (u !== "https://api.monday.com/v2") throw new Error("unexpected fetch " + u);
  const { query, variables = {} } = JSON.parse(opts.body);
  const ok = (data) => new Response(JSON.stringify({ data }));
  if (/items\(ids/.test(query)) return ok({ items: [{ id: "111", name: "Picnic", board: { id: "4774572020" }, column_values: [{ id: "date4", text: "2026-11-01" }, { id: "text_mm681056", text: "9.9" }] }] });
  if (/create_item/.test(query)) { S.cv.push(JSON.parse(variables.v)); return ok({ create_item: { id: "77" } }); }
  if (/change_multiple_column_values/.test(query)) { S.cv.push(JSON.parse(variables.v)); return ok({ change_multiple_column_values: { id: "77" } }); }
  if (/create_update/.test(query)) { S.updates.push(variables.t); return ok({ create_update: { id: "1" } }); }
  return ok({ items_page_by_column_values: { items: [] } });
};

const submit = (await import("../api/submit.mjs")).default;
const rescue = (await import("../api/rescue-file.mjs")).default;
const { escText } = await import("../lib/gate.mjs");

const nasty = "<!channel> <https://evil.example|Click here> & <b>bold</b>";
async function post(handler, body, url = "/api/submit") {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  const req = { method: "POST", url, headers: {}, async *[Symbol.asyncIterator]() { yield buf; } };
  const res = { statusCode: 200, setHeader() {}, end(s) { this.body = s; } };
  await handler(req, res);
  return res;
}
const allSlackText = () => JSON.stringify(S.slack);

test("escText escapes exactly & < >", () => {
  assert.equal(escText(`a & <b> "c"`), `a &amp; &lt;b&gt; "c"`);
});

test("event feedback: typed text reaches Slack and the monday update escaped; unknown consent and donate labels are not written", async () => {
  reset();
  const r = await post(submit, { eventId: "111", rating: 4, moment: nasty, name: "Mallory <!here>", consent: "Brand new label", donate: "Another new label", photos: [] });
  assert.equal(r.statusCode, 200);
  const text = allSlackText();
  assert.doesNotMatch(text, /<!channel>|<!here>|<https:\/\/evil/);
  assert.match(text, /&lt;!channel&gt;/);
  const up = S.updates.join("\n");
  assert.doesNotMatch(up, /<b>|<!channel>/);
  assert.match(up, /&lt;b&gt;bold&lt;\/b&gt;/);
  assert.match(up, /Понравилось:|Оценка: 4/); // the labels events-robot parses are still there
  const cv = Object.assign({}, ...S.cv);
  assert.equal(cv.dropdown_mm5n87fa, undefined, "consent: not one of the three labels, not written");
  assert.equal(cv.dropdown_mm5n3djq, undefined, "donate: never written from the request");
  reset();
  await post(submit, { eventId: "111", rating: 5, consent: "Да, но без имени", photos: [] });
  assert.deepEqual(Object.assign({}, ...S.cv).dropdown_mm5n87fa, { labels: ["Да, но без имени"] });
});

test("lead and weekly forms: typed text escaped in Slack and in the update", async () => {
  reset();
  await post(submit, { isLead: 1, eventId: "111", headcount: "12", comment: nasty, photos: [] });
  assert.doesNotMatch(allSlackText() + S.updates.join(""), /<!channel>|<b>/);
  reset();
  await post(submit, { multi: 1, events: [{ id: "111", rating: 3, comment: nasty }], name: "<!here>", consent: "x" });
  assert.doesNotMatch(allSlackText() + S.updates.join(""), /<!channel>|<!here>|<b>/);
  assert.equal(Object.assign({}, ...S.cv).dropdown_mm5n87fa, undefined);
});

test("rescued file: the file name from the request is escaped in Slack", async () => {
  reset();
  const req = { method: "POST", url: "/api/rescue-file?event=111&name=" + encodeURIComponent("<!channel>.jpg"), headers: {}, async *[Symbol.asyncIterator]() { yield Buffer.from("bytes"); } };
  const res = { statusCode: 200, setHeader() {}, end(s) { this.body = s; } };
  await rescue(req, res);
  assert.doesNotMatch(allSlackText(), /<!channel>/);
  assert.match(allSlackText(), /&lt;!channel&gt;\.jpg/);
});

test("support letter: the readable update posted on submit carries typed text escaped", async () => {
  reset();
  const letter = (await import("../api/letter.mjs")).default;
  const rid = "11111111-2222-4333-8444-555555555555";
  const r = await post(letter, { rid, mode: "submit", lang: "en", a: { firstName: "Test", anythingElse: nasty }, log: [], step: 18, progress: 100 }, "/api/letter");
  assert.equal(r.statusCode, 200);
  const up = S.updates.join("\n");
  assert.match(up, /Anything else: &lt;!channel&gt;/);
  assert.doesNotMatch(up, /<b>|<!channel>/);
});
