// GET /api/stocks?symbols=AAPL,NVDA,...
// Uses Yahoo Finance public chart endpoint directly (no library — yahoo-finance2 is ESM-only and breaks in CJS Netlify Functions).

const { cors, json } = require('./_lib/cors');

const CACHE = new Map(); // key -> { at, data }
const TTL_MS = 60 * 1000; // 60s

const UA = 'Mozilla/5.0 (compatible; GoodMorningEli/1.0)';

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

async function fetchChart(symbol) {
  // v2: sparkline is now 30-day daily closes (was 5-min intraday).
  // We still want regularMarketPrice for the headline price, but the chart series
  // is now `interval=1d&range=1mo` for a smoother monthly trend line.
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1mo`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`chart ${symbol} HTTP ${res.status}`);
  const data = await res.json();
  const result = data && data.chart && data.chart.result && data.chart.result[0];
  if (!result) throw new Error(`chart ${symbol} empty`);
  const meta = result.meta || {};
  const quote = (result.indicators && result.indicators.quote && result.indicators.quote[0]) || {};
  const closes = (quote.close || []).filter((v) => typeof v === 'number');
  const price = meta.regularMarketPrice;
  // For a 1mo daily series, chartPreviousClose is the price 1 month ago — we don't want that
  // for "day change". Use previousClose (last trading day's close) instead.
  const prevClose = meta.previousClose != null ? meta.previousClose : meta.chartPreviousClose;
  const change = price != null && prevClose != null ? price - prevClose : null;
  const changePct = change != null && prevClose ? (change / prevClose) * 100 : null;
  return {
    symbol: meta.symbol || symbol,
    name: meta.shortName || meta.longName || meta.symbol || symbol,
    price,
    change,
    changePct,
    dayHigh: meta.regularMarketDayHigh,
    dayLow: meta.regularMarketDayLow,
    volume: meta.regularMarketVolume,
    marketCap: null, // not provided by chart endpoint
    currency: meta.currency,
    fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
    fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
    sparkline: closes, // last 30 daily closes
  };
}

exports.handler = cors(async (event) => {
  const params = event.queryStringParameters || {};
  const symbolsRaw = params.symbols || '';
  const symbols = symbolsRaw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (symbols.length === 0) {
    return json(400, { error: 'BadRequest', message: 'symbols query param is required (comma-separated)' });
  }
  const cacheKey = symbols.slice().sort().join(',');
  const cached = cacheGet(cacheKey);
  if (cached) return json(200, cached);

  const results = await Promise.allSettled(symbols.map(fetchChart));
  const quotes = [];
  const errors = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled' && r.value) {
      quotes.push(r.value);
    } else {
      errors.push({ symbol: symbols[i], message: (r.reason && r.reason.message) || String(r.reason) });
      console.warn('[stocks] symbol failed:', symbols[i], r.reason && r.reason.message);
    }
  }
  const out = { quotes, errors, asOf: new Date().toISOString() };
  if (quotes.length) cacheSet(cacheKey, out);
  return json(200, out);
});
