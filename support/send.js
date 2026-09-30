// Страница отправки письма со ссылкой на встречу: /support/send?t=<ключ>.
// Ключ приходит ведущей в письме накануне встречи (lib/meetings.mjs, promptEmail).
// GET /api/meetings?t= — встреча, ссылка, текст по умолчанию и люди с доски группы;
// POST /api/meetings — отправка: одно письмо, все выбранные в скрытой копии.
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null)); return e; };
const T = new URLSearchParams(location.search).get("t") || "";
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DRAFT_KEY = "qaravan.meeting-send." + T.slice(0, 24);
let data = null, people = [], sending = false, tried = false;
const COLL = new Intl.Collator("ru", { sensitivity: "base" });

const fmtWhen = (iso) => new Intl.DateTimeFormat("ru-RU", { timeZone: "America/New_York", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const plural = (n) => { const d = n % 10, h = n % 100; return d === 1 && h !== 11 ? "участнику" : "участникам"; };

function problem(title, text) {
  $("loading").hidden = true; $("view").hidden = true; $("done").hidden = true;
  $("problemT").textContent = title; $("problemP").textContent = text; $("problem").hidden = false;
}

// ===== черновик: правки переживают перезагрузку до отправки =====
function saveDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ link: $("link").value, dial: $("dial").value, subject: $("subject").value, text: $("text").value, people: people.map((p) => [p.email, p.name, p.checked, !!p.added]) })); } catch (e) {}
}
function loadDraft() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch (e) {}
  if (!d || typeof d !== "object") return;
  for (const k of ["link", "dial", "subject", "text"]) if (typeof d[k] === "string") $(k).value = d[k];
  if (Array.isArray(d.people)) {
    const byEmail = new Map(people.map((p) => [p.email, p]));
    for (const [email, name, checked, added] of d.people) {
      if (byEmail.has(email)) byEmail.get(email).checked = !!checked;
      else if (added && EMAIL_RX.test(email)) people.push({ email, name, checked: !!checked, added: true, sec: "added" });
    }
  }
}
const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} };

// ===== люди =====
// статус с доски Джины — как на доске, с пояснением по-русски
const ST = { New: "новая анкета", Contacted: "связались", "Intro call done": "знакомство прошло", Joined: "в группе", "Not now": "не сейчас" };
const fmtDay = (d) => new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(new Date(d.slice(0, 10) + "T12:00:00Z")).replace(/ г\.$/, "");
// в сетке — коротко: у новых анкет дата, у свёрнутых остальных — статус и дата
function meta(p, s) {
  if (s.key === "new") return p.date ? fmtDay(p.date) : "";
  if (s.key !== "old") return "";
  return [p.status ? `${p.status} — ${ST[p.status] || p.status}` : "без статуса", p.date ? fmtDay(p.date) : ""].filter(Boolean).join(", ");
}
// Список не двигается, пока ведущая ставит галочки: разделы и порядок (по имени) задаются один
// раз при загрузке (support/roster.js). Сверху — участники группы, под ними новые анкеты с
// меткой, остальные анкеты свёрнуты; добавленные вручную — в конце.
let SECTIONS = [];
function arrange() {
  const show = data.show || [];
  for (const p of people) if (!p.sec) p.sec = data.member ? (p.checked || p.status === data.member.on ? "on" : show.includes(p.status) ? "new" : "old") : (p.checked ? "on" : "old");
  const rank = { on: 0, new: 1, old: 2, added: 3 };
  people.sort((a, b) => rank[a.sec] - rank[b.sec] || (a.sec === "added" ? 0 : COLL.compare(a.name || a.email, b.name || b.email)));
  SECTIONS = data.member
    ? [{ key: "on", title: "Участники группы (Joined)" }, { key: "new", title: "Новые анкеты (New)", mark: "new" }, { key: "old", title: "Остальные анкеты", fold: true }, { key: "added", title: "Добавлены вручную" }]
    : [{ key: "on", title: "Получают письма" }, { key: "old", title: "Остальные анкеты", fold: true }, { key: "added", title: "Добавлены вручную" }];
  if (!people.some((p) => p.sec === "on")) SECTIONS.find((x) => x.key === "old").open = true; // пока никто не получает — показать всех
}
function counts() {
  const on = people.filter((p) => p.checked).length;
  $("count").textContent = `Выбрано ${on} из ${people.length}`;
  $("send").textContent = on ? `Отправить ${on} ${plural(on)}` : "Отправить";
}
function renderPeople() {
  const q = $("q").value.trim().toLowerCase();
  const shown = Roster.render($("people"), { people, sections: SECTIONS, q, meta, onToggle: () => { counts(); onChange(); } });
  if (!shown) $("people").append(el("p", { className: "empty", textContent: q ? "Никого не нашли. Проверьте написание или добавьте человека ниже." : "На доске группы пока нет анкет." }));
  counts();
}
$("q").addEventListener("input", renderPeople);
// «Выбрать всех» / «Снять всех» — только тех, кого сейчас видно (свёрнутые остальные не трогаем)
const pick = (on) => { Roster.visible(people, SECTIONS, $("q").value.trim().toLowerCase()).forEach((p) => { p.checked = on; }); renderPeople(); onChange(); };
$("all").onclick = () => pick(true);
$("none").onclick = () => pick(false);
$("addBtn").onclick = () => {
  const email = $("addEmail").value.trim().toLowerCase(), name = $("addName").value.trim();
  const bad = !EMAIL_RX.test(email);
  $("addErr").classList.toggle("show", bad);
  bad ? $("addEmail").setAttribute("aria-invalid", "true") : $("addEmail").removeAttribute("aria-invalid");
  if (bad) { $("addEmail").focus(); return; }
  const have = people.find((p) => p.email === email);
  if (have) have.checked = true; else people.push({ email, name: name || email, checked: true, added: true, sec: "added" });
  $("addName").value = ""; $("addEmail").value = ""; $("q").value = "";
  renderPeople(); onChange(); $("addName").focus();
};
$("addEmail").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("addBtn").click(); } });

// ===== как увидят участники =====
function renderPreview() {
  const box = $("preview"); box.innerHTML = "";
  for (const p of $("text").value.trim().split(/\n{2,}/)) if (p) box.append(el("p", { textContent: p }));
  const link = $("link").value.trim(), dial = $("dial").value.trim();
  box.append(el("div", { className: "block" },
    el("div", { className: "eyebrow", style: "--flag:var(--q-purple)", textContent: data.title }),
    el("div", { className: "when", textContent: data.meeting.line }),
    el("span", { className: "fake-btn", textContent: "Присоединиться к встрече" }),
    el("p", { className: "small", textContent: `Ссылка: ${link || "—"}${dial ? `\nПо телефону: ${dial}` : ""}` })));
}

// ===== проверка и отправка =====
const FIELDS = ["link", "subject", "text"];
function problems() {
  const bad = [];
  if (!/^https:\/\/[^\s]+\.[^\s]+/.test($("link").value.trim())) bad.push("link");
  if (!$("subject").value.trim()) bad.push("subject");
  if (!$("text").value.trim()) bad.push("text");
  if (!people.some((p) => p.checked)) bad.push("people");
  return bad;
}
function showErrors(bad) {
  for (const id of FIELDS) { $(id + "Err").classList.toggle("show", bad.includes(id)); bad.includes(id) ? $(id).setAttribute("aria-invalid", "true") : $(id).removeAttribute("aria-invalid"); }
  $("peopleErr").classList.toggle("show", bad.includes("people"));
}
function onChange() {
  saveDraft();
  renderPreview();
  if (tried) { const bad = problems(); showErrors(bad); if (!bad.length) $("err").classList.remove("show"); }
}
for (const id of ["link", "dial", "subject", "text"]) $(id).addEventListener("input", onChange);

$("f").addEventListener("submit", (ev) => {
  ev.preventDefault();
  tried = true;
  const bad = problems();
  showErrors(bad);
  if (bad.length) {
    $("err").textContent = "Проверьте отмеченные поля и снова нажмите «Отправить».";
    $("err").classList.add("show");
    (bad[0] === "people" ? $("q") : $(bad[0])).focus();
    return;
  }
  $("err").classList.remove("show");
  const n = people.filter((p) => p.checked).length;
  $("confirmText").textContent = `Отправить письмо ${n} ${plural(n)}? Все получат его в скрытой копии, копия придёт вам на ${data.leaderEmail}.`;
  $("send").hidden = true; $("confirm").hidden = false; $("go").focus();
});
$("cancel").onclick = () => { $("confirm").hidden = true; $("send").hidden = false; $("send").focus(); };
$("go").onclick = async () => {
  if (sending) return;
  sending = true; $("go").disabled = true; $("go").textContent = "Отправляем…";
  const known = new Set((data.people || []).map((p) => p.email));
  const body = {
    t: T, link: $("link").value.trim(), dial: $("dial").value.trim(), subject: $("subject").value.trim(), text: $("text").value,
    selected: people.filter((p) => p.checked && known.has(p.email)).map((p) => p.email),
    add: people.filter((p) => p.checked && !known.has(p.email)).map((p) => ({ name: p.name, email: p.email })),
  };
  try {
    const r = await fetch("/api/meetings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 403) return problem("Ссылка больше не работает", j.error === "expired" ? "Она работала до конца встречи. Новая придёт накануне следующей встречи." : "Откройте кнопку из последнего письма о встрече.");
    if (r.status === 400 && Array.isArray(j.fields)) { showErrors(j.fields); throw new Error("invalid"); }
    if (!r.ok || !j.ok) throw new Error(j.error || "HTTP " + r.status);
    clearDraft();
    $("view").hidden = true; $("done").hidden = false;
    $("doneT").textContent = `Отправлено ${j.sent} ${plural(j.sent)}`;
    $("doneP").textContent = `Копия пришла вам на ${data.leaderEmail}. Список и ссылка запомнились до следующей встречи.`;
    window.scrollTo(0, 0); $("doneT").focus();
    data.sent = [...(data.sent || []), { at: j.at, n: j.sent }];
    people.forEach((p) => { if (p.checked && !known.has(p.email)) { known.add(p.email); data.people.push({ email: p.email, name: p.name, checked: true }); } });
  } catch (e) {
    $("err").textContent = "Не удалось отправить письмо. Всё, что вы ввели, осталось на странице: проверьте интернет и нажмите «Отправить» ещё раз.";
    $("err").classList.add("show");
  } finally {
    sending = false; $("go").disabled = false; $("go").textContent = "Да, отправить";
    $("confirm").hidden = true; $("send").hidden = false;
  }
};
$("back").onclick = () => { $("done").hidden = true; $("view").hidden = false; renderSent(); window.scrollTo(0, 0); };

function renderSent() {
  const last = (data.sent || []).at(-1);
  $("sentNote").hidden = !last;
  if (last) $("sentNote").textContent = `Уже отправлено ${fmtWhen(last.at)}: ${last.n} ${plural(last.n)}. Можно отправить ещё раз, например если поменялась ссылка.`;
}

// ===== старт =====
(async () => {
  if (!T) return problem("Ссылка неполная", "Откройте кнопку «Проверить и отправить» из письма о встрече.");
  let r, j;
  try { r = await fetch("/api/meetings?t=" + encodeURIComponent(T)); j = await r.json(); }
  catch (e) { return problem("Страница не загрузилась", "Проверьте интернет и обновите страницу."); }
  if (!r.ok) {
    if (j.error === "expired") return problem("Ссылка больше не работает", "Она работала до конца встречи. Новая придёт накануне следующей встречи.");
    if (j.error === "gone") return problem("Встреча не найдена", "Похоже, её убрали из календаря событий. Напишите команде QARAVAN, если это ошибка.");
    if (j.error === "bad") return problem("Ссылка не работает", "Откройте кнопку «Проверить и отправить» из последнего письма о встрече.");
    return problem("Страница не загрузилась", "Попробуйте обновить страницу через минуту.");
  }
  data = j;
  people = (j.people || []).map((p) => ({ ...p }));
  document.title = `Письмо участникам: ${j.meeting.line}`;
  $("groupTitle").textContent = j.title;
  $("when").textContent = j.meeting.line;
  $("bccHint").textContent = `Все получат одно письмо в скрытой копии и не увидят адреса друг друга. Копия придёт вам на ${j.leaderEmail}, ответы участников — тоже вам. ` +
    (j.member ? "Сверху участники группы (статус Joined), под ними новые анкеты (New), остальные анкеты свёрнуты. Галочка — это статус на доске: отметите человека — он станет Joined и будет получать письма и дальше; снимете — Not now."
      : "Галочки запоминаются до следующей встречи.");
  $("cancelNote").hidden = !j.meeting.cancelled;
  $("link").value = j.link || ""; $("dial").value = j.dial || ""; $("subject").value = j.subject || ""; $("text").value = j.text || "";
  arrange(); loadDraft();
  renderSent(); renderPeople(); renderPreview();
  $("loading").hidden = true; $("view").hidden = false;
})();
