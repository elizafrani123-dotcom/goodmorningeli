// Google OAuth2 helpers: build clients, auth URLs, sign/verify token cookies.

const crypto = require('crypto');
const { google } = require('googleapis');

const COOKIE_NAME = 'gme_auth';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/gmail.readonly',
  'openid',
  'email',
];

function getOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI');
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function getAuthUrl(state) {
  const client = getOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    include_granted_scopes: true,
    state: state || '',
  });
}

function getSecret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('Missing SESSION_SECRET');
  return s;
}

function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  str = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

// Encode tokens object as "base64(json).base64(hmac)" using HMAC-SHA256.
function cookieFromTokens(tokens) {
  const payload = b64urlEncode(JSON.stringify(tokens));
  const sig = crypto.createHmac('sha256', getSecret()).update(payload).digest();
  return `${payload}.${b64urlEncode(sig)}`;
}

function tokensFromCookie(cookieValue) {
  if (!cookieValue || typeof cookieValue !== 'string') return null;
  const parts = cookieValue.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = crypto.createHmac('sha256', getSecret()).update(payload).digest();
  const provided = b64urlDecode(sig);
  if (expected.length !== provided.length) return null;
  if (!crypto.timingSafeEqual(expected, provided)) return null;
  try {
    return JSON.parse(b64urlDecode(payload).toString('utf8'));
  } catch (_) {
    return null;
  }
}

// Parse the gme_auth cookie out of event.headers.cookie. Returns tokens or null.
function getTokensFromEvent(event) {
  const header = event && event.headers && (event.headers.cookie || event.headers.Cookie);
  if (!header) return null;
  const parts = String(header).split(/;\s*/);
  for (const p of parts) {
    const idx = p.indexOf('=');
    if (idx === -1) continue;
    const name = p.slice(0, idx).trim();
    if (name === COOKIE_NAME) {
      const value = decodeURIComponent(p.slice(idx + 1));
      return tokensFromCookie(value);
    }
  }
  return null;
}

function buildSetCookieHeader(value, opts) {
  const o = opts || {};
  const maxAge = o.maxAge != null ? o.maxAge : COOKIE_MAX_AGE_SECONDS;
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  return parts.join('; ');
}

function clearCookieHeader() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

module.exports = {
  COOKIE_NAME,
  COOKIE_MAX_AGE_SECONDS,
  SCOPES,
  getOAuthClient,
  getAuthUrl,
  cookieFromTokens,
  tokensFromCookie,
  getTokensFromEvent,
  buildSetCookieHeader,
  clearCookieHeader,
};
