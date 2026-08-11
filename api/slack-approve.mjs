// POST /api/slack-approve — the Slack app's interactivity endpoint.
// Handles three things for messages in #event-feedback:
//   • «Одобрить» button → flips the event's status to "Digest approved" and
//     запускает робота рассылки сразу, не дожидаясь вечернего прогона.
//   • «Редактировать» button → opens a Slack modal with the digest text.
//   • Modal submit → saves the edited text into the event's «Дайджест для
//     ведущего» column (that exact text goes into the email) and updates the
//     Slack message in place.
// Anyone in the channel can edit and approve — channel membership is the
// permission. Every request is verified against Slack's signing secret.
import { createHmac, timingSafeEqual } from "node:crypto";

const MONDAY = "https://api.monday.com/v2";
const EVENTS_BOARD = "4774572020";
const STATUS_COL = "color_mm5yxxe3";
const DIGEST_COL = "long_text_mm63m1zh";

async function monday(query, variables = {}) {
  const r = await fetch(MONDAY, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: process.env.MONDAY_TOKEN, "API-Version": "2024-10" },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
}

async function slack(method, payload) {
  const r = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  });
  const j = await r.json();
  if (!j.ok) console.error(`slack ${method}: ${j.error}`);
  return j;
}

// «Одобрить» больше не ждёт вечернего прогона: дёргаем workflow_dispatch у
// робота рассылки (events-robot, .github/workflows/robots.yml), и письмо уходит
// через минуту-две — GitHub поднимает раннер и сначала гоняет тесты, которые
// стоят там защитой от двойных писем. Запускается весь прогон рассылки, а не
// только этот дайджест: робот идемпотентный, статусы и дедуп держат от повторов.
// Токена нет или GitHub отказал — молчать нельзя: «одобрено, но не отправлено»
// хуже, чем честное «уйдёт в 17:00».
const DISPATCH = "https://api.github.com/repos/qaravannyc/events-robot/actions/workflows/robots.yml/dispatches";

async function runSendRobot() {
  const tok = process.env.GH_DISPATCH_TOKEN;
  if (!tok) return { ok: false, why: "GH_DISPATCH_TOKEN не задан" };
  let r;
  try {
    r = await fetch(DISPATCH, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tok}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main", inputs: { job: "send" } }),
    });
  } catch (e) { return { ok: false, why: `сеть: ${e.message}` }; }
  if (r.status === 204) return { ok: true };
  const hint = r.status === 403 ? " — организация не одобрила токен или у него нет Actions: Read and write"
    : r.status === 404 ? " — токен не видит репозиторий (Resource owner не qaravannyc?)"
    : r.status === 401 ? " — токен истёк или отозван"
    : "";
  return { ok: false, why: `GitHub ответил ${r.status}${hint}` };
}

async function getEventRow(eventId) {
  const d = await monday(
    `query ($ids: [ID!]) { items(ids: $ids) { id name column_values(ids: ["date4","location","text_mm5b1czz","link","${DIGEST_COL}"]) { id text } } }`,
    { ids: [String(eventId)] }
  );
  const item = d.items?.[0];
  if (!item) return null;
  const cols = Object.fromEntries(item.column_values.map((c) => [c.id, c.text || ""]));
  return {
    id: item.id, name: item.name,
    date: cols.date4 || "", location: (cols.location || "").trim(),
    lead: (cols.text_mm5b1czz || "").trim(),
    partiful: (String(cols.link || "").match(/https?:\/\/\S+/) || [""])[0],
    digest: (cols[DIGEST_COL] || "").trim(),
  };
}

const MONTHS_RU = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
function fmtDate(text) {
  const m = (text || "").match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}))?/);
  if (!m) return "";
  const [, y, mo, d, hh, mm] = m;
  let t = "";
  if (hh !== undefined) { const h = Number(hh); t = `, ${h % 12 || 12}:${mm} ${h < 12 ? "AM" : "PM"}`; }
  return `${Number(d)} ${MONTHS_RU[Number(mo) - 1]} ${y}${t}`;
}

// Must mirror the message the send robot posts (robot/send.mjs).
export function digestBlocks(ev, note) {
  const ctx = [fmtDate(ev.date), ev.location, ev.lead ? `Ведущие: ${ev.lead}` : ""].filter(Boolean).join(" — ");
  const links = [ev.partiful ? `<${ev.partiful}|Регистрация на Partiful>` : "", `<https://qaravan.monday.com/boards/${EVENTS_BOARD}/pulses/${ev.id}|Строка события на доске>`].filter(Boolean).join("     ");
  return [
    { type: "header", text: { type: "plain_text", text: `Дайджест ждёт проверки — ${ev.name}`.slice(0, 150), emoji: true } },
    { type: "context", elements: [{ type: "mrkdwn", text: (ctx || "событие с календаря").slice(0, 250) }] },
    { type: "section", text: { type: "mrkdwn", text: (ev.digest || "(пусто)").slice(0, 2900) } },
    ...(note ? [{ type: "context", elements: [{ type: "mrkdwn", text: note.slice(0, 250) }] }] : []),
    { type: "context", elements: [{ type: "mrkdwn", text: links }] },
    { type: "actions", elements: [
      { type: "button", style: "primary", action_id: "approve_digest", value: String(ev.id),
        text: { type: "plain_text", text: "Одобрить — отправить ведущему", emoji: true },
        confirm: {
          title: { type: "plain_text", text: "Отправить дайджест ведущему?" },
          text: { type: "mrkdwn", text: `Ведущему события «${ev.name}» уйдёт ровно тот текст, что в сообщении выше.`.slice(0, 250) },
          confirm: { type: "plain_text", text: "Да, отправить" },
          deny: { type: "plain_text", text: "Не сейчас" },
        } },
      { type: "button", action_id: "edit_digest", value: String(ev.id),
        text: { type: "plain_text", text: "Редактировать", emoji: true } },
    ] },
  ];
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.statusCode = 405; return res.end(); }
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) { res.statusCode = 500; return res.end("SLACK_SIGNING_SECRET is not set"); }

  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");

  const ts = String(req.headers["x-slack-request-timestamp"] || "");
  const given = String(req.headers["x-slack-signature"] || "");
  if (!ts || Math.abs(Date.now() / 1000 - Number(ts)) > 300) { res.statusCode = 401; return res.end(); }
  const want = "v0=" + createHmac("sha256", secret).update(`v0:${ts}:${raw}`).digest("hex");
  let ok = false;
  try { ok = timingSafeEqual(Buffer.from(want), Buffer.from(given)); } catch { ok = false; }
  if (!ok) { res.statusCode = 401; return res.end(); }

  let payload;
  try { payload = JSON.parse(new URLSearchParams(raw).get("payload")); }
  catch { res.statusCode = 400; return res.end(); }

  const who = payload.user?.name || payload.user?.username || payload.user?.id || "кто-то";

  // ---- modal submit: save the edited digest, refresh the channel message ----
  if (payload.type === "view_submission" && payload.view?.callback_id === "digest_edit") {
    try {
      const meta = JSON.parse(payload.view.private_metadata || "{}");
      const text = String(payload.view.state?.values?.digest?.text?.value || "").trim().slice(0, 9000);
      await monday(
        `mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v){id} }`,
        { b: EVENTS_BOARD, i: String(meta.eventId), v: JSON.stringify({ [DIGEST_COL]: { text } }) }
      );
      const ev = await getEventRow(meta.eventId);
      if (ev && meta.channel && meta.ts) {
        await slack("chat.update", {
          channel: meta.channel, ts: meta.ts,
          text: `Дайджест ждёт проверки — ${ev.name}`,
          blocks: digestBlocks(ev, `_Отредактировано @${who}_`),
        });
      }
    } catch (e) { console.error("digest edit failed:", e.message); }
    res.setHeader("Content-Type", "application/json");
    return res.end("{}");
  }

  if (payload.type !== "block_actions") { res.statusCode = 200; return res.end(); }
  const action = payload.actions?.[0];
  const eventId = String(action?.value || "").replace(/\D/g, "");

  // ---- «Редактировать»: open the modal with the current text ----
  if (action?.action_id === "edit_digest") {
    try {
      const ev = await getEventRow(eventId);
      await slack("views.open", {
        trigger_id: payload.trigger_id,
        view: {
          type: "modal", callback_id: "digest_edit",
          private_metadata: JSON.stringify({ eventId, channel: payload.channel?.id, ts: payload.message?.ts }),
          title: { type: "plain_text", text: "Дайджест" },
          submit: { type: "plain_text", text: "Сохранить" },
          close: { type: "plain_text", text: "Отмена" },
          blocks: [{
            type: "input", block_id: "digest",
            label: { type: "plain_text", text: "Этот текст уйдёт ведущему" },
            element: { type: "plain_text_input", action_id: "text", multiline: true, initial_value: (ev?.digest || "").slice(0, 2900) },
          }],
        },
      });
    } catch (e) { console.error("modal open failed:", e.message); }
    res.statusCode = 200; return res.end();
  }

  // ---- «Одобрить»: flip the status; the robot sends on its next run ----
  if (action?.action_id === "approve_digest") {
    try {
      await monday(
        `mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v,create_labels_if_missing:true){id} }`,
        { b: EVENTS_BOARD, i: eventId, v: JSON.stringify({ [STATUS_COL]: { label: "Digest approved" } }) }
      );
      const run = await runSendRobot();
      if (payload.response_url) {
        await fetch(payload.response_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            replace_original: true,
            text: run.ok
              ? `✅ Дайджест одобрен (@${who}). Робот запущен — письмо уйдёт ведущему через минуту-две.`
              : `✅ Дайджест одобрен (@${who}), но робота запустить не удалось: ${run.why}. Письмо уйдёт при вечернем прогоне — ежедневно в 17:00 по Нью-Йорку.`,
          }),
        }).catch(() => {});
      }
    } catch (e) {
      console.error("approve failed:", e.message);
      if (payload.response_url) {
        await fetch(payload.response_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ replace_original: false, text: `Не получилось поставить статус: ${e.message}. Поставь «Digest approved» руками на доске.` }),
        }).catch(() => {});
      }
    }
    res.statusCode = 200; return res.end();
  }

  res.statusCode = 200;
  res.end();
}
