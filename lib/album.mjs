// Создание фотоальбома события в Google Photos — общая логика для вебхука
// /api/album-webhook (кнопка «▶️ Create now» и смена даты в monday).
// Форма (api/submit.mjs) держит свой запасной путь с тем же поведением.
//
// Альбомы создаёт только приложение: Google разрешает API класть файлы лишь
// в свои альбомы, а «доступ по ссылке» с марта 2025 включает только человек.
import { createHash } from "node:crypto";

const MONTHS_RU = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
export function ruDate(text) {
  const m = (text || "").match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}))?/);
  if (!m) return "";
  const [, y, mo, d, hh, mm] = m;
  const t = hh === undefined ? "" : `, ${Number(hh) % 12 || 12}:${mm} ${Number(hh) < 12 ? "AM" : "PM"}`;
  return `${Number(d)} ${MONTHS_RU[Number(mo) - 1]} ${y}${t}`;
}

// Тот же текст собирает и ежедневный робот (events-robot/robot/albums.mjs) —
// состав менять синхронно, иначе разъедутся отпечатки синка.
export function composeAlbumInfo(ev) {
  return [
    ev.ruName && ev.ruName !== ev.name ? `${ev.name} / ${ev.ruName}` : ev.name,
    ruDate(ev.date), ev.location,
    ev.leads ? `Ведущие: ${ev.leads}` : "",
    ev.partiful,
    "Фото и видео гостей и ведущих, загружены через форму отзыва QARAVAN. Загружая, авторы согласились на использование в материалах и соцсетях организации.",
  ].filter(Boolean).join("\n");
}

export const infoFingerprint = (info) => createHash("sha256").update(info).digest("hex").slice(0, 16);

// Название альбома: «<событие> — QARAVAN», у событий до переименования
// организации (RUSA LGBTQ+ стала QARAVAN весной 2025) — «<событие> — RUSA LGBTQ».
// То же правило в events-robot (robot/lib/album-title.mjs): альбомы ищутся и по
// названию, менять вместе. date — «YYYY-MM-DD…» с колонки date4; без даты — QARAVAN.
export const RENAMED_ON = "2025-04-23";
export function albumTitle(name, date) {
  const d = String(date || "").slice(0, 10);
  return `${name} — ${d && d < RENAMED_ON ? "RUSA LGBTQ" : "QARAVAN"}`;
}

export async function googleAppendToken() {
  const j = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
      scope: "https://www.googleapis.com/auth/photoslibrary.appendonly",
    }),
  }).then((r) => r.json());
  if (!j.access_token) throw new Error("google auth");
  return j.access_token;
}

// Создаёт альбом с инфоблоком, возвращает { albumId, ownerUrl, info }.
export async function createEventAlbum(ev) {
  const token = await googleAppendToken();
  const a = await fetch("https://photoslibrary.googleapis.com/v1/albums", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ album: { title: albumTitle(ev.name, ev.date) } }),
  }).then((r) => r.json());
  if (!a.id) throw new Error("album create: " + JSON.stringify(a).slice(0, 200));
  const info = composeAlbumInfo(ev);
  await fetch(`https://photoslibrary.googleapis.com/v1/albums/${a.id}:addEnrichment`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ newEnrichmentItem: { textEnrichment: { text: info.slice(0, 1000) } }, albumPosition: { position: "FIRST_IN_ALBUM" } }),
  }).catch((e) => console.error("album enrichment failed:", e.message));
  return { albumId: a.id, ownerUrl: a.productUrl || `https://photos.google.com/lr/album/${a.id}`, info };
}
