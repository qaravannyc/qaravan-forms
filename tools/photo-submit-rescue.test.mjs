import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// Run the real handler with isolated service boundaries: no credentials or
// external requests are used, and the response is what the browser receives.
const source = readFileSync(new URL("../api/submit.mjs", import.meta.url), "utf8")
  .replace('import { createHmac } from "node:crypto";', "")
  .replace("export default async function handler", "async function handler");

async function submitLead(photos, result) {
  const context = vm.createContext({ Buffer, process: { env: {} }, console });
  vm.runInContext(source, context);
  context.getEvent = async () => ({ id: 123, name: "Test event" });
  context.monday = async () => ({ create_item: { id: 456 } });
  context.slackNotify = async () => null;
  let filed;
  context.filePhotos = async (_event, media) => {
    filed = media;
    if (result instanceof Error) throw result;
    return { created: media.length - result.length, lost: result, errors: [] };
  };
  const req = {
    method: "POST",
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify({ isLead: 1, eventId: 123, headcount: 10, photos }));
    },
  };
  let response;
  const res = { setHeader() {}, end(body) { response = JSON.parse(body); } };
  await context.handler(req, res);
  return { response, filed };
}

const photo = i => ({ token: `valid-upload-token-${i}`, name: `photo-${i}.jpg` });

test("lead album failures reach the browser with event and filename", async () => {
  const { response } = await submitLead([photo(1), photo(2)], [{ name: "photo-2.jpg" }]);
  assert.deepEqual(response, { ok: true, rescue: [{ eventId: "123", name: "photo-2.jpg" }] });
});

test("lead photo service errors return all 50 accepted files for rescue", async () => {
  const { response, filed } = await submitLead(Array.from({ length: 51 }, (_, i) => photo(i)), new Error("Photos unavailable"));
  assert.equal(filed.length, 50);
  assert.equal(response.ok, true);
  assert.equal(response.rescue.length, 50);
  assert.deepEqual(response.rescue[49], { eventId: "123", name: "photo-49.jpg" });
});

test("successful lead uploads return an empty rescue list", async () => {
  const { response } = await submitLead([photo(1)], []);
  assert.deepEqual(response, { ok: true, rescue: [] });
});
