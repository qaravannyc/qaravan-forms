import { randomBytes } from "node:crypto";

// One file, two identical copies — change both together:
//   events-robot/robot/lib/agreement.mjs  (the robot: reminders, Signed, catch-up)
//   qaravan-forms/lib/agreement.mjs       (the monday webhook: the first invite)

// Community Agreement invites — the rules, as pure functions. The I/O (monday,
// Gmail) lives in events-robot/robot/agreement-invites.mjs and in
// qaravan-forms/lib/agreement-invite.mjs.
//
// A volunteer role starts only after the Community Agreement is signed. The
// sign-up forms used to rely on a redirect to the agreement form, and whoever
// closed that tab never signed. So the robot emails the signing link from
// info@qaravan.org to everyone who signs up on a volunteer board without having
// signed, and — once, on request (BACKFILL=1) — to event leads and active
// volunteers who never signed.
//
// Where a signature can be:
//   • the code of a personal invite link, which the form keeps in its hidden
//     «invite» tag — exact, whatever email the person typed;
//   • the Community Agreement board — every signature since 2023, the old
//     versions of the form included (259 of them predate the Aug 9, 2026 text);
//   • «Agreement signed» on a Community Members card (the Aug 2026 import);
//   • the old sign-up forms, which carried the RUSA LGBTQ+ agreement as a
//     question: its column (short_text) on the volunteer boards, where the team
//     marked «signed» by hand, and their «Agreement» status set to Signed.
// A signature counts by a linked member card, an email, or an exact full name
// of two words or more.
//
// Nobody gets the email twice: every address sent to gets a row on the invites
// board before the email goes out, and an address or a full name that already
// has a row is never written to again — whichever board or run it comes from.

// The Community Agreement form (wkf.ms/49xfdAK, resolved: shorteners trip spam filters).
export const AGREEMENT_URL = "https://forms.monday.com/forms/ced21cb09e2f94f3b124cedcec92f173?r=use1";

export const AGREEMENT_BOARD = 5451306001; // «Community Agreement» — one row per signature, from the form
// invite: the form's hidden tag «invite» (the code from the personal link).
export const AGREEMENT_COLS = { name: "short_text", email: "short_text6", date: "date_1", member: "board_relation_mm639r9e", invite: "short_textifj2izd7" };

export const INVITES_BOARD = 18433064516; // «Community Agreement invites» — the robot's log and dedup
export const INVITE_COLS = {
  email: "email", source: "source", status: "invite_status", invited: "invited_at", signed: "signed_at", item: "source_item",
  code: "invite_code", reminders: "reminders", lastEmailed: "last_emailed",
};
export const INVITE_STATUS = { invited: "Invited", signed: "Signed", failed: "Send failed", noResponse: "No response" };

// Until they sign: a reminder a week after the last email, at most MAX_REMINDERS
// of them (five emails in all over about a month); then «No response», and a
// person takes it from there. Reminders go out in the New York daytime only.
export const REMIND_EVERY_DAYS = 7;
export const MAX_REMINDERS = 4;
export const REMIND_HOURS_NY = [10, 19];

// Every board a volunteer sign-up form writes to. A new form → a new line here.
export const SIGNUP_BOARDS = [
  // «Volunteer with us!» (wkf.ms/43nMav1)
  { board: 4806484412, source: "Volunteer sign-up form", email: "email", member: "board_relation_mm635h5j", oldAgreement: "short_text", agreementStatus: "status88", location: "location", phone: "phone" },
  // feedback.qaravan.org/event-volunteers
  { board: 18432838181, source: "Event volunteer form", email: "email" },
  // the two role forms embedded on qaravan.org/volunteer
  { board: 9710026121, source: "Event Project Manager application", email: "email", oldAgreement: "short_text", agreementStatus: "status88", location: "location", phone: "phone" },
  { board: 9710142984, source: "Community Manager application", email: "email", oldAgreement: "short_text", agreementStatus: "status88", location: "location", phone: "phone" },
];
export const VOLUNTEERS_BOARD = 4806484412;
export const ACTIVE_VOLUNTEERS_GROUP = "new_group"; // «Active volunteers»

// The one-time catch-up never writes to people in Russia: a letter from an
// LGBTQ+ organization can put them at risk there. That is the board's group
// «Past volunteers /those in Russia», and anyone whose location or phone says
// Russia. (New sign-ups asked us to write; this is for the catch-up only.)
export const NEVER_BACKFILL_GROUPS = ["new_group62981"];
const RUSSIA_RX = /russia|россия|росси[ияю]|moscow|москва|petersburg|петербург|\bспб\b|ekaterinburg|екатеринбург|novosibirsk|новосибирск|kazan\b|казань/i;
export function inRussia({ location = "", phoneValue = null } = {}) {
  let country = "";
  try { country = (JSON.parse(phoneValue || "{}") || {}).countryShortName || ""; } catch {}
  return RUSSIA_RX.test(String(location)) || country === "RU";
}

// Sign-ups older than this were never promised an automatic invite (the backfill
// covers those who actually led or volunteered); newer ones are looked at for
// WINDOW_DAYS, so a robot outage of a few days still catches up.
export const START = "2026-09-28T00:00:00Z";
export const WINDOW_DAYS = 14;
// The general form sends people straight on to the agreement form, so nobody is
// written to in their first half hour. The invite itself goes out from
// feedback.qaravan.org/api/agreement-invite, which a monday workflow on every
// sign-up board calls 30 minutes after the row appears; the endpoint refuses
// rows younger than WEBHOOK_MIN_AGE_MINUTES, in case a workflow loses its delay.
// The robot picks up only what that missed, from two hours on.
export const WEBHOOK_MIN_AGE_MINUTES = 20;
export const MIN_AGE_MINUTES = 120;

// The scheduled run never sends more than this; the rest waits for the next tick.
export const MAX_PER_RUN = 20;

// BACKFILL_SCOPE=recent: only people active in the last ACTIVE_DAYS — led an
// event, came to one (Confirmed attendees / Verified registrations), or signed
// up to volunteer.
export const ACTIVE_DAYS = 365;

// Russian mail services can be read by the Russian authorities: the one-time
// catch-up leaves these addresses for someone to reach another way.
const RU_MAIL = new Set(["mail.ru", "bk.ru", "inbox.ru", "list.ru", "internet.ru", "yandex.ru", "ya.ru", "yandex.com", "narod.ru", "rambler.ru", "lenta.ru", "autorambler.ru", "myrambler.ru", "ro.ru"]);
export const onRussianMail = (email) => RU_MAIL.has(String(email).split("@")[1] || "");

// Addresses typed wrong at sign-up: they only bounce.
const TYPO_DOMAINS = new Set(["gmai.com", "gmial.com", "gamil.com", "gmaill.com", "gnail.com", "gmail.co", "gmail.con", "gmali.com", "hmail.com", "yahooo.com", "yaho.com", "hotmial.com", "hotmai.com", "outlok.com", "iclod.com"]);
export const looksMistyped = (email) => TYPO_DOMAINS.has(String(email).split("@")[1] || "");
export const MAX_BACKFILL = 400;

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function normEmail(raw) {
  const e = String(raw || "").trim().toLowerCase().replace(/^mailto:/, "");
  return EMAIL_RX.test(e) ? e : "";
}

// Shared mailboxes (ours or a partner's) are not a person who can sign.
const ROLE_LOCALS = new Set(["info", "infoline", "team", "hello", "contact", "admin", "office", "events", "noreply", "no-reply", "volunteer", "volunteers"]);
export const isRoleMailbox = (email) => ROLE_LOCALS.has(String(email).split("@")[0]);

export function normName(s) {
  return String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

// "Maria Ivanova" → "maria ivanova"; a single word, or an initial, is not
// enough to claim a signature ("Maria" signed ≠ this Maria).
export function fullName(s) {
  const t = normName(s).split(" ").filter(Boolean);
  return t.length >= 2 && t.every((w) => w.length >= 2) ? t.join(" ") : "";
}

// What to call the person in the greeting: the preferred name, else the first
// word of the name — never an email address or a leftover note.
export function greetName(name, preferred = "") {
  const first = String(preferred || "").trim() || String(name || "").trim().split(/\s+/)[0] || "";
  return /[@\d()]/.test(first) ? "" : first;
}

// signatures: [{ name, itemName, email, date, memberIds }] from the agreement board.
// members:    [{ id, emails, agreementDate }] from Community Members.
export function signatureIndex(signatures, members = []) {
  const emails = new Map(), names = new Map(), memberIds = new Map(), codes = new Map();
  const put = (map, key, date) => { if (key && !map.has(key)) map.set(key, date || ""); };
  const byId = new Map(members.map((m) => [String(m.id), m]));
  for (const s of signatures) {
    put(emails, normEmail(s.email), s.date);
    put(codes, String(s.invite || "").trim().toLowerCase(), s.date);
    for (const n of [s.name, s.itemName]) put(names, fullName(n), s.date);
    for (const id of s.memberIds || []) {
      put(memberIds, String(id), s.date);
      for (const e of byId.get(String(id))?.emails || []) put(emails, e, s.date);
    }
  }
  for (const m of members) {
    if (!m.agreementDate) continue;
    put(memberIds, String(m.id), m.agreementDate);
    for (const e of m.emails) put(emails, e, m.agreementDate);
  }
  return { emails, names, memberIds, codes };
}

// → { how: "invite link" | "member" | "email" | "name", date } or null
export function findSignature(index, person) {
  const code = String(person.code || "").trim().toLowerCase();
  if (code && index.codes?.has(code)) return { how: "invite link", date: index.codes.get(code) };
  for (const id of person.memberIds || []) {
    if (index.memberIds.has(String(id))) return { how: "member", date: index.memberIds.get(String(id)) };
  }
  for (const e of person.emails || []) {
    if (index.emails.has(e)) return { how: "email", date: index.emails.get(e) };
  }
  for (const nm of [person.name, ...(person.altNames || [])]) {
    const n = fullName(nm);
    if (n && index.names.has(n)) return { how: "name", date: index.names.get(n) };
  }
  return null;
}

// candidates: [{ name, email, emails, memberIds, unsubscribed, ... }] in priority
// order (the first source that names a person decides the letter they get).
// invited: Set of emails that already have a row on the invites board.
// → { send: [candidate], skipped: [{ candidate, why }] }
// invitedNames: Set of full names (fullName()) that already have a row.
// exclude: Set of emails left out of this run by hand (BACKFILL_EXCLUDE).
export function planInvites(candidates, { index, invited, invitedNames = new Set(), exclude = new Set(), max = Infinity }) {
  const send = [], skipped = [];
  const seenEmails = new Set(), seenNames = new Set();
  for (const c of candidates) {
    // Without an address nobody can be written to — and a card without one must
    // not shadow the same person arriving later from a source that has it.
    if (!c.email) { skipped.push({ candidate: c, why: "no email" }); continue; }
    const emails = [...new Set([c.email, ...(c.emails || [])].filter(Boolean))];
    const name = fullName(c.name);
    let why = null;
    if (emails.some((e) => seenEmails.has(e)) || (name && seenNames.has(name))) why = "duplicate";
    for (const e of emails) seenEmails.add(e);
    if (name) seenNames.add(name);
    if (why) { skipped.push({ candidate: c, why }); continue; }

    const sig = findSignature(index, { ...c, emails });
    if (sig) why = `signed (${sig.how}${sig.date ? ", " + sig.date : ""})`;
    else if (/^test\b/i.test(String(c.name || "").trim())) why = "test entry";
    else if (emails.some((e) => exclude.has(e))) why = "left out by hand";
    else if (c.blocked) why = c.blocked;
    else if (looksMistyped(c.email)) why = "address looks mistyped";
    else if (isRoleMailbox(c.email)) why = "shared mailbox";
    else if (/passed away/i.test(c.name || "")) why = "passed away";
    else if (emails.some((e) => invited.has(e))) why = "already invited";
    else if (name && invitedNames.has(name)) why = "already invited under the same name";
    else if (c.unsubscribed) why = "unsubscribed";
    else if (send.length >= max) why = "over the per-run limit, next run";
    if (why) skipped.push({ candidate: c, why });
    else send.push(c);
  }
  return { send, skipped };
}

// The personal form link: name and email pre-filled, the code in the hidden
// «invite» tag. The form asks for the name in Latin letters, so a name in any
// other script is left for the person to type.
export function personalLink(base, { name = "", email = "", code = "" } = {}) {
  // encodeURIComponent, not URLSearchParams: a space must travel as %20 (as
  // monday's own examples write it), never as «+».
  const n = String(name || "").replace(/\s+/g, " ").trim();
  const params = [];
  if (/^[A-Za-z][A-Za-z .'-]*$/.test(n)) params.push(["name", n]);
  if (normEmail(email)) params.push(["email", normEmail(email)]);
  if (code) params.push(["invite", code]);
  if (!params.length) return base;
  return base + (base.includes("?") ? "&" : "?") + params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
}

// 12 hex characters: not guessable, short enough for a URL.
export const newCode = (bytes = randomBytes(6)) => Buffer.from(bytes).toString("hex");

// What an open invite needs today: "remind", "give up" or nothing.
// lastEmailed / invitedAt are YYYY-MM-DD in New York; today likewise.
export function reminderDue({ lastEmailed, invitedAt, reminders = 0 }, today) {
  const last = lastEmailed || invitedAt;
  if (!last || !today) return null;
  const days = (Date.parse(today) - Date.parse(last)) / 86400000;
  if (!(days >= REMIND_EVERY_DAYS)) return null;
  return reminders >= MAX_REMINDERS ? "give up" : "remind";
}

// Is this sign-up due for the automatic invite: newer than START, inside the
// window, and at least minAge minutes old (the robot: MIN_AGE_MINUTES; the
// webhook: WEBHOOK_MIN_AGE_MINUTES)?
export function inWindow(createdAt, now = new Date(), minAge = MIN_AGE_MINUTES) {
  const t = Date.parse(createdAt || "");
  if (!Number.isFinite(t)) return false;
  return t >= Date.parse(START) && t >= now.getTime() - WINDOW_DAYS * 86400000 && t <= now.getTime() - minAge * 60000;
}

// The old form's agreement answer, or the team's hand mark in it: «signed».
// (On other boards the same column was reused for unrelated answers.)
export const oldFormSigned = (text) => /sign|подпис/i.test(String(text || ""));

// A people column value → user ids: {"personsAndTeams":[{"id":1,"kind":"person"}]}.
export function personIds(value) {
  try {
    return (JSON.parse(value || "{}").personsAndTeams || []).filter((p) => p.kind === "person").map((p) => String(p.id));
  } catch { return []; }
}

// An email column: the address is in value.email; text may carry a label.
export function emailFromColumn(col) {
  try { const e = normEmail(JSON.parse(col?.value || "{}").email); if (e) return e; } catch {}
  return normEmail(col?.text);
}

// ── From monday items to people and signatures ──────────────────────────────
// Shared by the robot and the webhook, so both decide from the same facts.
// Items are what items_page returns: { id, name, created_at, group { id },
// column_values [{ id, text, value, linked_item_ids }] }.

export const MEMBERS_BOARD = 18425190164; // «Community Members»
export const MEMBER_COLS = {
  email: "email_mm5ysnnh", otherEmails: "text_mm63j91w", agreementSigned: "date_mm63tz8c",
  subscription: "color_mm63k40g", preferredName: "text_mm7bydss", eventsLed: "board_relation_mm63b63v",
};
export const signupColumns = (b) => [b.email, b.member, b.oldAgreement, b.agreementStatus, b.location, b.phone].filter(Boolean);
export const signupBoard = (id) => SIGNUP_BOARDS.find((b) => String(b.board) === String(id)) || null;

const ACCOUNT = "https://qaravan.monday.com";
export const itemUrl = (board, id) => `${ACCOUNT}/boards/${board}/pulses/${id}`;
export const col = (it, id) => (it.column_values || []).find((c) => c.id === id);
export const txt = (it, id) => (col(it, id)?.text || "").trim();
export const links = (it, id) => (col(it, id)?.linked_item_ids || []).map(String);
export const day = (s) => (/^\d{4}-\d{2}-\d{2}/.test(s || "") ? s.slice(0, 10) : "");

export function memberFrom(m) {
  const email = emailFromColumn(col(m, MEMBER_COLS.email));
  return {
    id: String(m.id), name: m.name, email,
    emails: [...new Set([email, ...txt(m, MEMBER_COLS.otherEmails).split(/[,;\s]+/).map(normEmail)].filter(Boolean))],
    agreementDate: day(txt(m, MEMBER_COLS.agreementSigned)),
    unsubscribed: txt(m, MEMBER_COLS.subscription) === "Unsubscribed",
    preferred: txt(m, MEMBER_COLS.preferredName),
    ledIds: links(m, MEMBER_COLS.eventsLed),
  };
}

// The signature date is the day the form was sent: «Today's Date» sometimes holds a birthday.
export const signatureFrom = (it) => ({
  itemName: it.name,
  name: txt(it, AGREEMENT_COLS.name),
  email: txt(it, AGREEMENT_COLS.email),
  date: day(it.created_at) || day(txt(it, AGREEMENT_COLS.date)),
  memberIds: links(it, AGREEMENT_COLS.member),
  invite: txt(it, AGREEMENT_COLS.invite),
});

// signupItems: [{ b, it }] — b is the SIGNUP_BOARDS entry the item is from.
// → the people on the sign-up boards, every signature (the old forms' marks
//   on those rows included) and the index to look them up in.
export function assemble({ signupItems, memberItems, agreementItems }) {
  const members = memberItems.map(memberFrom);
  const memberById = new Map(members.map((m) => [m.id, m]));
  const memberByEmail = new Map();
  for (const m of members) for (const e of m.emails) if (!memberByEmail.has(e)) memberByEmail.set(e, m);
  const signatures = agreementItems.map(signatureFrom);
  const signups = [];
  let oldForm = 0;
  for (const { b, it } of signupItems) {
    const email = emailFromColumn(col(it, b.email));
    const linked = b.member ? links(it, b.member) : [];
    const m = linked.map((id) => memberById.get(id)).find(Boolean) || memberByEmail.get(email);
    const person = {
      board: b.board, id: String(it.id), name: it.name, email,
      emails: [...new Set([email, ...(m?.emails || [])].filter(Boolean))],
      memberIds: m ? [m.id] : linked,
      altNames: m ? [m.name] : [],
      createdAt: it.created_at, groupId: it.group?.id,
      source: b.source, sourceUrl: itemUrl(b.board, it.id),
      unsubscribed: !!m?.unsubscribed, greet: greetName(it.name, m?.preferred),
      russia: NEVER_BACKFILL_GROUPS.includes(it.group?.id) ? "past volunteers / in Russia group"
        : inRussia({ location: b.location ? txt(it, b.location) : "", phoneValue: b.phone ? col(it, b.phone)?.value : null }) ? "lives in Russia" : "",
    };
    signups.push(person);
    const oldSigned = (b.oldAgreement && oldFormSigned(txt(it, b.oldAgreement))) || (b.agreementStatus && txt(it, b.agreementStatus) === "Signed");
    if (oldSigned) { oldForm++; signatures.push({ itemName: it.name, email, date: "", memberIds: person.memberIds }); }
  }
  return { members, memberById, memberByEmail, signups, signatures, oldForm, index: signatureIndex(signatures, members) };
}

// The invites board → who already has a row, by email and by full name.
export function invitedSets(inviteItems) {
  const invited = new Set(), invitedNames = new Set();
  for (const it of inviteItems) {
    const e = emailFromColumn(col(it, INVITE_COLS.email));
    if (e) invited.add(e);
    const n = fullName(it.name);
    if (n) invitedNames.add(n);
  }
  return { invited, invitedNames };
}

// The invites-board row written before the first email.
export const inviteRow = (c, { code, today }) => ({
  [INVITE_COLS.email]: { email: c.email, text: c.email },
  [INVITE_COLS.source]: { labels: [c.source] },
  [INVITE_COLS.status]: { label: INVITE_STATUS.invited },
  [INVITE_COLS.invited]: { date: today },
  [INVITE_COLS.lastEmailed]: { date: today },
  [INVITE_COLS.reminders]: "0",
  [INVITE_COLS.code]: code,
  [INVITE_COLS.item]: { url: c.sourceUrl, text: c.source },
});

// Two senders racing for one person (the webhook called twice, or the webhook
// and the robot): each writes its row, then looks again; the lowest row id for
// the address or full name sends, the others step back. → true if mine sends.
export function firstRow(inviteItems, mine, c) {
  const name = fullName(c.name);
  const same = inviteItems.filter((it) => emailFromColumn(col(it, INVITE_COLS.email)) === c.email || (name && fullName(it.name) === name));
  return same.every((it) => BigInt(it.id) >= BigInt(mine));
}

// "2026-10-05" in New York.
export const nyDate = (now) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
