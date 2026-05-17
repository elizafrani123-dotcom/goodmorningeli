# Deploy guide — Good Morning Eli

Follow these in order. Should take ~15 minutes total.

---

## 1. Push to GitHub

```bash
cd "C:\Users\eliza\Desktop\Claude Cowork Playground\2026-05-17-good-morning-eli"
git init
git add .
git commit -m "Initial dashboard"
gh repo create goodmorningeli --private --source=. --push
# or do it manually on github.com and push
```

## 2. Link the GitHub repo to your existing Netlify site

1. Go to https://app.netlify.com → your `goodmorningeli` site → **Site settings → Build & deploy → Continuous deployment**.
2. Click **Link site to Git** → choose GitHub → pick the `goodmorningeli` repo.
3. Build settings:
   - **Build command:** `npm install`
   - **Publish directory:** `public`
   - **Functions directory:** `netlify/functions`
   (Should auto-detect from `netlify.toml`.)
4. Save. Don't deploy yet — env vars first.

## 3. Get your Finnhub-free... wait, you chose Yahoo Finance — skip this. No key needed.

Yahoo Finance is unofficial but works without a key. If it ever breaks, swap to Finnhub by editing `netlify/functions/stocks.js`.

## 4. Create Google OAuth credentials (for Calendar + Gmail)

1. Go to https://console.cloud.google.com/
2. Top bar → project dropdown → **New Project**. Name it `good-morning-eli`. Create.
3. Make sure that project is selected.
4. Left menu → **APIs & Services → Library**. Enable these two:
   - **Google Calendar API**
   - **Gmail API**
5. Left menu → **APIs & Services → OAuth consent screen**.
   - User type: **External**. Create.
   - App name: `Good Morning Eli`. User support email + developer email: your Gmail.
   - Save and continue through the scopes screen (you can skip adding scopes here; we request them at runtime).
   - **Test users:** add `elizafrani123@gmail.com`. Save.
   - The app will stay in "Testing" mode — that's fine for personal use, no verification needed.
6. Left menu → **APIs & Services → Credentials**.
   - **+ CREATE CREDENTIALS → OAuth client ID**.
   - Application type: **Web application**. Name: `gme-web`.
   - **Authorized redirect URIs**: add BOTH:
     - `https://goodmorningeli.netlify.app/api/oauth-callback`
     - `http://localhost:8888/api/oauth-callback` (for local dev)
   - Create. Copy the **Client ID** and **Client secret**.

## 5. Set environment variables on Netlify

Netlify dashboard → your site → **Site settings → Environment variables → Add a variable**. Add these five:

| Key | Value |
| --- | --- |
| `OPENWEATHER_KEY` | `efaf79e07fc17b6cbeade1fdc47c598e` |
| `GOOGLE_CLIENT_ID` | (paste from step 4.6) |
| `GOOGLE_CLIENT_SECRET` | (paste from step 4.6) |
| `GOOGLE_REDIRECT_URI` | `https://goodmorningeli.netlify.app/api/oauth-callback` |
| `SESSION_SECRET` | any long random string — generate with `openssl rand -hex 32` or just mash the keyboard for 40 characters |

Save.

## 6. Deploy

Netlify → **Deploys → Trigger deploy → Deploy site**. Wait ~1 minute for build to finish.

## 7. First-run

1. Open https://goodmorningeli.netlify.app/
2. Browser prompts for location → **Allow**. Weather populates.
3. Stocks + world news populate automatically.
4. Calendar and Inbox cards show **Connect Google** buttons → click → pick your Google account → grant Calendar + Gmail read-only access → window auto-closes → cards refresh.
5. Done. Bookmark it.

---

## Troubleshooting

**Calendar/Inbox stuck on "Connect Google" after auth**
The redirect URI on Google Console must EXACTLY match the value in `GOOGLE_REDIRECT_URI` env var. Check for trailing slashes.

**"Access blocked: This app's request is invalid"**
You're hitting Google OAuth before adding yourself as a test user in step 4.5.

**Stocks card empty**
Yahoo Finance occasionally rate-limits. Wait 60 seconds and refresh. If persistent, check Netlify function logs.

**World news category empty**
RSS feeds can 404 or change URLs. Check `netlify/functions/world-news.js` and update feed URLs — they're at the top of the file.

**Want to change tickers**
Edit `public/config.js` OR use the settings cog in the dashboard → "Manage tickers". Settings cog version persists per-browser via localStorage.

**Want to add categories**
Edit `public/config.js` (`newsCategories` array) and add matching feed URLs in `netlify/functions/world-news.js`.

---

## Local dev

```bash
npm install
cp .env.example .env
# edit .env, set GOOGLE_REDIRECT_URI=http://localhost:8888/api/oauth-callback
npx netlify dev
```

Visit http://localhost:8888.
