// GET /api/calendar
// v2: returns events for the 30 days before AND 30 days after today.
// The frontend groups by date for a monthly view.

const { google } = require('googleapis');
const { cors, json } = require('./_lib/cors');
const {
  getOAuthClient,
  getAuthUrl,
  getTokensFromEvent,
  cookieFromTokens,
  buildSetCookieHeader,
} = require('./_lib/google-auth');

const DAYS_BACK = 30;
const DAYS_FORWARD = 30;

function windowStart() {
  const d = new Date();
  d.setDate(d.getDate() - DAYS_BACK);
  d.setHours(0, 0, 0, 0);
  return d;
}

function windowEnd() {
  const d = new Date();
  d.setDate(d.getDate() + DAYS_FORWARD);
  d.setHours(23, 59, 59, 999);
  return d;
}

exports.handler = cors(async (event) => {
  const tokens = getTokensFromEvent(event);
  if (!tokens) {
    return json(200, { authenticated: false, authUrl: getAuthUrl('calendar') });
  }

  const client = getOAuthClient();
  client.setCredentials(tokens);

  // Refresh response handler — capture new tokens to update cookie if rotated.
  let refreshed = null;
  client.on('tokens', (newTokens) => {
    refreshed = { ...tokens, ...newTokens };
  });

  const calendar = google.calendar({ version: 'v3', auth: client });
  const timeMin = windowStart().toISOString();
  const timeMax = windowEnd().toISOString();

  let resp;
  try {
    resp = await calendar.events.list({
      calendarId: 'primary',
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 500,
    });
  } catch (err) {
    // If invalid_grant / 401, treat as unauthenticated.
    const code = err && (err.code || (err.response && err.response.status));
    if (code === 401 || /invalid_grant/i.test(err.message || '')) {
      return json(200, { authenticated: false, authUrl: getAuthUrl('calendar') });
    }
    throw err;
  }

  const events = (resp.data.items || []).map((e) => ({
    title: e.summary || '(no title)',
    start: (e.start && (e.start.dateTime || e.start.date)) || null,
    end: (e.end && (e.end.dateTime || e.end.date)) || null,
    location: e.location || null,
    attendees: (e.attendees || []).map((a) => a.email).filter(Boolean),
    description: e.description || null,
    link: e.hangoutLink || (e.conferenceData && e.conferenceData.entryPoints && e.conferenceData.entryPoints[0] && e.conferenceData.entryPoints[0].uri) || e.htmlLink || null,
  }));

  const headers = {};
  if (refreshed) {
    headers['Set-Cookie'] = buildSetCookieHeader(cookieFromTokens(refreshed));
  }
  return json(200, { authenticated: true, events }, headers);
});
