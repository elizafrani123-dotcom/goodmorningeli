// GET /api/world-news?category=Top
// Aggregates RSS feeds, dedupes by title, sorts by date desc, limits to 20.

const Parser = require('rss-parser');
const { cors, json } = require('./_lib/cors');

const parser = new Parser({
  timeout: 8000,
  headers: { 'User-Agent': 'GoodMorningEli/1.0 (+https://goodmorningeli.netlify.app)' },
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: false }],
      ['media:thumbnail', 'mediaThumbnail', { keepArray: false }],
    ],
  },
});

const CACHE = new Map(); // category -> { at, data }
const TTL_MS = 10 * 60 * 1000; // 10 min

const FEEDS = {
  Top: [
    'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml',
    'https://feeds.skynews.com/feeds/rss/home.xml',
    'https://www.theguardian.com/world/rss',
  ],
  Geopolitics: [
    'https://www.aljazeera.com/xml/rss/all.xml',
    'https://www.theguardian.com/world/rss',
  ],
  Israel: [
    'https://www.timesofisrael.com/feed/',
    'https://rss.jpost.com/rss/rssfeedsfrontpage.aspx',
  ],
  US: [
    'https://feeds.npr.org/1003/rss.xml',
    'https://rss.nytimes.com/services/xml/rss/nyt/US.xml',
  ],
  Tech: [
    'https://techcrunch.com/feed/',
    'https://www.theverge.com/rss/index.xml',
  ],
  Markets: [
    'https://search.cnbc.com/rss/2.0/?type=rssfeed&keyword=markets',
    'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml',
  ],
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

function stripHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function normTitle(t) {
  return String(t || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function extractImage(item) {
  if (item.enclosure && item.enclosure.url) return item.enclosure.url;
  const mc = item.mediaContent;
  if (mc) {
    if (typeof mc === 'string') return mc;
    if (mc.$ && mc.$.url) return mc.$.url;
    if (mc.url) return mc.url;
  }
  const mt = item.mediaThumbnail;
  if (mt) {
    if (typeof mt === 'string') return mt;
    if (mt.$ && mt.$.url) return mt.$.url;
    if (mt.url) return mt.url;
  }
  return null;
}

async function fetchFeed(url) {
  try {
    return await parser.parseURL(url);
  } catch (e) {
    console.warn('[world-news] feed failed:', url, e && e.message);
    return null;
  }
}

exports.handler = cors(async (event) => {
  const params = event.queryStringParameters || {};
  const category = params.category || 'Top';
  if (!FEEDS[category]) {
    return json(400, { error: 'BadRequest', message: `Unknown category: ${category}` });
  }

  const cached = cacheGet(category);
  if (cached) return json(200, cached);

  const results = await Promise.allSettled(FEEDS[category].map(fetchFeed));
  const articles = [];
  for (const r of results) {
    if (r.status !== 'fulfilled' || !r.value) continue;
    const feed = r.value;
    const source = feed.title || '';
    for (const item of feed.items || []) {
      const publishedAt = item.isoDate || item.pubDate || null;
      const rawSummary = item.contentSnippet || item.summary || item.content || item.description || '';
      let summary = stripHtml(rawSummary);
      if (summary.length > 280) summary = summary.slice(0, 277).trimEnd() + '...';
      articles.push({
        title: item.title || '',
        summary,
        url: item.link || '',
        source,
        publishedAt,
        image: extractImage(item),
        category,
      });
    }
  }

  // Dedupe by normalized title.
  const seen = new Set();
  const unique = [];
  for (const a of articles) {
    const key = normTitle(a.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(a);
  }

  // Sort by publishedAt desc (missing dates sink).
  unique.sort((a, b) => {
    const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return tb - ta;
  });

  const out = { category, articles: unique.slice(0, 20), asOf: new Date().toISOString() };
  cacheSet(category, out);
  return json(200, out);
});
