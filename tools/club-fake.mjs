// In-memory fakes of the monday, Stripe and TMDB APIs for the movie club (lib/club.mjs), used by
// tools/club.test.mjs and tools/club-dev.mjs. Only the calls lib/club.mjs makes are answered.
// install() replaces globalThis.fetch; DB holds the boards: DB.boards[boardId] = [{ id, name, cv }].
import { BOARD } from "../lib/club.mjs";

export function makeDB() {
  return { boards: { [BOARD.members]: [], [BOARD.films]: [], [BOARD.exceptions]: [] }, updates: [], mails: [], seq: 9000, sessions: {}, portal: [] };
}

const textOf = (v) => {
  if (v == null || v === "") return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (v.label != null) return v.label;
  if (v.labels) return v.labels.join(", ");
  if (v.email != null) return v.email;
  if (v.date != null) return v.date + (v.time ? ` ${v.time}` : "");
  if (v.url != null) return v.text || v.url;
  if (v.text != null) return v.text;
  return "";
};
const shape = (it) => ({ id: it.id, name: it.name, column_values: Object.entries(it.cv).map(([id, v]) => ({ id, text: textOf(v), value: v === "" ? null : JSON.stringify(v) })) });
const ok = (data) => new Response(JSON.stringify({ data }), { headers: { "Content-Type": "application/json" } });

export function seedFilms(DB, films) {
  for (const f of films) DB.boards[BOARD.films].push({ id: String(++DB.seq), name: f.title, cv: { film_year: String(f.year || ""), film_tmdb: f.tmdb || "", film_show: { label: "Yes" }, film_source: { label: "Season list" }, film_note_en: { text: f.en || "" }, film_note_ru: { text: f.ru || "" } } });
}

export function install(DB, realFetch = globalThis.fetch) {
  process.env.MONDAY_TOKEN ||= "fake";
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.startsWith("https://api.monday.com/v2")) {
      const { query: q, variables: v = {} } = JSON.parse(opts.body);
      const board = (id) => DB.boards[String(id)] || [];
      if (q.includes("items_page_by_column_values")) {
        const items = board(v.b).filter((it) => textOf(it.cv[v.c]) === v.v[0]).map(shape);
        return ok({ items_page_by_column_values: { items } });
      }
      if (q.includes("items_page(")) return ok({ boards: [{ items_page: { cursor: null, items: board(v.b[0]).map(shape) } }] });
      if (q.includes("items(ids")) return ok({ items: Object.values(DB.boards).flat().filter((it) => v.i.includes(it.id)).map(shape) });
      if (q.includes("create_item")) {
        const id = String(++DB.seq);
        board(v.b).push({ id, name: v.n, cv: JSON.parse(v.v) });
        return ok({ create_item: { id } });
      }
      if (q.includes("change_multiple_column_values")) {
        const it = board(v.b).find((x) => x.id === String(v.i));
        if (!it) return new Response(JSON.stringify({ errors: [{ message: "no item" }] }));
        Object.assign(it.cv, JSON.parse(v.v));
        return ok({ change_multiple_column_values: { id: it.id } });
      }
      if (q.includes("create_update")) { DB.updates.push({ item: v.i, body: v.t }); return ok({ create_update: { id: "u" + DB.updates.length } }); }
      return new Response(JSON.stringify({ errors: [{ message: "fake monday: unknown query " + q.slice(0, 80) }] }));
    }
    if (u.startsWith("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "fake" }));
    if (u.startsWith("https://gmail.googleapis.com/")) {
      const raw = Buffer.from(JSON.parse(opts.body).raw, "base64url").toString("utf8");
      const to = /^To: (.*)$/m.exec(raw)?.[1];
      const subj = Buffer.from(/Subject: =\?UTF-8\?B\?(.*)\?=/.exec(raw)?.[1] || "", "base64").toString("utf8");
      DB.mails.push({ to, subject: subj, html: raw.split("\r\n\r\n").slice(1).join("\r\n\r\n") });
      return new Response("{}");
    }
    if (u.startsWith("https://api.stripe.com/v1/checkout/sessions/")) {
      const s = DB.sessions[u.split("/").pop()];
      return s ? new Response(JSON.stringify(s)) : new Response(JSON.stringify({ error: { message: "No such session" } }), { status: 404 });
    }
    if (u.startsWith("https://api.stripe.com/v1/billing_portal/sessions")) {
      const form = new URLSearchParams(String(opts.body));
      DB.portal.push(Object.fromEntries(form));
      return new Response(JSON.stringify({ url: "https://billing.stripe.com/p/session/test_fake" }));
    }
    if (u.startsWith("https://api.themoviedb.org/3/search/movie")) {
      const q = new URL(u).searchParams.get("query");
      return new Response(JSON.stringify({ results: [{ id: 999001, title: q.replace(/^\w/, (c) => c.toUpperCase()), release_date: "1999-01-01", poster_path: "" }] }));
    }
    if (u.startsWith("https://api.themoviedb.org/3/movie/")) {
      const id = u.split("/movie/")[1].split("?")[0];
      return new Response(JSON.stringify({ id, poster_path: "", release_date: "2000-01-01", videos: { results: [{ site: "YouTube", type: "Trailer", official: true, key: "yt" + id }] }, translations: { translations: [{ iso_639_1: "ru", data: { title: "Фильм " + id } }] } }));
    }
    return realFetch(url, opts);
  };
}
