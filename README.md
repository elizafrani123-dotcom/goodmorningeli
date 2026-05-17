# Good Morning Eli — personal morning dashboard

Live URL: https://goodmorningeli.netlify.app/

Six interactive cards: weather, stock portfolio with news, today's Google Calendar, Gmail highlights, and world news. Refreshes automatically; press `r` to force a refresh, `t` to toggle theme.

## What's in this folder

```
2026-05-17-good-morning-eli/
├── public/                  # static front-end (deployed by Netlify)
│   ├── index.html           # page shell, 6 section cards
│   ├── styles.css           # custom CSS on top of Tailwind
│   ├── app.js               # all front-end logic, charts, fetches
│   └── config.js            # edit your tickers here
├── netlify/
│   └── functions/           # serverless API endpoints
│       ├── _lib/
│       │   ├── cors.js
│       │   └── google-auth.js
│       ├── weather.js
│       ├── stocks.js
│       ├── stock-news.js
│       ├── world-news.js
│       ├── calendar.js
│       ├── inbox.js
│       ├── oauth-callback.js
│       └── disconnect.js
├── package.json
├── netlify.toml
├── .env.example             # copy to .env for local dev
├── .gitignore
└── docs/
    └── DEPLOY.md            # step-by-step deploy + OAuth setup
```

## Quickstart

1. Read `docs/DEPLOY.md`. Follow it top to bottom.
2. Set env vars on Netlify (OPENWEATHER_KEY is already provided; you create the rest).
3. `git push` — Netlify auto-deploys.

## Editing your tickers

Open `public/config.js` and edit the `tickers` array. Or use the "Manage tickers" modal in the dashboard's settings cog (persists to your browser's localStorage).

## Local dev (optional)

```bash
npm install
cp .env.example .env       # fill in real values
npx netlify dev            # opens at http://localhost:8888
```
