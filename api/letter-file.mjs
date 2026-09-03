// POST /api/letter-file?rid=<intake id>&kind=caseFiles|idFiles|declFiles&name=<filename>
// Body: the file bytes. Files from the letter intake form go straight into
// the Files column on the person's row; which file is which (case document,
// ID, personal statement) is remembered in the row's raw JSON and the update. The row is created on the spot if the person
// uploads before the first autosave landed.
//
// Vercel caps request bodies at 4.5 MB, so the page shrinks photos before
// sending (letter/app.js); PDFs above the cap are refused with a clear message.
// monday keeps every uploaded file: "Remove" in the form only takes the name
// off the person's list, so staff may see a replaced photo next to the new one.
import { C, RID_RX, MONDAY_FILE, monday, findByRid, createRow } from "../lib/letter-board.mjs";

const KIND = { caseFiles: C.files, idFiles: C.files, declFiles: C.files }; // one Files column; the kind is kept in the row's raw JSON
const MAX_BYTES = 4 * 1024 * 1024;

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.statusCode = 405; return res.end('{"ok":false}'); }
  const u = new URL(req.url, "https://x");
  const rid = String(u.searchParams.get("rid") || "").trim();
  const kind = String(u.searchParams.get("kind") || "");
  const name = String(u.searchParams.get("name") || "file").replace(/[\r\n"\\/]/g, "").slice(0, 120) || "file";
  if (!RID_RX.test(rid) || !KIND[kind]) { res.statusCode = 400; return res.end('{"ok":false,"error":"bad request"}'); }

  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > MAX_BYTES) { res.statusCode = 413; return res.end('{"ok":false,"error":"too big"}'); } chunks.push(c); }
  const buf = Buffer.concat(chunks);
  if (!buf.length) { res.statusCode = 400; return res.end('{"ok":false,"error":"empty"}'); }

  try {
    let row = await findByRid(rid);
    const itemId = row ? row.id : await createRow(rid);
    const form = new FormData();
    form.append("query", `mutation ($file: File!) { add_file_to_column (item_id: ${itemId}, column_id: "${KIND[kind]}", file: $file) { id } }`);
    form.append("map", '{"f":"variables.file"}');
    form.append("f", new Blob([buf]), ({ caseFiles: "case-", idFiles: "id-", declFiles: "statement-" }[kind] || "") + name);
    const up = await fetch(MONDAY_FILE, { method: "POST", headers: { Authorization: process.env.MONDAY_TOKEN, "API-Version": "2024-10" }, body: form }).then((r) => r.json());
    if (!up.data?.add_file_to_column?.id) { console.error("letter file upload failed:", JSON.stringify(up).slice(0, 300)); res.statusCode = 502; return res.end('{"ok":false,"error":"upload failed"}'); }

    // Remember the name in the row's raw JSON so the resume link and staff summary know about it.
    const raw = (row && row.raw) || { rid, files: {} };
    raw.files = raw.files && typeof raw.files === "object" ? raw.files : {};
    raw.files[kind] = (raw.files[kind] || []).concat([name]).slice(-12);
    if (kind === "caseFiles" && raw.submitted) raw.docLater = true;
    await monday(`mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id:$b, item_id:$i, column_values:$v) { id } }`,
      { b: "18429448469", i: String(itemId), v: JSON.stringify({ [C.raw]: { text: JSON.stringify(raw).slice(0, 9000) }, ...(kind === "caseFiles" ? { [C.caseDoc]: { label: raw.submitted ? "Added later" : "Uploaded" } } : {}) }) });
    return res.end(JSON.stringify({ ok: true, name, assetId: up.data.add_file_to_column.id }));
  } catch (e) {
    console.error("letter-file failed:", e.message);
    res.statusCode = 500; return res.end('{"ok":false}');
  }
}
