# youtelligence

## What's built so far

`index.js` is an Express server (listens on `process.env.PORT`, defaulting to `3000`) exposing the OAuth2 flow against the YouTube Data API as web routes:

- `GET /auth` — redirects the browser to Google's consent screen (scopes: `youtube.readonly`, `yt-analytics.readonly`).
- `GET /oauth2callback` — exchanges the auth code for an access/refresh token pair, saves them to Supabase, and responds with the authenticated channel's title and subscriber count.

`auth.js` holds the underlying OAuth logic as reusable functions (no longer a standalone script):

- `getAuthUrl()` / `handleOAuthCallback(code, clientName)` — used by `index.js`'s routes above. `handleOAuthCallback` upserts tokens into the `oauth_tokens` Supabase table, keyed by `client_name` (refresh token is only overwritten when Google actually returns a new one, since it's only issued on first consent).
- `getValidAccessToken(clientName)` — reads the stored tokens from Supabase and transparently refreshes (and re-persists) the access token if it's expired. Used by `analytics.js` and `create_reporting_job.js`.

**Note:** the redirect URI is derived as `http://localhost:${PORT}/oauth2callback`, so it must match whatever's registered as an Authorized redirect URI in Google Cloud Console for the `PORT` you run with.

`analytics.js` uses `getValidAccessToken` to call the YouTube Analytics API and prints average view duration over the last 28 days for the channel — no browser interaction needed once a refresh token is stored.

`create_reporting_job.js` uses `getValidAccessToken` to call the YouTube Reporting API (`youtubereporting` v1) and create a recurring bulk report job for the `channel_reach_basic_a1` report type. Report files aren't available immediately — there's typically a delay of a day or more before the first one is generated. There isn't yet a script to list/download the generated report files.

The `reach_reports` Supabase table is provisioned (`supabase/reach_reports.sql`) to hold per-video daily impressions and click-through rate once that download script exists — one row per `(video_id, report_date)`, plus a `pulled_at` timestamp.

## Setup

1. `npm install`
2. Create a Supabase project, then run the SQL migrations in `supabase/` (in order: `oauth_tokens.sql`, `oauth_tokens_unique_client.sql`, `oauth_tokens_add_expires_at.sql`, `grant_oauth_tokens.sql`, `reach_reports.sql`).
3. Create a `.env` file with:
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   SUPABASE_URL=...
   SUPABASE_SERVICE_ROLE_KEY=...
   ```
4. In the Google Cloud Console, add `http://localhost:3000/oauth2callback` as an Authorized redirect URI on that OAuth client.

## Run

```
node index.js
```

Then visit `http://localhost:3000/auth` (or whatever `PORT` you set) and approve access. You'll land back on `/oauth2callback`, which saves the tokens to Supabase and shows the channel title and subscriber count.

Once tokens are stored, fetch analytics without re-authenticating:

```
node analytics.js
```

Create the `channel_reach_basic_a1` reporting job (only needs to be run once — rerunning creates a duplicate job, since the script doesn't check for an existing one):

```
node create_reporting_job.js
```
