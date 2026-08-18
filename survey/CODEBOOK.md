# Codebook — Community Needs Survey 2026

Инструмент: `survey/index.html` (маршрут `/survey`), приём: `api/survey.mjs`.
Данные: доска monday **Community Needs Survey 2026** (id `18426996689`, workspace RUSA's Main Workspace).
Правило репозитория: структура доски (названия колонок, метки) — по-английски; содержимое (свободные ответы, апдейты) — по-русски.

## Устройство данных

- **Одна строка = один респондент.** Браузер генерирует случайный `response id` (UUID, колонка «⚙️ Response id»), автосейв создаёт строку при первом содержательном ответе и дальше обновляет её же. Продолжение на другом устройстве — по личной ссылке `?r=<response id>`: черновик читается обратно из «⚙️ Raw answers» (отправленные ответы назад не читаются). Никаких имён, почт, телефонов и IP форма не собирает — опрос анонимный, и это обещано респонденту во вступлении.
- **Группы**: `In progress` — черновики (человек ещё заполняет или бросил), `Submitted` — отправленные. Для анализа результатов берите только Submitted; черновики — материал для анализа отсева (где бросают форму).
- **Полный дословный ответ** дублируется двумя способами: апдейт на строке (по-русски, при отправке) и колонка «⚙️ Raw answers» (JSON с кодами, при каждом автосейве). Даже если колонка сломается, ответ не потеряется.
- **Свободный текст из «Другое»** — в колонке «Other answers (verbatim)» с префиксом номера вопроса. Много «Другое» на одном вопросе = список вариантов этого вопроса надо чинить.

## Конвенция пропусков

| Что видно в колонке | Что это значит |
|---|---|
| Пустая ячейка у вопроса с логикой показа (Q3, Q5, Q15, Q18) | вопрос не задавался (routed past) — см. условия ниже |
| Пустая ячейка у остальных вопросов | человек пропустил вопрос (все вопросы необязательные) |
| Метка `Prefer not to say` | человек явно выбрал «Предпочитаю не отвечать» |
| Пустые числовые Q17/Q23 | не отвечал(а) или «предпочитаю не отвечать» — в среднее не попадает, нулей мы не пишем |

«Пропустил» и «предпочёл не отвечать» — разные сигналы: массовый Prefer not to say на вопросе — находка про доверие, а не мусор.

## Переменные

Скейлы читаются так: код формы → метка на доске. Уровни: N = номинальная, O = порядковая, Числ = числовая.

**Мета** — Status (In progress/Submitted); Language (RU/EN — язык заполнения; форма двуязычная, вопросы идентичны; перед объединением проверяйте, не отличаются ли ответы по языковым версиям — «разница групп» может оказаться разницей инструмента); Progress % (0–100); Last section (0–5, докуда дошёл); Minutes spent (от первого ответа до отправки; < ~3 мин на полной форме — подозрение на «спидера»); Submitted at.

| Колонка | Вопрос (дословно, RU) | Тип | Коды формы → метки доски |
|---|---|---|---|
| Q1 Heard about QARAVAN | Как вы впервые узнали о QARAVAN? | N, один | friends→Friends or acquaintances; telegram→Telegram; social→Social media; bbpride→Brighton Beach Pride; org→Another organization; search→Internet search; other→Other |
| Q2 Why joined | Почему вы изначально решили участвовать? (до 3-х) | N, до 3 | help→Sought help (legal, medical…); community→Friends & community; emosupport→Emotional support; events→Interest in events; recommend→Recommended by friends; other→Other; not_participated→Hasn't participated yet (эксклюзивный) |
| Q3 Participation | Как вы участвовали в жизни QARAVAN? | N, много | inperson→In-person events; chat→Qaravan Connects chat; referrals→Specialist referrals; rainbow→Rainbow Connections; bbpride→Brighton Beach Pride; groups→Support groups; volunteer→Volunteering; other→Other. **Не задаётся**, если в Q2 выбрано not_participated |
| Q4 Frequency (6 mo) | Как часто участвовали за последние 6 месяцев? | O, один | weekly→Weekly or more; fewmonth→Few times a month; monthly→Monthly; few6mo→Few times in 6 months; once→Once; before→Earlier, not in last 6 mo; never→Never |
| Q5 Barriers | Что мешает вам участвовать? | N, много | time→No free time; moved→Moved away; unsafe→Feels unsafe (political situation); mismatch→Events don't match needs; unaware→Doesn't know about events; belong→Doesn't feel part of community; politics→Political views differ; other→Other. **Задаётся только** при Q4 ∈ {few6mo, once, before, never} |
| Q6 Identity | Что из этого лучше всего описывает вас? | N, много | lgbtq→LGBTQ+ person; immigrant→Immigrant / refugee; usborn→US-born (RU-speaking family); ally→Ally (not LGBTQ+); other→Other; pnts→Prefer not to say (эксклюзивный) |
| Q7 Trans / nonbinary | Считаете ли вы себя трансгендерным или небинарным человеком? | N, один | yes→Yes; no→No; pnts→Prefer not to say |
| Q8 Time in US | Как давно вы живёте в США? | O, один | lt6m→Under 6 months; m6to12→6–12 months; y1to3→1–3 years; y3to5→3–5 years; gt5y→Over 5 years; usborn→Born in US; pnts→Prefer not to say |
| Q9 Country of origin | Откуда вы родом? | N, один | az/am/by/ge/kz/kg/md/ru/tj/uz/ua→страны; usborn→Born in US; other→Other country; pnts→Prefer not to say |
| Q10 Age | Ваш возраст? | O, один | a18→18–24; a25→25–34; a35→35–44; a45→45–54; a55→55–64; a65→65+; pnts→Prefer not to say |
| Q11 Borough | В какой части Нью-Йорка вы живёте? | N, один | bk→Brooklyn; qn→Queens; mn→Manhattan; bx→Bronx; si→Staten Island; outside→Outside NYC; pnts→Prefer not to say |
| Q12 Settling in | Что лучше всего описывает вашу жизнь в США сейчас? | O, один | arrived→Just arrived; adapting→Adapting; settled→Settled, some difficulties; stable→Confident & stable; pnts→Prefer not to say |
| Q13 Top needs | Какая помощь сейчас нужнее всего? (до 3-х) | N, до 3 | immigration→Immigration case help; ice→ICE rights / deportation info; health→Healthcare & insurance info; job→Job search & career; housing→Housing; money→Emergency financial help; mental→Mental health support; english→English practice; social→Social connection; docs→Documents & translations; education→Education info; none→No help needed now (эксклюзивный); other→Other |
| Q14 Needs since Jan 2025 | Как изменились ваши потребности после января 2025? | O, один | chg_big→Changed significantly; chg_some→Changed somewhat; same→Unchanged; unsure→Not sure; pnts→Prefer not to say |
| Q15 Needs now (open) | Что вам сейчас нужно больше всего? | текст | **Задаётся только** при Q14 ∈ {chg_big, chg_some}. Кодировать в темы постфактум |
| Q16 Most valued programs | Какие программы наиболее ценны? (до 3-х) | N, до 3 | bbpride→Brighton Beach Pride; social→Regular social events; rainbow→Rainbow Connections; groups→Support groups; crisis→Crisis support; referrals→Specialist referrals; chat→Qaravan Connects chat; info→Info sessions & workshops; navigation→Service navigation help; none→None of these fit (эксклюзивный); other→Other |
| Q17 Safety concern (+ 1–4) | Насколько беспокоитесь о безопасности на ЛГБТК+ мероприятиях? | O + Числ | слайдер: 1→Not at all concerned … 4→Very concerned; pnts→Prefer not to say (число пустое) |
| Q18 Effect on participation | Как беспокойство влияет на участие? | N, один | less→Participates less; same→Same as before; online→Online instead of in person; stopped→Stopped participating; pnts→Prefer not to say. **Задаётся только** при Q17 ∈ {3, 4} |
| Q19 Would feel safer with | Что помогло бы чувствовать себя безопаснее? | N, много | protocols→Clear safety protocols; online→More online formats; private→More private events; data→Data-collection transparency; legal→Legal rights info; ice→ICE response plan; safe→Already feels safe (эксклюзивный); other→Other |
| Q20 Preferred format | Какой формат мероприятий предпочитаете? | N, один | inperson→In person; online→Online; hybrid→Hybrid; depends→Depends on event; unsure→Not sure |
| Q21 Would attend more if | Что помогло бы участвовать чаще? | N, много | weekend→Weekend events; online→More online formats; transport→Transport help; childcare→Childcare; boroughs→Events in other boroughs; announce→Earlier announcements; max→Attends as much as possible (эксклюзивный); other→Other |
| Q22 Info channels | Какие каналы информации удобнее? | N, много | telegram/instagram/facebook→то же; website→QARAVAN website; email→Email newsletter; partiful→Partiful; friends→Friends & community; orgs→Other organizations; other→Other |
| Q23 Will participate (+ 1–5) | Вероятность участия в следующие 6 месяцев? | O + Числ | слайдер: 1→Definitely not … 5→Definitely yes |
| Q24 Anything else (open) | Что ещё нам стоит знать? | текст | Кодировать в темы постфактум |

«Эксклюзивный» вариант живёт в ответе один: форма и сервер снимают остальные метки при его выборе.

## Запланированный анализ (таблицы отчёта)

1. **Топ потребностей**: % выбравших каждый вариант Q13 (мультивыбор — проценты не суммируются в 100). Разрез по Q8 (время в США) и Q12 (устроенность): потребности новоприбывших vs давно живущих.
2. **Безопасность**: распределение Q17 + средний балл Q17 (1–4); Q18 среди обеспокоенных; Q19 — что просят. Разрез Q17 по Q6 (identity) и Q7 — у кого тревога выше.
3. **Барьеры и отток**: Q4 (частота) и Q5 (барьеры) — доля «не чувствую себя в безопасности» против бытовых барьеров; разрез Q5 по Q11 (borough).
4. **Ценность программ**: Q16 по каждому варианту; разрез по Q4 (активные vs периферия — потребности периферии обычно недопредставлены, следить за n).
5. **Динамика потребностей**: Q14 + темы из Q15; средний Q23 (1–5) как индикатор намерения вернуться, разрез по Q17 (связь тревоги и намерения — только как ассоциация!).
6. **Каналы**: Q22 и Q1 — где сообщество реально живёт, куда нести анонсы.
7. **Воронка формы** (по черновикам In progress): Last section и Progress % — где бросают; Prefer not to say по вопросам — где кончается доверие.

Правила чтения: проценты считать внутри независимой переменной и показывать вместе с n; ячейки меньше ~5 человек в отчёт не выносить (маленькое сообщество, комбинации демографии могут деанонимизировать); формулировки только ассоциативные («связано», не «влияет»). Это convenience-выборка через каналы QARAVAN: выводы — про ответивших, а не про «всё сообщество», и в отчёте это проговаривается.

## Как менять опрос

Вопросы и коды заданы в двух местах: конфиг `Q` в `survey/index.html` и карты `L`/`RU` в `api/survey.mjs` — менять синхронно, метки на доске должны совпадать символ в символ (иначе monday создаст дубль метки). Новые волны опроса: формулировки замороженных вопросов не редактировать (сломается сравнимость между волнами) — только добавлять.
