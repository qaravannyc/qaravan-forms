// POST /api/survey — опрос потребностей сообщества 2026 (survey/index.html).
// Два режима в одном теле запроса: mode "draft" — автосохранение по ходу
// заполнения, mode "submit" — финальная отправка. Каждый респондент — одна
// строка на доске Community Needs Survey 2026: браузер выдаёт себе случайный
// response id, автосейв создаёт строку в группе In progress и дальше только
// обновляет её; submit переставляет строку в группу Submitted и пишет апдейт
// с полным текстом ответов по-русски.
// Клиент шлёт короткие коды ответов; здесь они переводятся в английские метки
// колонок (правило репозитория: структура доски — по-английски, содержимое —
// можно по-русски). Коды и соответствия задокументированы в survey/CODEBOOK.md
// и должны совпадать с конфигом Q в survey/index.html.
const MONDAY = "https://api.monday.com/v2";
const SURVEY_BOARD = "18426996689";
const GROUP_IN_PROGRESS = "group_mm6bbh6g";
const GROUP_SUBMITTED = "group_mm6bvfyd";

// Survey Translation Reports — сообщения «в переводе ошибка» с не-RU/EN версий.
// Репорты анонимны и НЕ связаны с ответами на опрос (rid не передаётся).
const REPORTS_BOARD = "18427148568";
const REPORTS_GROUP = "topics";
const R = {
  status: "color_mm6b6cgg",   // New | Fixed | Dismissed
  lang: "color_mm6bwwbj",     // UK | KA | UZ | KK | RU | EN
  section: "numeric_mm6bfwcc",
  text: "long_text_mm6bk0hd",
  date: "date_mm6b3bv6",
};

// Community Needs Survey 2026 — column map
const C = {
  status: "color_mm6b34af",        // In progress | Submitted
  progress: "numeric_mm6bsfb",     // Progress %
  lastSection: "numeric_mm6b9egg", // Last section (0–5)
  minutes: "numeric_mm6b61za",     // Minutes spent
  submittedAt: "date_mm6b4r3g",
  q1: "color_mm6bz069",
  q2: "dropdown_mm6b42c4",
  q3: "dropdown_mm6bkhyj",
  q4: "color_mm6b5g53",
  q5: "dropdown_mm6bxcy9",
  q6: "dropdown_mm6br0av",
  q7: "color_mm6b78ye",
  q8: "color_mm6bzsta",
  q9: "color_mm6b83kb",
  q10: "color_mm6begyf",
  q11: "color_mm6br7mf",
  q12: "color_mm6b5qth",
  q13: "dropdown_mm6b7ns3",
  q14: "color_mm6bj5zv",
  q15: "long_text_mm6bap4q",
  q16: "dropdown_mm6bz1jc",
  q17: "color_mm6bbmk5",
  q17n: "numeric_mm6bdveh",
  q18: "color_mm6bwchy",
  q19: "dropdown_mm6bfsb4",
  q20: "color_mm6btcm",
  q21: "dropdown_mm6bfa0y",
  q22: "dropdown_mm6b2ynx",
  q23: "color_mm6b6jtv",
  q23n: "numeric_mm6bcwwv",
  q24: "long_text_mm6be0fm",
  others: "long_text_mm6bzt03",    // Other answers (verbatim)
  lang: "color_mm6b61m9",          // Language (RU | EN)
  rid: "text_mm6bqa0w",            // ⚙️ Response id
  raw: "long_text_mm6bxg7f",       // ⚙️ Raw answers (JSON)
};

// Код ответа → метка на доске. Метки должны СИМВОЛ В СИМВОЛ совпадать с
// настройками колонок (включая длинные тире и «…»), иначе monday наплодит
// дубликаты меток и сломает аналитику.
const L = {
  q1: { friends: "Friends or acquaintances", telegram: "Telegram", social: "Social media", bbpride: "Brighton Beach Pride", org: "Another organization", search: "Internet search", other: "Other" },
  q2: { help: "Sought help (legal, medical…)", community: "Friends & community", emosupport: "Emotional support", events: "Interest in events", recommend: "Recommended by friends", other: "Other", not_participated: "Hasn't participated yet" },
  q3: { inperson: "In-person events", chat: "Qaravan Connects chat", referrals: "Specialist referrals", rainbow: "Rainbow Connections", bbpride: "Brighton Beach Pride", groups: "Support groups", volunteer: "Volunteering", other: "Other" },
  q4: { weekly: "Weekly or more", fewmonth: "Few times a month", monthly: "Monthly", few6mo: "Few times in 6 months", once: "Once", before: "Earlier, not in last 6 mo", never: "Never" },
  q5: { time: "No free time", moved: "Moved away", unsafe: "Feels unsafe (political situation)", mismatch: "Events don't match needs", unaware: "Doesn't know about events", belong: "Doesn't feel part of community", politics: "Political views differ", other: "Other" },
  q6: { lgbtq: "LGBTQ+ person", immigrant: "Immigrant / refugee", usborn: "US-born (RU-speaking family)", ally: "Ally (not LGBTQ+)", other: "Other", pnts: "Prefer not to say" },
  q7: { yes: "Yes", no: "No", pnts: "Prefer not to say" },
  q8: { lt6m: "Under 6 months", m6to12: "6–12 months", y1to3: "1–3 years", y3to5: "3–5 years", gt5y: "Over 5 years", usborn: "Born in US", pnts: "Prefer not to say" },
  q9: { az: "Azerbaijan", am: "Armenia", by: "Belarus", ge: "Georgia", kz: "Kazakhstan", kg: "Kyrgyzstan", md: "Moldova", ru: "Russia", tj: "Tajikistan", uz: "Uzbekistan", ua: "Ukraine", usborn: "Born in US", other: "Other country", pnts: "Prefer not to say" },
  q10: { a18: "18–24", a25: "25–34", a35: "35–44", a45: "45–54", a55: "55–64", a65: "65+", pnts: "Prefer not to say" },
  q11: { bk: "Brooklyn", qn: "Queens", mn: "Manhattan", bx: "Bronx", si: "Staten Island", outside: "Outside NYC", pnts: "Prefer not to say" },
  q12: { arrived: "Just arrived", adapting: "Adapting", settled: "Settled, some difficulties", stable: "Confident & stable", pnts: "Prefer not to say" },
  q13: { immigration: "Immigration case help", ice: "ICE rights / deportation info", health: "Healthcare & insurance info", job: "Job search & career", housing: "Housing", money: "Emergency financial help", mental: "Mental health support", english: "English practice", social: "Social connection", docs: "Documents & translations", education: "Education info", none: "No help needed now", other: "Other" },
  q14: { chg_big: "Changed significantly", chg_some: "Changed somewhat", same: "Unchanged", unsure: "Not sure", pnts: "Prefer not to say" },
  q16: { bbpride: "Brighton Beach Pride", social: "Regular social events", rainbow: "Rainbow Connections", groups: "Support groups", crisis: "Crisis support", referrals: "Specialist referrals", chat: "Qaravan Connects chat", info: "Info sessions & workshops", navigation: "Service navigation help", none: "None of these fit", other: "Other" },
  q17: { 1: "Not at all concerned", 2: "Not very concerned", 3: "Somewhat concerned", 4: "Very concerned", pnts: "Prefer not to say" },
  q18: { less: "Participates less", same: "Same as before", online: "Online instead of in person", stopped: "Stopped participating", pnts: "Prefer not to say" },
  q19: { protocols: "Clear safety protocols", online: "More online formats", private: "More private events", data: "Data-collection transparency", legal: "Legal rights info", ice: "ICE response plan", safe: "Already feels safe", other: "Other" },
  q20: { inperson: "In person", online: "Online", hybrid: "Hybrid", depends: "Depends on event", unsure: "Not sure" },
  q21: { weekend: "Weekend events", online: "More online formats", transport: "Transport help", childcare: "Childcare", boroughs: "Events in other boroughs", announce: "Earlier announcements", max: "Attends as much as possible", other: "Other" },
  q22: { telegram: "Telegram", instagram: "Instagram", facebook: "Facebook", website: "QARAVAN website", email: "Email newsletter", partiful: "Partiful", friends: "Friends & community", orgs: "Other organizations", other: "Other" },
  q23: { 1: "Definitely not", 2: "Probably not", 3: "Not sure", 4: "Probably yes", 5: "Definitely yes" },
};

// Русские метки — для человекочитаемого апдейта на строке (дословный архив).
const RU = {
  q1: { friends: "Друзья или знакомые", telegram: "Телеграм", social: "Социальные сети (Instagram, Facebook и др.)", bbpride: "Brighton Beach Pride", org: "Другая организация", search: "Поиск в интернете", other: "Другое" },
  q2: { help: "Искал(а) помощь (юридическую, медицинскую и т.д.)", community: "Хотел(а) найти друзей и сообщество", emosupport: "Нужна была эмоциональная поддержка", events: "Интерес к мероприятиям", recommend: "Рекомендация знакомых", other: "Другое", not_participated: "Я пока не участвовал(а) в программах QARAVAN" },
  q3: { inperson: "Посещал(а) мероприятия лично", chat: "Участвую в телеграм-чате Qaravan Connects", referrals: "Получал(а) направления к специалистам", rainbow: "Участвовал(а) в Rainbow Connections", bbpride: "Посещал(а) Brighton Beach Pride", groups: "Участвовал(а) в группах поддержки", volunteer: "Волонтёрил(а)", other: "Другое" },
  q4: { weekly: "Еженедельно или чаще", fewmonth: "Несколько раз в месяц", monthly: "Раз в месяц", few6mo: "Несколько раз за 6 месяцев", once: "Один раз", before: "Не участвовал(а) за последние 6 месяцев, но участвовал(а) раньше", never: "Никогда не участвовал(а)" },
  q5: { time: "Мало свободного времени", moved: "Переехал(а) в другой район или город", unsafe: "Не чувствую себя в безопасности из-за политической ситуации", mismatch: "Мероприятия не соответствуют моим потребностям", unaware: "Не знаю о предстоящих мероприятиях", belong: "Не чувствую себя частью сообщества", politics: "Политические взгляды организации не совпадают с моими", other: "Другое" },
  q6: { lgbtq: "ЛГБТК+ человек", immigrant: "Иммигрант / беженец в США", usborn: "Родился/вырос в США (русскоязычная семья)", ally: "Поддерживаю ЛГБТК+ сообщество, но не принадлежу к нему", other: "Другое", pnts: "Предпочитаю не отвечать" },
  q7: { yes: "Да", no: "Нет", pnts: "Предпочитаю не отвечать" },
  q8: { lt6m: "Менее 6 месяцев", m6to12: "От 6 месяцев до 1 года", y1to3: "От 1 года до 3 лет", y3to5: "От 3 до 5 лет", gt5y: "Больше 5 лет", usborn: "Я родился/ась в США", pnts: "Предпочитаю не отвечать" },
  q9: { az: "Азербайджан", am: "Армения", by: "Беларусь", ge: "Грузия", kz: "Казахстан", kg: "Кыргызстан", md: "Молдова", ru: "Россия", tj: "Таджикистан", uz: "Узбекистан", ua: "Украина", usborn: "Родился/ась в США", other: "Другая страна", pnts: "Предпочитаю не отвечать" },
  q10: { a18: "18–24", a25: "25–34", a35: "35–44", a45: "45–54", a55: "55–64", a65: "65 и старше", pnts: "Предпочитаю не отвечать" },
  q11: { bk: "Бруклин", qn: "Куинс", mn: "Манхэттен", bx: "Бронкс", si: "Стейтен-Айленд", outside: "За пределами Нью-Йорка", pnts: "Предпочитаю не отвечать" },
  q12: { arrived: "Только приехал(а) и осваиваюсь", adapting: "В процессе адаптации", settled: "Устроился/ась, но есть сложности", stable: "Чувствую себя уверенно и стабильно", pnts: "Предпочитаю не отвечать" },
  q13: { immigration: "Помощь с иммиграционным делом", ice: "Информация о правах при встрече с ICE и защите от депортации", health: "Информация о медицинских услугах и страховании", job: "Помощь в поиске работы или развитии карьеры", housing: "Помощь в поиске жилья", money: "Финансовая помощь (экстренная)", mental: "Поддержка психического здоровья", english: "Изучение английского / языковая практика", social: "Социальные связи и дружба", docs: "Помощь с документами и переводами", education: "Информация об образовании и поступлении", none: "Не нуждаюсь в помощи прямо сейчас", other: "Другое" },
  q14: { chg_big: "Значительно изменились — нужна другая поддержка", chg_some: "Немного изменились", same: "Остались прежними", unsure: "Не уверен(а)", pnts: "Предпочитаю не отвечать" },
  q16: { bbpride: "Brighton Beach Pride", social: "Регулярные социальные мероприятия", rainbow: "Rainbow Connections", groups: "Группы поддержки", crisis: "Поддержка в кризисной ситуации", referrals: "Направления к проверенным юристам и специалистам", chat: "Телеграм-чат Qaravan Connects", info: "Информационные встречи и воркшопы", navigation: "Помощь с навигацией по медицинским/социальным услугам", none: "Ничего из перечисленного не подходит", other: "Другое" },
  q17: { 1: "Совсем не обеспокоен(а)", 2: "Не очень обеспокоен(а)", 3: "Немного обеспокоен(а)", 4: "Очень обеспокоен(а)", pnts: "Предпочитаю не отвечать" },
  q18: { less: "Участвую реже, чем раньше", same: "Участвую так же, как раньше", online: "Выбираю онлайн-формат вместо личных встреч", stopped: "Совсем перестал(а) участвовать", pnts: "Предпочитаю не отвечать" },
  q19: { protocols: "Понятные правила безопасности на мероприятиях", online: "Больше онлайн-форматов", private: "Более приватные/закрытые встречи", data: "Информация о том, какие данные собирает QARAVAN", legal: "Юридическая информация о правах", ice: "Знать, что делать, если появится ICE", safe: "Уже чувствую себя в безопасности", other: "Другое" },
  q20: { inperson: "Личные встречи", online: "Онлайн-мероприятия", hybrid: "Смешанный формат", depends: "Зависит от типа мероприятия", unsure: "Не уверен(а)" },
  q21: { weekend: "Больше мероприятий на выходных", online: "Больше онлайн-форматов", transport: "Помощь с транспортом/проездом", childcare: "Присмотр за детьми", boroughs: "Мероприятия в других районах", announce: "Узнавать о мероприятиях заранее", max: "Уже участвую столько, сколько могу", other: "Другое" },
  q22: { telegram: "Телеграм", instagram: "Instagram", facebook: "Facebook", website: "Сайт QARAVAN", email: "Почтовые рассылки", partiful: "Partiful — уведомления и приглашения", friends: "От друзей и сообщества", orgs: "Через другие организации", other: "Другое" },
  q23: { 1: "Определённо нет", 2: "Скорее нет", 3: "Не уверен(а)", 4: "Скорее да", 5: "Определённо да" },
};

const QTEXT = {
  q1: "1. Как вы впервые узнали о QARAVAN?",
  q2: "2. Почему вы изначально решили участвовать?",
  q3: "3. Как вы участвовали в жизни QARAVAN?",
  q4: "4. Как часто участвовали за последние 6 месяцев?",
  q5: "5. Что мешает участвовать?",
  q6: "6. Что лучше всего описывает вас?",
  q7: "7. Считаете ли вы себя трансгендерным или небинарным человеком?",
  q8: "8. Как давно вы живёте в США?",
  q9: "9. Откуда вы родом?",
  q10: "10. Ваш возраст?",
  q11: "11. В какой части Нью-Йорка вы живёте?",
  q12: "12. Что описывает вашу жизнь в США сейчас?",
  q13: "13. Какая помощь сейчас нужнее всего?",
  q14: "14. Как изменились потребности после января 2025?",
  q15: "15. Что сейчас нужно больше всего? (свободный ответ)",
  q16: "16. Какие программы QARAVAN наиболее ценны?",
  q17: "17. Насколько беспокоитесь о безопасности?",
  q18: "18. Как беспокойство влияет на участие?",
  q19: "19. Что помогло бы чувствовать себя безопаснее?",
  q20: "20. Какой формат мероприятий предпочитаете?",
  q21: "21. Что помогло бы участвовать чаще?",
  q22: "22. Какие каналы информации удобнее?",
  q23: "23. Насколько вероятно участие в следующие 6 месяцев?",
  q24: "24. Что ещё нам стоит знать? (свободный ответ)",
};

// Типы вопросов и правила очистки. exclusive-вариант живёт в ответе один.
const MULTI = { q2: { max: 3, excl: ["not_participated"] }, q3: {}, q5: {}, q6: { excl: ["pnts"] }, q13: { max: 3, excl: ["none"] }, q16: { max: 3, excl: ["none"] }, q19: { excl: ["safe"] }, q21: { excl: ["max"] }, q22: {} };
const SINGLE = ["q1", "q4", "q7", "q8", "q9", "q10", "q11", "q12", "q14", "q18", "q20"];
const SCALE = { q17: { min: 1, max: 4, pnts: true }, q23: { min: 1, max: 5 } };
const OPEN = { q15: 4000, q24: 4000 };
const OTHER_ORDER = ["q1", "q2", "q3", "q5", "q6", "q9", "q13", "q16", "q19", "q21", "q22"];
const SECTIONS_RU = [
  ["РАЗДЕЛ 1: ВАША СВЯЗЬ С QARAVAN", ["q1", "q2", "q3", "q4", "q5"]],
  ["РАЗДЕЛ 2: КТО ВЫ", ["q6", "q7", "q8", "q9", "q10", "q11", "q12"]],
  ["РАЗДЕЛ 3: ЧТО ВАМ НУЖНО ПРЯМО СЕЙЧАС", ["q13", "q14", "q15", "q16"]],
  ["РАЗДЕЛ 4: БЕЗОПАСНОСТЬ И УЧАСТИЕ", ["q17", "q18", "q19", "q20", "q21", "q22"]],
  ["РАЗДЕЛ 5: БУДУЩЕЕ УЧАСТИЕ", ["q23", "q24"]],
];

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

async function findByRid(rid) {
  const d = await monday(
    `query ($b: ID!, $v: [String]!) { items_page_by_column_values(board_id: $b, limit: 1, columns: [{column_id: "${C.rid}", column_values: $v}]) { items { id group { id } column_values(ids: ["${C.raw}"]) { id text } } } }`,
    { b: SURVEY_BOARD, v: [rid] }
  );
  return d?.items_page_by_column_values?.items?.[0] || null;
}

const RID_RX = /^[0-9a-zA-Z-]{12,64}$/;

// Шесть языковых версий формы; метка в колонке Language — код заглавными.
const FORM_LANGS = new Set(["ru", "en", "uk", "ka", "uz", "kk"]);
const langOf = (v) => (FORM_LANGS.has(v) ? v : "ru");

// Санитайзер: пропускает только известные коды, режет длины, приводит типы.
function cleanAnswers(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const a = {};
  for (const qid of SINGLE) {
    const v = src[qid];
    if (typeof v === "string" && L[qid][v]) a[qid] = v;
  }
  for (const [qid, cfg] of Object.entries(MULTI)) {
    let v = Array.isArray(src[qid]) ? src[qid].filter((c) => typeof c === "string" && L[qid][c]) : [];
    v = [...new Set(v)];
    const excl = cfg.excl || [];
    const hit = v.find((c) => excl.includes(c));
    if (hit) v = [hit]; // эксклюзивный вариант вытесняет остальные
    else if (cfg.max) v = v.slice(0, cfg.max);
    if (v.length) a[qid] = v;
  }
  for (const [qid, cfg] of Object.entries(SCALE)) {
    const v = src[qid];
    if (v === "pnts" && cfg.pnts) a[qid] = "pnts";
    else if (Number.isInteger(v) && v >= cfg.min && v <= cfg.max) a[qid] = v;
  }
  for (const [qid, max] of Object.entries(OPEN)) {
    const v = src[qid];
    if (typeof v === "string" && v.trim()) a[qid] = v.trim().slice(0, max);
  }
  for (const qid of OTHER_ORDER) {
    const v = src[qid + "_other"];
    const picked = Array.isArray(a[qid]) ? a[qid].includes("other") : a[qid] === "other";
    if (picked && typeof v === "string" && v.trim()) a[qid + "_other"] = v.trim().slice(0, 200);
  }
  // Маршрутизация (та же, что на форме): скрытый вопрос не несёт данных.
  // Пустая колонка при таком ответе-гейте читается как «не задавался».
  if ((a.q2 || []).includes("not_participated")) { delete a.q3; delete a.q3_other; }
  if (!["few6mo", "once", "before", "never"].includes(a.q4)) { delete a.q5; delete a.q5_other; }
  if (!["chg_big", "chg_some"].includes(a.q14)) delete a.q15;
  if (!(a.q17 === 3 || a.q17 === 4)) delete a.q18;
  return a;
}

function columnValues(a, mode, meta) {
  const single = (qid) => (a[qid] ? { label: L[qid][a[qid]] } : "");
  const multi = (qid) => (a[qid]?.length ? { labels: a[qid].map((c) => L[qid][c]) } : "");
  const cv = {
    [C.rid]: meta.rid,
    [C.status]: { label: mode === "submit" ? "Submitted" : "In progress" },
    [C.lang]: { label: meta.lang.toUpperCase() },
    [C.progress]: String(meta.progress),
    [C.lastSection]: String(meta.lastSection),
    [C.q1]: single("q1"),
    [C.q2]: multi("q2"),
    [C.q3]: multi("q3"),
    [C.q4]: single("q4"),
    [C.q5]: multi("q5"),
    [C.q6]: multi("q6"),
    [C.q7]: single("q7"),
    [C.q8]: single("q8"),
    [C.q9]: single("q9"),
    [C.q10]: single("q10"),
    [C.q11]: single("q11"),
    [C.q12]: single("q12"),
    [C.q13]: multi("q13"),
    [C.q14]: single("q14"),
    [C.q15]: a.q15 ? { text: a.q15 } : "",
    [C.q16]: multi("q16"),
    [C.q17]: a.q17 ? { label: L.q17[a.q17] } : "",
    [C.q17n]: typeof a.q17 === "number" ? String(a.q17) : "",
    [C.q18]: single("q18"),
    [C.q19]: multi("q19"),
    [C.q20]: single("q20"),
    [C.q21]: multi("q21"),
    [C.q22]: multi("q22"),
    [C.q23]: a.q23 ? { label: L.q23[a.q23] } : "",
    [C.q23n]: typeof a.q23 === "number" ? String(a.q23) : "",
    [C.q24]: a.q24 ? { text: a.q24 } : "",
  };
  const others = OTHER_ORDER.filter((q) => a[q + "_other"]).map((q) => `Q${q.slice(1)}: ${a[q + "_other"]}`);
  cv[C.others] = others.length ? { text: others.join("\n").slice(0, 9500) } : "";
  cv[C.raw] = { text: JSON.stringify({ rid: meta.rid, savedAt: new Date().toISOString(), mode, lang: meta.lang, progress: meta.progress, lastSection: meta.lastSection, startedAt: meta.startedAt || undefined, answers: a }).slice(0, 9500) };
  if (mode === "submit") {
    const now = new Date();
    cv[C.submittedAt] = { date: now.toISOString().slice(0, 10), time: now.toISOString().slice(11, 19) };
    if (meta.minutes != null) cv[C.minutes] = String(meta.minutes);
  }
  return cv;
}

// Дословный русский архив ответа — апдейтом на строке, чтобы ничего не
// потерялось, даже если колонка когда-нибудь переедет или удалится.
function updateText(a, meta, repeat) {
  const line = (qid) => {
    let val = "—";
    if (Array.isArray(a[qid])) val = a[qid].map((c) => RU[qid][c]).join("; ");
    else if (OPEN[qid] && a[qid]) val = a[qid];
    else if (a[qid] != null && RU[qid]) val = RU[qid][a[qid]] ?? "—";
    const other = a[qid + "_other"] ? ` | Другое: ${a[qid + "_other"]}` : "";
    return `${QTEXT[qid]}\n${val}${other}`;
  };
  const parts = [repeat ? "ОБНОВЛЁННЫЙ ОТВЕТ — форму отправили ещё раз, колонки перезаписаны, прежний текст остался в истории выше" : "Ответ из формы опроса потребностей 2026"];
  for (const [title, qids] of SECTIONS_RU) {
    parts.push(`\n${title}`);
    for (const qid of qids) parts.push(line(qid));
  }
  parts.push(`\nЗаполнено: ${meta.progress}% · ${meta.minutes != null ? meta.minutes + " мин" : "время неизвестно"} · язык формы: ${meta.lang.toUpperCase()}`);
  return parts.join("\n").slice(0, 9500);
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  // GET /api/survey?rid=… — продолжение на другом устройстве. Отдаём черновик
  // по личной ссылке (rid — неугадываемый UUID из ссылки «продолжить на другом
  // устройстве»). Отправленный ответ назад не читается — только факт отправки:
  // лишний раз гонять чужие ответы по сети незачем.
  if (req.method === "GET") {
    const url = new URL(req.url, "https://x");
    const rid = String(url.searchParams.get("rid") || "").trim();
    if (!RID_RX.test(rid)) { res.statusCode = 400; return res.end("{}"); }
    try {
      const item = await findByRid(rid);
      if (!item) return res.end('{"found":false}');
      if (item.group?.id === GROUP_SUBMITTED) return res.end('{"found":true,"submitted":true}');
      let draft = null;
      try { draft = JSON.parse(item.column_values?.find((c) => c.id === C.raw)?.text || "null"); } catch (e) {}
      return res.end(JSON.stringify({
        found: true, submitted: false,
        answers: draft?.answers || {},
        lastSection: draft?.lastSection || 1,
        startedAt: draft?.startedAt || 0,
        lang: langOf(draft?.lang),
      }));
    } catch (e) {
      console.error("survey draft read failed:", e.message);
      res.statusCode = 502; return res.end("{}");
    }
  }

  if (req.method !== "POST") { res.statusCode = 405; return res.end("{}"); }
  const chunks = []; for await (const c of req) chunks.push(c);
  let b;
  try { b = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { res.statusCode = 400; return res.end("{}"); }

  // Honeypot: боты заполняют скрытое поле — вежливо соглашаемся и ничего не пишем.
  if (b.website) return res.end('{"ok":true}');

  // Репорт об ошибке перевода: отдельная доска, без rid (аноним по построению).
  if (b.mode === "report") {
    const text = String(b.text || "").trim().slice(0, 2000);
    if (!text) return res.end('{"ok":true}');
    const lng = langOf(b.lang);
    const section = Math.min(5, Math.max(0, Math.round(Number(b.section) || 0)));
    const now = new Date();
    const cv = {
      [R.status]: { label: "New" },
      [R.lang]: { label: lng.toUpperCase() },
      [R.section]: String(section),
      [R.text]: { text },
      [R.date]: { date: now.toISOString().slice(0, 10), time: now.toISOString().slice(11, 19) },
    };
    try {
      await monday(
        `mutation ($b: ID!, $g: String!, $n: String!, $v: JSON!) { create_item(board_id:$b,group_id:$g,item_name:$n,column_values:$v,create_labels_if_missing:true){id} }`,
        { b: REPORTS_BOARD, g: REPORTS_GROUP, n: `${lng.toUpperCase()}: ${text.slice(0, 50).replace(/\s+/g, " ")}`, v: JSON.stringify(cv) });
      return res.end('{"ok":true}');
    } catch (e) {
      console.error("translation report failed:", e.message);
      res.statusCode = 502; return res.end("{}");
    }
  }

  const rid = String(b.rid || "").trim();
  if (!RID_RX.test(rid)) { res.statusCode = 400; return res.end("{}"); }
  const mode = b.mode === "submit" ? "submit" : "draft";
  const a = cleanAnswers(b.answers);
  if (mode === "draft" && !Object.keys(a).length) return res.end('{"ok":true}'); // пустой черновик не создаём

  const startedAt = Number(b.startedAt) || 0;
  const meta = {
    rid,
    startedAt,
    lang: langOf(b.lang),
    progress: Math.min(100, Math.max(0, Math.round(Number(b.progress) || 0))),
    lastSection: Math.min(5, Math.max(0, Math.round(Number(b.lastSection) || 0))),
    minutes: startedAt > 0 ? Math.min(1440, Math.max(0, Math.round((Date.now() - startedAt) / 6000) / 10)) : null,
  };

  try {
    const cv = columnValues(a, mode, meta);
    const existing = await findByRid(rid);
    let itemId;
    if (existing) {
      itemId = existing.id;
      await monday(
        `mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v,create_labels_if_missing:true){id} }`,
        { b: SURVEY_BOARD, i: String(itemId), v: JSON.stringify(cv) });
      if (mode === "submit" && existing.group?.id !== GROUP_SUBMITTED) {
        await monday(`mutation ($i: ID!) { move_item_to_group(item_id:$i, group_id:"${GROUP_SUBMITTED}"){id} }`, { i: String(itemId) })
          .catch((e) => console.error("move to Submitted failed:", e.message));
      }
    } else {
      const d = await monday(
        `mutation ($b: ID!, $g: String!, $n: String!, $v: JSON!) { create_item(board_id:$b,group_id:$g,item_name:$n,column_values:$v,create_labels_if_missing:true){id} }`,
        { b: SURVEY_BOARD, g: mode === "submit" ? GROUP_SUBMITTED : GROUP_IN_PROGRESS, n: `Response ${rid.slice(0, 8)}`, v: JSON.stringify(cv) });
      itemId = d.create_item.id;
    }
    if (mode === "submit") {
      await monday(`mutation ($i: ID!, $t: String!) { create_update(item_id:$i, body:$t){id} }`,
        { i: String(itemId), t: updateText(a, meta, !!existing && existing.group?.id === GROUP_SUBMITTED) })
        .catch((e) => console.error("update write failed:", e.message)); // ответ уже в колонках — не валим отправку
    }
    return res.end('{"ok":true}');
  } catch (e) {
    console.error("survey save failed:", e.message);
    res.statusCode = 502;
    return res.end("{}");
  }
}
