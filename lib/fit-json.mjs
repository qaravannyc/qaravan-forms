// Two small guards against the 2026-11-16 incident (one person got the letter form's link email 13 times).
//
// fitJson: text kept in a board column to be read back must always parse. A JSON text cut in the middle reads back as
// nothing, and whatever it remembered ("this email already went") is forgotten. So when it is too long, its longest strings
// are shortened until it fits; it is never cut.
//
// claimOnce: this instance's memory of emails that go once (a form's link, a meeting's question to its leaders). Not
// durable, so it is never the only guard, but it holds when the board's own note can't be read or was written a second ago.
export function fitJson(value, max) {
  let s = JSON.stringify(value);
  if (s.length <= max) return s;
  const body = JSON.parse(s), strings = [];
  (function walk(o) { for (const k of Object.keys(o || {})) { const v = o[k]; if (typeof v === "string") strings.push({ o, k }); else if (v && typeof v === "object") walk(v); } })(body);
  for (let i = 0; i < 80 && (s = JSON.stringify(body)).length > max; i++) {
    const big = strings.reduce((m, x) => (x.o[x.k].length > (m ? m.o[m.k].length : 0) ? x : m), null);
    if (!big || big.o[big.k].length < 40) break;
    big.o[big.k] = big.o[big.k].slice(0, Math.floor(big.o[big.k].length / 2));
  }
  if (s.length <= max) return s;
  // still too long (very many short values): keep the top-level values that aren't lists or objects
  const flat = {}; for (const [k, v] of Object.entries(body)) if (v === null || typeof v !== "object") flat[k] = v;
  s = JSON.stringify(flat);
  return s.length <= max ? s : "{}";
}

const CLAIMS = new Map();
/** true the first time a key is seen in this instance within ms; false after that. */
export function claimOnce(key, ms = 24 * 3600000, now = Date.now()) {
  const at = CLAIMS.get(key);
  if (at && Math.abs(now - at) < ms) return false;
  if (CLAIMS.size > 5000) CLAIMS.clear();
  CLAIMS.set(key, now);
  return true;
}
export function unclaim(key) { CLAIMS.delete(key); }
