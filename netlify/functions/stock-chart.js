// GET /api/stock-chart?symbol=AAPL&range=1mo
// Returns timeseries for one symbol over a chosen range, plus meta.
// Used by the expanded markets row in v2 to render multi-timeframe charts.

const { cors, json } = require('./_lib/cors');

const CACHE = new Map(); // key -> { at, data }
const TTL_MS = 5 * 60 * 1000; // 5 min per (symbol, range)

const UA = 'Mozilla/5.0 (compatible; GoodMorningEli/1.0)';

// Range -> interval per spec.
const INTERVALS = {
  '1d':  '5m',
  '5d':  '15m',
  '1mo': '1d',
  '3mo': '1d',
  '1y':  '1wk',
  '5y':  '1mo',
  'max': '1mo',
};

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
  const range = (params.range || '1mo').trim().toLowerCase();

  if (!symbol) {
    return json(400, { error: 'BadRequest', message: 'symbol query param is required' });
  }
  if (!INTERVALS[range]) {
    return json(400, { error: 'BadRequest', message: `Unsupported range: ${range}. Valid: ${Object.keys(INTERVALS).join(', ')}` });
  }

  const interval = INTERVALS[range];
  const cacheKey = `${symbol}:${range}`;
  const cached = cacheGet(cacheKey);
  if (cached) return json(200, cached);

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  let resp;
  try {
    resp = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
  } catch (e) {
    return json(502, { error: 'Upstream', message: `fetch failed: ${e.message}` });
  }
  if (!resp.ok) {
    return json(resp.status, { error: 'Upstream', message: `Yahoo HTTP ${resp.status}` });
  }
  const data = await resp.json();
  const result = data && data.chart && data.chart.result && data.chart.result[0];
  if (!result) {
    const errMsg = data && data.chart && data.chart.error && data.chart.error.description;
    return json(404, { error: 'NotFound', message: errMsg || `No data for ${symbol} / ${range}` });
  }

  const meta = result.meta || {};
  const timestamps = result.timestamp || [];
  const quote = (result.indicators && result.indicators.quote && result.indicators.quote[0]) || {};
  const closes = quote.close || [];
  const volumes = quote.volume || [];

  const points = [];
  for (let i = 0; i < timestamps.length; i++) {
    const t = timestamps[i];
    const c = closes[i];
    const v = volumes[i];
    if (t == null || typeof c !== 'number' || !isFinite(c)) continue;
    points.push({ t: t * 1000, close: c, volume: typeof v === 'number' ? v : null });
  }

  const out = {
    symbol: meta.symbol || symbol,
    range,
    interval,
    points,
    meta: {
      regularMarketPrice: meta.regularMarketPrice ?? null,
      previousClose: meta.previousClose ?? meta.chartPreviousClose ?? null,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh ?? null,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow ?? null,
      currency: meta.currency || 'USD',
      exchangeName: meta.exchangeName || meta.fullExchangeName || null,
      shortName: meta.shortName || null,
      longName: meta.longName || null,
    },
    asOf: new Date().toISOString(),
  };

  if (points.length) cacheSet(cacheKey, out);
  return json(200, out);
});
