// GET /api/stock-news?symbol=AAPL
// Yahoo Finance news + naive keyword-based sentiment.

const yahooFinance = require('yahoo-finance2').default;
const { cors, json } = require('./_lib/cors');

const CACHE = new Map(); // symbol -> { at, data }
const TTL_MS = 5 * 60 * 1000; // 5 min

const POSITIVE = ['beat', 'surge', 'rally', 'gain', 'upgrade', 'record', 'growth', 'strong', 'bullish', 'profit', 'win'];
const NEGATIVE = ['miss', 'drop', 'fall', 'plunge', 'downgrade', 'loss', 'weak', 'bearish', 'lawsuit', 'probe', 'decline', 'cut'];

try {
  yahooFinance.suppressNotices && yahooFinance.suppressNotices(['yahooSurvey', 'ripHistorical']);
} catch (_) { /* noop */ }

function classifySentiment(text) {
  const t = (text || '').toLowerCase();
  let pos = 0, neg = 0;
  for (const w of POSITIVE) if (t.includes(w)) pos++;
  for (const w of NEGATIVE) if (t.includes(w)) neg++;
  if (pos > neg) return 'positive';
  if (neg > pos) return 'negative';
  return 'neutral';
}

function cacheGet(key) {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    CACHE.delete(key);
    return null;
  }
  return hit.data;
}

function cacheSet(key, data) {
  CACHE.set(key, { at: Date.now(), data });
}

exports.handler = cors(async (event) => {
  const params = event.queryStringParameters || {};
  const symbol = (params.symbol || '').trim().toUpperCase();
  if (!symbol) {
    return json(400, { error: 'BadRequest', message: 'symbol query param is required' });
  }
  const cached = cacheGet(symbol);
  if (cached) return json(200, cached);

  const result = await yahooFinance.search(symbol, { newsCount: 10, quotesCount: 0 });
  const newsArr = (result && result.news) || [];

  const news = newsArr.map((n) => {
    const publishedAtSec = n.providerPublishTime;
    const publishedAt = publishedAtSec
      ? (typeof publishedAtSec === 'number'
          ? new Date(publishedAtSec * 1000).toISOString()
          : new Date(publishedAtSec).toISOString())
      : null;
    const summary = n.summary || '';
    return {
      title: n.title,
      summary,
      url: n.link,
      publishedAt,
      source: n.publisher,
      sentiment: classifySentiment(`${n.title || ''} ${summary}`),
    };
  });

  const out = { news, symbol };
  cacheSet(symbol, out);
  return json(200, out);
});
