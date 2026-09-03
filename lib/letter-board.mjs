// Letters of Support — Immigration Cases (monday board 18429448469): column
// map, label maps and the small monday client shared by api/letter.mjs and
// api/letter-file.mjs. Board structure is named in English (repository rule);
// the member's own words are stored verbatim in whatever language they wrote.
//
// Column ids come from the board; if a column is ever deleted and re-created
// its id changes and must be updated here. Status/dropdown labels must match
// the board CHARACTER FOR CHARACTER or monday will create duplicate labels.
export const MONDAY = "https://api.monday.com/v2";
export const MONDAY_FILE = "https://api.monday.com/v2/file";
export const BOARD = "18429448469";
export const GROUP_ANSWERS = "group_mm6vd9vd"; // "Form — answers received"
export const GROUP_DRAFTS = "group_mm6vn84d";  // "Form — started, not finished"

export const C = {
  // columns that existed before the form
  firstName: "text_mm6t5fwm", lastName: "text_mm6tdbn6", firstContact: "text_mm6trpv7",
  venue: "color_mm6t680h", caseType: "color_mm6txvgp", aNumber: "text_mm6t6ch3",
  phone: "phone_mm6t8pt2", letterStatus: "color_mm6tgw9r", involvement: "long_text_mm6ty7vy",
  attorney: "text_mm6t2vmt", email: "email_mm6tv0gg", source: "text_mm6tnsh",
  deadline: "date_mm6tt8s6", country: "text_mm6tbmev",
  // columns added for the form (Sep 3, 2026), trimmed to what staff scan
  rid: "text_mm6vmdw4",            // ⚙️ Intake id
  formStatus: "color_mm6vrkj1",    // Form status: In progress | Submitted
  progress: "text_mm6vy8gv",       // Form progress: "Q 14 of 21 · 62% · RU" / "Submitted 2026-09-03 · 18 min · RU"
  resumeLink: "link_mm6v31pr",     // Resume link
  dob: "date_mm6vvbwa",            // Date of birth
  known: "text_mm6v7xd7",          // Known as · pronouns
  messengers: "text_mm6vq0qb",     // Messengers: Telegram · WhatsApp · Instagram
  followLang: "color_mm6v3bzt",    // Follow-up language: Russian | English
  proceeding: "color_mm6v50cx",    // Proceeding (7 labels)
  caseDoc: "color_mm6vv6g7",       // Case document: Uploaded | Will send later | Added later
  files: "file_mm6vkmk9",          // Files: case documents, ID photo, personal statement
  identities: "dropdown_mm6vpxeh", // Identities & experiences
  attEmail: "email_mm6vf63b",      // Attorney email (the letter goes there)
  keyEvents: "long_text_mm6vwk4x", // Key events at home
  otherLetters: "long_text_mm6vrvev", // Other support letters
  refs: "long_text_mm6vgfen",      // References at QARAVAN
  roles: "dropdown_mm6vrmrg",      // Roles at QARAVAN
  partner: "long_text_mm6vqdmv",   // Partner
  consents: "boolean_mm6vjfb1",    // Consents given (answers true · share with attorney · may contact)
  anythingElse: "long_text_mm6vz4rq", // Anything else (+ details typed for "Other")
  path: "long_text_mm6v1216",      // ⚙️ Path log
  raw: "long_text_mm6vtrcm",       // ⚙️ Raw answers (JSON)
};

// form code → board label
export const L = {
  proceeding: { removal: "Removal (defensive asylum)", affirmative: "Affirmative asylum (USCIS)", withholding: "Withholding of removal", cat: "Convention Against Torture", parole: "Parole / humanitarian parole", uvisa: "U-visa / T-visa", other: "Other" },
  // the board's older Case Type / Venue columns, derived from the proceeding
  caseType: { removal: "Asylum — defensive (court)", affirmative: "Asylum — affirmative (USCIS)", withholding: "Withholding of removal", cat: "Other", parole: "Other", uvisa: "Visa petition (O-1/P-3/other)", other: "Other" },
  venue: { removal: "Immigration Court", affirmative: "USCIS Asylum Office", withholding: "Immigration Court", cat: "Immigration Court", parole: "USCIS (other)", uvisa: "USCIS (other)", other: "Other" },
  identities: { gay: "Gay", lesbian: "Lesbian", bi: "Bisexual", transw: "Trans woman", transm: "Trans man", nb: "Nonbinary", intersex: "Intersex", ethnic: "Ethnic minority", religious: "Religious minority", activist: "Political activist or dissident", journalist: "Journalist", gbv: "Survivor of gender-based violence", trafficking: "Survivor of trafficking", family: "Family member of a targeted person", other: "Other" },
  found: { friend: "Friend", event: "Event", group: "Support group", helpdesk: "Help Desk", telegram: "Telegram", org: "Another organization", other: "Other" },
  activities: { groups: "Support groups", events: "Events and outings", oneonone: "They helped me one-on-one", volunteer: "We volunteer together", chats: "Community chats", before: "We knew each other before QARAVAN", other: "Other" },
  freq: { week: "Every week", month: "Every month", year: "A few times a year", rarely: "Rarely" },
  counts: { "1-2": "1–2 times", "3-5": "3–5 times", "6-10": "6–10 times", "10+": "more than 10 times" },
  roles: { volunteer: "Volunteer", lead: "Event lead (captain)", facilitator: "Group facilitator", board: "Board member", none: "No role, takes part" },
  partner: { yes: "Yes", no: "No", pnts: "Rather not say" },
  yesno: { yes: "Yes", no: "No" },
  pstatement: { yes: "Yes", maybe: "Maybe, ask them", no: "No" },
  letterStatus: { received: "Received", waiting: "Asked, still waiting", notasked: "Not yet asked" },
  pronouns: { he: "he/him", she: "she/her", they: "they/them", hethey: "he/they", shethey: "she/they", any: "any pronouns", none: "no pronouns", other: "other" },
  lang: { ru: "RU", en: "EN", uk: "UK", ka: "KA", uz: "UZ", kk: "KK" },
  followLang: { ru: "Russian", en: "English" },
};

export const LANGS = ["ru", "en", "uk", "ka", "uz", "kk"];
export const RID_RX = /^[0-9a-zA-Z-]{12,64}$/;

export async function monday(query, variables = {}) {
  const r = await fetch(MONDAY, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: process.env.MONDAY_TOKEN, "API-Version": "2024-10" },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
}

// The person's row, found by intake id. Returns {id, group, raw} or null.
export async function findByRid(rid) {
  const d = await monday(
    `query ($b: ID!, $v: [String]!) { items_page_by_column_values(board_id: $b, limit: 1, columns: [{column_id: "${C.rid}", column_values: $v}]) { items { id group { id } column_values(ids: ["${C.raw}"]) { id text } } } }`,
    { b: BOARD, v: [rid] }
  );
  const it = d?.items_page_by_column_values?.items?.[0];
  if (!it) return null;
  let raw = null;
  try { raw = JSON.parse(it.column_values?.find((c) => c.id === C.raw)?.text || "null"); } catch (e) { raw = null; }
  return { id: it.id, group: it.group?.id, raw: raw && typeof raw === "object" ? raw : null };
}

// Creates the row for a brand-new intake id: a bare item in the drafts group,
// tagged with the id, so files and answers arriving in any order land on it.
export async function createRow(rid, name) {
  const d = await monday(
    `mutation ($b: ID!, $g: String!, $n: String!, $v: JSON!) { create_item(board_id:$b, group_id:$g, item_name:$n, column_values:$v, create_labels_if_missing:true) { id } }`,
    { b: BOARD, g: GROUP_DRAFTS, n: name || `Intake ${rid.slice(0, 8)}`, v: JSON.stringify({ [C.rid]: rid, [C.formStatus]: { label: "In progress" } }) }
  );
  return d.create_item.id;
}
