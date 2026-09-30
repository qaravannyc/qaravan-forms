// Страница «Кто пришёл на встречу»: /support/attendance?t=<ключ>.
// Ключ приходит ведущей в письме сразу после встречи (lib/meetings.mjs, askEmail); сервер — lib/attendance.mjs.
// GET /api/attendance?t= — встреча и люди: участники группы (Joined), новые анкеты, уже
// отмеченные в «Confirmed attendees» этой встречи (с галочкой) и остальные (свёрнуты).
// POST /api/attendance — сохранить: отмеченные становятся «Confirmed attendees» встречи,
// снятые галочки (unselected) оттуда убираются.
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null)); return e; };
const T = new URLSearchParams(location.search).get("t") || "";
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DRAFT_KEY = "qaravan.meeting-attendance." + T.slice(0, 24);
let data = null, people = [], saving = false;
const COLL = new Intl.Collator("ru", { sensitivity: "base" });

const fmtWhen = (iso) => new Intl.DateTimeFormat("ru-RU", { timeZone: "America/New_York", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
// 1 человек, 2 человека, 5 человек
const ppl = (n) => { const d = n % 10, h = n % 100; return `${n} ${d >= 2 && d <= 4 && (h < 12 || h > 14) ? "человека" : "человек"}`; };

function problem(title, text) {
  $("loading").hidden = true; $("view").hidden = true; $("done").hidden = true;
  $("problemT").textContent = title; $("problemP").textContent = text; $("problem").hidden = false;
}

// ===== черновик: свои правки переживают перезагрузку до сохранения =====
// Хранятся только собственные изменения (галочка не такая, как при загрузке, или добавленный
// вручную): чужие отметки, сохранённые за это время другим человеком, черновик не перебивает.
function saveDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(people.filter((p) => p.added || p.checked !== p.was).map((p) => [p.key, p.name, p.email, p.checked, !!p.added]))); } catch (e) {}
}
function loadDraft() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch (e) {}
  if (!Array.isArray(d)) return;
  const byKey = new Map(people.map((p) => [p.key, p]));
  for (const [key, name, email, checked, added] of d) {
    if (byKey.has(key)) byKey.get(key).checked = !!checked;
    else if (added && EMAIL_RX.test(email)) people.push({ key, name, email, checked: !!checked, added: true, sec: "added" });
  }
}
const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} };

// ===== люди =====
const ST = { New: "новая анкета", Contacted: "связались", "Intro call done": "знакомство прошло", Joined: "в группе", "Not now": "не сейчас" };
// в сетке — коротко: у свёрнутых остальных — статус и сколько раз были
function meta(p, s) {
  if (s.key !== "old") return "";
  return [p.status ? `${p.status} — ${ST[p.status] || p.status}` : "", p.past ? `был(а) на встречах: ${p.past}` : ""].filter(Boolean).join(", ");
}
// Список не двигается, пока ведущая ставит галочки: разделы и порядок (по имени) задаются один
// раз при загрузке (support/roster.js). Сверху — участники группы, под ними новые анкеты с
// меткой и уже отмеченные на этой встрече; остальные свёрнуты; добавленные вручную — в конце.
const SECTIONS = [
  { key: "member", title: "Участники группы" }, { key: "new", title: "Новые анкеты (New)", mark: "new" },
  { key: "marked", title: "Уже отмечены на этой встрече" }, { key: "old", title: "Остальные анкеты", fold: true },
  { key: "added", title: "Добавлены вручную" },
];
function arrange() {
  const show = data.show || [];
  for (const p of people) if (p.was === undefined) p.was = !!p.checked; // как было при загрузке: снять можно только своё
  for (const p of people) if (!p.sec) p.sec = p.member ? "member" : show.includes(p.status) ? "new" : p.checked ? "marked" : "old";
  const rank = { member: 0, new: 1, marked: 2, old: 3, added: 4 };
  people.sort((a, b) => rank[a.sec] - rank[b.sec] || (a.sec === "added" ? 0 : COLL.compare(a.name || a.email, b.name || b.email)));
}
function counts() {
  const on = people.filter((p) => p.checked).length;
  $("count").textContent = on ? `Отмечено: ${ppl(on)}` : "Пока никто не отмечен";
  $("save").textContent = on ? `Сохранить: ${ppl(on)}` : "Сохранить";
}
function renderPeople() {
  const q = $("q").value.trim().toLowerCase();
  const shown = Roster.render($("people"), { people, sections: SECTIONS, q, meta, onToggle: () => { saveDraft(); counts(); } });
  if (!shown) $("people").append(el("p", { className: "empty", textContent: q ? "Никого не нашли. Проверьте написание или добавьте человека ниже." : "Пока никого нет. Добавьте человека ниже." }));
  counts();
}
$("q").addEventListener("input", renderPeople);
$("addBtn").onclick = () => {
  const email = $("addEmail").value.trim().toLowerCase(), name = $("addName").value.trim();
  const bad = !EMAIL_RX.test(email);
  $("addErr").classList.toggle("show", bad);
  bad ? $("addEmail").setAttribute("aria-invalid", "true") : $("addEmail").removeAttribute("aria-invalid");
  if (bad) { $("addEmail").focus(); return; }
  const have = people.find((p) => p.email === email);
  if (have) have.checked = true; else people.push({ key: email, email, name: name || email, checked: true, added: true, sec: "added" });
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
    // снятые этим человеком галочки (были при загрузке, теперь нет); чужие отметки сохраняются
    unselected: people.filter((p) => p.was && !p.checked && known.has(p.key)).map((p) => p.key),
    add: people.filter((p) => p.checked && !known.has(p.key)).map((p) => ({ name: p.name, email: p.email })),
    seen: data.saved?.at || null, // от какого сохранения открыта страница
  };
  try {
    const r = await fetch("/api/attendance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 403) return problem("Ссылка больше не работает", j.error === "expired" ? "Она работала две недели после встречи. Напишите команде QARAVAN, если нужно поправить отметки." : "Откройте кнопку из письма о прошедшей встрече.");
    if (!r.ok || !j.ok) throw new Error(j.error || "HTTP " + r.status);
    clearDraft();
    $("view").hidden = true; $("done").hidden = false;
    $("doneT").textContent = j.test ? `Тест: отмечено ${ppl(j.n)}` : j.n ? `Сохранено: ${ppl(j.n)}` : "Сохранено: никто не отмечен";
    $("doneP").textContent = j.test ? "Это тестовая копия: в monday ничего не записано."
      : (j.other ? `Пока вы отмечали, ${j.other.byName || "кто-то ещё"} тоже сохранил(а) отметки (${fmtWhen(j.other.at)}): они сложились с вашими, ничьи не пропали. ` : "")
        + "Отметки уже в «Confirmed attendees» этой встречи в календаре событий. Если кого-то забыли или отметили лишнего, вернитесь к списку, поправьте и сохраните ещё раз.";
    window.scrollTo(0, 0); $("doneT").focus();
    if (!j.test) data.saved = { at: j.at, n: j.n, byName: data.meName };
    for (const p of people) if (p.added) { p.added = false; p.key = j.keys?.[p.email] || p.key; }
    data.people = people.map((p) => ({ ...p }));
    if (!j.test) refresh(); // список с сервера: новые карточки, слитые по почте люди
  } catch (e) {
    $("err").textContent = "Не удалось сохранить. Отметки остались на странице: проверьте интернет и нажмите «Сохранить» ещё раз.";
    $("err").classList.add("show");
  } finally {
    saving = false; $("save").disabled = false; renderPeople();
  }
});
$("back").onclick = () => { $("done").hidden = true; $("view").hidden = false; renderSaved(); window.scrollTo(0, 0); };
// кто и когда уже отмечал — видно тем, кто открывает ссылку вторым и третьим
function renderSaved() {
  const log = (data.log || []).length ? data.log : data.saved ? [data.saved] : [];
  $("savedNote").hidden = !log.length;
  if (log.length) $("savedNote").textContent = "Уже отмечали: " + log.slice(-3).map((x) => `${x.byName || "кто-то из команды"} — ${fmtWhen(x.at)}, ${ppl(x.n)}`).join("; ") + ". Галочки ниже — как сохранено сейчас: поправьте, если нужно, и сохраните.";
}

async function refresh() {
  try {
    const r = await fetch("/api/attendance?t=" + encodeURIComponent(T));
    if (!r.ok) return;
    const j = await r.json();
    data = j; people = (j.people || []).map((p) => ({ ...p })); arrange();
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
  // тестовая копия: сохранение ничего не записывает в monday
  $("testNote").hidden = !j.test;
  if (j.test) $("testNote").textContent = "Тестовая копия. «Сохранить» ничего не запишет в monday — это проверка страницы.";
  arrange(); loadDraft();
  renderSaved(); renderPeople();
  $("loading").hidden = true; $("view").hidden = false;
})();
