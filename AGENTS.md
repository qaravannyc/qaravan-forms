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
| `qaravannyc/events-robot` (private) | Robots between Partiful, monday.com, Gmail, Google Photos and Slack; the Telegram bot @qaravan_door_bot | GitHub Actions; Cloudflare Workers |
| `qaravannyc/qaravan-events` | events.qaravan.org: the events page with its `EVENTS` list, the embeds on qaravan.org, the `.ics` feeds | GitHub Pages from `main` |

Shared state outside git: monday.com boards, info@qaravan.org (Gmail, Google
Photos), Slack, and secrets kept both in Vercel and in events-robot's GitHub
Actions. `UNSUB_SECRET` must have the same value in both, because links signed
there are verified here; `GOOGLE_*` belong to info@qaravan.org in both.

## What other systems depend on here

**URLs already sent in emails or stored on boards.** Never change a shape
without still serving the old one.
- `/<event item id>`, `/<id>/lead`, `/<id>/photos` (`api/page.mjs`), `/<id>` with optional `?p=<attendeeId>.<sig>`; the older `/feedback/<id>[/lead|/photos]` is still served. Built by events-robot (`robot/send.mjs`, `robot/photos-link.mjs`) and by the Event Calendar formula columns "Feedback link" (`formula_mm64pdt9`) and "Photo upload link" (`formula_mm688t01`), which people paste into chats.
- `/multi?e=<up to 10 ids>&p=<attendeeId>.<sig>`, `/api/didnt-attend?i=&a=&s=`, `/api/unsubscribe?e=&s=`: in events-robot emails, built in its `robot/emails.mjs`.
- `/support/gina` (the `link` of the support group on events.qaravan.org and in its calendar feeds) and `/support/simon`.
- `/logo-email.png`: the logo in events-robot's emails.
- Links this repo sends itself: `/letter?r=`, `/survey?r=`, `/support/send?t=`, `/support/attendance?t=`, `/support/status?t=` (valid 365 days).

**Endpoints other systems call.**
- `/api/meeting-attendance` and `/api/meeting-prompts`: unauthenticated, idempotent GET. Called every 5 minutes by events-robot's Telegram worker (`FORMS_POKE_URLS` in `telegram/worker.mjs`; `FORMS_POKE = "0"` there switches it off), by the Vercel crons in `vercel.json` and by `.github/workflows/meeting-attendance.yml`.
- `/api/album-webhook` (monday webhook on Event Calendar `date4`), `/api/agreement-invite` (monday `create_item` webhooks on boards 4806484412, 18432838181, 9710026121, 9710142984) and `/api/website-inquiry` (monday `create_item` webhook on Website submissions 4939299706: the team email about a new qaravan.org inquiry, which replaced the board's own monday email automation). The webhooks are registered in monday through the API, not in this repo. All echo `{challenge}` and re-read the item from monday.
- `/api/slack-approve`: Slack buttons on the digest card, verified with `SLACK_SIGNING_SECRET`.
- `/api/aggregate`: weekly Vercel cron, needs `CRON_SECRET`.

**Signatures.** With `UNSUB_SECRET`: `p` = first 16 hex of HMAC-SHA256 of `eventId:attendeeId`, multi = of `multi:attendeeId`, didnt-attend = of `na:eventId:attendeeId`, unsubscribe = the full HMAC of the lowercased email. events-robot builds the same in `robot/emails.mjs`. Rotating `UNSUB_SECRET` breaks every link already emailed. Meeting and status tokens use `MEETINGS_SECRET`, or `MONDAY_TOKEN` when it is unset, so rotating `MONDAY_TOKEN` then breaks open meeting links.

**Text events-robot parses.** Change only together with its `robot/send.mjs` (digests) and `robot/sync-attendance.mjs` (attendance):
- Feedback board 18423848983 item names `<event> — <who>`, `LEAD — <event>`, `No show — <event>`; the digest finds rows by event name, so renaming an event orphans its feedback.
- Respondent key in `text_mm63r903`: `<eventId>:<attendeeId>`.
- Update labels `Оценка:`, `Момент:` or `Комментарий:`, `Ответ:`, `Понравилось:` or `Запомнилось:`, `Некомфортно:`, and the no-show line `Отметил(а) (в форме|по ссылке из письма): не был(а) на событии`.

**Code shared with events-robot.**
- `lib/agreement.mjs`, `lib/agreement-email.mjs`, `lib/wordmark-email.mjs` are byte-identical copies of events-robot `robot/lib/`. Change both together; check with `cmp lib/agreement.mjs ../events-robot/robot/lib/agreement.mjs` (same for the other two).
- The album title `<name> — QARAVAN` and `composeAlbumInfo` (`lib/album.mjs`) must match events-robot `robot/albums.mjs`; both write the fingerprint to `text_mm6417vh`.
- `digestBlocks` in `api/slack-approve.mjs` mirrors the digest card in events-robot `robot/send.mjs`.

## What this repository depends on

- **monday.com boards**; ids are in code (`lib/*.mjs`, `api/*.mjs`). Event Calendar 4774572020 (read: name, `date4`, `status`, `text_mm5qsspp`, `location`, `link`, `people`, `board_relation_mm63c5g1`, `color_mm6310pc`, `long_text_mm64tyb5`, `attendance_registered`; written: the album columns, Slack thread id, Survey status "Digest approved", lead digest, rescued photos, attendance relations, meeting columns), Events feedback 18423848983, Community Members 18425190164, the survey, letters, volunteer, support-group (Gina 18433061986, Simon 5469799506) and agreement boards, and Website submissions 4939299706 (read: name, `text2`, `long_text`, `color`, `status`, `email`, `phone93`, `text5`, `status6`; written: an update starting "Team email sent" (older rows: «Письмо команде отправлено»), which stops a second email). People delete and rename columns: a deleted column reads as empty and fails every write. Every call pins API-Version `2024-10`.
- **Labels** in status and dropdown columns must match the board character for character: writes use `create_labels_if_missing`, so a typo creates a duplicate label instead of failing. Board structure (column titles, labels, groups) is written in English.
- **Item names**: support-group meetings are found by `/gina|джин/` and `/simon|саймон/`; removing the name from an item stops its meeting emails.
- **Google** as info@qaravan.org: Photos (the API only adds to albums the app created) and Gmail. **Slack** #event-feedback.

## Deploy and limits

- Vercel deploys every commit: production from `main`, previews from branches. No build step and no `package.json`. A failed deploy is silent.
- `api/` holds at most 12 files (Vercel Hobby limit). Add an endpoint through the `?form=` switch in `api/survey.mjs` plus a rewrite in `vercel.json`.
- Font files are cached for a year: rename a file to change it.
- This repository is public: never commit a secret or personal data. Environment variables live in Vercel.

## Before you push

- `node --test tools/*.test.mjs` (no CI runs them). Local servers with a fake monday: `tools/*-dev.mjs`.
- `ls api | wc -l` prints 12 or less.
- Grep all three repos for any monday id, URL shape or text format you change. With the other two checked out next to this one: `grep -rn "<id or text>" . ../events-robot ../qaravan-events`

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

## Keeping this file live

- Change this file in the same commit as anything it describes: a route, a URL or token shape, a parsed text format, a board or column id, a copied file, a limit.
- When the change affects another repository listed above, change that repository too, or tell the user exactly what will break there. Update that repository's `AGENTS.md` section about this one.
- After something breaks, add one line under Incidents: the date, what broke, the rule it taught.
- Write only what an agent can't learn quickly from the code: contracts, who reads what, where ids live, limits, rules and their reasons. No changelog, no tutorials. Delete lines that stop being true. Keep the file under about 200 lines.
