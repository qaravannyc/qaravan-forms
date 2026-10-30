// Local preview of the movie club pages (/club, /club/welcome) against fake monday, Stripe,
// Gmail and TMDB (tools/club-fake.mjs): nothing is written anywhere.
// Usage: node tools/club-dev.mjs [port]   — then open http://localhost:3998/club
// GET /__db shows the fake boards and the emails that would have gone out;
// GET /__pay?key=<member key>&tier=10 fakes a finished Stripe checkout and opens /club/welcome.
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { makeDB, install, seedFilms } from "./club-fake.mjs";

const root = new URL("..", import.meta.url).pathname;
const port = +(process.argv[2] || 3998);
Object.assign(process.env, {
  UNSUB_SECRET: "dev", GOOGLE_REFRESH_TOKEN: "fake", STRIPE_SECRET_KEY: "rk_test_fake", TMDB_API_KEY: "0123456789abcdef0123456789abcdef",
  CLUB_WHATSAPP_URL: "https://chat.whatsapp.com/DEVLINK", CLUB_LINK_5: `http://localhost:${port}/__pay?tier=5`,
  CLUB_LINK_10: `http://localhost:${port}/__pay?tier=10`, CLUB_LINK_15: `http://localhost:${port}/__pay?tier=15`,
});
const DB = makeDB();
install(DB);
seedFilms(DB, JSON.parse(process.env.CLUB_FILMS || "null") || [
  { title: "Dallas Buyers Club", year: 2013, en: "Texas, 1985: a man diagnosed with HIV smuggles in unapproved drugs and starts a club through which other patients get them.", ru: "Техас, 1985 год: у электрика находят ВИЧ, он ввозит в США неодобренные лекарства и открывает клуб, через который их получают другие больные." },
  { title: "Selma", year: 2014, en: "Alabama, 1965: the marches from Selma to Montgomery that led to the Voting Rights Act.", ru: "Алабама, 1965 год: марши из Сельмы в Монтгомери, после которых приняли Закон об избирательных правах." },
  { title: "Rustin", year: 2023, en: "1963: Bayard Rustin, a gay Black activist, organizes the March on Washington.", ru: "1963 год: Баярд Растин, чернокожий открытый гей, организует Марш на Вашингтон." },
  { title: "Milk", year: 2008, en: "San Francisco, 1977 to 1978: Harvey Milk becomes one of the first openly gay people elected to office in the US.", ru: "Сан-Франциско, 1977–1978: Харви Милк становится одним из первых открытых геев, избранных на должность в США." },
  { title: "Loving", year: 2016, en: "Virginia, 1958 to 1967: an interracial couple is arrested for their marriage and takes the case to the Supreme Court.", ru: "Вирджиния, 1958–1967: межрасовую пару арестовывают за брак, и их дело доходит до Верховного суда." },
  { title: "Call Jane", year: 2022, en: "Chicago, late 1960s: the underground network that helped women get abortions before Roe v. Wade.", ru: "Чикаго, конец 1960-х: подпольная сеть, которая помогала женщинам сделать аборт до решения «Роу против Уэйда»." },
]);
const survey = (await import("../api/survey.mjs")).default;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2" };
const PAGES = { "/club": "/club/index.html", "/club/": "/club/index.html", "/club/welcome": "/club/welcome.html" };

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  try {
    if (u.pathname === "/__db") { res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify(DB, null, 2)); }
    if (u.pathname === "/__pay") {
      const key = u.searchParams.get("client_reference_id"), tier = +u.searchParams.get("tier");
      const id = "cs_test_dev" + Date.now();
      DB.sessions[id] = { id, status: "complete", payment_status: "paid", client_reference_id: key, amount_total: tier * 100, customer: "cus_dev", subscription: "sub_dev", customer_details: { email: u.searchParams.get("prefilled_email") } };
      res.statusCode = 302; res.setHeader("Location", `/club/welcome?session_id=${id}`); return res.end();
    }
    if (u.pathname.startsWith("/api/") || u.pathname === "/club/cancel") return await survey(req, res);
    const file = join(root, PAGES[u.pathname] || u.pathname);
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) { res.statusCode = 404; return res.end("not found"); }
    res.setHeader("Content-Type", TYPES[extname(file)] || "application/octet-stream");
    res.end(readFileSync(file));
  } catch (e) { console.error(e); res.statusCode = 500; res.end(String(e)); }
}).listen(port, () => console.log(`movie club preview: http://localhost:${port}/club  (fake boards: /__db)`));
