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
  // 5-minute interval over 1 day gives us a sparkline plus meta with current price + previous close.
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=5m&range=1d&includePrePost=false`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`chart ${symbol} HTTP ${res.status}`);
  const data = await res.json();
  const result = data && data.chart && data.chart.result && data.chart.result[0];
  if (!result) throw new Error(`chart ${symbol} empty`);
  const meta = result.meta || {};
  const quote = (result.indicators && result.indicators.quote && result.indicators.quote[0]) || {};
  const closes = (quote.close || []).filter((v) => typeof v === 'number');
  const price = meta.regularMarketPrice;
  const prevClose = meta.chartPreviousClose != null ? meta.chartPreviousClose : meta.previousClose;
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
    sparkline: closes.slice(-60), // last ~5h of 5-min ticks, max
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
