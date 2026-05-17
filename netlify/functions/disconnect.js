// POST /api/disconnect
// Clears the gme_auth cookie. (Also accepts GET for convenience in dev.)

const { cors, json } = require('./_lib/cors');
const { clearCookieHeader } = require('./_lib/google-auth');

exports.handler = cors(async (event) => {
  // Accept POST primarily, but allow GET too for ease of testing.
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
    return json(405, { error: 'MethodNotAllowed', message: 'Use POST' });
  }
  return json(200, { disconnected: true }, { 'Set-Cookie': clearCookieHeader() });
});
