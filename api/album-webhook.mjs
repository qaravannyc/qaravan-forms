// POST /api/album-webhook — monday шлёт сюда вебхуки с календаря событий:
//   • колонка «Create album» переключена в «▶️ Create now» — человек просит
//     альбом СЕЙЧАС (кнопка). Создаём без проверок окна и приватности —
//     осознанный клик; чип сбрасываем обратно в пусто.
//   • колонка «Date and Time» изменилась — событию проставили дату: если она
//     в альбомном окне (21 день назад … конец месяца, с 29-го — конец
//     следующего) и альбома ещё нет, создаём сразу, не дожидаясь утреннего
//     робота (events-robot/robot/albums.mjs — он же подчищает пропуски).
//
// Данные из вебхука не значат ничего: пришедший id — только повод перечитать
// строку из monday и решить по её РЕАЛЬНОМУ состоянию (подделать вебхук может
// кто угодно, состояние доски — нет). Приватные события (группы поддержки,
// всё с Simon или Gina — Zoom, приватность) по дате не альбомятся.
import { createEventAlbum, infoFingerprint } from "../lib/album.mjs";

const MONDAY = "https://api.monday.com/v2";
const EVENTS_BOARD = "4774572020";
const DATE_COL = "date4";
const TRIGGER_COL = "color_mm645sqk";     // «Create album» — кнопка-чип
const TRIGGER_LABEL = "▶️ Create now";
const ALBUM_COL = "text_mm64mt8q";        // «⚙️ Photos album id»
const ALBUM_LINK_COL = "link_mm64zqrk";   // «Photo album»
const ALBUM_STATUS_COL = "color_mm6470za"; // «Album status»
const ALBUM_SYNC_COL = "text_mm6417vh";   // «⚙️ Album sync» — отпечаток инфоблока
const ST_OPEN = "⚠️ OPEN ACCESS";
const WINDOW_BACK_DAYS = 21;

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

const urlFrom = (t) => (String(t || "").match(/https?:\/\/\S+/) || [""])[0];
const isShareUrl = (u) => /photos\.app\.goo\.gl|photos\.google\.com\/(?:u\/\d+\/)?share\//.test(u);
const idFromOwnerLink = (u) => (String(u).match(/photos\.google\.com\/(?:u\/\d+\/)?lr\/album\/([\w-]+)/) || [])[1] || "";

function albumWindow() {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const start = new Date(now.getTime() - WINDOW_BACK_DAYS * 86400000).toISOString().slice(0, 10);
  const endOfMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  const late = now.getUTCDate() >= 29 || todayStr === endOfMonth(y, m);
  return { start, end: late ? endOfMonth(y, m + 1) : endOfMonth(y, m) };
}

async function getEventRow(id) {
  const d = await monday(
    `query ($ids: [ID!]) { items(ids: $ids) { id name board { id } column_values(ids: ["${DATE_COL}","${TRIGGER_COL}","${ALBUM_COL}","${ALBUM_LINK_COL}","text_mm5qsspp","location","link","status","color_mm5yxxe3","color_mm6310pc","board_relation_mm63c5g1","people"]) { id text ... on BoardRelationValue { display_value } } } }`,
    { ids: [String(id)] });
  const item = d.items?.[0];
  if (!item || String(item.board.id) !== EVENTS_BOARD) return null;
  const cols = Object.fromEntries(item.column_values.map((c) => [c.id, c.text || c.display_value || ""]));
  const albumLink = urlFrom(cols[ALBUM_LINK_COL]);
  return {
    id: item.id, name: item.name,
    ruName: (cols.text_mm5qsspp || "").trim(),
    date: cols[DATE_COL] || "",
    location: (cols.location || "").trim(),
    partiful: urlFrom(cols.link),
    leads: (cols.board_relation_mm63c5g1 || "").trim(),
    staffLead: (cols.people || "").trim(),
    eventStatus: (cols.status || "").trim().toLowerCase(),
    surveyStatus: cols.color_mm5yxxe3 || "",
    type: cols.color_mm6310pc || "",
    trigger: cols[TRIGGER_COL] || "",
    albumId: (cols[ALBUM_COL] || "").trim() || idFromOwnerLink(albumLink),
    albumLink,
  };
}

// Группы поддержки и всё, что ведут Simon или Gina — Zoom и приватность,
// альбом им по дате не создаём (кнопка — можно, это осознанный клик).
const isPrivate = (ev) =>
  /support group|группа поддержки/i.test(`${ev.name} ${ev.ruName}`) ||
  /\b(simon|gina)\b/i.test(`${ev.leads} ${ev.staffLead}`);

async function createAndRecord(ev) {
  const { albumId, ownerUrl, info } = await createEventAlbum(ev);
  await monday(
    `mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v,create_labels_if_missing:true){id} }`,
    { b: EVENTS_BOARD, i: String(ev.id), v: JSON.stringify({
      [ALBUM_COL]: albumId,
      [ALBUM_LINK_COL]: { url: ownerUrl, text: "не публичная — включи доступ по ссылке" },
      [ALBUM_STATUS_COL]: { label: ST_OPEN },
      [ALBUM_SYNC_COL]: infoFingerprint(info),
    }) });
  await monday(`mutation ($i: ID!, $t: String!) { create_update(item_id:$i, body:$t){id} }`, {
    i: String(ev.id),
    t: `Фотоальбом события создан: ${ownerUrl}\n` +
       `Один раз, под info@qaravan.org: открыть альбом → «Поделиться» → создать ссылку → вставить её в колонку «Photo album».\n` +
       `После этого робот сам переключит «Album status» на «✅ Shared by link» и будет добавлять ссылку в сообщения о новых отзывах. Фото гостей лягут в этот альбом автоматически.`,
  }).catch((e) => console.error("album update note failed:", e.message));
  return ownerUrl;
}

const resetTrigger = (id) =>
  monday(`mutation ($b: ID!, $i: ID!, $c: String!, $v: String!) { change_simple_column_value(board_id:$b,item_id:$i,column_id:$c,value:$v){id} }`,
    { b: EVENTS_BOARD, i: String(id), c: TRIGGER_COL, v: "" })
    .catch((e) => console.error("trigger reset failed:", e.message));

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "POST") { res.statusCode = 405; return res.end("{}"); }
  const chunks = []; for await (const c of req) chunks.push(c);
  let b;
  try { b = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { res.statusCode = 400; return res.end("{}"); }

  // Рукопожатие monday при подписке на вебхук.
  if (b.challenge) return res.end(JSON.stringify({ challenge: b.challenge }));

  const evt = b.event || {};
  if (String(evt.boardId) !== EVENTS_BOARD || !evt.pulseId) return res.end('{"ok":true}');
  if (evt.columnId !== TRIGGER_COL && evt.columnId !== DATE_COL) return res.end('{"ok":true}');

  const ev = await getEventRow(evt.pulseId).catch(() => null);
  if (!ev) return res.end('{"ok":true}');

  try {
    if (evt.columnId === TRIGGER_COL) {
      // Кнопка. Реагируем только на реальное состояние чипа на доске.
      if (ev.trigger !== TRIGGER_LABEL) return res.end('{"ok":true}');
      if (ev.albumId) {
        await monday(`mutation ($i: ID!, $t: String!) { create_update(item_id:$i, body:$t){id} }`, {
          i: String(ev.id),
          t: `Альбом у события уже есть${ev.albumLink ? `: ${ev.albumLink}` : ""} — новый не создавал.`,
        }).catch(() => {});
      } else {
        await createAndRecord(ev);
      }
      await resetTrigger(ev.id);
      return res.end('{"ok":true}');
    }

    // Смена даты: альбом сразу, если дата в окне и событию альбом положен.
    if (ev.albumId || isShareUrl(ev.albumLink)) return res.end('{"ok":true}');
    if (ev.eventStatus === "cancelled" || ev.surveyStatus === "No survey" || ev.type === "INTERNAL_MEETING") return res.end('{"ok":true}');
    if (isPrivate(ev)) return res.end('{"ok":true}');
    const d = ev.date.slice(0, 10);
    const w = albumWindow();
    if (!d || d < w.start || d > w.end) return res.end('{"ok":true}');
    await createAndRecord(ev);
    return res.end('{"ok":true}');
  } catch (e) {
    console.error("album-webhook failed:", e.message);
    res.statusCode = 500;
    return res.end('{"ok":false}');
  }
}
