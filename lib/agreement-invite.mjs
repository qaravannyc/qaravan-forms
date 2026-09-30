// Приглашение подписать Соглашение сообщества — сразу после записи в волонтёры.
//
// POST /api/agreement-invite (vercel.json → /api/survey?form=agreement-invite: своей функции
// нет, на плане Hobby в api/ не больше 12 функций). Зовёт monday: на каждой доске
// волонтёрских форм (SIGNUP_BOARDS в lib/agreement.mjs) висит вебхук API (create_webhook,
// событие create_item), он шлёт { event: { pulseId, boardId, … } } в тот момент, когда
// появилась строка. При подключении вебхука monday присылает { challenge } — отвечаем им же.
// Понимает и { "itemId": …, "boardId": … }, и ?item=&board=.
//
// Что делает, по порядку:
//   1. берёт строку; доска — из SIGNUP_BOARDS, иначе отказ;
//   2. строка не раньше START и не старше WINDOW_DAYS (минимального возраста нет:
//      WEBHOOK_MIN_AGE_MINUTES = 0);
//   3. у адреса или полного имени уже есть строка на доске «Community Agreement invites» — стоп;
//   4. читает подписи (доска Community Agreement, «Agreement signed» в карточках Community
//      Members, отметки старых форм) и решает теми же правилами, что робот (planInvites);
//   5. пишет строку приглашения, смотрит, первая ли она у этого человека (monday мог позвать
//      дважды), и только потом шлёт письмо от info@qaravan.org; не ушло — строка «Send failed».
// Напоминания, отметки «Signed» и всё, что вебхук пропустил (с часа после записи), —
// дело робота: events-robot/robot/agreement-invites.mjs. lib/agreement.mjs,
// lib/agreement-email.mjs и lib/wordmark-email.mjs — его копии один в один.
//
// В ответе нет ни имён, ни адресов: эндпоинт открыт всем. Кто угодно может разве что
// ускорить приглашение, которое робот и так отправил бы этой строке через час.
// ?dry=1 — только сказать, что было бы, без записи и письма.
import * as A from "./agreement.mjs";
import { agreementMime } from "./agreement-email.mjs";
import { sendMime, MAIL_FROM } from "./letter-mail.mjs";

async function mondayApi(query, variables = {}) {
  const r = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: process.env.MONDAY_TOKEN, "API-Version": "2024-10" },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error("monday: " + JSON.stringify(j.errors).slice(0, 500));
  return j.data;
}
const COLUMN_FIELDS = `id text value ... on BoardRelationValue { linked_item_ids }`;
async function allItems(board, columnIds) {
  const ids = JSON.stringify(columnIds.map(String));
  const items = [];
  let cursor = null;
  do {
    const args = cursor ? `cursor: ${JSON.stringify(cursor)}` : "limit: 500";
    const d = await mondayApi(`query { boards(ids: [${Number(board)}]) { items_page(${args}) { cursor items { id name created_at group { id } column_values(ids: ${ids}) { ${COLUMN_FIELDS} } } } } }`);
    const page = d.boards?.[0]?.items_page;
    if (!page) throw new Error(`board ${board} not readable`);
    items.push(...page.items);
    cursor = page.cursor;
  } while (cursor);
  return items;
}
async function getItem(id) {
  const d = await mondayApi(`query ($id: [ID!]) { items(ids: $id) { id name created_at state board { id } group { id } column_values { ${COLUMN_FIELDS} } } }`, { id: [String(id)] });
  return d.items?.[0] || null;
}

// Тело вебхука → { itemId, boardId }: из JSON, из обычного вебхука monday или из ?item=&board=.
export function parseCall(body, url) {
  const b = body && typeof body === "object" ? body : {};
  const e = b.event && typeof b.event === "object" ? b.event : {};
  const q = url.searchParams;
  const pick = (...vs) => { for (const v of vs) { const s = String(v ?? "").trim(); if (/^\d{1,20}$/.test(s)) return s; } return ""; };
  return {
    itemId: pick(b.itemId, b.item_id, b.item, b.pulseId, e.pulseId, e.itemId, q.get("item")),
    boardId: pick(b.boardId, b.board_id, b.board, e.boardId, q.get("board")),
  };
}

// → { status, result, why } (result: "sent" | "skipped" | "would send" | "failed")
export async function inviteForItem({ itemId, boardId = "", dry = false }, { now = new Date(), send = sendMime } = {}) {
  const skip = (why) => ({ status: 200, result: "skipped", why });
  const it = await getItem(itemId);
  if (!it || it.state !== "active") return skip("no such item");
  const b = A.signupBoard(it.board?.id);
  if (!b) return { status: 400, result: "skipped", why: "not a volunteer sign-up board" };
  if (boardId && String(boardId) !== String(b.board)) return { status: 400, result: "skipped", why: "item is on another board" };
  if (!A.inWindow(it.created_at, now, A.WEBHOOK_MIN_AGE_MINUTES)) return skip("outside the invite window");
  const email = A.emailFromColumn(A.col(it, b.email));
  if (!email) return skip("no email");

  // Сначала лёгкое: доска приглашений. Уже есть строка — дальше не читаем.
  const invites = await allItems(A.INVITES_BOARD, Object.values(A.INVITE_COLS));
  const { invited, invitedNames } = A.invitedSets(invites);
  const name = A.fullName(it.name);
  if (invited.has(email) || (name && invitedNames.has(name))) return skip("already invited");

  // Подписи — отовсюду, где их ищет робот; все доски форм — ради отметок старых форм.
  const [memberItems, agreementItems, ...boards] = await Promise.all([
    allItems(A.MEMBERS_BOARD, Object.values(A.MEMBER_COLS)),
    allItems(A.AGREEMENT_BOARD, Object.values(A.AGREEMENT_COLS)),
    ...A.SIGNUP_BOARDS.map((sb) => allItems(sb.board, A.signupColumns(sb))),
  ]);
  const signupItems = A.SIGNUP_BOARDS.flatMap((sb, i) => boards[i].filter((x) => String(x.id) !== String(it.id)).map((x) => ({ b: sb, it: x })));
  signupItems.push({ b, it });
  const { signups, index } = A.assemble({ signupItems, memberItems, agreementItems });
  const person = signups.find((p) => p.id === String(it.id));
  const { send: go, skipped } = A.planInvites([person], { index, invited, invitedNames, max: 1 });
  if (!go.length) return skip(skipped[0]?.why || "not due");
  const c = go[0];
  if (dry) return { status: 200, result: "would send", why: c.source };

  const code = A.newCode();
  const today = A.nyDate(now);
  const d = await mondayApi(
    `mutation ($b: ID!, $n: String!, $v: JSON!) { create_item(board_id: $b, item_name: $n, column_values: $v, create_labels_if_missing: true) { id } }`,
    { b: String(A.INVITES_BOARD), n: c.name || c.email, v: JSON.stringify(A.inviteRow(c, { code, today })) },
  );
  const rowId = String(d.create_item.id);
  // Второй вызов о том же человеке мог успеть раньше: пишет письмо тот, чья строка первая.
  const again = await allItems(A.INVITES_BOARD, [A.INVITE_COLS.email]);
  if (!again.some((x) => String(x.id) === rowId)) again.push({ id: rowId, name: c.name, column_values: [{ id: A.INVITE_COLS.email, text: c.email, value: null }] });
  if (!A.firstRow(again, rowId, c)) {
    await mondayApi(`mutation ($id: ID!) { delete_item(item_id: $id) { id } }`, { id: rowId })
      .catch((e) => console.error(`agreement invite: could not remove duplicate row ${rowId}: ${e.message}`));
    return skip("already invited (a parallel call)");
  }
  try {
    const link = A.personalLink(A.AGREEMENT_URL, { name: c.name, email: c.email, code });
    await send(c.email, agreementMime({ from: MAIL_FROM, to: c.email, name: c.greet, link }));
  } catch (e) {
    console.error(`agreement invite: email for item ${it.id} failed: ${e.message}`);
    await mondayApi(
      `mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id: $b, item_id: $i, column_values: $v) { id } }`,
      { b: String(A.INVITES_BOARD), i: rowId, v: JSON.stringify({ [A.INVITE_COLS.status]: { label: A.INVITE_STATUS.failed } }) },
    ).catch((e2) => console.error(`  …and row ${rowId} could not be marked Send failed: ${e2.message}`));
    return { status: 502, result: "failed", why: "email not sent" };
  }
  return { status: 200, result: "sent", why: c.source };
}

async function readJson(req) {
  const chunks = []; for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return null; }
}
const reply = (res, status, obj) => { res.statusCode = status; res.end(JSON.stringify(obj)); };

export async function agreementInviteHandler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  const url = new URL(req.url, "https://x");
  const dry = url.searchParams.get("dry") === "1";
  if (req.method !== "POST" && !(req.method === "GET" && dry)) return reply(res, 405, { error: "POST only" });
  const body = req.method === "POST" ? await readJson(req) : {};
  if (body === null) return reply(res, 400, { error: "invalid JSON" });
  // Проверка адреса при подключении вебхука monday: вернуть challenge как есть.
  if (typeof body.challenge === "string") return reply(res, 200, { challenge: body.challenge });
  const call = parseCall(body, url);
  if (!call.itemId) return reply(res, 400, { error: "itemId is required" });
  try {
    const r = await inviteForItem({ ...call, dry });
    console.log(`agreement invite: item ${call.itemId} → ${r.result} (${r.why})`);
    const { status, ...rest } = r;
    return reply(res, status, { ok: status === 200, ...rest });
  } catch (e) {
    console.error(`agreement invite: item ${call.itemId}: ${e.message}`);
    return reply(res, 502, { ok: false, error: "failed" });
  }
}
