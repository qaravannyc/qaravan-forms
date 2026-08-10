// POST /api/submit — both forms land here.
// Attendee answers fill the structured columns on the Отзывы board (labels are
// stored in Russian regardless of UI language — one label system), plus one
// update with the complete submission so nothing is ever lost to a missing
// column. The lead's headcount goes straight into the event's Attended column.
const MONDAY = "https://api.monday.com/v2";
const EVENTS_BOARD = "4774572020";
const FEEDBACK_BOARD = "18423848983";
const ATTENDED_COL = "numbers";

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
  highlights: ["Люди и общение", "Атмосфера", "Тема и содержание", "Те, кто вёл", "Другое"],
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

async function getEvent(id) {
  if (!id) return null;
  const d = await monday(
    `query ($ids: [ID!]) { items(ids: $ids) { id name board { id } column_values(ids: ["long_text_custom"]) { id text } } }`,
    { ids: [String(id)] });
  const item = d.items?.[0];
  if (!item || String(item.board.id) !== EVENTS_BOARD) return null;
  return { id: item.id, name: item.name, custom: (item.column_values[0]?.text || "").trim() };
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
    const body = [
      `Сколько пришло: ${b.headcount}`, `Оценка: ${b.rating || "—"}`,
      `Комментарий: ${b.comment || "—"}`,
      `Мешало: ${(b.obstacles || []).join("; ") || "—"}`,
      `Не хватило от QARAVAN: ${(b.missing || []).join("; ") || "—"}`,
    ].join("\n");
    await monday(`mutation ($i: ID!, $t: String!) { create_update(item_id:$i, body:$t){id} }`,
      { i: String(d.create_item.id), t: body });
    return res.end('{"ok":true}');
  }

  // Attendee
  const hi = split(b.highlights), lo = split(b.discomfort);
  const cv = {
    [F.eventName]: ev?.name || "",
    [F.lang]: { labels: [b.lang === "en" ? "en" : "ru"] },
  };
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
  const d = await monday(
    `mutation ($b: ID!, $n: String!, $v: JSON!) { create_item(board_id:$b,item_name:$n,column_values:$v,create_labels_if_missing:true){id} }`,
    { b: FEEDBACK_BOARD, n: `${ev?.name || "Событие"} — ${who}`, v: JSON.stringify(cv) });

  // The full submission, verbatim — contacts and demographics live here.
  const lines = [
    `Оценка: ${b.rating || "—"}`,
    `Запомнилось: ${(b.highlights || []).join("; ") || "—"}`,
    `Некомфортно: ${(b.discomfort || []).join("; ") || "—"}`,
    `Момент: ${b.moment || "—"}`,
    `Пришёл/пришла потому что: ${(b.why_come || []).join("; ") || "—"}`,
    `В стране: ${b.stay || "—"} | Возраст: ${b.age || "—"}`,
    `Согласие на цитаты: ${b.consent || "—"}${b.name ? ` (подпись: ${b.name})` : ""}`,
    `Связь: ${b.contact_ok || "—"}${b.contact_name ? ` | Имя: ${b.contact_name}` : ""}${b.email ? ` | Почта: ${b.email}` : ""}${b.phone ? ` | Телефон: ${b.phone}` : ""}`,
    `Донат: ${b.donate || "—"}`,
    ev?.custom ? `Свой вопрос: ${ev.custom}\nОтвет: ${b.custom_a || "—"}` : null,
    `Язык формы: ${b.lang || "ru"}`,
  ].filter(Boolean);
  await monday(`mutation ($i: ID!, $t: String!) { create_update(item_id:$i, body:$t){id} }`,
    { i: String(d.create_item.id), t: lines.join("\n") });

  res.end('{"ok":true}');
}
