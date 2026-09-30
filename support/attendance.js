// Страница «Кто пришёл на встречу»: /support/attendance?t=<ключ>.
// Ключ приходит ведущей в письме сразу после встречи (lib/meetings.mjs, askEmail); сервер — lib/attendance.mjs.
// GET /api/attendance?t= — встреча и люди: участники группы, пришедшие на прошлые встречи,
// остальные анкеты; галочки — те, кто уже отмечен в «Confirmed attendees» этой встречи.
// POST /api/attendance — сохранить: отмеченные становятся «Confirmed attendees» встречи,
// снятые галочки (unselected) оттуда убираются.
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null)); return e; };
const T = new URLSearchParams(location.search).get("t") || "";
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DRAFT_KEY = "qaravan.meeting-attendance." + T.slice(0, 24);
let data = null, people = [], saving = false;

const fmtWhen = (iso) => new Intl.DateTimeFormat("ru-RU", { timeZone: "America/New_York", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
// 1 человек, 2 человека, 5 человек
const ppl = (n) => { const d = n % 10, h = n % 100; return `${n} ${d >= 2 && d <= 4 && (h < 12 || h > 14) ? "человека" : "человек"}`; };

function problem(title, text) {
  $("loading").hidden = true; $("view").hidden = true; $("done").hidden = true;
  $("problemT").textContent = title; $("problemP").textContent = text; $("problem").hidden = false;
}

// ===== черновик: отметки переживают перезагрузку до сохранения =====
function saveDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(people.map((p) => [p.key, p.name, p.email, p.checked, !!p.added]))); } catch (e) {}
}
function loadDraft() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch (e) {}
  if (!Array.isArray(d)) return;
  const byKey = new Map(people.map((p) => [p.key, p]));
  for (const [key, name, email, checked, added] of d) {
    if (byKey.has(key)) byKey.get(key).checked = !!checked;
    else if (added && EMAIL_RX.test(email)) people.unshift({ key, name, email, checked: !!checked, added: true });
  }
}
const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} };

// ===== люди =====
const ST = { New: "новая анкета", Contacted: "связались", "Intro call done": "знакомство прошло", Joined: "в группе", "Not now": "не сейчас" };
function meta(p) {
  if (p.added) return "добавлен(а) вручную";
  const bits = [];
  if (p.status) bits.push(ST[p.status] || p.status);
  if (p.past) bits.push(`был(а) на прошлых встречах: ${p.past}`);
  return bits.join(", ");
}
function renderPeople() {
  const wrap = $("people"); wrap.innerHTML = "";
  const q = $("q").value.trim().toLowerCase();
  const on = people.filter((p) => p.checked);
  const regular = people.filter((p) => !p.checked && (p.member || p.past || p.added));
  const rest = people.filter((p) => !p.checked && !(p.member || p.past || p.added));
  let shown = 0;
  const row = (p) => {
    const i = el("input", { type: "checkbox", checked: p.checked });
    i.onchange = () => { p.checked = i.checked; saveDraft(); renderPeople(); };
    const hide = q && !((p.name || "").toLowerCase().includes(q) || (p.email || "").includes(q));
    if (!hide) shown++;
    return el("label", { className: "person", hidden: hide }, i, el("span", {},
      el("div", { className: "nm", textContent: p.name || p.email }), p.email ? el("div", { className: "em", textContent: p.email }) : null,
      meta(p) ? el("div", { className: "meta", textContent: meta(p) }) : null));
  };
  const block = (title, list) => { if (list.length) { wrap.append(el("h3", { textContent: `${title} (${list.length})` })); list.forEach((p) => wrap.append(row(p))); } };
  block("Были на встрече", on);
  block("Участники группы", regular);
  block("Остальные анкеты", rest);
  if (!shown) wrap.append(el("p", { className: "empty", textContent: q ? "Никого не нашли. Проверьте написание или добавьте человека ниже." : "Пока никого нет. Добавьте человека ниже." }));
  $("count").textContent = on.length ? `Отмечено: ${ppl(on.length)}` : "Пока никто не отмечен";
  $("save").textContent = on.length ? `Сохранить: ${ppl(on.length)}` : "Сохранить";
}
$("q").addEventListener("input", renderPeople);
$("addBtn").onclick = () => {
  const email = $("addEmail").value.trim().toLowerCase(), name = $("addName").value.trim();
  const bad = !EMAIL_RX.test(email);
  $("addErr").classList.toggle("show", bad);
  bad ? $("addEmail").setAttribute("aria-invalid", "true") : $("addEmail").removeAttribute("aria-invalid");
  if (bad) { $("addEmail").focus(); return; }
  const have = people.find((p) => p.email === email);
  if (have) have.checked = true; else people.unshift({ key: email, email, name: name || email, checked: true, added: true });
  $("addName").value = ""; $("addEmail").value = ""; $("q").value = "";
  saveDraft(); renderPeople(); $("addName").focus();
};

// ===== сохранение =====
$("f").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (saving) return;
  saving = true; $("save").disabled = true; $("save").textContent = "Сохраняем…";
  const known = new Set((data.people || []).map((p) => p.key));
  const body = {
    t: T,
    selected: people.filter((p) => p.checked && known.has(p.key)).map((p) => p.key),
    unselected: people.filter((p) => !p.checked && known.has(p.key)).map((p) => p.key),
    add: people.filter((p) => p.checked && !known.has(p.key)).map((p) => ({ name: p.name, email: p.email })),
  };
  try {
    const r = await fetch("/api/attendance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 403) return problem("Ссылка больше не работает", j.error === "expired" ? "Она работала две недели после встречи. Напишите команде QARAVAN, если нужно поправить отметки." : "Откройте кнопку из письма о прошедшей встрече.");
    if (!r.ok || !j.ok) throw new Error(j.error || "HTTP " + r.status);
    clearDraft();
    $("view").hidden = true; $("done").hidden = false;
    $("doneT").textContent = j.n ? `Сохранено: ${ppl(j.n)}` : "Сохранено: никто не отмечен";
    $("doneP").textContent = "Отметки уже в «Confirmed attendees» этой встречи в календаре событий. Если кого-то забыли, вернитесь к списку, поправьте и сохраните ещё раз.";
    window.scrollTo(0, 0); $("doneT").focus();
    data.saved = { at: j.at, n: j.n };
    for (const p of people) if (p.added) { p.added = false; p.key = j.keys?.[p.email] || p.key; }
    data.people = people.map((p) => ({ ...p }));
    refresh(); // список с сервера: новые карточки, слитые по почте люди
  } catch (e) {
    $("err").textContent = "Не удалось сохранить. Отметки остались на странице: проверьте интернет и нажмите «Сохранить» ещё раз.";
    $("err").classList.add("show");
  } finally {
    saving = false; $("save").disabled = false; renderPeople();
  }
});
$("back").onclick = () => { $("done").hidden = true; $("view").hidden = false; renderSaved(); window.scrollTo(0, 0); };
function renderSaved() {
  const s = data.saved;
  $("savedNote").hidden = !s;
  if (s) $("savedNote").textContent = `Уже сохраняли ${fmtWhen(s.at)}: ${ppl(s.n)}. Можно поправить и сохранить ещё раз.`;
}

async function refresh() {
  try {
    const r = await fetch("/api/attendance?t=" + encodeURIComponent(T));
    if (!r.ok) return;
    const j = await r.json();
    data = j; people = (j.people || []).map((p) => ({ ...p }));
    if (!$("view").hidden) { renderSaved(); renderPeople(); }
  } catch (e) {}
}

// ===== старт =====
(async () => {
  if (!T) return problem("Ссылка неполная", "Откройте кнопку «Отметить, кто пришёл» из письма о прошедшей встрече.");
  let r, j;
  try { r = await fetch("/api/attendance?t=" + encodeURIComponent(T)); j = await r.json(); }
  catch (e) { return problem("Страница не загрузилась", "Проверьте интернет и обновите страницу."); }
  if (!r.ok) {
    if (j.error === "early") return problem("Встреча ещё не началась", "Отметить, кто пришёл, можно после начала встречи. Ссылка из письма заработает сама.");
    if (j.error === "expired") return problem("Ссылка больше не работает", "Она работала две недели после встречи. Напишите команде QARAVAN, если нужно поправить отметки.");
    if (j.error === "gone") return problem("Встреча не найдена", "Похоже, её убрали из календаря событий. Напишите команде QARAVAN, если это ошибка.");
    if (j.error === "bad") return problem("Ссылка не работает", "Откройте кнопку «Отметить, кто пришёл» из письма о прошедшей встрече.");
    return problem("Страница не загрузилась", "Попробуйте обновить страницу через минуту.");
  }
  data = j;
  people = (j.people || []).map((p) => ({ ...p }));
  document.title = `Кто пришёл: ${j.meeting.line}`;
  $("groupTitle").textContent = j.title;
  $("when").textContent = j.meeting.line;
  $("cancelNote").hidden = !j.meeting.cancelled;
  loadDraft();
  renderSaved(); renderPeople();
  $("loading").hidden = true; $("view").hidden = false;
})();
