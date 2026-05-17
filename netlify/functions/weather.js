// GET /api/weather?lat=&lon=&units=imperial
// Free OpenWeather endpoints (current + 5-day/3-hour forecast).
// NOTE: alerts are NOT available on the free tier; returned array is always empty.

const { cors, json } = require('./_lib/cors');

const CACHE = new Map(); // key -> { at, data }
const TTL_MS = 10 * 60 * 1000; // 10 min

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

function pickIcon(weatherArr) {
  if (!Array.isArray(weatherArr) || weatherArr.length === 0) return null;
  return weatherArr[0].icon;
}

function pickConditions(weatherArr) {
  if (!Array.isArray(weatherArr) || weatherArr.length === 0) return null;
  return weatherArr[0].main || weatherArr[0].description || null;
}

function dayKey(unixSec, tzOffsetSec) {
  // Date in local timezone of the location (forecast is UTC; add city tz offset).
  const d = new Date((unixSec + (tzOffsetSec || 0)) * 1000);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function aggregateDaily(list, tzOffsetSec) {
  // Group by local day. For each day, capture min/max temps across all entries,
  // and pick the entry nearest local noon (12:00) as the representative.
  const groups = new Map();
  for (const item of list) {
    const key = dayKey(item.dt, tzOffsetSec);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const days = [];
  for (const [key, items] of groups) {
    let lo = Infinity, hi = -Infinity;
    for (const it of items) {
      const mn = it.main && it.main.temp_min;
      const mx = it.main && it.main.temp_max;
      if (typeof mn === 'number') lo = Math.min(lo, mn);
      if (typeof mx === 'number') hi = Math.max(hi, mx);
    }
    // Choose entry closest to local noon.
    let midday = items[0];
    let bestDelta = Infinity;
    for (const it of items) {
      const localHour = new Date((it.dt + (tzOffsetSec || 0)) * 1000).getUTCHours();
      const delta = Math.abs(localHour - 12);
      if (delta < bestDelta) {
        bestDelta = delta;
        midday = it;
      }
    }
    days.push({
      date: key,
      dt: midday.dt,
      hi: isFinite(hi) ? hi : (midday.main && midday.main.temp_max) || null,
      lo: isFinite(lo) ? lo : (midday.main && midday.main.temp_min) || null,
      conditions: pickConditions(midday.weather),
      icon: pickIcon(midday.weather),
      pop: midday.pop || 0,
      wind: midday.wind && midday.wind.speed,
      humidity: midday.main && midday.main.humidity,
    });
  }
  days.sort((a, b) => a.dt - b.dt);
  return days.slice(0, 7);
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`OpenWeather ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

exports.handler = cors(async (event) => {
  const params = event.queryStringParameters || {};
  const lat = params.lat;
  const lon = params.lon;
  const units = params.units || 'imperial';

  if (!lat || !lon) {
    return json(400, { error: 'BadRequest', message: 'lat and lon are required' });
  }
  const key = process.env.OPENWEATHER_KEY;
  if (!key) {
    return json(500, { error: 'ConfigError', message: 'OPENWEATHER_KEY is not set' });
  }

  const cacheKey = `${lat},${lon},${units}`;
  const cached = cacheGet(cacheKey);
  if (cached) return json(200, cached);

  const base = 'https://api.openweathermap.org/data/2.5';
  const currentUrl = `${base}/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&appid=${key}&units=${encodeURIComponent(units)}`;
  const forecastUrl = `${base}/forecast?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&appid=${key}&units=${encodeURIComponent(units)}`;

  const [current, forecast] = await Promise.all([fetchJson(currentUrl), fetchJson(forecastUrl)]);

  const tzOffsetSec = (forecast.city && forecast.city.timezone) || current.timezone || 0;

  const out = {
    location: current.name || (forecast.city && forecast.city.name) || null,
    current: {
      temp: current.main && current.main.temp,
      feelsLike: current.main && current.main.feels_like,
      conditions: pickConditions(current.weather),
      icon: pickIcon(current.weather),
      humidity: current.main && current.main.humidity,
      wind: current.wind && current.wind.speed,
      sunrise: current.sys && current.sys.sunrise,
      sunset: current.sys && current.sys.sunset,
      pressure: current.main && current.main.pressure,
    },
    hourly: (forecast.list || []).slice(0, 8).map((item) => ({
      dt: item.dt,
      temp: item.main && item.main.temp,
      feelsLike: item.main && item.main.feels_like,
      conditions: pickConditions(item.weather),
      icon: pickIcon(item.weather),
      pop: item.pop || 0,
      wind: item.wind && item.wind.speed,
      humidity: item.main && item.main.humidity,
    })),
    daily: aggregateDaily(forecast.list || [], tzOffsetSec),
    alerts: [], // not available on free tier
  };

  cacheSet(cacheKey, out);
  return json(200, out);
});
