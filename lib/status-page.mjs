// The small result page behind the signed links in survey emails («я не был(а)
// на событии», unsubscribe). Same look as the forms: the QARAVAN design system
// from /assets (fonts, tokens), the wordmark as artwork, white page, square.
// `form` (optional): extra markup under the text, e.g. the confirm button of confirmPage below.
export function statusPage(h1, sub, form = "") {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><meta name="theme-color" content="#ffffff">
<link rel="stylesheet" href="/assets/qaravan.css"><title>${h1} — QARAVAN</title>
<style>
.page{max-width:560px; margin:0 auto; padding:20px 20px 64px}
h1{margin:40px 0 0; font:700 clamp(30px,8vw,40px)/1.08 var(--font-head); letter-spacing:var(--tracking-display); text-wrap:balance}
.sub{margin:14px 0 0; color:var(--q-muted); font-size:17px; line-height:1.5; text-wrap:pretty}
footer{margin-top:56px; color:var(--q-muted); font-size:15px}
form{margin:28px 0 0}
.go{display:inline-block; border:0; border-radius:0; background:var(--q-ink,#333); color:var(--q-white,#fff); font:600 18px/1.15 var(--font-head); padding:14px 22px; cursor:pointer}
.go:focus-visible{outline:3px solid var(--q-sky,#0099cc); outline-offset:2px}
</style></head>
<body><div class="page">
<a class="wordmark" href="https://qaravan.org" aria-label="qaravan.org"><img src="/assets/logo-wordmark.svg" width="140" height="28" alt="qaravan"></a>
<h1>${h1}</h1>
<p class="sub">${sub}</p>${form}
<footer>qaravan.org</footer>
</div></body></html>`;
}

// A signed link from an email must not act on a plain GET: mail scanners and link previews open
// every link in a message. The GET shows this page; its button POSTs the same signed address,
// and only the POST changes anything. `action` is a path with its query (already validated).
const attr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function confirmPage(h1, sub, action, label) {
  return statusPage(h1, sub, `<form method="post" action="${attr(action)}"><button class="go" type="submit">${label}</button></form>`);
}
