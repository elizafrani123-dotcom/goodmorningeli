// GET /api/oauth-callback?code=&state=
// Exchanges the auth code for tokens, stores them in a signed cookie,
// then renders a tiny HTML page that messages the opener and self-closes.

const { cors, CORS_HEADERS } = require('./_lib/cors');
const {
  getOAuthClient,
  cookieFromTokens,
  buildSetCookieHeader,
} = require('./_lib/google-auth');

function htmlResponse(statusCode, html, extraHeaders) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ...CORS_HEADERS,
      ...(extraHeaders || {}),
    },
    body: html,
  };
}

const SUCCESS_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Connected</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         background: #0b1020; color: #e7eaf2; display: flex; align-items: center;
         justify-content: center; height: 100vh; margin: 0; }
  .card { text-align: center; padding: 32px 40px; border-radius: 16px;
          background: rgba(255,255,255,0.06); }
  h1 { margin: 0 0 8px; font-size: 22px; }
  p { margin: 0; opacity: 0.8; font-size: 14px; }
</style></head>
<body>
  <div class="card">
    <h1>Connected!</h1>
    <p>You can close this window.</p>
  </div>
  <script>
    try { window.opener && window.opener.postMessage({ type: 'gme-auth-success' }, '*'); } catch (e) {}
    setTimeout(function(){ try { window.close(); } catch(e){} }, 1500);
  </script>
</body></html>`;

function errorHtml(message) {
  const safe = String(message || 'Unknown error').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Connection failed</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         background: #2a0b0b; color: #fce7e7; display: flex; align-items: center;
         justify-content: center; height: 100vh; margin: 0; }
  .card { text-align: center; padding: 32px 40px; border-radius: 16px;
          background: rgba(255,255,255,0.06); max-width: 480px; }
  h1 { margin: 0 0 8px; font-size: 22px; }
  pre { white-space: pre-wrap; opacity: 0.85; font-size: 13px; margin: 8px 0 0; }
</style></head>
<body>
  <div class="card">
    <h1>Connection failed</h1>
    <pre>${safe}</pre>
  </div>
  <script>
    try { window.opener && window.opener.postMessage({ type: 'gme-auth-error', message: ${JSON.stringify(message || '')} }, '*'); } catch (e) {}
  </script>
</body></html>`;
}

exports.handler = cors(async (event) => {
  const params = event.queryStringParameters || {};
  const code = params.code;
  const errParam = params.error;
  if (errParam) {
    return htmlResponse(400, errorHtml(`OAuth error: ${errParam}`));
  }
  if (!code) {
    return htmlResponse(400, errorHtml('Missing authorization code.'));
  }

  try {
    const client = getOAuthClient();
    const { tokens } = await client.getToken(code);
    const cookieValue = cookieFromTokens(tokens);
    return htmlResponse(200, SUCCESS_HTML, {
      'Set-Cookie': buildSetCookieHeader(cookieValue),
    });
  } catch (err) {
    console.error('[oauth-callback] token exchange failed:', err);
    return htmlResponse(500, errorHtml(err.message || 'Token exchange failed'));
  }
});
