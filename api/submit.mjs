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
const ATTENDED_COL = "numbers";
const ALBUM_COL = "text_mm636xn";      // Photos album id, on the events board
const CUSTOM_COL = "long_text_mm64tyb5"; // «Свой вопрос гостям» — доп. вопрос про это событие
const RESPONDENT_COL = "text_mm63r903"; // eventId:attendeeId, on the feedback board
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
  highlights: ["Люди и общение", "Атмосфера", "Тема и содержание", "Организаторы", "Другое"],
  discomfort: ["Неудобное время", "Сложно добираться", "Слишком долго", "Слишком коротко",
    "Было сложно включиться", "Мало информации заранее", "Другое", "Всё было ок"],
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

async function getEvent(id) {
  if (!id) return null;
  const d = await monday(
    `query ($ids: [ID!]) { items(ids: $ids) { id name board { id } column_values(ids: ["${CUSTOM_COL}","${ALBUM_COL}","date4","location","text_mm5qsspp","text_mm5b1czz","link"]) { id text } } }`,
    { ids: [String(id)] });
  const item = d.items?.[0];
  if (!item || String(item.board.id) !== EVENTS_BOARD) return null;
  const cols = Object.fromEntries(item.column_values.map((c) => [c.id, c.text || ""]));
  return {
    id: item.id, name: item.name,
    custom: (cols[CUSTOM_COL] || "").trim(),
    albumId: (cols[ALBUM_COL] || "").trim(),
    date: ruDate(cols.date4),
    location: (cols.location || "").trim(),
    ruName: (cols.text_mm5qsspp || "").trim(),
    lead: (cols.text_mm5b1czz || "").trim(),
    partiful: (String(cols.link || "").match(/https?:\/\/\S+/) || [""])[0],
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

async function filePhotos(ev, photos, credit) {
  const token = await googleToken();
  let albumId = ev.albumId;
  if (!albumId) {
    const a = await fetch("https://photoslibrary.googleapis.com/v1/albums", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ album: { title: `${ev.name} — QARAVAN` } }),
    }).then((r) => r.json());
    if (!a.id) throw new Error("album create: " + JSON.stringify(a).slice(0, 200));
    albumId = a.id;
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
    await monday(
      `mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v){id} }`,
      { b: EVENTS_BOARD, i: String(ev.id), v: JSON.stringify({ [ALBUM_COL]: albumId }) }
    ).catch(() => {}); // filing photos matters more than caching the album id
  }
  const description = credit ? `Автор: ${credit}` : "";
  let created = 0;
  const errors = [];
  for (let i = 0; i < photos.length; i += 50) {
    const batch = photos.slice(i, i + 50);
    const r = await fetch("https://photoslibrary.googleapis.com/v1/mediaItems:batchCreate", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        albumId,
        newMediaItems: batch.map((ph) => ({
          description,
          simpleMediaItem: { uploadToken: ph.token, fileName: String(ph.name || "media").slice(0, 120) },
        })),
      }),
    }).then((x) => x.json());
    for (const it of r.newMediaItemResults || []) {
      if (it.mediaItem) created++;
      else errors.push(it.status?.message || "unknown");
    }
    if (!r.newMediaItemResults) errors.push(JSON.stringify(r).slice(0, 200));
  }
  return { created, errors, albumId };
}

// ---------- Slack: every submission lands in #event-feedback ----------
async function slackNotify(text, blocks) {
  const tok = process.env.SLACK_BOT_TOKEN, ch = process.env.SLACK_CHANNEL_ID;
  if (!tok || !ch) return;
  try {
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ channel: ch, text, blocks, unfurl_links: false, unfurl_media: false }),
    });
  } catch (e) { console.error("slack notify failed:", e.message); }
}

const slackCtx = (ev) => [ev?.date, ev?.location, ev?.lead ? `Ведущие: ${ev.lead}` : ""].filter(Boolean).join(" — ") || "событие с календаря QARAVAN";
const slackLinks = (ev, itemId) => [
  ev?.partiful ? `<${ev.partiful}|Регистрация на Partiful>` : "",
  `<https://qaravan.monday.com/boards/${FEEDBACK_BOARD}/pulses/${itemId}|Открыть отзыв на доске>`,
].filter(Boolean).join("     ");

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
      { type: "section", text: { type: "mrkdwn", text: `*«Меня там не было»* — ${ev.name}\n${slackCtx(ev)}${rKey ? "" : " — аноним"}` } },
    ]);
    return res.end('{"ok":true}');
  }

  // Combined Sunday form: short answers about several events at once.
  if (b.multi) {
    const attendeeId = multiAttendee(b.p);
    const entries = Array.isArray(b.events) ? b.events.slice(0, 10) : [];
    const summary = [];
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
          photoLine = `Фото/видео: ${done.created} шт. в альбоме события (согласие подтверждено при загрузке)` +
            (b.photo_credit ? `, автор: ${b.photo_credit}` : "");
        } catch (e) {
          console.error("multi photos failed:", e.message);
          photoLine = `Фото/видео: не удалось положить в альбом (${String(e.message).slice(0, 120)})`;
        }
      }
      const lines = noShow
        ? ["Отметил(а) в общей форме: не был(а) на событии"]
        : [
            existing ? "ОБНОВЛЁННЫЙ ОТВЕТ (общая форма недели)" : "Ответ из общей формы недели",
            `Оценка: ${rating || "—"}`,
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
      summary.push(`*${evi.name}* — ${stars}${media.length ? ` · 📷 ${media.length}` : ""}${comment ? `\n${comment}` : ""}`);
    }
    if (summary.length) {
      const who = b.name || b.contact_name || "аноним";
      await slackNotify(`Новый отзыв (общая форма, ${processed} соб.) — ${who}`, [
        { type: "header", text: { type: "plain_text", text: `Новый отзыв — общая форма недели (${processed} соб.)`.slice(0, 150), emoji: true } },
        { type: "section", text: { type: "mrkdwn", text: summary.join("\n\n").slice(0, 2900) } },
      ]);
    }
    return res.end(JSON.stringify({ ok: true, processed }));
  }

  if (b.isLead) {
    if (ev && Number.isFinite(b.headcount)) {
      await monday(
        `mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v){id} }`,
        { b: EVENTS_BOARD, i: String(ev.id), v: JSON.stringify({ [ATTENDED_COL]: String(b.headcount) }) });
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
        leadPhotoLine = `Фото/видео: ${done.created} шт. в альбоме события (согласие на использование подтверждено при загрузке)` +
          (b.photo_credit ? `, автор: ${b.photo_credit}` : "") +
          (done.errors.length ? ` — не приняты Google: ${done.errors.length}` : "");
      } catch (e) {
        leadPhotoLine = `Фото/видео: загружены (${leadMedia.length} шт.), но разложить в альбом не вышло — ${e.message}`;
      }
    }
    const body = [
      `Сколько пришло: ${b.headcount}`, `Оценка: ${b.rating || "—"}`,
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
  const media = Array.isArray(b.photos) ? b.photos.filter((x) => x && typeof x.token === "string" && x.token.length > 10).slice(0, 20) : [];
  if (ev && media.length) {
    try {
      const done = await filePhotos(ev, media, String(b.photo_credit || "").slice(0, 120));
      photoLine = `Фото/видео: ${done.created} шт. в альбоме события (согласие на использование подтверждено при загрузке)` +
        (b.photo_credit ? `, автор: ${b.photo_credit}` : "") +
        (done.errors.length ? ` — не приняты Google: ${done.errors.length}` : "");
    } catch (e) {
      photoLine = `Фото/видео: загружены (${media.length} шт.), но разложить в альбом не вышло — ${e.message}`;
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
  await slackNotify(`${header} (${stars})`,
    slackBlocks(`${header}`, ev, `*${stars}*\n${lines.join("\n")}`, itemId));

  res.end(JSON.stringify({ ok: true, updated }));
}
