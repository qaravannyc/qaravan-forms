// Checks for the "copy of your answers" email (lib/answers-copy.mjs): cleaning of what the page
// sends, hidden links, every form language, and no email without an address or answers.
// Run: node --test tools/answers-copy.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

process.env.GOOGLE_REFRESH_TOKEN = "fake";
const mails = [];
globalThis.fetch = async (url, opts = {}) => {
  if (String(url).includes("oauth2")) return new Response(JSON.stringify({ access_token: "t" }));
  mails.push(Buffer.from(JSON.parse(opts.body).raw, "base64url").toString("utf8"));
  return new Response("{}");
};
const M = await import("../lib/answers-copy.mjs");

test("pairs are trimmed, capped, emptied ones dropped, and links hidden", () => {
  const raw = [{ q: " Имя ", a: " Ани " }, { q: "Пусто", a: "  " }, { q: "Ссылка", a: "см. https://evil.example/x и www.bad.ru или pay.com/now" }, "not a pair"];
  const out = M.cleanPairs(raw, "ru");
  assert.deepEqual(out.map((p) => p.q), ["Имя", "Ссылка"]);
  assert.equal(out[0].a, "Ани");
  assert.equal(out[1].a, "см. [ссылка] и [ссылка] или [ссылка]");
  assert.equal(M.cleanPairs([{ q: "Email", a: "ani@example.com" }])[0].a, "ani@example.com", "email addresses stay");
  assert.equal(M.cleanPairs(Array.from({ length: 200 }, (_, i) => ({ q: "q" + i, a: "a" })), "en").length, 80);
});

test("the email is written in the form's language, with the answers escaped", () => {
  for (const lang of ["ru", "en", "uk", "ka", "uz", "kk"]) {
    const m = M.answersCopyEmail({ lang, form: "Анкета", pairs: [{ q: "Q", a: "<b>ответ</b>" }], now: new Date("2026-10-28T12:00:00Z") });
    assert.ok(m.subject.includes("Анкета"), lang);
    assert.match(m.html, /&lt;b&gt;ответ&lt;\/b&gt;/);
    assert.match(m.html, new RegExp(`lang="${lang}"`));
  }
});

test("nothing is sent without a valid address or without answers", async () => {
  mails.length = 0;
  assert.equal(await M.sendAnswersCopy({ to: "not-an-email", form: "F", copy: [{ q: "Q", a: "A" }] }), false);
  assert.equal(await M.sendAnswersCopy({ to: "a@b.org", form: "F", copy: [] }), false);
  assert.equal(mails.length, 0);
  assert.equal(await M.sendAnswersCopy({ to: "a@b.org", form: "F", copy: [{ q: "Q", a: "A" }] }), true);
  assert.match(mails[0], /^To: a@b\.org$/m);
});
