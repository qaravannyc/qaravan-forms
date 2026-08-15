// POST /api/submit — both forms land here.
// Repeat answers: survey emails carry a signed personal token (?p=), so a
// second submission from the same person for the same event UPDATES their
// existing row on the Отзывы board instead of creating a duplicate. Links
// opened without a token (QR code, forward) stay anonymous — each send is a row.
// Photos/videos: the browser uploads bytes straight to Google Photos and sends
// only upload tokens here; we file them into the event's album with the
// author's name in the description.
// Attendee answers fill the structured columns on the Отзывы board (labels are
// stored in Russian regardless of UI language — one label system), plus one
// update with the complete submission so nothing is ever lost to a missing
// column. The lead's headcount goes straight into the event's Attended column.
const MONDAY = "https://api.monday.com/v2";
const EVENTS_BOARD = "4774572020";
const FEEDBACK_BOARD = "18423848983";
// Колонку Attendance (numbers) Эзра удалил при чистке доски (Aug 11, 2026) —
// число участников от ведущего идёт сразу в дашбордную «⚙️ 2026 attendance».
const ATTENDED_COL = "numeric_mm64dp6";
// Три поля про альбом на календаре. Альбомы создаёт робот (events-robot,
// robot/albums.mjs) заранее; здесь альбом заводится только как запасной путь —
// если фото пришли раньше, чем робот успел. Служебный id — чтобы фото всех
// гостей ложились в ОДИН альбом события. Публичную ссылку Google с марта 2025
// не даёт включать через API (albums.share убран) — её один раз вставляет
// человек, просьба об этом уходит апдейтом на строку события в monday.
const ALBUM_COL = "text_mm64mt8q";       // «⚙️ Photos album id» — робот, не трогать руками
const ALBUM_LINK_COL = "link_mm64zqrk";  // «Photo album» — публичная ссылка, вставляет человек
const ALBUM_STATUS_COL = "color_mm6470za"; // «Album status» — 🔴 NO ALBUM / ⚠️ OPEN ACCESS / ✅ Shared by link
const CUSTOM_COL = "long_text_mm64tyb5"; // «Свой вопрос гостям» — доп. вопрос про это событие
const RESPONDENT_COL = "text_mm63r903"; // eventId:attendeeId, on the feedback board
// «⚙️ Slack thread id»: родительская карточка события в #event-feedback.
// Каждый отдельный отзыв, «не был(а)» и фото-квитанция уходят ОТВЕТОМ в её
// тред — канал видит одну строку на событие, а не карточку на каждый отклик.
const THREAD_COL = "text_mm681056";
import { createHmac } from "node:crypto";

// Отзывы с событий — column map
const F = {
  eventName: "text_mm5nfyst",
  eventRel: "board_relation_mm5nbv55",
  lang: "dropdown_mm5ngh8m",
  rating: "rating_mm5nhzte",
  highlights: "dropdown_mm5ngxxv",
  discomfort: "dropdown_mm5nwa73",
  moment: "long_text_mm5ndfc1",
  whyCome: "long_text_mm5nmf9c",
  consent: "dropdown_mm5n87fa",
  quoteName: "text_mm5nfa8j",
  donate: "dropdown_mm5n3djq",
  customQ: "text_mm5nqcrp",
  customA: "long_text_mm5n767f",
};

// Canonical chip labels (RU). Free-text "Другое: …" entries stay out of the
// dropdowns — they go into the update instead, so label sets never bloat.
const CANON = {
  highlights: ["Люди и общение", "Новые знакомства", "Атмосфера", "Тема и содержание",
    "Ведущие и организация", "Место и площадка", "Еда и угощения", "Польза и новые знания", "Другое"],
  discomfort: ["Неудобное время", "Сложно добираться", "Неудобное место или помещение",
    "Слишком долго", "Слишком коротко", "Было сложно включиться", "Слишком много людей",
    "Языковой барьер", "Мало информации заранее", "Дорого вышло", "Другое", "Всё было ок"],
};

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

const MONTHS_RU = ["января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря"];
function ruDate(text) {
  const m = (text || "").match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}))?/);
  if (!m) return "";
  const [, y, mo, d, hh, mm] = m;
  let t = "";
  if (hh !== undefined) {
    const h = Number(hh);
    t = `, ${h % 12 || 12}:${mm} ${h < 12 ? "AM" : "PM"}`;
  }
  return `${Number(d)} ${MONTHS_RU[Number(mo) - 1]} ${y}${t}`;
}

// monday link columns return "label - url" as text; keep only the url
const urlFrom = (t) => (String(t || "").match(/https?:\/\/\S+/) || [""])[0];
// Публичная ссылка на альбом (photos.app.goo.gl/… или …/share/…, бывает с
// /u/N/ в пути) против владельческой (…/lr/album/<id>, открывается только
// под info@qaravan.org).
const isShareUrl = (u) => /photos\.app\.goo\.gl|photos\.google\.com\/(?:u\/\d+\/)?share\//.test(u);

async function getEvent(id) {
  if (!id) return null;
  const d = await monday(
    `query ($ids: [ID!]) { items(ids: $ids) { id name board { id } column_values(ids: ["${CUSTOM_COL}","${ALBUM_COL}","${ALBUM_LINK_COL}","${THREAD_COL}","date4","location","text_mm5qsspp","text_mm5b1czz","link"]) { id text } } }`,
    { ids: [String(id)] });
  const item = d.items?.[0];
  if (!item || String(item.board.id) !== EVENTS_BOARD) return null;
  const cols = Object.fromEntries(item.column_values.map((c) => [c.id, c.text || ""]));
  // /u/7/ в пути — номер аккаунта владельца в его браузере; чужим мешает.
  const albumLink = urlFrom(cols[ALBUM_LINK_COL]).replace(/photos\.google\.com\/u\/\d+\//, "photos.google.com/");
  return {
    id: item.id, name: item.name,
    custom: (cols[CUSTOM_COL] || "").trim(),
    // id из служебной колонки; для событий, где в «Photos album» лежит
    // владельческая ссылка, id достаём из неё — альбом уже есть, новый не нужен
    albumId: (cols[ALBUM_COL] || "").trim() || (albumLink.match(/photos\.google\.com\/(?:u\/\d+\/)?lr\/album\/([\w-]+)/) || [])[1] || "",
    albumShareUrl: isShareUrl(albumLink) ? albumLink : "",
    date: ruDate(cols.date4),
    location: (cols.location || "").trim(),
    ruName: (cols.text_mm5qsspp || "").trim(),
    lead: (cols.text_mm5b1czz || "").trim(),
    partiful: (String(cols.link || "").match(/https?:\/\/\S+/) || [""])[0],
    slackThread: (cols[THREAD_COL] || "").trim(),
  };
}


// ---------- personal token (?p=attendeeId.sig) ----------
function respondentKey(eventId, p) {
  const secret = process.env.UNSUB_SECRET;
  if (!secret || !p) return null;
  const m = String(p).match(/^(\d+)\.([0-9a-f]{16})$/);
  if (!m) return null;
  const want = createHmac("sha256", secret).update(`${eventId}:${m[1]}`).digest("hex").slice(0, 16);
  return want === m[2] ? `${eventId}:${m[1]}` : null;
}

// Personal token of the Sunday combined form: attendeeId.hmac16("multi:attendeeId")
function multiAttendee(p) {
  const secret = process.env.UNSUB_SECRET;
  if (!secret || !p) return null;
  const m = String(p).match(/^(\d+)\.([0-9a-f]{16})$/);
  if (!m) return null;
  const want = createHmac("sha256", secret).update(`multi:${m[1]}`).digest("hex").slice(0, 16);
  return want === m[2] ? m[1] : null;
}

async function findByRespondentKey(key) {
  const d = await monday(
    `query ($b: ID!, $v: [String]!) { items_page_by_column_values(board_id: $b, limit: 1, columns: [{column_id: "${RESPONDENT_COL}", column_values: $v}]) { items { id } } }`,
    { b: FEEDBACK_BOARD, v: [key] }
  ).catch(() => null);
  return d?.items_page_by_column_values?.items?.[0]?.id || null;
}

// ---------- Google Photos: album + filing uploaded bytes ----------
async function googleToken() {
  const j = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
      scope: "https://www.googleapis.com/auth/photoslibrary.appendonly",
    }),
  }).then((r) => r.json());
  if (!j.access_token) throw new Error("google auth");
  return j.access_token;
}

// Поиск существующего альбома по названию среди созданных ПРИЛОЖЕНИЕМ.
// Нужен scope readonly.appcreateddata; если refresh-токен его не несёт,
// Google откажет — тогда молча пропускаем и идём обычным путём.
// Альбомы, созданные человеком руками в Google Photos, API не видит и
// класть в них файлы не может ни при каких условиях — ограничение Google.
async function findAppAlbumByTitle(title) {
  const j = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
      scope: "https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata",
    }),
  }).then((r) => r.json());
  if (!j.access_token) return "";
  const hits = [];
  let page = "";
  do {
    const r = await fetch(`https://photoslibrary.googleapis.com/v1/albums?pageSize=50&excludeNonAppCreatedData=true${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`,
      { headers: { Authorization: `Bearer ${j.access_token}` } });
    if (!r.ok) return "";
    const d = await r.json();
    for (const a of d.albums || []) if (a.title === title) hits.push(a.id);
    page = d.nextPageToken || "";
  } while (page);
  // только однозначное совпадение: два одноимённых альбома — не угадываем
  return hits.length === 1 ? hits[0] : "";
}

async function filePhotos(ev, photos, credit) {
  const token = await googleToken();
  let albumId = ev.albumId;
  if (!albumId) {
    // Прежде чем заводить новый альбом — поискать существующий по названию:
    // id мог не записаться или потеряться, а альбом уже есть.
    albumId = await findAppAlbumByTitle(`${ev.name} — QARAVAN`).catch(() => "");
    if (albumId) {
      ev.albumId = albumId;
      await monday(
        `mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v){id} }`,
        { b: EVENTS_BOARD, i: String(ev.id), v: JSON.stringify({ [ALBUM_COL]: albumId }) }
      ).catch((e) => console.error("album id write-back failed:", e.message));
    }
  }
  if (!albumId) {
    // Публичная ссылка на строке есть, а id альбома нет: по публичной ссылке
    // id не восстановить (в ней share-токен, а методы sharing из API убраны),
    // так что файлы лягут в новый альбом — и об этом надо честно сказать.
    const staleShare = ev.albumShareUrl;
    const a = await fetch("https://photoslibrary.googleapis.com/v1/albums", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ album: { title: `${ev.name} — QARAVAN` } }),
    }).then((r) => r.json());
    if (!a.id) throw new Error("album create: " + JSON.stringify(a).slice(0, 200));
    albumId = a.id;
    // Открыть альбом «всем, у кого есть ссылка» через API нельзя (Google убрал
    // albums.share в марте 2025) — просим человека сделать это один раз,
    // апдейтом на строке события (просьбы в Slack Эзра отменил, Aug 2026).
    const ownerUrl = a.productUrl || `https://photos.google.com/lr/album/${albumId}`;
    // Инструкцию-апдейт больше не постим (15.08.2026) — сигнал даёт чип «Album
    // status». Единственное исключение: в колонке лежала СТАРАЯ публичная ссылка,
    // а файлы легли в новый альбом — про такое расхождение молчать нельзя.
    if (staleShare) {
      await slackNotify(`⚠️ Альбомы разъехались — ${ev.name}`, [
        { type: "section", text: { type: "mrkdwn", text: `⚠️ *«${ev.name}»*: в колонке «Photo album» лежала публичная ссылка (${staleShare}), но id того альбома роботу неизвестен — новые фото ушли в НОВЫЙ альбом, колонка перезаписана. Если альбом должен быть один — перенеси фото из старого руками и включи новому доступ по ссылке. <https://qaravan.monday.com/boards/${EVENTS_BOARD}/pulses/${ev.id}|Строка события>`.slice(0, 2900) } },
      ]);
    }
    // Album "description": Google Photos albums have no description field, so
    // the event info goes in as a text enrichment pinned to the top.
    const info = [
      ev.ruName && ev.ruName !== ev.name ? `${ev.name} / ${ev.ruName}` : ev.name,
      ev.date, ev.location,
      ev.lead ? `Ведущие: ${ev.lead}` : "",
      ev.partiful,
      "Фото и видео гостей и ведущих, загружены через форму отзыва QARAVAN. Загружая, авторы согласились на использование в материалах и соцсетях организации.",
    ].filter(Boolean).join("\n");
    await fetch(`https://photoslibrary.googleapis.com/v1/albums/${albumId}:addEnrichment`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ newEnrichmentItem: { textEnrichment: { text: info.slice(0, 1000) } }, albumPosition: { position: "FIRST_IN_ALBUM" } }),
    }).catch((e) => console.error("album enrichment failed:", e.message));
    // Кэш в две колонки: id — служебный, ссылка — владельческая с пометкой,
    // из неё id тоже восстанавливается (…/lr/album/<id>), если запись id упала.
    // Устаревшую публичную ссылку (см. staleShare выше) перезаписываем: она
    // ведёт в альбом, куда новые фото уже не попадут. «Album status» покажет
    // на доске, что доступ ещё не открыт.
    await monday(
      `mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v,create_labels_if_missing:true){id} }`,
      { b: EVENTS_BOARD, i: String(ev.id), v: JSON.stringify({
        [ALBUM_COL]: albumId,
        [ALBUM_LINK_COL]: { url: ownerUrl, text: "не публичная — включи доступ по ссылке" },
        [ALBUM_STATUS_COL]: { label: "⚠️ OPEN ACCESS" },
      }) }
    ).catch((e) => console.error("album cache write failed:", e.message)); // filing photos matters more than caching the album id
    // Сообщения ниже по коду должны вести в ЭТОТ альбом, а не в старый по ссылке
    ev.albumId = albumId;
    ev.albumShareUrl = "";
  }
  const description = credit ? `Автор: ${credit}` : "";

  // Один заход batchCreate. Возвращает, что легло, что не легло и почему.
  // Без albumId Google кладёт файлы прямо в библиотеку аккаунта — это всегда
  // работает, пока жив upload-токен, и служит нам страховкой.
  async function tryCreate(items, intoAlbum) {
    const okItems = [], failedItems = [], why = [];
    for (let i = 0; i < items.length; i += 50) {
      const batch = items.slice(i, i + 50);
      const body = {
        newMediaItems: batch.map((ph) => ({
          description,
          simpleMediaItem: { uploadToken: ph.token, fileName: String(ph.name || "media").slice(0, 120) },
        })),
      };
      if (intoAlbum) body.albumId = intoAlbum;
      let r;
      try {
        r = await fetch("https://photoslibrary.googleapis.com/v1/mediaItems:batchCreate", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }).then((x) => x.json());
      } catch (e) {
        failedItems.push(...batch); why.push(`сеть: ${e.message}`); continue;
      }
      const results = r.newMediaItemResults;
      if (!Array.isArray(results) || !results.length) {
        // весь запрос отвергнут целиком — обычно проблема в альбоме, не в файлах
        failedItems.push(...batch);
        why.push(r?.error?.message || JSON.stringify(r).slice(0, 200));
        continue;
      }
      results.forEach((res, j) => {
        if (res.mediaItem) okItems.push(batch[j]);
        else { failedItems.push(batch[j]); why.push(res.status?.message || "unknown"); }
      });
    }
    return { okItems, failedItems, why };
  }

  // Лестница спасения: альбом события → библиотека без альбома → новый альбом.
  // Ни один файл гостя не должен потеряться из-за проблем с альбомом.
  const errors = [];
  let created = 0, toLibrary = 0, rescueAlbumId = null;
  let left = photos;

  if (albumId && left.length) {
    const a = await tryCreate(left, albumId);
    created += a.okItems.length;
    left = a.failedItems;
    if (a.why.length) errors.push(...a.why.map((w) => `альбом: ${w}`));
  }

  if (left.length) {
    // без альбома — лишь бы файлы оказались в аккаунте
    const b = await tryCreate(left, null);
    toLibrary += b.okItems.length;
    left = b.failedItems;
    if (b.why.length) errors.push(...b.why.map((w) => `библиотека: ${w}`));
  }

  if (left.length) {
    // последняя попытка: свежий альбом, созданный прямо сейчас этим же приложением
    try {
      const a = await fetch("https://photoslibrary.googleapis.com/v1/albums", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ album: { title: `${ev.name} — QARAVAN (спасённые файлы)` } }),
      }).then((r) => r.json());
      if (a.id) {
        const c = await tryCreate(left, a.id);
        if (c.okItems.length) { rescueAlbumId = a.id; created += c.okItems.length; }
        left = c.failedItems;
        if (c.why.length) errors.push(...c.why.map((w) => `запасной альбом: ${w}`));
      } else {
        errors.push(`запасной альбом не создался: ${JSON.stringify(a).slice(0, 150)}`);
      }
    } catch (e) { errors.push(`запасной альбом: ${e.message}`); }
  }

  // Токены того, что не легло никуда: они живут около суток, по ним файл ещё
  // можно достать вручную. Пишем их рядом с отзывом, чтобы не терять концы.
  const lost = left.map((ph) => ({ name: ph.name || "media", token: String(ph.token).slice(0, 400) }));
  return { created, toLibrary, rescueAlbumId, errors, lost, albumId };
}

// ---------- Slack: every submission lands in #event-feedback ----------
async function slackNotify(text, blocks, threadTs) {
  const tok = process.env.SLACK_BOT_TOKEN, ch = process.env.SLACK_CHANNEL_ID;
  if (!tok || !ch) return null;
  try {
    const r = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ channel: ch, text, blocks, unfurl_links: false, unfurl_media: false, ...(threadTs ? { thread_ts: threadTs } : {}) }),
    });
    const j = await r.json();
    return j.ok ? j : null;
  } catch (e) { console.error("slack notify failed:", e.message); return null; }
}

// Правило против шума: на событие — ОДНА карточка-родитель в канале, всё
// остальное репликами в её тред. Родитель создаётся при первом отклике,
// его ts кэшируется в «⚙️ Slack thread id». Если Slack/monday не в духе —
// честно возвращаем null и сообщение уходит в канал как раньше (не молчим).
async function eventThread(ev) {
  if (!ev) return null;
  if (ev.slackThread) return ev.slackThread;
  const parent = await slackNotify(`Отклики по «${ev.name}»`, [
    { type: "header", text: { type: "plain_text", text: `Отклики по «${ev.name}»`.slice(0, 150), emoji: true } },
    { type: "context", elements: [{ type: "mrkdwn", text: (slackCtx(ev) + " — отзывы, фото и «не был(а)» собираются в этом треде").slice(0, 250) }] },
  ]);
  if (!parent?.ts) return null;
  ev.slackThread = parent.ts;
  await monday(
    `mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v){id} }`,
    { b: EVENTS_BOARD, i: String(ev.id), v: JSON.stringify({ [THREAD_COL]: parent.ts }) }
  ).catch((e) => console.error("thread ts cache failed:", e.message));
  return parent.ts;
}

const slackCtx = (ev) => [ev?.date, ev?.location, ev?.lead ? `Ведущие: ${ev.lead}` : ""].filter(Boolean).join(" — ") || "событие с календаря QARAVAN";
const slackLinks = (ev, itemId) => [
  ev?.partiful ? `<${ev.partiful}|Регистрация на Partiful>` : "",
  ev?.albumShareUrl ? `<${ev.albumShareUrl}|Фотоальбом события>` : "",
  `<https://qaravan.monday.com/boards/${FEEDBACK_BOARD}/pulses/${itemId}|Открыть отзыв на доске>`,
].filter(Boolean).join("     ");

// Строка про альбом — и в запись на доске, и в Slack (обычный URL кликается в
// обоих). Пока доступ по ссылке не включён, честно говорим, что ссылка
// владельческая — иначе люди тычут в неё и видят «Can't access photo».
const albumRefText = (ev, albumId) => {
  if (ev?.albumShareUrl) return `\nАльбом события: ${ev.albumShareUrl}`;
  const id = albumId || ev?.albumId;
  return id ? `\nАльбом события (доступ по ссылке ещё не включён — открывается только под info@qaravan.org): https://photos.google.com/lr/album/${id}` : "";
};

// Одна строка-отчёт о фото для всех трёх форм. Говорит правду о том, где
// файлы оказались, и никогда не молчит о потерянных: если что-то не легло
// вообще никуда, рядом остаются upload-токены — по ним файл ещё сутки
// достаётся вручную.
function photoResultLine(ev, done, credit, sent) {
  const where = [];
  if (done.created) where.push(`${done.created} шт. в альбоме события`);
  if (done.toLibrary) where.push(`${done.toLibrary} шт. в общей библиотеке Google Photos (в альбом не пустил Google — разложи руками)`);
  const head = where.length
    ? `Фото/видео: ${where.join(", ")} (согласие на использование подтверждено при загрузке)${credit ? `, автор: ${credit}` : ""}`
    : `Фото/видео: прислано ${sent} шт., но Google не принял ни одного`;
  const lostLine = done.lost?.length
    ? `\n⚠️ НЕ СОХРАНИЛОСЬ: ${done.lost.length} шт. Токены загрузки (живут ~сутки, по ним файл можно достать):\n` +
      done.lost.map((l) => `${l.name}: ${l.token}`).join("\n")
    : "";
  const errLine = done.errors?.length ? `\nОтвет Google: ${done.errors.slice(0, 3).join(" | ").slice(0, 400)}` : "";
  const rescue = done.rescueAlbumId
    ? `\nЗапасной альбом: https://photos.google.com/lr/album/${done.rescueAlbumId}`
    : "";
  return head + albumRefText(ev, done.albumId) + rescue + errLine + lostLine;
}

function slackBlocks(header, ev, bodyText, itemId) {
  return [
    { type: "header", text: { type: "plain_text", text: header.slice(0, 150), emoji: true } },
    { type: "context", elements: [{ type: "mrkdwn", text: slackCtx(ev).slice(0, 250) }] },
    { type: "section", text: { type: "mrkdwn", text: bodyText.slice(0, 2900) } },
    { type: "context", elements: [{ type: "mrkdwn", text: slackLinks(ev, itemId) }] },
  ];
}

const split = (arr) => ({
  labels: (arr || []).filter((v) => !String(v).startsWith("Другое: ")),
  other: (arr || []).filter((v) => String(v).startsWith("Другое: ")),
});

export default async function handler(req, res) {
  if (req.method !== "POST") { res.statusCode = 405; return res.end(); }
  const chunks = []; for await (const c of req) chunks.push(c);
  let b;
  try { b = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { res.statusCode = 400; return res.end(); }

  // Honeypot: bots fill the hidden field; thank them and write nothing.
  if (b.website) { res.setHeader("Content-Type", "application/json"); return res.end('{"ok":true}'); }

  const ev = await getEvent(b.eventId).catch(() => null);
  res.setHeader("Content-Type", "application/json");

  // «Меня там не было» — одна отметка. С личным токеном ложится под тот же
  // respondent key, так что настоящий ответ позже займёт ту же строку.
  if (b.no_show) {
    if (!ev) { res.statusCode = 404; return res.end("{}"); }
    const rKey = respondentKey(ev.id, b.p);
    const existing = rKey ? await findByRespondentKey(rKey) : null;
    if (existing) {
      await monday(`mutation ($i: ID!, $t: String!) { create_update(item_id:$i, body:$t){id} }`,
        { i: String(existing), t: "Отметил(а) в форме: не был(а) на событии" });
    } else {
      const cv = { [F.eventName]: ev.name, [F.eventRel]: { item_ids: [Number(ev.id)] } };
      if (rKey) cv[RESPONDENT_COL] = rKey;
      const c = await monday(
        `mutation ($b: ID!, $n: String!, $v: JSON!) { create_item(board_id:$b,item_name:$n,column_values:$v,create_labels_if_missing:true){id} }`,
        { b: FEEDBACK_BOARD, n: `No show — ${ev.name} — ${rKey ? "по личной ссылке" : "аноним"}`, v: JSON.stringify(cv) });
      await monday(`mutation ($i: ID!, $t: String!) { create_update(item_id:$i, body:$t){id} }`,
        { i: String(c.create_item.id), t: "Отметил(а) в форме: не был(а) на событии" });
    }
    await slackNotify(`«Меня там не было» — ${ev.name}`, [
      { type: "section", text: { type: "mrkdwn", text: `*«Меня там не было»* — ${ev.name}${rKey ? "" : " — аноним"}` } },
    ], await eventThread(ev));
    return res.end('{"ok":true}');
  }

  // Photos-only page (/{id}/photos): files go into the event album, no feedback
  // row is created — the record of what landed where goes onto the EVENT row.
  if (b.photos_only) {
    if (!ev) { res.statusCode = 404; return res.end("{}"); }
    const credit = String(b.photo_credit || "").slice(0, 120);
    const media = Array.isArray(b.photos)
      ? b.photos.filter((x) => x && typeof x.token === "string" && x.token.length > 10).slice(0, 20)
      : [];
    if (!media.length) return res.end('{"ok":true,"rescue":[]}');
    const rescue = [];
    let photoLine;
    try {
      const done = await filePhotos(ev, media, credit);
      photoLine = photoResultLine(ev, done, credit, media.length);
      for (const l of done.lost || []) rescue.push({ eventId: String(ev.id), name: l.name });
    } catch (e) {
      console.error("photos-only failed:", e.message);
      photoLine = `⚠️ Фото/видео: прислано ${media.length} шт., сохранить не удалось — ${String(e.message).slice(0, 200)}\n` +
        `Токены загрузки (живут ~сутки):\n` + media.map((m) => `${m.name || "media"}: ${String(m.token).slice(0, 400)}`).join("\n");
      for (const m of media) rescue.push({ eventId: String(ev.id), name: m.name || "media" });
    }
    // Квитанция уходит только в Slack-тред события — апдейты-комментарии на строках убраны (15.08.2026).
    await slackNotify(`📷 Фото с события — ${ev.name} (${media.length} шт.)`, [
      { type: "section", text: { type: "mrkdwn", text: `📷 *Фото: ${media.length} шт.*${credit ? ` — автор: ${credit}` : ""}\n${photoLine}`.slice(0, 2900) } },
    ], await eventThread(ev));
    return res.end(JSON.stringify({ ok: true, rescue }));
  }

  // Combined Sunday form: short answers about several events at once.
  if (b.multi) {
    const attendeeId = multiAttendee(b.p);
    const entries = Array.isArray(b.events) ? b.events.slice(0, 10) : [];
    const summary = [];
    const rescue = [];   // файлы, которые Google не взял никуда — форма дошлёт их нам
    let processed = 0;
    for (const entry of entries) {
      const evi = await getEvent(entry.id).catch(() => null);
      if (!evi) continue;
      const noShow = !!entry.no_show;
      const rating = Number(entry.rating) || 0;
      const comment = String(entry.comment || "").trim().slice(0, 2000);
      if (!noShow && !rating && !comment) continue; // про это событие ничего не сказали
      processed++;
      const rKey = attendeeId ? `${evi.id}:${attendeeId}` : null;
      const cv = { [F.eventName]: evi.name, [F.lang]: { labels: [b.lang === "en" ? "en" : "ru"] }, [F.eventRel]: { item_ids: [Number(evi.id)] } };
      if (rKey) cv[RESPONDENT_COL] = rKey;
      if (!noShow && rating >= 1 && rating <= 5) cv[F.rating] = { rating };
      // варианты ответов из общей формы: хорошее и то, что стоит поправить
      const tags = Array.isArray(entry.tags) ? entry.tags.map(String) : [];
      const hi = tags.filter((t) => CANON.highlights.includes(t));
      const lo = tags.filter((t) => CANON.discomfort.includes(t));
      if (!noShow && hi.length) cv[F.highlights] = { labels: hi };
      if (!noShow && lo.length) cv[F.discomfort] = { labels: lo };
      if (!noShow && b.consent) cv[F.consent] = { labels: [b.consent] };
      if (!noShow && b.name) cv[F.quoteName] = String(b.name).slice(0, 120);
      // отдельный вопрос этого события: сохраняем и сам вопрос, и ответ
      if (!noShow && evi.custom) cv[F.customQ] = evi.custom.slice(0, 250);
      if (!noShow && entry.custom_a) cv[F.customA] = { text: String(entry.custom_a).slice(0, 4000) };
      const who = b.name || b.contact_name || "аноним";
      const itemName = noShow ? `No show — ${evi.name}${attendeeId ? "" : " — аноним"}` : `${evi.name} — ${who}`;
      const existing = rKey ? await findByRespondentKey(rKey) : null;
      let itemId;
      if (existing) {
        await monday(
          `mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v,create_labels_if_missing:true){id} }`,
          { b: FEEDBACK_BOARD, i: String(existing), v: JSON.stringify(cv) });
        itemId = existing;
      } else {
        const d = await monday(
          `mutation ($b: ID!, $n: String!, $v: JSON!) { create_item(board_id:$b,item_name:$n,column_values:$v,create_labels_if_missing:true){id} }`,
          { b: FEEDBACK_BOARD, n: itemName, v: JSON.stringify(cv) });
        itemId = d.create_item.id;
      }
      // Фото и видео гостя уходят в альбом ИМЕННО этого события — в общей форме
      // каждое событие грузит свои файлы отдельно.
      let photoLine = null;
      const media = Array.isArray(entry.photos)
        ? entry.photos.filter((x) => x && typeof x.token === "string" && x.token.length > 10).slice(0, 20)
        : [];
      if (!noShow && media.length) {
        try {
          const done = await filePhotos(evi, media, String(b.photo_credit || "").slice(0, 120));
          photoLine = photoResultLine(evi, done, b.photo_credit, media.length);
          for (const l of done.lost || []) rescue.push({ eventId: String(evi.id), name: l.name });
        } catch (e) {
          console.error("multi photos failed:", e.message);
          photoLine = `⚠️ Фото/видео: прислано ${media.length} шт., сохранить не удалось — ${String(e.message).slice(0, 200)}\n` +
            `Токены загрузки (живут ~сутки):\n` + media.map((m) => `${m.name || "media"}: ${String(m.token).slice(0, 400)}`).join("\n");
          for (const m of media) rescue.push({ eventId: String(evi.id), name: m.name || "media" });
        }
      }
      const lines = noShow
        ? ["Отметил(а) в общей форме: не был(а) на событии"]
        : [
            existing ? "ОБНОВЛЁННЫЙ ОТВЕТ (общая форма недели)" : "Ответ из общей формы недели",
            `Оценка: ${rating || "—"}`,
            hi.length ? `Запомнилось: ${hi.join(", ")}` : null,
            lo.length ? `Некомфортно: ${lo.join(", ")}` : null,
            `Комментарий: ${comment || "—"}`,
            evi.custom ? `${evi.custom}\n${String(entry.custom_a || "").trim() || "—"}` : null,
            photoLine,
            `Согласие на цитаты: ${b.consent || "—"}${b.name ? ` (подпись: ${b.name})` : ""}`,
            `Связь: ${b.contact_ok || "—"}${b.contact_name ? ` | Имя: ${b.contact_name}` : ""}${b.email ? ` | Почта: ${b.email}` : ""}${b.phone ? ` | Телефон: ${b.phone}` : ""}`,
            `Язык формы: ${b.lang || "ru"}`,
          ];
      await monday(`mutation ($i: ID!, $t: String!) { create_update(item_id:$i, body:$t){id} }`,
        { i: String(itemId), t: lines.filter(Boolean).join("\n") });
      const stars = noShow ? "не был(а)" : (rating ? "★".repeat(rating) + "☆".repeat(5 - rating) : "без оценки");
      const albumRef = evi.albumShareUrl ? ` · <${evi.albumShareUrl}|альбом>` : "";
      summary.push(`*${evi.name}* — ${stars}${media.length ? ` · 📷 ${media.length}${albumRef}` : ""}${comment ? `\n${comment}` : ""}`);
    }
    if (summary.length) {
      const who = b.name || b.contact_name || "аноним";
      await slackNotify(`Новый отзыв (общая форма, ${processed} соб.) — ${who}`, [
        { type: "header", text: { type: "plain_text", text: `Новый отзыв — общая форма недели (${processed} соб.)`.slice(0, 150), emoji: true } },
        { type: "section", text: { type: "mrkdwn", text: summary.join("\n\n").slice(0, 2900) } },
      ]);
    }
    return res.end(JSON.stringify({ ok: true, processed, rescue }));
  }

  if (b.isLead) {
    // Ответ ведущего не должен падать из-за колонки Attendance: её однажды
    // удалили с доски, и каждый ответ ведущего умирал с 500. Число всё равно
    // сохраняется в тексте отзыва («Сколько пришло: N») и уходит в Slack.
    let attendedNote = null;
    if (ev && Number.isFinite(b.headcount)) {
      await monday(
        `mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v){id} }`,
        { b: EVENTS_BOARD, i: String(ev.id), v: JSON.stringify({ [ATTENDED_COL]: String(b.headcount) }) }
      ).catch((e) => {
        console.error("attended write failed:", e.message);
        attendedNote = "⚠️ Число участников НЕ записалось в колонку Attendance (колонка удалена с доски?) — только в текст этого отзыва.";
      });
    }
    const cv = { [F.eventName]: ev?.name || "", [F.lang]: { labels: [b.lang === "en" ? "en" : "ru"] } };
    if (ev) cv[F.eventRel] = { item_ids: [Number(ev.id)] };
    if (b.rating >= 1 && b.rating <= 5) cv[F.rating] = { rating: b.rating };
    const d = await monday(
      `mutation ($b: ID!, $n: String!, $v: JSON!) { create_item(board_id:$b,item_name:$n,column_values:$v,create_labels_if_missing:true){id} }`,
      { b: FEEDBACK_BOARD, n: `LEAD — ${ev?.name || "событие"}`, v: JSON.stringify(cv) });
    let leadPhotoLine = null;
    const leadMedia = Array.isArray(b.photos) ? b.photos.filter((x) => x && typeof x.token === "string" && x.token.length > 10).slice(0, 20) : [];
    if (ev && leadMedia.length) {
      try {
        const done = await filePhotos(ev, leadMedia, String(b.photo_credit || "").slice(0, 120));
        leadPhotoLine = photoResultLine(ev, done, b.photo_credit, leadMedia.length);
      } catch (e) {
        leadPhotoLine = `⚠️ Фото/видео: прислано ${leadMedia.length} шт., сохранить не удалось — ${String(e.message).slice(0, 200)}\n` +
          `Токены загрузки (живут ~сутки):\n` + leadMedia.map((m) => `${m.name || "media"}: ${String(m.token).slice(0, 400)}`).join("\n");
      }
    }
    const body = [
      `Сколько пришло: ${b.headcount}`, attendedNote, `Оценка: ${b.rating || "—"}`,
      `Комментарий: ${b.comment || "—"}`,
      `Мешало: ${(b.obstacles || []).join("; ") || "—"}`,
      `Не хватило от QARAVAN: ${(b.missing || []).join("; ") || "—"}`,
      leadPhotoLine,
    ].filter(Boolean).join("\n");
    await monday(`mutation ($i: ID!, $t: String!) { create_update(item_id:$i, body:$t){id} }`,
      { i: String(d.create_item.id), t: body });
    await slackNotify(`Отзыв ведущего — ${ev?.name || "событие"}`,
      slackBlocks(`Отзыв ведущего — ${ev?.name || "событие"}`, ev, body, d.create_item.id));
    return res.end('{"ok":true}');
  }

  // Attendee
  const hi = split(b.highlights), lo = split(b.discomfort);
  const rKey = ev ? respondentKey(ev.id, b.p) : null;
  const cv = {
    [F.eventName]: ev?.name || "",
    [F.lang]: { labels: [b.lang === "en" ? "en" : "ru"] },
  };
  if (rKey) cv[RESPONDENT_COL] = rKey;
  if (ev) cv[F.eventRel] = { item_ids: [Number(ev.id)] };
  if (b.rating >= 1 && b.rating <= 5) cv[F.rating] = { rating: b.rating };
  if (hi.labels.length) cv[F.highlights] = { labels: hi.labels.filter((l) => CANON.highlights.includes(l)) };
  if (lo.labels.length) cv[F.discomfort] = { labels: lo.labels.filter((l) => CANON.discomfort.includes(l)) };
  if (b.moment) cv[F.moment] = { text: String(b.moment).slice(0, 4000) };
  if (Array.isArray(b.why_come) && b.why_come.length) cv[F.whyCome] = { text: b.why_come.join("; ").slice(0, 4000) };
  if (b.consent) cv[F.consent] = { labels: [b.consent] };
  if (b.name) cv[F.quoteName] = String(b.name).slice(0, 120);
  if (b.donate) cv[F.donate] = { labels: [b.donate] };
  if (ev?.custom) cv[F.customQ] = ev.custom.slice(0, 250);
  if (b.custom_a) cv[F.customA] = { text: String(b.custom_a).slice(0, 4000) };

  const who = b.name || b.contact_name || "аноним";
  const existingId = rKey ? await findByRespondentKey(rKey) : null;
  let itemId, updated = false;
  if (existingId) {
    await monday(
      `mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v,create_labels_if_missing:true){id} }`,
      { b: FEEDBACK_BOARD, i: String(existingId), v: JSON.stringify(cv) });
    itemId = existingId; updated = true;
  } else {
    const d = await monday(
      `mutation ($b: ID!, $n: String!, $v: JSON!) { create_item(board_id:$b,item_name:$n,column_values:$v,create_labels_if_missing:true){id} }`,
      { b: FEEDBACK_BOARD, n: `${ev?.name || "Событие"} — ${who}`, v: JSON.stringify(cv) });
    itemId = d.create_item.id;
  }

  // Photos/videos: file the browser-uploaded bytes into the event album.
  let photoLine = null;
  const rescue = [];   // файлы, которые Google не взял никуда — форма дошлёт их нам
  const media = Array.isArray(b.photos) ? b.photos.filter((x) => x && typeof x.token === "string" && x.token.length > 10).slice(0, 20) : [];
  if (ev && media.length) {
    try {
      const done = await filePhotos(ev, media, String(b.photo_credit || "").slice(0, 120));
      photoLine = photoResultLine(ev, done, b.photo_credit, media.length);
      for (const l of done.lost || []) rescue.push({ eventId: String(ev.id), name: l.name });
    } catch (e) {
      photoLine = `⚠️ Фото/видео: прислано ${media.length} шт., сохранить не удалось — ${String(e.message).slice(0, 200)}\n` +
        `Токены загрузки (живут ~сутки):\n` + media.map((m) => `${m.name || "media"}: ${String(m.token).slice(0, 400)}`).join("\n");
      for (const m of media) rescue.push({ eventId: String(ev.id), name: m.name || "media" });
    }
  }

  // The full submission, verbatim — contacts and demographics live here.
  const lines = [
    updated ? "ОБНОВЛЁННЫЙ ОТВЕТ — человек отправил форму ещё раз, колонки перезаписаны, прежний текст остался в истории выше" : null,
    `Оценка: ${b.rating || "—"}`,
    `Понравилось: ${(b.highlights || []).join("; ") || "—"}`,
    `Некомфортно: ${(b.discomfort || []).join("; ") || "—"}`,
    `Момент: ${b.moment || "—"}`,
    `Пришёл/пришла потому что: ${(b.why_come || []).join("; ") || "—"}`,
    `В стране: ${b.stay || "—"} | Возраст: ${b.age || "—"}`,
    `Согласие на цитаты: ${b.consent || "—"}${b.name ? ` (подпись: ${b.name})` : ""}`,
    `Связь: ${b.contact_ok || "—"}${b.contact_name ? ` | Имя: ${b.contact_name}` : ""}${b.email ? ` | Почта: ${b.email}` : ""}${b.phone ? ` | Телефон: ${b.phone}` : ""}`,
    `Донат: ${b.donate || "—"}`,
    ev?.custom ? `Свой вопрос: ${ev.custom}\nОтвет: ${b.custom_a || "—"}` : null,
    photoLine,
    `Язык формы: ${b.lang || "ru"}`,
  ].filter(Boolean);
  await monday(`mutation ($i: ID!, $t: String!) { create_update(item_id:$i, body:$t){id} }`,
    { i: String(itemId), t: lines.join("\n") });

  const stars = b.rating >= 1 && b.rating <= 5 ? "★".repeat(b.rating) + "☆".repeat(5 - b.rating) : "без оценки";
  const header = `${updated ? "Обновлённый отзыв" : "Новый отзыв"} — ${ev?.name || "событие"}`;
  // Контакты и демография — только на monday: в Slack карточка идёт без строк
  // «Связь» (почта, телефон) и «В стране | Возраст».
  const slackSafe = lines.filter((l) => !/^(Связь|В стране):/.test(l));
  await slackNotify(`${header} (${stars})`,
    slackBlocks(`${header}`, ev, `*${stars}*\n${slackSafe.join("\n")}`, itemId),
    await eventThread(ev));

  res.end(JSON.stringify({ ok: true, updated, rescue }));
}
