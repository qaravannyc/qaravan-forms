// The Community Agreement invite email, in the QARAVAN design system
// (2026-09 revision: https://claude.ai/artifact/LRUUfhr9BLYZL7eZdUdRHK), like
// the survey emails in robot/emails.mjs. The rules it follows:
//   • white ground, square shapes, no shadows, no tinted fills, no emoji;
//   • one regular-width face everywhere: Fira Sans, else Helvetica/Arial. Most
//     mail apps (Gmail first) load no web fonts, and the narrow fallback of the
//     system's Fira Sans Condensed (Arial Narrow) read as squeezed, so the
//     email keeps the condensed face out entirely;
//   • ink (#333333) text on white; the English is the muted second line;
//   • brand colour only as a flag: the yellow volunteering flag (with its thin
//     ink edge) before the eyebrow;
//   • the primary action is a solid ink button with a white label;
//   • links are ink with a 2 px sky underline;
//   • the logo is the official wordmark outlines, drawn to a PNG
//     (lib/wordmark-email.mjs, from qaravan-forms/assets/logo-wordmark.svg)
//     and sent inside the message, so it shows without loading remote images.
// One file, two identical copies — change both together: events-robot/robot/lib/
// and qaravan-forms/lib/ (so is lib/wordmark-email.mjs).
import { randomBytes } from "node:crypto";
import { WORDMARK_PNG_B64 } from "./wordmark-email.mjs";

const C = { ink: "#333333", muted: "#5e5a53", line: "#ece8de", white: "#ffffff", sky: "#0099cc", yellow: "#f8f36e" };
const FONT = `'Fira Sans','Helvetica Neue',Helvetica,Arial,sans-serif`;
const LOGO_CID = "qaravan-wordmark";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// A reminder is the same letter under its own subject and eyebrow.
const SUBJECT = "Action required: QARAVAN Community Agreement/Соглашение сообщества QARAVAN";
export const agreementSubject = ({ reminder = false } = {}) => (reminder ? `Reminder — ${SUBJECT}` : SUBJECT);

// One letter for everyone — new sign-ups, leads and volunteers — in the team's
// words (2026-09-28). English first, Russian second (the subject too), with a
// line at the very top telling Russian speakers their text is below.
const RU = {
  hello: (name) => (name ? `Привет, ${name}!` : "Привет!"),
  paragraphs: [
    "Вы получили это письмо, потому что проявили интерес к волонтёрству или уже волонтёрите с QARAVAN. Мы просим всех, кто ведёт события и волонтёрит с нами, подписать Соглашение сообщества.",
    "В нём наши общие правила: как мы бережём приватность и личные границы друг друга и как действовать, когда что-то идёт не так.",
    "Это займёт не более трёх минут.",
    "Спасибо вам большое за неравнодушие!",
  ],
};
const EN = {
  hello: (name) => (name ? `Hi ${name}!` : "Hi!"),
  paragraphs: [
    "You're receiving this email because you've shown interest in volunteering or already volunteer with QARAVAN. We ask everyone who leads events or volunteers with us to sign our Community Agreement.",
    "It sets out our shared rules: how we protect each other's privacy and personal boundaries, and what to do when something goes wrong.",
    "It takes no more than three minutes.",
    "Thank you so much for caring!",
  ],
};
const RU_BELOW = "Текст на русском — ниже";
const PREHEADER = `We ask everyone who leads events or volunteers with us to sign our Community Agreement. ${RU_BELOW}.`;
const BUTTON = "Read and sign the agreement";
const RU_LINK = "Прочитать и подписать соглашение";

export function agreementHtml({ name, link, reminder = false }) {
  const href = esc(link);
  const para = (t, { color = C.ink, size = 16, pt = 14, lang } = {}) =>
    `<p${lang ? ` lang="${lang}"` : ""} style="margin:0;padding-top:${pt}px;font-family:${FONT};font-size:${size}px;line-height:1.5;mso-line-height-rule:exactly;font-weight:400;color:${color};">${t}</p>`;
  const letter = (L, opts) => [para(esc(L.hello(name)), { ...opts, pt: 0 }), ...L.paragraphs.map((t) => para(esc(t), opts))].join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<!--[if !mso]><!--><link href="https://fonts.googleapis.com/css2?family=Fira+Sans:wght@400;600;700&display=swap" rel="stylesheet"><!--<![endif]-->
<title>QARAVAN Community Agreement</title>
<style>
@media only screen and (max-width:480px){
.q-pad{padding-left:20px !important;padding-right:20px !important;}
.q-btn a{display:block !important;text-align:center !important;}
}
</style>
</head>
<body style="margin:0;padding:0;background:${C.white};">
<span style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${esc(PREHEADER)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</span>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${C.white};">
<tr><td align="center" style="padding:24px 0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px;background:${C.white};">

<tr><td class="q-pad" style="padding:8px 32px 0;">
<a href="https://qaravan.org" style="display:inline-block;text-decoration:none;border:0;"><img src="cid:${LOGO_CID}" width="132" height="27" alt="qaravan" style="display:block;border:0;outline:none;text-decoration:none;width:132px;height:auto;"></a>
</td></tr>

<tr><td class="q-pad" style="padding:20px 32px 0;">
${para(`${RU_BELOW}.`, { color: C.muted, size: 14, pt: 0, lang: "ru" })}
</td></tr>

<tr><td class="q-pad" style="padding:28px 32px 0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="16" height="14" style="width:16px;height:14px;background:${C.yellow};border:1px solid ${C.ink};font-size:0;line-height:0;">&nbsp;</td>
<td style="padding-left:10px;font-family:${FONT};font-size:13px;line-height:1;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${C.ink};">${reminder ? "Reminder: Community Agreement" : "Community Agreement"}</td>
</tr></table>
</td></tr>

<tr><td class="q-pad" style="padding:24px 32px 0;">
${letter(EN)}
</td></tr>

<tr><td class="q-pad" style="padding:28px 32px 0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="q-btn"><tr>
<td bgcolor="${C.ink}" style="background:${C.ink};">
<a href="${href}" style="display:inline-block;padding:15px 24px;font-family:${FONT};font-size:16px;line-height:1.2;mso-line-height-rule:exactly;font-weight:600;color:${C.white};text-decoration:none;">${BUTTON}</a>
</td></tr></table>
</td></tr>

<tr><td class="q-pad" style="padding:32px 32px 0;">
<div style="border-top:1px solid ${C.line};font-size:0;line-height:0;height:1px;">&nbsp;</div>
</td></tr>

<tr><td class="q-pad" style="padding:24px 32px 0;">
${letter(RU, { color: C.muted, size: 15, lang: "ru" })}
${para(`<a href="${href}" style="color:${C.ink};font-weight:600;text-decoration:none;border-bottom:2px solid ${C.sky};">${RU_LINK}</a>`, { size: 15, pt: 18, lang: "ru" })}
</td></tr>

<tr><td class="q-pad" style="padding:36px 32px 0;">
${para(`<a href="https://qaravan.org" style="color:${C.ink};font-weight:600;text-decoration:none;border-bottom:2px solid ${C.sky};">qaravan.org</a>`, { size: 13, pt: 0 })}
</td></tr>

<tr><td style="padding:24px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export function agreementText({ name, link, reminder = false }) {
  return [
    ...(reminder ? ["Reminder / Напоминание", ""] : []),
    `${RU_BELOW}.`, "",
    EN.hello(name), "", ...EN.paragraphs.flatMap((p) => [p, ""]),
    `${BUTTON}: ${link}`, "", "—", "",
    RU.hello(name), "", ...RU.paragraphs.flatMap((p) => [p, ""]),
    `${RU_LINK}: ${link}`, "",
    "qaravan.org",
  ].join("\n");
}

// RFC 2047 subject in chunks a mail header can hold (≤ 75 chars per word).
function encodeHeader(s) {
  const words = [];
  let chunk = "";
  for (const ch of String(s)) {
    if (Buffer.byteLength(chunk + ch) > 42) { words.push(chunk); chunk = ""; }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w).toString("base64")}?=`).join("\r\n ");
}
const b64lines = (buf) => Buffer.from(buf).toString("base64").replace(/.{76}/g, "$&\r\n");

// multipart/alternative: plain text, then HTML with the wordmark inline.
export function agreementMime({ from, to, name, link, reminder = false }) {
  const alt = "alt_" + randomBytes(12).toString("hex"), rel = "rel_" + randomBytes(12).toString("hex");
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(agreementSubject({ reminder }))}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
    `--${alt}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64lines(agreementText({ name, link, reminder })),
    `--${alt}`,
    `Content-Type: multipart/related; boundary="${rel}"`,
    "",
    `--${rel}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64lines(agreementHtml({ name, link, reminder })),
    `--${rel}`,
    "Content-Type: image/png; name=\"qaravan.png\"",
    "Content-Transfer-Encoding: base64",
    `Content-ID: <${LOGO_CID}>`,
    "Content-Disposition: inline; filename=\"qaravan.png\"",
    "",
    WORDMARK_PNG_B64.replace(/.{76}/g, "$&\r\n"),
    `--${rel}--`,
    `--${alt}--`,
    "",
  ].join("\r\n");
}
