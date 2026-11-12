# AGENTS.md: qaravan-forms (feedback.qaravan.org)

Read this whole file before you change anything here. Claude Code reads it
through `CLAUDE.md`; Codex, Cursor, Copilot, Gemini and other agents read it
directly. It lists what other QARAVAN systems rely on in this repository and
what this repository relies on elsewhere: most breakages so far came from a
change in one place that silently broke another (see Incidents). Keep it true:
see "Keeping this file live". Human-facing details are in `README.md`.

## QARAVAN's three repositories

| Repository | What it is | Runs on |
| - | - | - |
| `qaravannyc/qaravan-forms` (this one, public) | feedback.qaravan.org: survey, lead and photo forms, the weekly combined form, unsubscribe, letters, volunteer and support-group forms, monday and Slack webhooks | Vercel |
| `qaravannyc/events-robot` (private) | Robots between qaravan.org's guest lists, monday.com, Gmail, Google Photos and Slack; the Telegram bot @qaravan_door_bot | GitHub Actions; Cloudflare Workers |
| `qaravannyc/qaravan-events` | Retired (owner, 2026-11-07): holds the bio page server's code. events.qaravan.org is a custom domain of qaravan-site's Worker since 2026-11-08, which answers the `.ics` feeds and redirects every other address to www.qaravan.org | nothing served from it |

Shared state outside git: monday.com boards, info@qaravan.org (Gmail, Google
Photos), Slack, and secrets kept both in Vercel and in events-robot's GitHub
Actions. `UNSUB_SECRET` must have the same value in both, because links signed
there are verified here; `GOOGLE_*` belong to info@qaravan.org in both.

## What other systems depend on here

**URLs already sent in emails or stored on boards.** Never change a shape
without still serving the old one.
- `/<event item id>`, `/<id>/lead`, `/<id>/photos` (`api/page.mjs`), `/<id>` with optional `?p=<attendeeId>.<sig>`; the older `/feedback/<id>[/lead|/photos]` is still served. Built by events-robot (`robot/send.mjs`, `robot/photos-link.mjs`) and by the Event Calendar formula columns "Feedback link" (`formula_mm64pdt9`) and "Photo upload link" (`formula_mm688t01`), which people paste into chats.
- `/multi?e=<up to 10 ids>&p=<attendeeId>.<sig>`, `/api/didnt-attend?i=&a=&s=`, `/api/unsubscribe?e=&s=`: in events-robot emails, built in its `robot/emails.mjs`. Since 2026-11-10 the last two only ask on a GET (mail scanners open links) and act on a POST of the same address (the page's button, or a mail app's one-click unsubscribe). Known, left as is: the `/multi` token never expires and isn't tied to its events (`multi:attendeeId`); changing it changes events-robot's emails.
- `/support/gina` (the `link` of the support group in qaravan.org's events, `/data/site-events.json`, and in its calendar feeds) and `/support/simon`.
- `/logo-email.png`: the logo in events-robot's emails.
- Links this repo sends itself: `/letter?r=`, `/survey?r=`, `/support/send?t=`, `/support/attendance?t=`, `/support/status?t=` (valid 365 days), `/club/cancel?m=<member item id>&s=<sig>` (movie club welcome email).
- `/letter`: since 2026-11-05 its home is qaravan.org/forms/letter/ (qaravan-site TASKS 40: the site copies `letter/*.js` and the page's `<style>` with its `tools/letter-import.mjs`, which stops if one of its patches no longer matches exactly, so after a change to the letter app, import it there again). A visit to /letter here moves there (a script at the top of `letter/index.html`, feedback.qaravan.org only), except with `?r=` and while a letter started on that device is still in progress here. `/api/letter` stays here: qaravan.org sends to it server to server. Once a letter is sent, `GET /api/letter?rid=` answers only `{found, submitted}` and drafts or a second submit get 409 (the page treats 409 as sent); the page keeps only the id and the sent flag on the device and drops an unsent draft untouched for 8 weeks.
- `/club`: since 2026-11-05 its home is qaravan.org/forms/club/ (qaravan-site TASKS 40, imported there by `tools/club-import.mjs` from `club/index.html`, `assets/qaravan.css` and `assets/forms.css`; after a change to the club page, import it there again). A visit to /club here moves there (a script at the top of `club/index.html`, feedback.qaravan.org only), except while someone who started joining on that device is still in the middle of it. `/api/club`, `/club/welcome` and `/club/cancel` stay here.
- `/club` (the movie club form) and `/club/welcome?session_id={CHECKOUT_SESSION_ID}`, the return address of the three Stripe payment links (set in Stripe, not here).

**Endpoints other systems call.**
- `/api/meeting-attendance` and `/api/meeting-prompts`: unauthenticated, idempotent GET. Called every 5 minutes by events-robot's Telegram worker (`FORMS_POKE_URLS` in `telegram/worker.mjs`; `FORMS_POKE = "0"` there switches it off), by the Vercel crons in `vercel.json` and by `.github/workflows/meeting-attendance.yml`.
- `/api/album-webhook` (monday webhook on Event Calendar `date4`), `/api/agreement-invite` (monday `create_item` webhooks on boards 4806484412, 18432838181, 9710026121, 9710142984), `/api/website-inquiry` (monday `create_item` webhook on Website submissions 4939299706: the team email about a new qaravan.org inquiry) and `/api/team-email` (monday `create_item` webhooks on boards 4806484412, 9710026121, 9710142984 and RC: Submissions 5344342465: the team email about a new volunteer sign-up, role application or Rainbow Connections sign-up). These emails replaced the boards' own monday "Send an email" automations, now deactivated; turning one back on sends every email twice. The webhooks are registered in monday through the API, not in this repo. All echo `{challenge}` and re-read the item from monday.
- `/api/slack-approve`: Slack buttons on the digest card, verified with `SLACK_SIGNING_SECRET`.
- `/api/aggregate`: weekly Vercel cron, needs `CRON_SECRET`. It and every manual mode (`/api/status?item=`, `/api/meeting-prompts` and `/api/meeting-attendance` with `item`, `dry`, `to`) take the secret only as `Authorization: Bearer <CRON_SECRET>` (what Vercel's cron sends), never `?key=`.
- `/api/club-tick`: unauthenticated, idempotent GET, every 5 minutes from `.github/workflows/meeting-attendance.yml` (nothing else calls it): approves movie club exceptions whose time has come, resends a failed WhatsApp email, recounts film scores, fills in TMDB ids.

**Signatures.** With `UNSUB_SECRET`: `p` = first 16 hex of HMAC-SHA256 of `eventId:attendeeId`, multi = of `multi:attendeeId`, didnt-attend = of `na:eventId:attendeeId`, unsubscribe = the full HMAC of the lowercased email. events-robot builds the same in `robot/emails.mjs`. The movie club cancel link signs `club:<itemId>` with `UNSUB_SECRET` (first 32 hex). Rotating `UNSUB_SECRET` breaks every link already emailed. Meeting and status tokens use `MEETINGS_SECRET`, or `MONDAY_TOKEN` when it is unset, so rotating `MONDAY_TOKEN` then breaks open meeting links.

**Text events-robot parses.** Change only together with its `robot/send.mjs` (digests) and `robot/sync-attendance.mjs` (attendance):
- Feedback board 18423848983 item names `<event> — <who>`, `LEAD — <event>`, `No show — <event>`; the digest finds rows by event name, so renaming an event orphans its feedback.
- Respondent key in `text_mm63r903`: `<eventId>:<attendeeId>`.
- Update labels `Оценка:`, `Момент:` or `Комментарий:`, `Ответ:`, `Понравилось:` or `Запомнилось:`, `Некомфортно:`, and the no-show line `Отметил(а) (в форме|по ссылке из письма): не был(а) на событии`.

**Copies of answers.** After a form is sent, the person gets "a copy of your answers" from info@qaravan.org (`lib/answers-copy.mjs`) when we have their email: typed into the form, or, for event feedback opened with `?p=`, the Community Members email (not to people marked Unsubscribed). The page sends the questions and answers as they saw them in the body field `copy: [{q, a}]`; the server caps them and hides links. Wired into `/legal-help`, `/event-volunteers`, `/support/gina` and `/support/simon`, `/letter` (on submit) and the event feedback forms (`/<id>`, `/multi`); not the lead, photo, survey or staff forms. `/legal-help` also mails each answer to `LEGAL_HELP_NOTIFY` (default ezra@qaravan.org). A copy that fails is logged and never fails the submission. Since 2026-11-10 (audit): the letter's and event feedback's copies keep only questions from the form's own texts (letter/strings.js, the pages' STRINGS, plus the event's name, date and own question), read by `formQuestions` in `lib/answers-copy.mjs`; at most 3 copies an address and 10 an IP a day per function instance; 20,000 characters of answers at most.

**Who sent a form** (`formGate` in `lib/gate.mjs`, `/api/legal-help`, `/api/event-volunteers`, `/api/support-groups`). qaravan.org's Worker sends `X-QV-Relay: <RELAY_SECRET>` from its `forward()` (after its own Turnstile check; never from its `relay()` of /api/letter and /api/club, which checks nothing); a page here may send a Turnstile token (`cf-turnstile-response`, checked with `TURNSTILE_SECRET_KEY`). While `RELAY_SECRET` is unset in Vercel nothing changes. Once it is set, a request with neither proof is still saved and still reaches the team, but no email goes to the address it names, and the team's copy keeps only the form's own questions. Set `RELAY_SECRET` here and on the Worker on the same day.

**Code shared with events-robot.**
- `lib/agreement.mjs`, `lib/agreement-email.mjs`, `lib/wordmark-email.mjs` are byte-identical copies of events-robot `robot/lib/`. Change both together; check with `cmp lib/agreement.mjs ../events-robot/robot/lib/agreement.mjs` (same for the other two). Since 2026-11-10 `agreementMime` takes `unsubUrl`: the webhook invite (`lib/agreement-invite.mjs`) passes the signed `/api/unsubscribe` link (`unsubUrlFor`, built as events-robot's), so both invites carry the same stop line.
- The album title (`albumTitle` in `lib/album.mjs`: `<name> — QARAVAN`, or `<name> — RUSA LGBTQ` for events before 2025-04-23, when the organization took its new name) must match events-robot `robot/lib/album-title.mjs`, since both sides also look albums up by title; `composeAlbumInfo` there must match events-robot `robot/albums.mjs` (both write the fingerprint to `text_mm6417vh`).
- `digestBlocks` in `api/slack-approve.mjs` mirrors the digest card in events-robot `robot/send.mjs`.

## What this repository depends on

- **monday.com boards**; ids are in code (`lib/*.mjs`, `api/*.mjs`). Event Calendar 4774572020 (read: name, `date4`, `status`, `text_mm5qsspp`, `location`, `link`, `people`, `board_relation_mm63c5g1`, `color_mm6310pc`, `long_text_mm64tyb5`, `attendance_registered`; written: the album columns, Slack thread id, Survey status "Digest approved", lead digest, rescued photos, attendance relations, meeting columns), Events feedback 18423848983, Community Members 18425190164, the survey, letters, volunteer, support-group (Gina 18433061986, Simon 5469799506) and agreement boards, Legal Help Needs 2026 18437438152 (`/legal-help`, written only; private, holds immigration answers), and Website submissions 4939299706 (read: name, `text2`, `long_text`, `color`, `status`, `email`, `phone93`, `text5`, `status6`; written: an update starting "Team email sent" (older rows: «Письмо команде отправлено»), which stops a second email). The volunteer boards above and RC: Submissions 5344342465 get the same "Team email sent" update (columns in `V` and `RC` in `lib/team-email.mjs`). People delete and rename columns: a deleted column reads as empty and fails every write. Every call pins API-Version `2024-10`.
- **Labels** in status and dropdown columns must match the board character for character: writes use `create_labels_if_missing`, so a typo creates a duplicate label instead of failing. Board structure (column titles, labels, groups) is written in English.
- **Item names**: support-group meetings are found by `/gina|джин/` and `/simon|саймон/`; removing the name from an item stops its meeting emails.
- **Google** as info@qaravan.org: Photos (the API only adds to albums the app created) and Gmail. **Slack** #event-feedback.
- **Photo upload tokens** (`api/photos-token.mjs`, since 2026-11-10): a browser gets a Google token only when Google's answer names exactly `photoslibrary.appendonly` (otherwise 503 and the log line "Google did not narrow the token": then uploads stop until the refresh token is fixed, never a broader token), and with the personal link (`p`), a ticket from an earlier answer for that event, or a Turnstile pass. The Turnstile requirement starts when `TURNSTILE_SECRET_KEY` is set in Vercel, together with the public `TURNSTILE_SITE_KEY` (api/page.mjs puts it on the pages; the widget's hostnames must include feedback.qaravan.org); until then pages without a personal link (photos, lead, QR) still get tokens. `/api/rescue-file` needs that event's ticket (header `X-QV-Ticket`) or the personal link (`X-QV-P`) whenever `UNSUB_SECRET` is set.
- **The movie club** (`lib/club.mjs`): boards Movie Club Members 18437884339 (private), Movie Club Films 18437884341, Movie Club Exceptions 18437884343 (private, hardship answers: written only); their columns have readable ids (`club_*`, `film_*`, `exc_*`). **Stripe** with `STRIPE_SECRET_KEY` (a restricted key: read Checkout Sessions, Customers, Subscriptions, Invoices, Payment Methods; write Customer portal), three payment links ($5, $10, $15 a month on the product tagged `qaravan_product: movie_club`; test links in code, live ones in `CLUB_LINK_5/10/15`) and the saved customer portal settings, without which the cancel link fails. **TMDB** (`TMDB_API_KEY`, v3 key or v4 token) for posters, trailers and search; the pages must keep the TMDB credit line. `CLUB_WHATSAPP_URL`: until it's set nobody is approved or emailed.
  - Privacy and payments (audit, 2026-11-10): `join` answers `{ok, key, state: "applied"}` to everyone, so it never tells whether an address is in the club; a member or a pending request hears it by email instead (at most once a day per instance), and their row isn't touched. A Removed / Remove from group row is never reset or reinstated, by the form, an exception or a payment: it gets a note and a person decides. `welcome` counts a session only for the row its `client_reference_id` key names, and refuses one Stripe marks as another product (`qaravan_product` on the session or the expanded line item's product, which needs Products read on the restricted key, or the payment link id in `CLUB_PAYMENT_LINK_IDS`, comma-separated plink_ ids, optional); a payment without our key gets a note on a row and no WhatsApp link. Added film titles: TMDB's title when TMDB knows the id, else cleaned. No cancel link is signed or accepted without `UNSUB_SECRET`. The portal returns to www.qaravan.org/forms/club/ (/ru/ for Russian).
  - Open, the owner decides (not changed): exception requests are approved by `/api/club-tick` after a random 0 to 12 hours with nobody reading them, and the approval emails the WhatsApp link, so anyone can get the link by asking for an exception.

## Deploy and limits

- Vercel deploys every commit: production from `main`, previews from branches. No build step and no `package.json`. A failed deploy is silent.
- `api/` holds at most 12 files (Vercel Hobby limit). Add an endpoint through the `?form=` switch in `api/survey.mjs` plus a rewrite in `vercel.json`.
- Font files are cached for a year: rename a file to change it.
- This repository is public: never commit a secret or personal data. Environment variables live in Vercel.

## Before you push

- `node --test tools/*.test.mjs` (no CI runs them). Local servers with a fake monday: `tools/*-dev.mjs`.
- `ls api | wc -l` prints 12 or less.
- `/support/gina`, `/support/simon`, `/survey`, `/event-volunteers`, `/legal-help`: since 2026-11-06 their homes are qaravan.org/forms/gina/, /forms/simon/, /forms/survey/, /forms/event-volunteers/ and /forms/legal-needs/ (qaravan-site TASKS 10; that site's own forms, which send to the `/api/*` here server to server). A visit here moves there in its language (Russian unless `?lang=en`), by a script at the top of each page, feedback.qaravan.org only. It stays here with `/survey?r=`, a survey language other than ru or en, `/event-volunteers?role=`, and while a draft started on that device is in progress (keys `qsurvey26.v1`, `qaravan.event-volunteers.v1`, `qaravan.legal-help.v1`). The token pages `/support/send`, `/support/attendance`, `/support/status` don't move.
- Languages (2026-11-12, the owner's "everything available in Russian also in Turkmen, Ukrainian, Uzbek, Tajik, Azerbaijani, Kyrgyz and Spanish"): the letter form speaks ru, en, uk, ka, uz, kk, tg, ky, az, tk, es (`LANGS` in letter/app.js and lib/letter-board.mjs; words in letter/strings.js and letter/events-i18n.js, checked by `node tools/letter-langs-check.mjs <code>`; its emails in lib/letter-mail.mjs and lib/answers-copy.mjs); the movie club speaks ru, en, uk, uz, tg, ky, az, tk, es (club/index.html STRINGS, club/welcome.html T, lib/club.mjs T and AGAIN, checked by `node tools/club-langs-check.mjs <code>`; `langOf` keeps a code the club has words for, else Russian; the club's films keep Russian titles and notes in every language but English; Stripe's portal gets es, en or ru). A new language needs a translated and proofread block in each of those places, then both imports into qaravan-site. The board columns store the code as text (letter) or a label created on first use (club: `TG`, `KY`...).
- A change to `letter/` or `club/` (or `assets/qaravan.css`, `assets/forms.css`, which the club page uses) must be imported into qaravan-site with its `tools/letter-import.mjs` or `tools/club-import.mjs`, then checked there with `node scripts/forms-e2e.mjs`: qaravan.org draws its own copy of both apps, so a fix made only here never reaches the people who use them there.
- Grep all three repos for any monday id, URL shape or text format you change. With the other two checked out next to this one: `grep -rn "<id or text>" . ../events-robot ../qaravan-events`

## Talking to the owner

Owner, 2026-11-08 ("speak like that always, in all chats"): everything you write to the owner is in plain, everyday language. Say what happens, to whom and when, in short sentences, the way you would explain it to someone who doesn't build websites. Example: "When someone signs in, the site remembers them on that phone or computer for 90 days. After 90 days, it asks them to sign in again with a new code." Not: "the session runs out after 90 days." No jargon, code names or file names unless the owner asks for them; when a technical word can't be avoided, say what it means in the same sentence. This holds in every chat, in all four QARAVAN repositories.

## Publishing

The owner wants work finished, not parked: open a pull request from your
branch, merge it yourself as soon as the checks above pass, then confirm
Vercel's production deploy (its status on the merge commit, and the changed
page on feedback.qaravan.org). Don't leave a pull request waiting for a person
to merge.

## Incidents and the rule each one taught

- 2026-09-03 (fixed in 8b409d7): a 13th file in `api/` went over Vercel's limit; the deploy failed silently and new routes answered 404. Rule: at most 12 files in `api/`.
- August and September 2026: columns deleted on the Event Calendar (the album id cache, Attendance, "Checked in") broke code that still read or wrote them in this repo and in events-robot. Rule: grep for a column id in all three repos before deleting it.
- 2026-09-30: events.qaravan.org changed the shape of its `EVENTS` list and broke the Telegram bot in events-robot. Rule: anything another repository parses is a contract; change both sides together.
- 2026-10-30: the `/letter` form showed «Thank you» without sending in two ways: Submit pressed while an autosave was still on its way took the autosave's answer as its own (one person that day, row 13430571911 stayed «In progress»), and Skip on the optional last question opened the thank-you screen. Rule: a thank-you screen appears only after the server confirmed that very submission.

## Keeping this file live

- Change this file in the same commit as anything it describes: a route, a URL or token shape, a parsed text format, a board or column id, a copied file, a limit.
- When the change affects another repository listed above, change that repository too, or tell the user exactly what will break there. Update that repository's `AGENTS.md` section about this one.
- After something breaks, add one line under Incidents: the date, what broke, the rule it taught.
- Write only what an agent can't learn quickly from the code: contracts, who reads what, where ids live, limits, rules and their reasons. No changelog, no tutorials. Delete lines that stop being true. Keep the file under about 200 lines.
