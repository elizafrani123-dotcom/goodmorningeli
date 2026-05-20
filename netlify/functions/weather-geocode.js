// GET /api/weather/geocode?q=Miami   (also reachable as /api/weather-geocode?q=Miami)
// Thin wrapper over OpenWeather's geocoding API. Used by the "manage cities" UI.
//
// Note on routing: netlify.toml redirects /api/* -> /.netlify/functions/:splat.
// Both /api/weather/geocode and /api/weather-geocode hit this function via the
// extra redirect added to netlify.toml.

const { cors, json } = require('./_lib/cors');

const CACHE = new Map(); // q -> { at, data }
const TTL_MS = 60 * 60 * 1000; // 1 hour

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
  const q = (params.q || '').trim();
  if (!q) {
    return json(400, { error: 'BadRequest', message: 'q query param is required' });
  }
  const key = process.env.OPENWEATHER_KEY;
  if (!key) {
    return json(500, { error: 'ConfigError', message: 'OPENWEATHER_KEY is not set' });
  }
  const cacheKey = q.toLowerCase();
  const cached = cacheGet(cacheKey);
  if (cached) return json(200, cached);

  const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(q)}&limit=5&appid=${key}`;
  let resp;
  try {
    resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
  } catch (e) {
    return json(502, { error: 'Upstream', message: `geocode fetch failed: ${e.message}` });
  }
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    return json(resp.status, { error: 'Upstream', message: `OpenWeather ${resp.status}: ${txt.slice(0, 200)}` });
  }
  const arr = await resp.json();
  const results = Array.isArray(arr) ? arr.map((r) => ({
    name: r.name || '',
    country: r.country || '',
    state: r.state || '',
    lat: r.lat,
    lon: r.lon,
  })) : [];

  const out = { results };
  cacheSet(cacheKey, out);
  return json(200, out);
});
