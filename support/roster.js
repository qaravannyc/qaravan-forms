// Компактный список людей с галочками — общий для страниц ведущей: отправка ссылки на встречу
// (/support/send, send.js) и «Кто пришёл» (/support/attendance, attendance.js).
//  • Сетка в несколько колонок (стили .roster в support.css): участники группы видны почти
//    на одном экране; на телефоне в этих разделах — только имена (почта — в поиске).
//  • Разделы и порядок задаёт страница при загрузке; галочка человека никуда не переносит и
//    список не перерисовывает — меняется только счётчик (onToggle).
//  • Раздел с fold: true свёрнут (<details>), пока его не откроют сами или пока поиск не
//    найдёт в нём кого-то; открытость запоминается на объекте раздела.
//  • Раздел с mark: "new" — новые анкеты: оранжевая метка у каждой ячейки и у заголовка.
(function () {
  const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null && k !== "")); return e; };
  const hit = (p, q) => !q || (p.name || "").toLowerCase().includes(q) || (p.email || "").includes(q);

  function cell(p, s, q, onToggle, meta) {
    const i = el("input", { type: "checkbox", checked: !!p.checked });
    i.onchange = () => { p.checked = i.checked; onToggle(p); };
    const m = meta ? meta(p, s) : "";
    const name = p.name || p.email;
    return el("label", { className: "rp" + (s.mark ? " rp-" + s.mark : ""), hidden: !hit(p, q), title: [name, p.email, m].filter(Boolean).join("\n") }, i,
      el("span", { className: "rp-t" },
        el("span", { className: "rp-n", textContent: name }),
        p.email && p.email !== name ? el("span", { className: "rp-e", textContent: p.email }) : null,
        m ? el("span", { className: "rp-m", textContent: m }) : null));
  }

  // sections: [{ key, title, fold?, mark?, open? }]; у людей — p.sec (ключ раздела).
  // Возвращает, сколько людей видно по поиску (во всех разделах, и в свёрнутых тоже).
  function render(wrap, { people, sections, q = "", onToggle, meta }) {
    wrap.innerHTML = "";
    let shown = 0;
    for (const s of sections) {
      const list = people.filter((p) => p.sec === s.key);
      if (!list.length) continue;
      const hits = list.filter((p) => hit(p, q)).length;
      shown += hits;
      // в свёрнутом разделе — всегда с почтой; в остальных на телефоне почта прячется (support.css)
      const grid = el("div", { className: "roster" + (s.fold ? " roster-full" : "") }, ...list.map((p) => cell(p, s, q, onToggle, meta)));
      const title = `${s.title} (${list.length})`;
      if (s.fold) {
        const d = el("details", { className: "fold", open: !!s.open || (!!q && hits > 0) }, el("summary", { textContent: title }), grid);
        d.ontoggle = () => { if (!q) s.open = d.open; };
        wrap.append(d);
      } else {
        wrap.append(el("h3", { className: s.mark ? "rp-h-" + s.mark : "", textContent: title }), grid);
      }
    }
    return shown;
  }
  // кого видно сейчас: не скрыт поиском и не в свёрнутом разделе — для «Выбрать всех» / «Снять всех»
  function visible(people, sections, q = "") {
    const open = new Set(sections.filter((s) => !s.fold || s.open || (q && people.some((p) => p.sec === s.key && hit(p, q)))).map((s) => s.key));
    return people.filter((p) => open.has(p.sec) && hit(p, q));
  }
  window.Roster = { render, visible, hit };
})();
