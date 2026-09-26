// The small result page behind the signed links in survey emails («я не был(а)
// на событии», unsubscribe). Same look as the forms: the QARAVAN design system
// from /assets (fonts, tokens), the wordmark as artwork, white page, square.
export function statusPage(h1, sub) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><meta name="theme-color" content="#ffffff">
<link rel="stylesheet" href="/assets/qaravan.css"><title>${h1} — QARAVAN</title>
<style>
.page{max-width:560px; margin:0 auto; padding:20px 20px 64px}
h1{margin:40px 0 0; font:700 clamp(30px,8vw,40px)/1.08 var(--font-head); letter-spacing:var(--tracking-display); text-wrap:balance}
.sub{margin:14px 0 0; color:var(--q-muted); font-size:17px; line-height:1.5; text-wrap:pretty}
footer{margin-top:56px; color:var(--q-muted); font-size:15px}
</style></head>
<body><div class="page">
<a class="wordmark" href="https://qaravan.org" aria-label="qaravan.org"><img src="/assets/logo-wordmark.svg" width="140" height="28" alt="qaravan"></a>
<h1>${h1}</h1>
<p class="sub">${sub}</p>
<footer>qaravan.org</footer>
</div></body></html>`;
}
