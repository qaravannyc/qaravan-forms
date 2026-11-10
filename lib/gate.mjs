// Small checks shared by the endpoints: secrets compared in constant time, the cron secret only from
// the Authorization header, email addresses masked before they reach a log, typed text escaped for monday
// and Slack, a best-effort rate cap, and the proofs that a request comes from a real visitor (Turnstile,
// the personal link from our emails, the photo upload ticket).
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

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

// ---------- bot check and proofs of a real visitor ----------
// The visitor's address as Vercel reports it (x-real-ip, else the first x-forwarded-for).
export function clientIp(req) {
  const h = (req && req.headers) || {};
  return String(h["x-real-ip"] || String(h["x-forwarded-for"] || "").split(",")[0] || "").trim();
}

// Cloudflare Turnstile, checked with TURNSTILE_SECRET_KEY. false when no key, no token or Cloudflare says no.
export async function turnstileOk(token, ip = "", env = process.env) {
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret || typeof token !== "string" || !token || token.length > 2048) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set("remoteip", ip);
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    const j = await r.json();
    return j && j.success === true;
  } catch (e) { console.error("turnstile check failed:", e.message); return false; }
}

const hmac16 = (secret, msg) => createHmac("sha256", secret).update(msg).digest("hex").slice(0, 16);
// The personal link from our survey emails (?p=<attendeeId>.<sig>, AGENTS.md "Signatures"): signed for this
// event (eventId:attendeeId), or the weekly form's (multi:attendeeId). Needs UNSUB_SECRET.
export function personalLinkOk(eventId, p, env = process.env) {
  const secret = env.UNSUB_SECRET;
  const m = String(p || "").match(/^(\d+)\.([0-9a-f]{16})$/);
  if (!secret || !m || !/^\d+$/.test(String(eventId || ""))) return false;
  return safeEqual(hmac16(secret, `${eventId}:${m[1]}`), m[2]) || safeEqual(hmac16(secret, `multi:${m[1]}`), m[2]);
}

// A ticket for one event's photo uploads, handed out with an upload token (api/photos-token.mjs) and shown by
// the rescue upload (api/rescue-file.mjs): "<expiry ms>.<sig>", valid 24 hours. "" without UNSUB_SECRET.
const TICKET_MS = 24 * 3600e3;
export function photoTicket(eventId, now = Date.now(), env = process.env) {
  if (!env.UNSUB_SECRET || !/^\d+$/.test(String(eventId || ""))) return "";
  const exp = now + TICKET_MS;
  return `${exp}.${hmac16(env.UNSUB_SECRET, `photos:${eventId}:${exp}`)}`;
}
export function photoTicketOk(eventId, ticket, now = Date.now(), env = process.env) {
  const m = String(ticket || "").match(/^(\d{13})\.([0-9a-f]{16})$/);
  if (!env.UNSUB_SECRET || !m || !/^\d+$/.test(String(eventId || ""))) return false;
  const exp = Number(m[1]);
  return exp > now && exp - now <= TICKET_MS && safeEqual(hmac16(env.UNSUB_SECRET, `photos:${eventId}:${exp}`), m[2]);
}
