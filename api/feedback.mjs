// qaravan.org/feedback/{event-id} — attendee survey
// qaravan.org/feedback/{event-id}/lead — the lead's five questions
// One Vercel function renders and receives both. The event id in the link IS the
// monday item id, so every link is unique per event with no extra machinery.

import { attendeeQuestions, leadQuestions } from "../questions.mjs";

const MONDAY = "https://api.monday.com/v2";
const B = { events: 4774572020, attendees: 18425190164, feedback: 18423848983 };
const C = {
  rsvps: "numeric_mm5yrs5j", attended: "numbers", surveyStatus: "color_mm5yxxe3",
  ruText: "text_mm5qsspp", customQuestions: "long_text_custom", // created by setup.mjs; harmless if absent
};

async function monday(query, variables = {}) {
  const res = await fetch(MONDAY, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: process.env.MONDAY_TOKEN, "API-Version": "2024-10" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

async function getEvent(id) {
  const d = await monday(
    `query ($ids: [ID!]) { items(ids: $ids) { id name board { id } column_values { id text } } }`,
    { ids: [String(id)] }
  );
  const item = d.items?.[0];
  if (!item || String(item.board.id) !== String(B.events)) return null;
  const cols = Object.fromEntries(item.column_values.map((c) => [c.id, c.text || ""]));
  return { id: item.id, name: item.name, custom: cols[C.customQuestions] || "" };
}

// ---------- Google Photos (appendonly): upload + credit + album per event ----------
async function googleAccessToken() {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error("Google auth failed: " + JSON.stringify(j));
  return j.access_token;
}

async function uploadToGooglePhotos(files, { eventName, credit, consentAt }) {
  const token = await googleAccessToken();
  const uploadTokens = [];
  for (const f of files) {
    const up = await fetch("https://photoslibrary.googleapis.com/v1/uploads", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "X-Goog-Upload-Protocol": "raw",
        "X-Goog-Upload-Content-Type": f.type || "application/octet-stream",
      },
      body: f.bytes,
    });
    uploadTokens.push({ token: await up.text(), name: f.name });
  }
  const description = `Автор: ${credit || "участник события"}. Событие: ${eventName}. Согласие на использование получено ${consentAt}.`;
  const create = await fetch("https://photoslibrary.googleapis.com/v1/mediaItems:batchCreate", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      newMediaItems: uploadTokens.map((t) => ({ description, simpleMediaItem: { uploadToken: t.token, fileName: t.name } })),
    }),
  });
  if (!create.ok) throw new Error("batchCreate failed: " + (await create.text()));
  return uploadTokens.length;
}

// ---------- multipart parsing (no dependencies) ----------
function parseMultipart(buffer, boundary) {
  const parts = [];
  const delim = Buffer.from(`--${boundary}`);
  let idx = buffer.indexOf(delim);
  while (idx !== -1) {
    const next = buffer.indexOf(delim, idx + delim.length);
    if (next === -1) break;
    const chunk = buffer.subarray(idx + delim.length + 2, next - 2);
    const headerEnd = chunk.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      const headers = chunk.subarray(0, headerEnd).toString();
      const body = chunk.subarray(headerEnd + 4);
      const nameM = headers.match(/name="([^"]+)"/);
      const fileM = headers.match(/filename="([^"]*)"/);
      const typeM = headers.match(/Content-Type:\s*(\S+)/i);
      if (nameM) parts.push({ name: nameM[1], filename: fileM?.[1] || null, type: typeM?.[1] || null, body });
    }
    idx = next;
  }
  return parts;
}

// ---------- the page ----------
function page(html, lang = "ru") {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>QARAVAN</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600&family=Unbounded:wght@500&display=swap" rel="stylesheet">
<style>
:root{--ink:#1d1b16;--paper:#fbfaf6;--accent:#6b3df5;--soft:#efece4;--ok:#0f6e56}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 "Golos Text",system-ui,sans-serif}
main{max-width:560px;margin:0 auto;padding:28px 20px 80px}
.brand{font:500 15px "Unbounded";letter-spacing:.06em;color:var(--accent)}
h1{font:500 clamp(24px,6vw,32px)/1.25 "Unbounded";margin:14px 0 8px}
.intro{color:#5c584f;margin:0 0 26px}
.lang{float:right;font-size:14px}.lang a{color:#5c584f;text-decoration:none;padding:2px 8px;border-radius:99px}.lang a.on{background:var(--soft);color:var(--ink)}
fieldset{border:0;padding:0;margin:0 0 26px}
label,.qlabel{display:block;font-weight:600;margin:0 0 8px}
.hint{font-weight:400;color:#7a766c;font-size:14px;margin:-4px 0 10px}
textarea,input[type=text],input[type=number],input[type=email]{width:100%;border:1.5px solid #d8d4c8;border-radius:12px;padding:12px 14px;font:inherit;background:#fff}
textarea{min-height:96px;resize:vertical}
textarea:focus,input:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:var(--accent)}
.stars{display:flex;gap:8px}.stars input{position:absolute;opacity:0}
.stars label{width:52px;height:52px;margin:0;border:1.5px solid #d8d4c8;border-radius:12px;display:grid;place-items:center;font-size:20px;color:#b6b1a3;cursor:pointer;background:#fff}
.stars input:checked~label, .stars label.lit{background:var(--accent);border-color:var(--accent);color:#fff}
.chips{display:flex;flex-wrap:wrap;gap:8px}.chips input{position:absolute;opacity:0}
.chips label{margin:0;font-weight:500;border:1.5px solid #d8d4c8;border-radius:99px;padding:9px 16px;cursor:pointer;background:#fff}
.chips input:checked+label{background:var(--ink);border-color:var(--ink);color:#fff}
.reveal{display:none;margin-top:14px}.reveal.open{display:block}
.consent{display:flex;gap:10px;align-items:flex-start;background:var(--soft);border-radius:12px;padding:12px 14px;margin-top:12px}
.consent input{width:20px;height:20px;margin-top:2px;flex:none}
.consent span{font-weight:500;font-size:14.5px}
button{width:100%;border:0;border-radius:14px;background:var(--accent);color:#fff;font:600 17px "Golos Text";padding:15px;cursor:pointer}
button:active{transform:scale(.99)}
.done{background:#fff;border:1.5px solid var(--ok);color:var(--ok);border-radius:14px;padding:18px;font-weight:600}
input[type=file]{width:100%;padding:12px;border:1.5px dashed #c9c4b5;border-radius:12px;background:#fff}
</style></head><body><main>${html}</main>
<script>
document.querySelectorAll('[data-reveal]').forEach(el=>{el.addEventListener('change',()=>{
  const t=document.getElementById(el.dataset.reveal);const on=el.value==='yes'||el.value==='Да'||el.value==='Yes'||el.value==='Может быть'||el.value==='Maybe';
  t.classList.toggle('open',on&&el.checked);
  t.querySelectorAll('[data-required]').forEach(i=>i.required=on&&el.checked);
})});
document.querySelectorAll('.stars').forEach(g=>{const ls=[...g.querySelectorAll('label')];
  g.addEventListener('change',()=>{const v=+g.querySelector('input:checked').value;ls.forEach((l,i)=>l.classList.toggle('lit',i<v))});});
</script></body></html>`;
}

function langSwitch(base, lang) {
  return `<div class="lang"><a class="${lang === "ru" ? "on" : ""}" href="${base}?lang=ru">RU</a><a class="${lang === "en" ? "on" : ""}" href="${base}?lang=en">EN</a></div>`;
}

function starsField(name) {
  return `<div class="stars">` + [1, 2, 3, 4, 5].map((v) =>
    `<input type="radio" id="${name}${v}" name="${name}" value="${v}"><label for="${name}${v}" class="s">${v}</label>`).join("") + `</div>`;
}

function attendeeForm(ev, lang, base) {
  const q = attendeeQuestions[lang];
  // Custom questions from the monday row replace q1–q4 as plain open questions, one per line.
  const customLines = (ev.custom || "").split("\n").map((s) => s.trim()).filter(Boolean);
  const coreQuestions = customLines.length
    ? customLines.map((line, i) => `<fieldset><label>${line}</label><textarea name="custom_${i}"></textarea></fieldset>`).join("")
    : `
<fieldset><span class="qlabel">${q.q1.label}</span>${starsField("rating")}</fieldset>
<fieldset><label>${q.q2.label}</label><p class="hint">${q.q2.hint}</p><textarea name="best"></textarea></fieldset>
<fieldset><label>${q.q3.label}</label><textarea name="improve"></textarea></fieldset>
<fieldset><span class="qlabel">${q.q4.label}</span><div class="chips">${q.q4.options.map((o, i) =>
      `<input type="radio" id="h${i}" name="heard" value="${o}"><label for="h${i}">${o}</label>`).join("")}</div></fieldset>`;

  return page(`
${langSwitch(base, lang)}<div class="brand">qaravan</div>
<h1>${q.title(ev.name)}</h1><p class="intro">${q.intro}</p>
<form method="post" enctype="multipart/form-data">
<input type="hidden" name="lang" value="${lang}">
${coreQuestions}
<fieldset><span class="qlabel">${q.photoAsk.label}</span>
  <div class="chips">
    <input type="radio" id="py" name="hasPhotos" value="yes" data-reveal="photoBlock"><label for="py">${q.photoAsk.yes}</label>
    <input type="radio" id="pn" name="hasPhotos" value="no" data-reveal="photoBlock"><label for="pn">${q.photoAsk.no}</label>
  </div>
  <div class="reveal" id="photoBlock">
    <label>${q.photoUpload}</label>
    <input type="file" name="photos" multiple accept="image/*,video/*" data-required>
    <div class="consent"><input type="checkbox" name="consent" value="yes" data-required><span>${q.consent}</span></div>
    <label style="margin-top:12px">${q.credit}</label><input type="text" name="credit">
  </div>
</fieldset>
<fieldset><span class="qlabel">${q.leadAsk.label}</span><p class="hint">${q.leadAsk.hint}</p>
  <div class="chips">${q.leadAsk.options.map((o, i) =>
    `<input type="radio" id="l${i}" name="wantsLead" value="${o}" ${i < 2 ? 'data-reveal="leadBlock"' : 'data-reveal="leadBlock"'}><label for="l${i}">${o}</label>`).join("")}</div>
  <div class="reveal" id="leadBlock"><label>${q.leadInterest}</label><textarea name="leadInterest"></textarea></div>
</fieldset>
<fieldset><label>Email</label><input type="email" name="email" required></fieldset>
<button>${q.submit}</button>
</form>`, lang);
}

function leadForm(ev, lang, base) {
  const q = leadQuestions[lang];
  return page(`
${langSwitch(base, lang)}<div class="brand">qaravan</div>
<h1>${q.title(ev.name)}</h1><p class="intro">${q.intro}</p>
<form method="post">
<input type="hidden" name="lang" value="${lang}"><input type="hidden" name="isLead" value="1">
<fieldset><label>${q.q1.label}</label><input type="number" name="headcount" min="0" required></fieldset>
<fieldset><span class="qlabel">${q.q2.label}</span>${starsField("rating")}<textarea name="how" style="margin-top:10px"></textarea></fieldset>
<fieldset><label>${q.q3.label}</label><textarea name="support"></textarea></fieldset>
<fieldset><label>${q.q4.label}</label><textarea name="disruptions"></textarea></fieldset>
<fieldset><label>${q.q5.label}</label><textarea name="helped"></textarea></fieldset>
<button>${q.submit}</button>
</form>`, lang);
}

// ---------- handler ----------
export default async function handler(req, res) {
  const url = new URL(req.url, "https://x");
  const id = url.searchParams.get("id");
  const isLead = url.searchParams.get("lead") === "1";
  const lang = url.searchParams.get("lang") === "en" ? "en" : "ru";
  const base = isLead ? `/feedback/${id}/lead` : `/feedback/${id}`;

  const ev = await getEvent(id).catch(() => null);
  if (!ev) { res.statusCode = 404; return res.end(page(`<h1>Событие не найдено / Event not found</h1>`)); }

  if (req.method === "GET") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(isLead ? leadForm(ev, lang, base) : attendeeForm(ev, lang, base));
  }

  // POST — collect body
  const chunks = []; for await (const c of req) chunks.push(c);
  const buf = Buffer.concat(chunks);
  const ctype = req.headers["content-type"] || "";
  let fields = {}, files = [];
  if (ctype.includes("multipart/form-data")) {
    const boundary = ctype.split("boundary=")[1];
    for (const p of parseMultipart(buf, boundary)) {
      if (p.filename) { if (p.body.length) files.push({ name: p.filename, type: p.type, bytes: p.body }); }
      else fields[p.name] = p.body.toString("utf8");
    }
  } else {
    fields = Object.fromEntries(new URLSearchParams(buf.toString("utf8")));
  }
  const L = fields.lang === "en" ? "en" : "ru";

  if (fields.isLead === "1") {
    // Headcount goes straight into the event's Attended column; answers become a response row.
    await monday(
      `mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v,create_labels_if_missing:true){id} }`,
      { b: String(B.events), i: String(ev.id), v: JSON.stringify({ [C.attended]: String(fields.headcount || "") }) }
    );
    await monday(
      `mutation ($b: ID!, $n: String!, $v: JSON!) { create_item(board_id:$b,item_name:$n,column_values:$v){id} }`,
      { b: String(B.feedback), n: `LEAD — ${ev.name}`, v: JSON.stringify({}) }
    ).then(async (d) => {
      const body = [`Headcount: ${fields.headcount}`, `Rating: ${fields.rating || "—"}`, `How it went: ${fields.how || "—"}`,
        `Support from QARAVAN: ${fields.support || "—"}`, `Disruptions: ${fields.disruptions || "—"}`, `What helped: ${fields.helped || "—"}`].join("\n");
      await monday(`mutation ($i: ID!, $t: String!) { create_update(item_id:$i, body:$t){id} }`, { i: String(d.create_item.id), t: body });
    });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(page(`<div class="brand">qaravan</div><h1>${leadQuestions[L].thanks}</h1>`, L));
  }

  // Attendee response
  let photoCount = 0;
  if (fields.hasPhotos === "yes" && files.length) {
    if (fields.consent !== "yes") { res.statusCode = 400; return res.end(page(`<h1>${L === "ru" ? "Для загрузки фото нужно согласие на использование." : "Consent is required to upload photos."}</h1>`, L)); }
    photoCount = await uploadToGooglePhotos(files, { eventName: ev.name, credit: fields.credit, consentAt: new Date().toISOString() });
  }
  const customAnswers = Object.entries(fields).filter(([k]) => k.startsWith("custom_")).map(([, v]) => v);
  const bodyLines = customAnswers.length
    ? customAnswers.map((v, i) => `Q${i + 1}: ${v}`)
    : [`Rating: ${fields.rating || "—"}`, `Best: ${fields.best || "—"}`, `Improve: ${fields.improve || "—"}`, `Heard via: ${fields.heard || "—"}`];
  bodyLines.push(`Wants to lead: ${fields.wantsLead || "—"}`, `Lead interest: ${fields.leadInterest || "—"}`,
    `Photos shared: ${photoCount}`, photoCount ? `Consent: yes, ${new Date().toISOString()}, credit "${fields.credit || ""}"` : `Consent: n/a`,
    `Email: ${fields.email || "—"}`);

  const created = await monday(
    `mutation ($b: ID!, $n: String!, $v: JSON!) { create_item(board_id:$b,item_name:$n,column_values:$v){id} }`,
    { b: String(B.feedback), n: `${ev.name} — ${fields.email || "anonymous"}`, v: JSON.stringify({}) }
  );
  await monday(`mutation ($i: ID!, $t: String!) { create_update(item_id:$i, body:$t){id} }`,
    { i: String(created.create_item.id), t: bodyLines.join("\n") });

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.end(page(`<div class="brand">qaravan</div><h1>${attendeeQuestions[L].thanks}</h1>`, L));
}
