// GET /api/inbox
// v2: heuristic scoring + action item extraction.
//
// For each message we compute:
//   - score: numeric importance score (see scoreEmail)
//   - importance: "high" (>=5) / "medium" (2-4) / "low" (else)
//   - category: "Action Required" / "Finance" / "Work" / "Personal" / "Notification"
//   - actionItems: short string array surfaced as orange pill chips
//
// We pull last 50 messages from INBOX, score, and return top 8 by score
// (must score > 0 OR be unread+IMPORTANT).

const { google } = require('googleapis');
const { cors, json } = require('./_lib/cors');
const {
  getOAuthClient,
  getAuthUrl,
  getTokensFromEvent,
  cookieFromTokens,
  buildSetCookieHeader,
} = require('./_lib/google-auth');

// ---------- Heuristics ----------
const URGENT_PHRASES = [
  'action required', 'please respond', 'deadline', 'due by',
  'asap', 'urgent', 'important', 'needs your attention',
  'by today', 'by tomorrow',
];
const DAY_OF_WEEK_RE = /\bby\s+(mon|tue|tues|wed|wedn|thu|thur|thurs|fri|sat|sun)(day|nesday|sday|nday|rday|urday)?\b/i;
const MONEY_RE = /\$\s?[\d,]+(?:\.\d+)?/;
const FINANCE_KEYWORDS = ['invoice', 'payment', 'statement', 'balance', 'transaction', 'due', 'pay by', 'amount due'];
const REVIEW_KEYWORDS = ['review', 'approve', 'approval', 'sign off', 'signoff'];
const MEETING_KEYWORDS = ['meeting', 'meet', 'call', 'invite', 'rsvp', 'calendar'];
const NEGATIVE_KEYWORDS = ['unsubscribe', 'newsletter', '% off', 'deal alert', 'promotional'];
const DATE_FORMAT_RE = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?\b|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/i;

// Lower-cased sender-domain substrings that suppress the score.
const NOISE_DOMAINS = [
  'mailchimp.com', 'hubspot.com', 'github.com', 'linkedin.com',
  'slack.com', 'intercom-mail.com', 'mailer-daemon', 'sendgrid.net',
  'marketo.com', 'eloqua.com', 'salesforce.com',
];
// Sender-mailbox prefixes that also count as noise.
const NOISE_PREFIXES = [/^no[-_]?reply@/i, /^noreply@/i, /^donotreply@/i, /^notifications?@/i, /^alerts?@/i, /^mailer-daemon/i];
const PERSONAL_DOMAINS = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'me.com', 'aol.com'];

function parseFromHeader(fromHeader) {
  if (!fromHeader) return { name: null, email: null };
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

function isNoiseSender(email) {
  if (!email) return false;
  const d = domainOf(email);
  if (NOISE_DOMAINS.some((nd) => d === nd || d.endsWith('.' + nd))) return true;
  if (NOISE_PREFIXES.some((re) => re.test(email))) return true;
  return false;
}

function isPersonalDomain(email) {
  const d = domainOf(email);
  return PERSONAL_DOMAINS.includes(d);
}

function headerValue(headers, name) {
  if (!Array.isArray(headers)) return null;
  const h = headers.find((x) => x.name && x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : null;
}

// Extract a haystack of text from subject + snippet for keyword tests.
function haystack(subject, snippet) {
  return `${subject || ''} ${snippet || ''}`.toLowerCase();
}

function findDollarAmount(text) {
  const m = text && text.match(MONEY_RE);
  return m ? m[0].replace(/\s+/g, '') : null;
}

function findDayOfWeek(text) {
  const m = text && text.match(DAY_OF_WEEK_RE);
  if (!m) return null;
  const map = { mon: 'Monday', tue: 'Tuesday', tues: 'Tuesday', wed: 'Wednesday', wedn: 'Wednesday',
                thu: 'Thursday', thur: 'Thursday', thurs: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
  return map[m[1].toLowerCase()] || null;
}

function scoreEmail({ subject, snippet, from, labelIds, receivedAt }) {
  const text = haystack(subject, snippet);
  let score = 0;

  // +3: urgent phrases
  if (URGENT_PHRASES.some((p) => text.includes(p)) || DAY_OF_WEEK_RE.test(text)) score += 3;
  // +2: dollar amount detected
  const dollar = findDollarAmount(text);
  if (dollar) score += 2;
  // +2: Gmail IMPORTANT label
  if (Array.isArray(labelIds) && labelIds.includes('IMPORTANT')) score += 2;
  // +2: unread AND received in last 24h
  const isUnread = Array.isArray(labelIds) && labelIds.includes('UNREAD');
  const ageMs = receivedAt ? Date.now() - Date.parse(receivedAt) : Infinity;
  if (isUnread && isFinite(ageMs) && ageMs < 24 * 3600 * 1000) score += 2;
  // +1: question mark in subject
  if (subject && subject.includes('?')) score += 1;
  // +1: a recognizable date (next 7 days mentioned)
  if (DATE_FORMAT_RE.test(text)) score += 1;
  // -2: noise sender domain
  if (isNoiseSender(from.email)) score -= 2;
  // -3: promotional subject words
  if (NEGATIVE_KEYWORDS.some((k) => text.includes(k))) score -= 3;

  return { score, dollar, isUnread };
}

function extractActionItems({ subject, snippet, dollar }) {
  const text = haystack(subject, snippet);
  const items = [];

  // Respond by [day]
  const respondMatch = text.match(/(?:respond|reply|get back)\s+(?:to me\s+)?by\s+([a-z]+)/i);
  if (respondMatch) {
    const day = respondMatch[1].charAt(0).toUpperCase() + respondMatch[1].slice(1);
    items.push(`Respond by ${day}`);
  } else {
    const dow = findDayOfWeek(text);
    if (dow && /respond|reply/.test(text)) items.push(`Respond by ${dow}`);
  }

  // $X due (dollar amount + finance words)
  if (dollar && FINANCE_KEYWORDS.some((k) => text.includes(k))) {
    items.push(`${dollar} due`);
  } else if (dollar && /invoice|payment|balance/.test(text)) {
    items.push(`${dollar} due`);
  }

  // Review/approve
  if (REVIEW_KEYWORDS.some((k) => text.includes(k))) {
    items.push('Review and approve');
  }

  // Meeting on [date]
  if (MEETING_KEYWORDS.some((k) => text.includes(k))) {
    const dateMatch = text.match(DATE_FORMAT_RE);
    if (dateMatch) items.push(`Meeting on ${dateMatch[0]}`);
  }

  // Deduplicate while preserving order, cap at 3.
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const k = it.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
    if (out.length >= 3) break;
  }
  return out;
}

function categorize({ score, dollar, subject, snippet, from }) {
  const text = haystack(subject, snippet);
  if (score >= 5) return 'Action Required';
  if (dollar || FINANCE_KEYWORDS.some((k) => text.includes(k))) return 'Finance';
  if (score <= 0) return 'Notification';
  if (isPersonalDomain(from.email)) return 'Personal';
  // Corporate-looking domain that isn't a free email host => Work.
  return 'Work';
}

function importanceFromScore(score) {
  if (score >= 5) return 'high';
  if (score >= 2) return 'medium';
  return 'low';
}

// ---------- Handler ----------
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
      labelIds: ['INBOX'],
      maxResults: 50,
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

  const scored = [];
  for (const r of details) {
    if (r.status !== 'fulfilled' || !r.value || !r.value.data) continue;
    const msg = r.value.data;
    const headers = (msg.payload && msg.payload.headers) || [];
    const fromHeader = headerValue(headers, 'From');
    const subject = headerValue(headers, 'Subject');
    const dateHeader = headerValue(headers, 'Date');
    const from = parseFromHeader(fromHeader);

    let receivedAt = null;
    if (msg.internalDate) {
      receivedAt = new Date(Number(msg.internalDate)).toISOString();
    } else if (dateHeader) {
      const t = Date.parse(dateHeader);
      if (!isNaN(t)) receivedAt = new Date(t).toISOString();
    }

    const labelIds = msg.labelIds || [];
    const snippet = msg.snippet || '';
    const { score, dollar, isUnread } = scoreEmail({ subject, snippet, from, labelIds, receivedAt });
    const actionItems = extractActionItems({ subject, snippet, dollar });
    const category = categorize({ score, dollar, subject, snippet, from });
    const importance = importanceFromScore(score);

    // Inclusion rule: score > 0 OR (unread AND IMPORTANT label).
    const isImportantUnread = isUnread && labelIds.includes('IMPORTANT');
    if (score <= 0 && !isImportantUnread) continue;

    scored.push({
      from: from.name || from.email || fromHeader || '',
      fromEmail: from.email || null,
      subject: subject || '(no subject)',
      snippet,
      receivedAt,
      score,
      importance,
      category,
      actionItems,
      threadUrl: msg.threadId ? `https://mail.google.com/mail/u/0/#inbox/${msg.threadId}` : null,
    });
  }

  // Sort: highest score first, then newest first.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ta = a.receivedAt ? Date.parse(a.receivedAt) : 0;
    const tb = b.receivedAt ? Date.parse(b.receivedAt) : 0;
    return tb - ta;
  });

  const out = { authenticated: true, highlights: scored.slice(0, 8) };
  const headers = {};
  if (refreshed) {
    headers['Set-Cookie'] = buildSetCookieHeader(cookieFromTokens(refreshed));
  }
  return json(200, out, headers);
});
