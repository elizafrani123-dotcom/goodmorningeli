// GET /api/stocks?symbols=AAPL,NVDA,...
// Yahoo Finance quotes + 1-day 5-min sparkline.

const yahooFinance = require('yahoo-finance2').default;
const { cors, json } = require('./_lib/cors');

const CACHE = new Map(); // key -> { at, data }
const TTL_MS = 60 * 1000; // 60s

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

// Silence yahoo-finance2 survey/notice prompts in serverless.
try {
  yahooFinance.suppressNotices && yahooFinance.suppressNotices(['yahooSurvey', 'ripHistorical']);
} catch (_) { /* noop */ }

async function fetchOne(symbol) {
  const sym = String(symbol).trim().toUpperCase();
  const period1 = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [quote, chart] = await Promise.all([
    yahooFinance.quote(sym),
    yahooFinance.chart(sym, { period1, interval: '5m' }).catch(() => ({ quotes: [] })),
  ]);
  const sparkline = ((chart && chart.quotes) || [])
    .map((q) => (q && typeof q.close === 'number' ? q.close : null))
    .filter((v) => v != null);
  return {
    symbol: sym,
    name: quote.shortName || quote.longName || sym,
    price: quote.regularMarketPrice,
    change: quote.regularMarketChange,
    changePct: quote.regularMarketChangePercent,
    dayHigh: quote.regularMarketDayHigh,
    dayLow: quote.regularMarketDayLow,
    volume: quote.regularMarketVolume,
    marketCap: quote.marketCap,
    currency: quote.currency,
    sparkline,
  };
}

exports.handler = cors(async (event) => {
  const params = event.queryStringParameters || {};
  const symbolsRaw = params.symbols || '';
  const symbols = symbolsRaw.split(',').map((s) => s.trim()).filter(Boolean);
  if (symbols.length === 0) {
    return json(400, { error: 'BadRequest', message: 'symbols query param is required (comma-separated)' });
  }
  const cacheKey = symbols.slice().sort().join(',');
  const cached = cacheGet(cacheKey);
  if (cached) return json(200, cached);

  const results = await Promise.allSettled(symbols.map(fetchOne));
  const quotes = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      quotes.push(r.value);
    } else if (r.status === 'rejected') {
      console.warn('[stocks] symbol failed:', r.reason && r.reason.message);
    }
  }
  const out = { quotes, asOf: new Date().toISOString() };
  cacheSet(cacheKey, out);
  return json(200, out);
});
