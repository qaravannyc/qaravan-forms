// One-time, run on YOUR computer: node robot/google-auth.mjs
// It prints a URL. You open it, approve with the QARAVAN account
// (info@qaravan.org), and it prints the refresh token to store as the
// GOOGLE_REFRESH_TOKEN secret. Nobody but you sees the token.
//
// This uses the loopback redirect (http://127.0.0.1:PORT). The old
// copy-the-code flow (urn:ietf:wg:oauth:2.0:oob) was switched off by Google on
// January 31, 2023 and now fails with "Error 400: invalid_request", which is
// why this file was rewritten on Aug 10, 2026.
// https://developers.google.com/identity/protocols/oauth2/resources/oob-migration
//
// The loopback server ignores any request that carries neither code nor error
// (a favicon fetch or a port probe would otherwise be mistaken for Google's
// answer and kill the script before the real redirect arrives).

import { createServer } from 'node:http';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.log('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first (see README step 4).');
  process.exit(1);
}

const SCOPES = [
  'https://www.googleapis.com/auth/photoslibrary.appendonly',
  // Два scope добавлены Aug 11, 2026 (старый токен продолжает работать для
  // всего остального; чтобы включить и это — перезапусти скрипт и обнови
  // GOOGLE_REFRESH_TOKEN в секретах GitHub и переменных Vercel):
  //   edit.appcreateddata — переименование альбома, когда событие меняется;
  //   readonly.appcreateddata — найти СВОЙ альбом по названию и довязать его
  //   id, если на доске есть только публичная ссылка (id в ней не содержится).
  'https://www.googleapis.com/auth/photoslibrary.edit.appcreateddata',
  'https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata',
  'https://www.googleapis.com/auth/gmail.send',
].join(' ');

const server = createServer();

server.on('request', async (req, res) => {
  const base = 'http://127.0.0.1:' + server.address().port;
  const params = new URL(req.url, base).searchParams;
  const code = params.get('code');
  const error = params.get('error');

  if (!code && !error) {
    res.writeHead(204);
    res.end();
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<meta charset="utf-8"><p style="font:16px system-ui;padding:40px">'
    + (code ? 'Готово. Закройте вкладку и вернитесь в терминал.' : 'Не получилось: ' + error)
    + '</p>');

  if (!code) {
    console.error('\nAuthorization failed: ' + error);
    server.close();
    process.exit(1);
  }

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: base,
      grant_type: 'authorization_code',
    }),
  });
  const j = await r.json();

  if (j.refresh_token) {
    console.log('\nYour GOOGLE_REFRESH_TOKEN (save as a GitHub secret and a Vercel env var):\n');
    console.log(j.refresh_token + '\n');
  } else {
    console.log('\nGoogle did not return a refresh token. Full response:\n');
    console.log(JSON.stringify(j, null, 2) + '\n');
  }

  server.close();
  process.exit(0);
});

server.listen(0, '127.0.0.1', () => {
  const redirect = 'http://127.0.0.1:' + server.address().port;
  const url = 'https://accounts.google.com/o/oauth2/v2/auth'
    + '?client_id=' + encodeURIComponent(CLIENT_ID)
    + '&redirect_uri=' + encodeURIComponent(redirect)
    + '&response_type=code&access_type=offline&prompt=consent'
    + '&scope=' + encodeURIComponent(SCOPES);

  console.log('\nOpen this URL and approve with the QARAVAN account (info@qaravan.org):\n');
  console.log(url + '\n');
  console.log('Waiting for Google to send the approval back to ' + redirect + ' ...');
});
