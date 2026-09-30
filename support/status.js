// Страница «Статус анкеты»: /support/status?t=<ключ>. Ключ — в кнопке «Изменить статус» из
// письма команде о новой анкете (lib/support-mail.mjs); сервер — lib/status.mjs.
// GET /api/status?t= — имя, почта, дата анкеты, текущий статус и все статусы колонки на доске.
// POST /api/status { t, status } — записать выбранный статус в monday.
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null)); return e; };
const T = new URLSearchParams(location.search).get("t") || "";
let data = null, saving = false;

function problem(title, text) {
  $("loading").hidden = true; $("view").hidden = true; $("done").hidden = true;
  $("problemT").textContent = title; $("problemP").textContent = text; $("problem").hidden = false;
}
const fmtDate = (d) => d ? new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(new Date(d + "T12:00:00Z")) : "";

function render() {
  const wrap = $("opts"); wrap.innerHTML = "";
  for (const o of data.options) {
    const i = el("input", { type: "radio", name: "status", value: o.label, checked: o.label === data.status });
    const now = o.label === data.status ? el("span", { className: "now", textContent: "сейчас" }) : null;
    wrap.append(el("label", {}, i, el("span", {}, el("span", { className: "st" }, o.label, now), o.hint ? el("span", { className: "ht", textContent: o.hint }) : null)));
  }
}

$("f").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (saving) return;
  const pick = document.querySelector('input[name="status"]:checked')?.value;
  $("err").classList.remove("show");
  if (!pick) { $("err").textContent = "Выберите статус."; $("err").classList.add("show"); return; }
  saving = true; $("save").disabled = true; $("save").textContent = "Сохраняем…";
  try {
    const r = await fetch("/api/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t: T, status: pick }) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 403) return problem("Ссылка больше не работает", "Поменяйте статус прямо на доске группы в monday.");
    if (!r.ok || !j.ok) throw new Error(j.error || "HTTP " + r.status);
    data.status = j.label;
    $("view").hidden = true; $("done").hidden = false;
    $("doneT").textContent = j.changed ? `Статус: ${j.label}` : `Статус не изменился: ${j.label}`;
    const hint = data.options.find((o) => o.label === j.label)?.hint;
    $("doneP").textContent = (j.changed ? `Записали в monday: было ${j.was || "без статуса"}, стало ${j.label}.` : "В monday уже стоял этот статус.") + (hint ? ` ${hint}.` : "");
    window.scrollTo(0, 0); $("doneT").focus();
  } catch (e) {
    $("err").textContent = "Не удалось сохранить. Проверьте интернет и нажмите «Сохранить статус» ещё раз.";
    $("err").classList.add("show");
  } finally {
    saving = false; $("save").disabled = false; $("save").textContent = "Сохранить статус";
  }
});
$("back").onclick = () => { $("done").hidden = true; $("view").hidden = false; render(); window.scrollTo(0, 0); };

(async () => {
  if (!T) return problem("Ссылка неполная", "Откройте кнопку «Изменить статус» из письма о новой анкете.");
  let r, j;
  try { r = await fetch("/api/status?t=" + encodeURIComponent(T)); j = await r.json(); }
  catch (e) { return problem("Страница не загрузилась", "Проверьте интернет и обновите страницу."); }
  if (!r.ok) {
    if (j.error === "expired") return problem("Ссылка больше не работает", "Она работает год после анкеты. Поменяйте статус прямо на доске группы в monday.");
    if (j.error === "gone") return problem("Анкета не найдена", "Похоже, её удалили с доски группы в monday.");
    if (j.error === "bad") return problem("Ссылка не работает", "Откройте кнопку «Изменить статус» из письма о новой анкете.");
    return problem("Страница не загрузилась", "Попробуйте обновить страницу через минуту.");
  }
  data = j;
  document.title = `Статус: ${j.name}`;
  $("groupTitle").textContent = j.title;
  $("name").textContent = j.name;
  $("who").textContent = [j.email, j.date ? `анкета от ${fmtDate(j.date)}` : ""].filter(Boolean).join(", ");
  $("mlink").href = j.url;
  render();
  $("loading").hidden = true; $("view").hidden = false;
})();
