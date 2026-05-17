// GET /api/inbox
// Returns top ~12 important emails from the last day, with importance + category.

const { google } = require('googleapis');
const { cors, json } = require('./_lib/cors');
const {
  getOAuthClient,
  getAuthUrl,
  getTokensFromEvent,
  cookieFromTokens,
  buildSetCookieHeader,
} = require('./_lib/google-auth');

const HIGH_KEYWORDS = ['urgent', 'action required', 'asap', 'today', 'due', 'payment'];
const ACTION_KEYWORDS = ['action', 'required', 'verify', 'confirm'];
const FINANCE_DOMAINS = ['chase.com', 'schwab.com', 'paypal.com', 'fidelity.com', 'vanguard.com'];
const MARKETING_KEYWORDS = ['unsubscribe', 'newsletter', 'promo', 'deal', 'sale', '% off', 'limited time'];

function parseFromHeader(fromHeader) {
  if (!fromHeader) return { name: null, email: null };
  // "Display Name" <email@example.com>  OR  email@example.com
  const m = fromHeader.match(/^\s*"?([^"<]+?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  const trimmed = fromHeader.trim();
  if (/^[^\s@]+@[^\s@]+$/.test(trimmed)) return { name: null, email: trimmed.toLowerCase() };
  return { name: trimmed, email: null };
}

function domainOf(email) {
  if (!email) return '';
  const idx = email.indexOf('@');
  return idx === -1 ? '' : email.slice(idx + 1).toLowerCase();
}

function looksLikeBrand(email, name) {
  const d = domainOf(email);
  if (!d) return false;
  // common transactional/marketing patterns
  if (/^(no[-_]?reply|noreply|donotreply|notifications?|alerts?|info|hello|team|support|news|updates|mailer|marketing)@/i.test(email)) return true;
  if (/^(bounce|mailer-daemon)/i.test(email)) return true;
  return false;
}

function scoreImportance({ subject, from, labelIds }) {
  const subj = (subject || '').toLowerCase();
  if (Array.isArray(labelIds) && labelIds.includes('STARRED')) return 'high';
  for (const kw of HIGH_KEYWORDS) {
    if (subj.includes(kw)) return 'high';
  }
  if (!looksLikeBrand(from.email, from.name)) {
    const isMarketing = MARKETING_KEYWORDS.some((kw) => subj.includes(kw));
    if (!isMarketing) return 'medium';
  }
  return 'low';
}

function categorize({ subject, from }) {
  const subj = (subject || '').toLowerCase();
  const d = domainOf(from.email);
  if (FINANCE_DOMAINS.some((fd) => d === fd || d.endsWith('.' + fd))) return 'Finance';
  if (ACTION_KEYWORDS.some((kw) => subj.includes(kw))) return 'Action';
  // Personal: gmail/yahoo/outlook free domains + non-brand sender.
  const personalDomains = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'me.com'];
  if (personalDomains.includes(d) && !looksLikeBrand(from.email, from.name)) return 'Personal';
  return 'Work';
}

function headerValue(headers, name) {
  if (!Array.isArray(headers)) return null;
  const h = headers.find((x) => x.name && x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : null;
}

exports.handler = cors(async (event) => {
  const tokens = getTokensFromEvent(event);
  if (!tokens) {
    return json(200, { authenticated: false, authUrl: getAuthUrl('inbox') });
  }
  const client = getOAuthClient();
  client.setCredentials(tokens);
  let refreshed = null;
  client.on('tokens', (newTokens) => {
    refreshed = { ...tokens, ...newTokens };
  });

  const gmail = google.gmail({ version: 'v1', auth: client });

  let listResp;
  try {
    listResp = await gmail.users.messages.list({
      userId: 'me',
      q: 'newer_than:1d -category:promotions -category:social -category:updates -from:noreply',
      maxResults: 25,
    });
  } catch (err) {
    const code = err && (err.code || (err.response && err.response.status));
    if (code === 401 || /invalid_grant/i.test(err.message || '')) {
      return json(200, { authenticated: false, authUrl: getAuthUrl('inbox') });
    }
    throw err;
  }

  const messages = listResp.data.messages || [];
  const details = await Promise.allSettled(
    messages.map((m) =>
      gmail.users.messages.get({
        userId: 'me',
        id: m.id,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date'],
      })
    )
  );

  const highlights = [];
  for (const r of details) {
    if (r.status !== 'fulfilled' || !r.value || !r.value.data) continue;
    const msg = r.value.data;
    const headers = (msg.payload && msg.payload.headers) || [];
    const fromHeader = headerValue(headers, 'From');
    const subject = headerValue(headers, 'Subject');
    const dateHeader = headerValue(headers, 'Date');
    const from = parseFromHeader(fromHeader);

    const importance = scoreImportance({ subject, from, labelIds: msg.labelIds });
    const category = categorize({ subject, from });

    let receivedAt = null;
    if (msg.internalDate) {
      receivedAt = new Date(Number(msg.internalDate)).toISOString();
    } else if (dateHeader) {
      const t = Date.parse(dateHeader);
      if (!isNaN(t)) receivedAt = new Date(t).toISOString();
    }

    highlights.push({
      from: from.name ? `${from.name} <${from.email || ''}>` : (from.email || fromHeader || ''),
      subject: subject || '(no subject)',
      snippet: msg.snippet || '',
      receivedAt,
      importance,
      category,
      threadUrl: msg.threadId ? `https://mail.google.com/mail/u/0/#inbox/${msg.threadId}` : null,
    });
  }

  // Rank: high > medium > low, then by receivedAt desc.
  const rank = { high: 0, medium: 1, low: 2 };
  highlights.sort((a, b) => {
    const r = rank[a.importance] - rank[b.importance];
    if (r !== 0) return r;
    const ta = a.receivedAt ? Date.parse(a.receivedAt) : 0;
    const tb = b.receivedAt ? Date.parse(b.receivedAt) : 0;
    return tb - ta;
  });

  const out = { authenticated: true, highlights: highlights.slice(0, 12) };
  const headers = {};
  if (refreshed) {
    headers['Set-Cookie'] = buildSetCookieHeader(cookieFromTokens(refreshed));
  }
  return json(200, out, headers);
});
