# youtelligence

## What's built so far

`index.js` is an Express server (listens on `process.env.PORT`, defaulting to `3000`) exposing the OAuth2 flow against the YouTube Data API as web routes:

- `GET /connect?client=<name>` — redirects the browser to Google's consent screen (scopes: `youtube.readonly`, `yt-analytics.readonly`), passing `client` through as the OAuth `state` parameter. `client` is optional and defaults to `'my channel'` (`DEFAULT_CLIENT_NAME` in `index.js`).
- `GET /oauth2callback` — exchanges the auth code for an access/refresh token pair, saves them to Supabase under the `client_name` from `state`, and responds with the authenticated channel's title and subscriber count.

`auth.js` holds the underlying OAuth logic as reusable functions (no longer a standalone script):

- `getAuthUrl()` / `handleOAuthCallback(code, clientName)` — used by `index.js`'s routes above. `handleOAuthCallback` upserts tokens into the `oauth_tokens` Supabase table, keyed by `client_name` (refresh token is only overwritten when Google actually returns a new one, since it's only issued on first consent).
- `getValidAccessToken(clientName)` — reads the stored tokens from Supabase and transparently refreshes (and re-persists) the access token if it's expired. Used by `analytics.js` and `create_reporting_job.js`.

**Note:** the redirect URI defaults to `http://localhost:${PORT}/oauth2callback` for local development. Set `REDIRECT_URI` in deployed environments (e.g. Railway) to the public callback URL. Either way, it must match whatever's registered as an Authorized redirect URI in Google Cloud Console.

`analytics.js` uses `getValidAccessToken` to call the YouTube Analytics API and prints average view duration over the last 28 days for the channel — no browser interaction needed once a refresh token is stored.

`create_reporting_job.js` uses `getValidAccessToken` to call the YouTube Reporting API (`youtubereporting` v1) and create a recurring bulk report job for the `channel_reach_basic_a1` report type. Report files aren't available immediately — there's typically a delay of a day or more before the first one is generated. There isn't yet a script to list/download the generated report files.

The `reach_reports` Supabase table is provisioned (`supabase/reach_reports.sql`) to hold per-video daily impressions and click-through rate once that download script exists — one row per `(video_id, report_date)`, plus a `pulled_at` timestamp.

### Competitor tracking

This uses the YouTube Data API directly with an API key (`YOUTUBE_API_KEY`) — no OAuth needed, since it's all public data.

- `lookup_channel_id.js` resolves a `@handle` to its channel ID via `channels.list({ forHandle })`.
- `fetch_recent_videos.js` takes a channel ID, pulls its 10 most recent uploads (via the channel's uploads playlist), and for each one prints title, views, likes, comments, published date, plus normalized metrics — views/day (one decimal, matching the audit report format), like rate, and comment rate (both as percents). It then saves each video's raw and normalized stats as a row in the `competitor_snapshots` Supabase table.
  - **Note:** `CHANNEL_NAME` is currently hardcoded to `'JB Eckl'` in the script — every pull gets tagged with that name regardless of which channel ID you pass in. Fine for now since JB Eckl is the only channel being tracked, but will need to become a parameter once a second competitor is added.

The `competitor_channels` (client/channel pairs to track) and `competitor_snapshots` (per-video stat history) Supabase tables are provisioned in `supabase/`.

### Audit pipeline (findings.json)

The end-to-end pipeline that turns pulled data into a client deliverable. All six stages are built and working.

1. **Schema** — `docs/findings-schema.md` defines `findings.json`'s structure: `client`, `client_videos`, `competitors`, `pairs`, `studio_asks`, and the judgment-call fields (`headline_finding`, `ruled_out`, `recommendations`) that a person writes in rather than the pipeline deriving.
2. **Assembly** — `assemble_findings.js` pulls the client channel (via the stored OAuth token) and groups `competitor_snapshots` by channel, writing both into `findings.json`.
3. **Compute** — `assets/compute.py` recalculates `views_per_day`/`like_rate`/`comment_rate` and `traffic_source_split` percentages, validates the results (including that pairs reference real videos and use a valid `diagnosis`), and only saves back to `findings.json` if validation passes.
4. **Report** — `assets/build_report.py` renders `findings.json` into a markdown audit report (`report.md`), matching the structure of `docs/example-report.md`.
5. **Workbook** — `assets/build_workbook.py` exports `findings.json` into an Excel workbook (`workbook.xlsx`) with Client/Competitors/Pairs sheets, values written as a static snapshot rather than live formulas.
6. **Deck** — `assets/build_deck.js` loops `findings.json`'s `pairs`, resolves each pair's `video_refs` to full video data, downloads each video's thumbnail (`test_thumbnail.js`'s resolution/download logic, cached under `thumbnails/`), and renders one slide per pair using `assets/slide_template.js`'s layout (`deck.pptx`) — real titles, stats, and thumbnails in place of the template's hardcoded example. The higher-`views_per_day` video in a pair gets the "higher performer" badge; the takeaway strip is the pair's own `notes`. Only handles pairs with exactly 2 `video_refs` — anything else is skipped with a warning, since the template is a two-column layout.

**Note:** `findings.json`, `report.md`, `workbook.xlsx`, `deck.pptx`, and `docs/example-report.md` are all gitignored — they contain real client data, generated per run rather than being source-controlled. Downloaded thumbnails (`*.jpg`, including everything under `thumbnails/`) are gitignored too.

## Setup

1. `npm install`, then `pip3 install -r requirements.txt` (openpyxl, needed for `build_workbook.py`; `compute.py` and `build_report.py` are stdlib-only).
2. Create a Supabase project, then run the SQL migrations in `supabase/` (in order: `oauth_tokens.sql`, `oauth_tokens_unique_client.sql`, `oauth_tokens_add_expires_at.sql`, `grant_oauth_tokens.sql`, `reach_reports.sql`, `competitor_channels.sql`, `competitor_snapshots.sql`, `competitor_snapshots_add_normalized.sql`).
3. Create a `.env` file with:
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   SUPABASE_URL=...
   SUPABASE_SERVICE_ROLE_KEY=...
   YOUTUBE_API_KEY=...  # for lookup_channel_id.js and fetch_recent_videos.js
   REDIRECT_URI=...  # optional; only needed outside local dev, e.g. https://<app>.up.railway.app/oauth2callback
   ```
4. In the Google Cloud Console, add the callback URL as an Authorized redirect URI on that OAuth client — `http://localhost:3000/oauth2callback` for local dev, plus your Railway URL's `/oauth2callback` for deployment.

## Run

```
node index.js
```

Then visit `http://localhost:3000/connect?client=<name>` (or whatever `PORT` you set) and approve access — `<name>` is the `client_name` the tokens get saved under in Supabase. You'll land back on `/oauth2callback`, which saves the tokens to Supabase and shows the channel title and subscriber count.

Once tokens are stored, fetch analytics without re-authenticating:

```
node analytics.js
```

Create the `channel_reach_basic_a1` reporting job (only needs to be run once — rerunning creates a duplicate job, since the script doesn't check for an existing one):

```
node create_reporting_job.js
```

Look up a competitor's channel ID from their handle:

```
node lookup_channel_id.js @owner-com
```

Pull and save a snapshot of a channel's 10 most recent videos:

```
node fetch_recent_videos.js <channelId>
```

Run the audit pipeline (in order) once `client_videos`/`competitors` data has been pulled and `pairs`/`headline_finding`/`ruled_out`/`recommendations` have been filled in by hand:

```
node assemble_findings.js
python3 assets/compute.py
python3 assets/build_report.py
python3 assets/build_workbook.py
node assets/build_deck.js
```

Test the thumbnail fetch/download for a single video on its own:

```
node test_thumbnail.js <videoId>
```
