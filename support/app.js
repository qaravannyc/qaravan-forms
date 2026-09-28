// Анкеты групп поддержки QARAVAN: /support/gina (support/gina.html) и /support/simon
// (support/simon.html). Обе страницы берут этот файл; какую анкету показать, говорит
// <body data-group="…">. Вопросы и их порядок — в FORMS, все тексты на двух языках —
// в TEXTS (своё у каждой группы) и COMMON (общее). Коды ответов должны совпадать
// с lib/support-groups.mjs: там они переводятся в метки колонок на досках monday.

// ===== вопросы =====
// type: text | contact (почта и телефон) | radio | chips (несколько вариантов) | consent | textarea |
// picks (до max вариантов по популярности, первые visible видны сразу, ниже — «своими словами»).
// follow — поле, которое открывается под вариантом when и тогда обязательно.
const FORMS = {
  gina: [
    { id: "name", type: "text", req: true, max: 120, auto: "name" },
    { id: "pronouns", type: "radio", req: true, opts: ["she", "he", "they", "other"], follow: { when: "other", id: "pronouns_other", kind: "input", max: 60 } },
    { id: "contact", type: "contact" },
    { id: "in_us", type: "radio", req: true, two: true, opts: ["yes", "partly"], follow: { when: "partly", id: "in_us_note", kind: "textarea", max: 1000 } },
    { id: "regular", type: "radio", req: true, two: true, opts: ["yes", "no"] },
    { id: "immig", type: "radio", req: true, two: true, opts: ["yes", "no"] },
    { id: "intro", type: "radio", req: true, two: true, opts: ["yes", "no"] },
    { id: "rules", type: "consent", req: true },
    { id: "expect", type: "textarea", req: true, max: 4000 },
    // варианты — по популярности в старых ответах (lib/support-groups.mjs, NEEDS); видны первые visible
    { id: "needs", type: "picks", req: true, max: 3, visible: 8, text: { id: "needs_text", max: 2000 },
      opts: ["talk", "mental", "support", "friends", "growth", "work", "calm", "acceptance", "belonging", "money", "legal", "safety", "health", "love", "housing", "adaptation", "loneliness", "basics", "family"] },
    { id: "notes", type: "textarea", max: 4000 },
  ],
  simon: [
    { id: "name", type: "text", req: true, max: 120, auto: "name" },
    { id: "contact", type: "contact" },
    { id: "city", type: "text", req: true, max: 200, auto: "address-level2" },
    { id: "identities", type: "chips", exclusive: "prefer_not",
      opts: ["agender", "asexual", "bisexual", "cisgender", "demisexual", "gay_lesbian", "genderfluid", "genderqueer", "heterosexual", "nonbinary", "pansexual", "queer", "transgender", "prefer_not"] },
    { id: "format", type: "radio", opts: ["remote", "in_person", "both"] },
    { id: "question", type: "textarea", max: 4000 },
    { id: "notes", type: "textarea", max: 4000 },
  ],
};

// ===== тексты — редактируются здесь =====
// q_<id> — вопрос, h_<id> — подсказка под ним, o_<id> — варианты, p_<id> — пример в поле,
// f_<id> / fp_<id> — подпись и пример поля, которое открывается под вариантом,
// c_<id> — текст галочки, e_<id> — ошибка, если своя.
const COMMON = {
ru: {
  language_label: "Язык формы",
  optional: "·\u00a0по\u00a0желанию",
  email: "Email", phone: "Телефон",
  o_yesno: { yes: "Да", no: "Нет" },
  send: "Отправить анкету",
  sending: "Отправляем…",
  e_name: "Напишите, как вас зовут.",
  e_email: "Проверьте почту: нужен адрес в формате name@example.com.",
  e_phone: "В номере должно быть от 10 до 15 цифр. Проверьте, все ли цифры на месте.",
  e_choice: "Выберите ответ.",
  e_text: "Напишите хотя бы пару слов.",
  more: "Показать ещё {n}",
  picked: "Выбрано {n} из {max}",
  e_summary: "Проверьте отмеченные поля и снова нажмите «Отправить анкету».",
  e_net: "Не удалось отправить анкету. Ответы сохранились на этой странице: проверьте интернет и снова нажмите «Отправить анкету».",
  thanks_t: "Спасибо, {name}!",
  thanks_t0: "Спасибо!",
  tg_p: "Пока ждёте, присоединяйтесь к RUSA Connects — нашему сообществу в Telegram.",
  tg_btn: "Открыть RUSA Connects",
},
en: {
  language_label: "Form language",
  optional: "·\u00a0optional",
  email: "Email", phone: "Phone",
  o_yesno: { yes: "Yes", no: "No" },
  send: "Send",
  sending: "Sending…",
  e_name: "Tell us your name.",
  e_email: "Check the email address: use a format such as name@example.com.",
  e_phone: "The phone number needs 10 to 15 digits. Check for missing or extra digits.",
  e_choice: "Pick an answer.",
  e_text: "Write at least a few words.",
  more: "Show {n} more",
  picked: "{n} of {max} picked",
  e_summary: "Check the highlighted fields and select “Send” again.",
  e_net: "We couldn’t send your form. Your answers are still on this page: check your connection and select “Send” again.",
  thanks_t: "Thank you, {name}!",
  thanks_t0: "Thank you!",
  tg_p: "While you wait, join RUSA Connects, our community on Telegram.",
  tg_btn: "Open RUSA Connects",
}};

const RULES_RU = "Правила простые: то, что сказано в группе, остаётся в группе; никто не обязан рассказывать больше, чем хочет, можно просто слушать.";
const RULES_EN = "The rules are simple: what’s said in the group stays in the group, nobody has to share more than they want to, and it’s fine to just listen.";

const TEXTS = {
gina: {
  ru: {
    title: "Группа поддержки с Джиной",
    eyebrow: "Группа поддержки",
    intro: ["Раз в неделю мы встречаемся в Zoom и говорим о жизни здесь, какая она есть: ожидание документов, поиск работы и жилья, семья на расстоянии, одиночество в большом городе. Это постоянная группа для русскоязычных ЛГБТК+ людей, которые живут в США. Ведёт группу Джина."],
    second: "A weekly Zoom support group for Russian-speaking LGBTQ+ people in the US, led by Gina.",
    note: RULES_RU,
    steps: "Заполните анкету: мы свяжемся с вами, договоримся о коротком знакомстве с Джиной в Zoom и пришлём ссылку на встречу.",
    q_name: "Как вас зовут?", h_name: "Имя и фамилия",
    q_pronouns: "Какие местоимения вы используете?", h_pronouns: "Так к вам будут обращаться в группе.",
    o_pronouns: { she: "Она/её", he: "Он/его", they: "Они/их", other: "Другие" },
    f_pronouns: "Напишите свои местоимения", e_pronouns_other: "Напишите, какие местоимения вы используете.",
    q_contact: "Как с вами связаться", h_contact: "Звоним мы редко, но номер телефона нам нужен.",
    q_in_us: "Группа — для русскоязычных ЛГБТК+ людей, которые живут в США. Это про вас?",
    o_in_us: { yes: "Да", partly: "Не совсем" },
    f_in_us: "Расскажите подробнее", fp_in_us: "Например: пока живу в другой стране", e_in_us_note: "Расскажите подробнее, чтобы мы поняли, подойдёт ли вам группа.",
    q_regular: "Получится приходить на встречи регулярно?",
    q_immig: "Вам интересно узнать, как иммиграция влияет на психическое здоровье?",
    q_intro: "Найдёте 15 минут на знакомство с Джиной в Zoom до первой встречи?",
    q_rules: "Правила группы", h_rules: "Мы бережём комфорт и приватность каждого участника.",
    c_rules: "Обещаю соблюдать правила группы и конфиденциальность: то, что сказано в группе, остаётся в группе.",
    e_rules: "Отметьте, что согласны с правилами: без этого участвовать в группе нельзя.",
    q_expect: "Чего вы ждёте от группы?",
    q_needs: "Что вам сейчас нужнее всего?", h_needs: "Выберите до трёх. Сверху — то, что участники группы называют чаще всего.",
    o_needs: {
      talk: "Общение", mental: "Психологическая помощь", support: "Поддержка и понимание", friends: "Друзья и новые знакомства",
      growth: "Развитие и учёба", work: "Работа", calm: "Спокойствие, меньше тревоги", acceptance: "Принять себя и быть собой",
      belonging: "Свои люди, сообщество", money: "Деньги, стабильный доход", legal: "Документы и легализация", safety: "Безопасность",
      health: "Здоровье", love: "Отношения и любовь", housing: "Жильё", adaptation: "Адаптация на новом месте",
      loneliness: "Не чувствовать себя одиноко", basics: "Еда и самое необходимое", family: "Отношения с семьёй",
    },
    t_needs: "Или своими словами", e_needs: "Выберите хотя бы один вариант или напишите своими словами.",
    q_notes: "Что ещё нам важно знать?",
    thanks_p: "Анкета у нас, мы скоро с вами свяжемся.",
  },
  en: {
    title: "Support Group with Gina",
    eyebrow: "Support group",
    intro: ["Once a week we meet on Zoom to talk about life here as it actually is: waiting on paperwork, looking for work and housing, family far away, feeling alone in a big city. It’s an ongoing group for Russian-speaking LGBTQ+ people living in the US. Gina leads the group."],
    note: RULES_EN,
    steps: "Fill in the form: we’ll get in touch, set up a short Zoom intro with Gina and send you the meeting link.",
    q_name: "What’s your name?", h_name: "First and last name",
    q_pronouns: "What are your pronouns?", h_pronouns: "So the group addresses you the right way.",
    o_pronouns: { she: "She/her", he: "He/him", they: "They/them", other: "Other" },
    f_pronouns: "Write your pronouns", e_pronouns_other: "Tell us your pronouns.",
    q_contact: "How can we reach you?", h_contact: "We rarely call, but we need a phone number.",
    q_in_us: "The group is for Russian-speaking LGBTQ+ people who live in the US. Is that you?",
    o_in_us: { yes: "Yes", partly: "Not exactly" },
    f_in_us: "Tell us more", fp_in_us: "For example: I live in another country for now", e_in_us_note: "Tell us more so we can see whether the group is right for you.",
    q_regular: "Can you come to meetings regularly?",
    q_immig: "Would you like to learn how immigration affects mental health?",
    q_intro: "Can you find 15 minutes for a Zoom intro with Gina before your first meeting?",
    q_rules: "Group rules", h_rules: "We look after every member’s comfort and privacy.",
    c_rules: "I promise to follow the group rules and keep confidentiality: what’s said in the group stays in the group.",
    e_rules: "Tick the box to agree to the rules: you can’t join the group without it.",
    q_expect: "What do you hope to get from the group?",
    q_needs: "What do you need most right now?", h_needs: "Pick up to three. The top ones are what group members name most often.",
    o_needs: {
      talk: "Talking with people", mental: "Psychological help", support: "Support and understanding", friends: "Friends and new people",
      growth: "Growth and learning", work: "Work", calm: "Calm, less anxiety", acceptance: "Accepting and being myself",
      belonging: "My people, community", money: "Money, steady income", legal: "Papers and legal status", safety: "Safety",
      health: "Health", love: "Relationships and love", housing: "Housing", adaptation: "Settling in somewhere new",
      loneliness: "Feeling less alone", basics: "Food and basic needs", family: "Relationships with family",
    },
    t_needs: "Or in your own words", e_needs: "Pick at least one option or write it in your own words.",
    q_notes: "Anything else we should know?",
    thanks_p: "We’ve got your form and will be in touch soon.",
  },
},
simon: {
  ru: {
    title: "Группа равной поддержки с Саймоном",
    eyebrow: "Равная поддержка",
    intro: [
      "Встречаемся онлайн и говорим на равных: делимся тем, что происходит в жизни, полезными ресурсами и опытом адаптации на новом месте, слушаем и поддерживаем друг друга.",
      "Группу ведёт Саймон — транс-мужчина и волонтёр с опытом равного консультирования с 2008 года. Сейчас он также консультирует транс-людей в «Выходе».",
    ],
    second: "An online peer support group led by Simon.",
    note: RULES_RU,
    steps: "Заполните анкету, и мы пришлём информацию о ближайших встречах.",
    q_name: "Как вас зовут?", h_name: "Имя и фамилия латиницей",
    q_contact: "Как с вами связаться", h_contact: "Сюда пришлём информацию о встречах.",
    q_city: "Где вы живёте?", h_city: "Город и штат", p_city: "Например, Brooklyn, NY", e_city: "Напишите город и штат.",
    q_identities: "Как вы себя определяете?", h_identities: "Ориентация и гендерная идентичность. Можно выбрать несколько.",
    o_identities: {
      agender: "Агендер", asexual: "Асексуал(ка)", bisexual: "Бисексуал(ка)", cisgender: "Цисгендер", demisexual: "Демисексуал(ка)",
      gay_lesbian: "Гей / лесбиянка", genderfluid: "Гендерфлюид", genderqueer: "Гендерквир", heterosexual: "Гетеросексуал(ка)",
      nonbinary: "Небинарный человек", pansexual: "Пансексуал(ка)", queer: "Квир", transgender: "Транс-персона", prefer_not: "Предпочитаю не отвечать",
    },
    q_format: "Как вам удобнее встречаться?",
    o_format: { remote: "Только онлайн", in_person: "Только вживую", both: "Подходит и так, и так" },
    q_question: "Какой вопрос вы хотели бы задать на группе?",
    q_notes: "Чем ещё хотите поделиться?",
    thanks_p: "Анкета у нас. Скоро пришлём информацию о ближайших встречах.",
  },
  en: {
    title: "Peer Support Group with Simon",
    eyebrow: "Peer support",
    intro: [
      "We meet online and talk as equals: we share what’s going on in our lives, useful resources and what we’ve learned settling in somewhere new, and we listen to and support each other.",
      "Simon leads the group. He’s a trans man and a volunteer who has done peer counseling since 2008, and he also counsels trans people at Coming Out (Vykhod).",
    ],
    note: RULES_EN,
    steps: "Fill in the form and we’ll send you details of upcoming meetings.",
    q_name: "What’s your name?", h_name: "First and last name, in Latin letters",
    q_contact: "How can we reach you?", h_contact: "We’ll send meeting details here.",
    q_city: "Where do you live?", h_city: "City and state", p_city: "For example, Brooklyn, NY", e_city: "Tell us your city and state.",
    q_identities: "How do you identify?", h_identities: "Sexual orientation and gender identity. Pick all that apply.",
    o_identities: {
      agender: "Agender", asexual: "Asexual", bisexual: "Bisexual", cisgender: "Cisgender", demisexual: "Demisexual",
      gay_lesbian: "Gay / Lesbian", genderfluid: "Genderfluid", genderqueer: "Genderqueer", heterosexual: "Heterosexual",
      nonbinary: "Nonbinary", pansexual: "Pansexual", queer: "Queer", transgender: "Transgender", prefer_not: "Prefer not to say",
    },
    q_format: "How would you prefer to meet?",
    o_format: { remote: "Online only", in_person: "In person only", both: "Either works" },
    q_question: "What question would you like to raise in the group?",
    q_notes: "Anything else you’d like to share?",
    thanks_p: "We’ve got your form and will send you details of upcoming meetings soon.",
  },
}};

// ===== состояние =====
const $ = (id) => document.getElementById(id);
const GROUP = document.body.dataset.group;
const FIELDS = FORMS[GROUP];
const DRAFT_KEY = `qaravan.support.${GROUP}.v1`;
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const params = new URLSearchParams(location.search);
let lang = "ru", sending = false, tried = false;
const opened = new Set(); // списки «Показать ещё», которые уже раскрыли
const A = {}; // ответы: текст — строкой, выбор — кодом, несколько вариантов — массивом, галочка — true/false
const T = (k) => TEXTS[GROUP][lang][k] ?? COMMON[lang][k];
const optsOf = (f) => T("o_" + f.id) || T("o_yesno");
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null)); return e; };
const star = () => { const s = el("span", { className: "req", textContent: "*" }); s.setAttribute("aria-hidden", "true"); return s; };

// ===== черновик: всё, что человек ввёл, переживает перезагрузку страницы =====
function saveDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ lang, A })); } catch (e) {}
}
function loadDraft() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch (e) {}
  if (!d || typeof d !== "object" || !d.A || typeof d.A !== "object") return;
  for (const [k, v] of Object.entries(d.A)) if (typeof v === "string" || typeof v === "boolean" || Array.isArray(v)) A[k] = v;
  if (d.lang === "en" || d.lang === "ru") lang = d.lang;
}
function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} }

// ===== рендер =====
function legend(f, labelFor) {
  const q = labelFor ? el("label", { htmlFor: labelFor, textContent: T("q_" + f.id) }) : el("span", { textContent: T("q_" + f.id) });
  // у «Как с вами связаться» звёздочки стоят у самих полей
  const mark = f.type === "contact" ? null : f.req ? star() : el("span", { className: "opt", textContent: T("optional") });
  const hint = T("h_" + f.id) ? el("span", { className: "hint", textContent: T("h_" + f.id) }) : null;
  return el("legend", { id: f.id + "Q" }, q, mark && " ", mark, hint);
}
function errorLine(id, text) { return el("p", { className: "field-hint", id: id + "Err", textContent: text }); }

function textInput(id, max, { auto, type = "text", ph, area } = {}) {
  const i = el(area ? "textarea" : "input", { id, maxLength: max, value: A[id] || "" });
  if (!area) i.type = type;
  if (auto) i.autocomplete = auto;
  if (ph) i.placeholder = ph;
  if (type === "email") { i.inputMode = "email"; i.autocapitalize = "off"; i.spellcheck = false; }
  if (type === "tel") i.inputMode = "tel";
  i.setAttribute("aria-describedby", id + "Err");
  i.addEventListener("input", () => { A[id] = i.value; onChange(); });
  return i;
}

function renderField(f) {
  const fs = el("fieldset", { id: f.id + "Set" });
  if (f.type === "text" || f.type === "textarea") {
    const i = textInput(f.id, f.max, { auto: f.auto, ph: T("p_" + f.id), area: f.type === "textarea" });
    if (f.req) i.setAttribute("aria-required", "true");
    fs.append(legend(f, f.id), el("div", { className: "field" }, i, errorLine(f.id, T("e_" + f.id) || (f.type === "textarea" ? T("e_text") : T("e_choice")))));
  } else if (f.type === "contact") {
    const email = textInput("email", 200, { auto: "email", type: "email", ph: "name@example.com" });
    const phone = textInput("phone", 40, { auto: "tel", type: "tel", ph: "+1 212 555 0123" });
    for (const i of [email, phone]) i.setAttribute("aria-required", "true");
    fs.append(legend(f),
      el("div", { className: "field" }, el("label", { className: "lbl", htmlFor: "email" }, T("email") + " ", star()), email, errorLine("email", T("e_email"))),
      el("div", { className: "field" }, el("label", { className: "lbl", htmlFor: "phone" }, T("phone") + " ", star()), phone, errorLine("phone", T("e_phone"))));
  } else if (f.type === "radio") {
    const wrap = el("div", { className: "opts" + (f.two ? " two" : ""), id: f.id, role: "radiogroup" });
    wrap.setAttribute("aria-labelledby", f.id + "Q");
    wrap.setAttribute("aria-describedby", f.id + "Err");
    if (f.req) wrap.setAttribute("aria-required", "true");
    const labels = optsOf(f);
    let follow = null;
    if (f.follow) {
      const fo = f.follow;
      const input = textInput(fo.id, fo.max, { ph: T("fp_" + f.id), area: fo.kind === "textarea" });
      input.setAttribute("aria-required", "true");
      follow = el("div", { className: "follow field", id: fo.id + "Wrap", hidden: A[f.id] !== fo.when },
        el("label", { className: "lbl", htmlFor: fo.id, textContent: T("f_" + f.id) }), input, errorLine(fo.id, T("e_" + fo.id)));
    }
    for (const code of f.opts) {
      const i = el("input", { type: "radio", name: f.id, value: code, checked: A[f.id] === code });
      i.onchange = () => {
        A[f.id] = code;
        if (follow) { follow.hidden = code !== f.follow.when; if (!follow.hidden) follow.querySelector("input,textarea").focus(); }
        onChange();
      };
      wrap.append(el("label", {}, i, el("span", { textContent: labels[code] })));
    }
    fs.append(legend(f), wrap, errorLine(f.id, T("e_choice")));
    if (follow) fs.append(follow);
  } else if (f.type === "chips") {
    const wrap = el("div", { className: "chips", id: f.id, role: "group" });
    wrap.setAttribute("aria-labelledby", f.id + "Q");
    const labels = optsOf(f);
    const chosen = new Set(Array.isArray(A[f.id]) ? A[f.id] : []);
    // по алфавиту на языке формы; «предпочитаю не отвечать» — всегда последним
    const order = [...f.opts].sort((a, b) => (a === f.exclusive) - (b === f.exclusive) || labels[a].localeCompare(labels[b], lang));
    const buttons = {};
    const sync = () => { for (const [code, b] of Object.entries(buttons)) b.setAttribute("aria-pressed", chosen.has(code) ? "true" : "false"); };
    for (const code of order) {
      const b = el("button", { type: "button", textContent: labels[code] });
      b.onclick = () => {
        if (chosen.has(code)) chosen.delete(code);
        else {
          if (code === f.exclusive) chosen.clear(); else chosen.delete(f.exclusive);
          chosen.add(code);
        }
        A[f.id] = f.opts.filter((c) => chosen.has(c));
        sync(); onChange();
      };
      buttons[code] = b; wrap.append(b);
    }
    sync();
    fs.append(legend(f), wrap);
  } else if (f.type === "picks") {
    const wrap = el("div", { className: "chips", id: f.id, role: "group" });
    wrap.setAttribute("aria-labelledby", f.id + "Q");
    wrap.setAttribute("aria-describedby", f.id + "Count " + f.id + "Err");
    const labels = optsOf(f);
    const chosen = new Set(Array.isArray(A[f.id]) ? A[f.id].filter((c) => f.opts.includes(c)).slice(0, f.max) : []);
    // раскрыт ли список: уже раскрывали или выбран вариант из скрытой части (черновик)
    if (f.opts.slice(f.visible).some((c) => chosen.has(c))) opened.add(f.id);
    const count = el("p", { className: "pick-count", id: f.id + "Count" });
    count.setAttribute("aria-live", "polite");
    const buttons = {};
    const sync = () => {
      const full = chosen.size >= f.max;
      for (const [code, b] of Object.entries(buttons)) {
        b.setAttribute("aria-pressed", chosen.has(code) ? "true" : "false");
        if (full && !chosen.has(code)) b.setAttribute("aria-disabled", "true"); else b.removeAttribute("aria-disabled");
      }
      count.textContent = T("picked").replace("{n}", chosen.size).replace("{max}", f.max);
    };
    f.opts.forEach((code, i) => {
      const b = el("button", { type: "button", textContent: labels[code], hidden: i >= f.visible && !opened.has(f.id) });
      b.onclick = () => {
        if (chosen.has(code)) chosen.delete(code);
        else if (chosen.size < f.max) chosen.add(code);
        else return; // уже выбрано max — сначала снимите один из выбранных
        A[f.id] = f.opts.filter((c) => chosen.has(c));
        sync(); onChange();
      };
      buttons[code] = b; wrap.append(b);
    });
    const rest = f.opts.length - f.visible;
    const more = el("button", { type: "button", className: "na-link more", textContent: T("more").replace("{n}", rest), hidden: opened.has(f.id) || rest <= 0 });
    more.setAttribute("aria-controls", f.id);
    more.onclick = () => {
      opened.add(f.id);
      for (const b of Object.values(buttons)) b.hidden = false;
      more.hidden = true;
      buttons[f.opts[f.visible]].focus();
    };
    sync();
    const t = f.text;
    fs.append(legend(f), wrap, more, count, errorLine(f.id, T("e_" + f.id)),
      el("div", { className: "field own-field" }, el("label", { className: "lbl", htmlFor: t.id }, T("t_" + f.id) + " ", el("span", { className: "opt", textContent: T("optional") })), textInput(t.id, t.max, { area: true })));
  } else if (f.type === "consent") {
    const i = el("input", { type: "checkbox", id: f.id, checked: A[f.id] === true });
    i.setAttribute("aria-describedby", f.id + "Err");
    i.setAttribute("aria-required", "true");
    i.onchange = () => { A[f.id] = i.checked; onChange(); };
    fs.append(legend(f), el("div", { className: "opts consent", id: f.id + "Box" }, el("label", {}, i, el("span", { textContent: T("c_" + f.id) }))), errorLine(f.id, T("e_" + f.id)));
  }
  return fs;
}

function render() {
  document.documentElement.lang = lang;
  document.title = T("title");
  $("btnRu").setAttribute("aria-pressed", lang === "ru" ? "true" : "false");
  $("btnEn").setAttribute("aria-pressed", lang === "en" ? "true" : "false");
  $("langSwitch").setAttribute("aria-label", T("language_label"));
  $("eyebrow").textContent = T("eyebrow");
  $("title").textContent = T("title");
  $("intro").replaceChildren(...T("intro").map((p) => el("p", { className: "intro", textContent: p })));
  $("second").textContent = TEXTS[GROUP].ru.second;
  $("second").hidden = lang !== "ru";
  $("note").textContent = T("note");
  $("steps").textContent = T("steps");
  $("fields").replaceChildren(...FIELDS.map(renderField));
  $("send").textContent = sending ? T("sending") : T("send");
  $("tgP").textContent = T("tg_p");
  $("tgBtn").textContent = T("tg_btn");
  if (tried) validate(false);
}
function setLang(l) { lang = l; render(); saveDraft(); }
$("btnRu").onclick = () => setLang("ru");
$("btnEn").onclick = () => setLang("en");

// ===== проверка =====
const filled = (id) => typeof A[id] === "string" && A[id].trim() !== "";
const digits = (s) => String(s || "").replace(/\D/g, "").length;
function problems() {
  const bad = [];
  for (const f of FIELDS) {
    if (f.type === "contact") {
      if (!EMAIL_RX.test((A.email || "").trim())) bad.push("email");
      const d = digits(A.phone);
      if (d < 10 || d > 15) bad.push("phone");
    } else if (f.type === "text" || f.type === "textarea") {
      if (f.req && !filled(f.id)) bad.push(f.id);
    } else if (f.type === "radio") {
      if (f.req && !f.opts.includes(A[f.id])) bad.push(f.id);
      else if (f.follow && A[f.id] === f.follow.when && !filled(f.follow.id)) bad.push(f.follow.id);
    } else if (f.type === "consent") {
      if (f.req && A[f.id] !== true) bad.push(f.id);
    } else if (f.type === "picks") {
      if (f.req && !(Array.isArray(A[f.id]) && A[f.id].length) && !filled(f.text.id)) bad.push(f.id);
    }
  }
  return bad;
}
// Все поля, у которых может быть ошибка: id поля ввода или группы вариантов.
function errorIds() {
  const ids = [];
  for (const f of FIELDS) {
    if (f.type === "contact") ids.push("email", "phone");
    else if (f.type !== "chips") ids.push(f.id);
    if (f.follow) ids.push(f.follow.id);
  }
  return ids;
}
function showErrors(bad) {
  for (const id of errorIds()) {
    const isBad = bad.includes(id);
    $(id + "Err")?.classList.toggle("show", isBad);
    const target = $(id);
    if (!target) continue;
    if (target.matches("input[type=checkbox]")) $(id + "Box").classList.toggle("bad-group", isBad);
    else if (target.matches("input,textarea")) isBad ? target.setAttribute("aria-invalid", "true") : target.removeAttribute("aria-invalid");
    else target.classList.toggle("bad-group", isBad);
  }
}
function validate(focus) {
  const bad = problems();
  showErrors(bad);
  if (focus && bad.length) focusField(bad[0]);
  return bad.length === 0;
}
function focusField(id) {
  const t = $(id);
  if (!t) return;
  const target = t.matches("input,textarea") ? t : t.querySelector("input,button");
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.focus({ preventScroll: true });
}
function onChange() {
  saveDraft();
  if (tried && validate(false)) $("err").classList.remove("show");
}

// ===== отправка =====
function body() {
  const b = { website: $("website").value, group: GROUP, lang, name: A.name || "", email: A.email || "", phone: A.phone || "" };
  for (const f of FIELDS) {
    if (f.type === "contact" || f.id === "name") continue;
    b[f.id] = f.type === "chips" || f.type === "picks" ? (A[f.id] || []) : f.type === "consent" ? A[f.id] === true : (A[f.id] || "");
    if (f.text) b[f.text.id] = A[f.text.id] || "";
    if (f.follow) b[f.follow.id] = A[f.follow.id] || "";
  }
  return b;
}
$("f").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (sending) return;
  tried = true;
  const err = $("err");
  if (!validate(true)) { err.textContent = T("e_summary"); err.classList.add("show"); return; }
  err.classList.remove("show");
  sending = true;
  const btn = $("send"); btn.disabled = true; btn.textContent = T("sending");
  try {
    const r = await fetch("/api/support-groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body()) });
    const j = await r.json().catch(() => ({}));
    // сервер проверяет те же поля; если он что-то отклонил — показываем, что именно
    if (r.status === 400 && Array.isArray(j.fields) && j.fields.length) {
      const known = j.fields.filter((id) => errorIds().includes(id));
      showErrors(known);
      if (known.length) focusField(known[0]);
      err.textContent = T("e_summary"); err.classList.add("show");
      return;
    }
    if (!r.ok || !j.ok) throw new Error(j.error || "HTTP " + r.status);
    const first = (A.name || "").trim().split(/\s+/)[0];
    $("thanksT").textContent = first ? T("thanks_t").replace("{name}", first) : T("thanks_t0");
    $("thanksP").textContent = T("thanks_p");
    clearDraft();
    $("formView").hidden = true;
    $("thanks").classList.add("show");
    window.scrollTo(0, 0);
    $("thanksT").focus();
  } catch (e) {
    err.textContent = T("e_net"); err.classList.add("show");
  } finally {
    sending = false; btn.disabled = false; btn.textContent = T("send");
  }
});

// ===== старт =====
loadDraft();
if (params.get("lang") === "en" || params.get("lang") === "ru") lang = params.get("lang");
render();
requestAnimationFrame(() => $("hero").classList.add("on"));
