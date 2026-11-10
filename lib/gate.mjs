// Small checks shared by the endpoints: secrets compared in constant time, the cron secret only from
// the Authorization header, and email addresses masked before they reach a log.
import { createHash, timingSafeEqual } from "node:crypto";

// Constant time whatever the lengths: both sides are hashed first. An empty expected value never matches.
export function safeEqual(want, got) {
  if (typeof want !== "string" || !want || typeof got !== "string") return false;
  const h = (s) => createHash("sha256").update(s, "utf8").digest();
  return timingSafeEqual(h(want), h(got));
}

// Manual and cron runs: `Authorization: Bearer <CRON_SECRET>` (what Vercel's cron sends). Never the query
// string: a secret in a URL ends up in logs, browser history and Referer headers.
export function cronAuthed(req, secret = process.env.CRON_SECRET) {
  if (!secret) return false;
  const h = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || "");
  return safeEqual(`Bearer ${secret}`, h);
}

// someone@example.org → s***@example.org, for error logs.
export function maskEmail(e) {
  const s = String(e || "").trim();
  const at = s.lastIndexOf("@");
  if (at < 1) return s ? "***" : "";
  return `${s[0]}***${s.slice(at)}`;
}
// A list of addresses ("a@x.org, b@y.org") masked one by one.
export const maskEmails = (list) => String(list || "").split(/\s*,\s*/).filter(Boolean).map(maskEmail).join(", ");

// Text people typed, on its way into markup we don't write ourselves: a monday update (its body is HTML) or a
// Slack mrkdwn block (where `<…>` is a link or a mention and `&` starts an entity). Both need exactly these three.
export const escText = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// A best-effort cap kept in this function instance's memory: at most `max` uses of `key` in `windowMs`.
// Vercel runs several short-lived instances, so it slows a burst down but is no hard daily limit (this
// repository has no database); the bot check in front of each form is the real gate.
const buckets = new Map();
export function allow(bucket, key, max, windowMs, now = Date.now()) {
  if (!key) return true;
  const k = `${bucket}\u0000${key}`;
  const list = (buckets.get(k) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) { buckets.set(k, list); return false; }
  list.push(now); buckets.set(k, list);
  if (buckets.size > 5000) for (const [kk, v] of buckets) if (!v.some((t) => now - t < windowMs)) buckets.delete(kk);
  return true;
}
export const resetLimits = () => buckets.clear(); // tests
