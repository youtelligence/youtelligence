# youtelligence

## What's built so far

`index.js` is an Express server (listens on `process.env.PORT`, defaulting to `3000`) exposing the OAuth2 flow against the YouTube Data API as web routes:

- `GET /onboard?client=<name>` — shows a simple HTML landing page for that client, with a "Connect Your Channel" button linking to `/connect?client=<name>`. `client` is required (400s if missing).
- `GET /connect?client=<name>` — redirects the browser to Google's consent screen (scopes: `youtube.readonly`, `yt-analytics.readonly`), passing `client` through as the OAuth `state` parameter. `client` is optional and defaults to `'my channel'` (`DEFAULT_CLIENT_NAME` in `index.js`).
- `GET /oauth2callback` — exchanges the auth code for an access/refresh token pair, saves them to Supabase under the `client_name` from `state`, and responds with the authenticated channel's title/subscriber count plus a form (five text inputs, "Competitor 1" – "Competitor 5", plus a hidden `client` field carrying `state` forward) for submitting competitor handles.
- `POST /competitors` — takes the submitted `client` and `competitor1`–`competitor5` fields (blanks ignored; 400s if `client` or every field is missing). Each field can be a bare `@handle`, a handle-style URL (`youtube.com/@handle[/videos]`), or a `/channel/<id>` URL — `parseCompetitorInput` in `competitors.js` sorts out which. A `/channel/` URL already carries a real channel ID, so it skips the `@handle` lookup entirely (via `getChannelTitle`); everything else resolves through `lookupChannelId`, the same way `lookup_channel_id.js` does. Either way, the resulting `(client_name, channel_id, channel_name)` pair is upserted into `competitor_channels`, then its recent-videos snapshot is pulled and saved the same way `fetch_recent_videos.js` does. Reports per-field success or failure.

`auth.js` holds the underlying OAuth logic as reusable functions (no longer a standalone script):

- `getAuthUrl()` / `handleOAuthCallback(code, clientName)` — used by `index.js`'s routes above. `handleOAuthCallback` upserts tokens into the `oauth_tokens` Supabase table, keyed by `client_name` (refresh token is only overwritten when Google actually returns a new one, since it's only issued on first consent).
- `getValidAccessToken(clientName)` — reads the stored tokens from Supabase and transparently refreshes (and re-persists) the access token if it's expired. Used by `analytics.js`, `create_reporting_job.js`, and `assemble_findings.js`.

**Note:** the redirect URI defaults to `http://localhost:${PORT}/oauth2callback` for local development. Set `REDIRECT_URI` in deployed environments (e.g. Railway) to the public callback URL. Either way, it must match whatever's registered as an Authorized redirect URI in Google Cloud Console.

`analytics.js` uses `getValidAccessToken` to call the YouTube Analytics API and prints average view duration over the last 28 days for the channel — no browser interaction needed once a refresh token is stored. Takes a client name as its first CLI argument, defaulting to `'my channel'` if omitted.

`create_reporting_job.js` uses `getValidAccessToken` to call the YouTube Reporting API (`youtubereporting` v1) and create a recurring bulk report job for the `channel_reach_basic_a1` report type. Report files aren't available immediately — there's typically a delay of a day or more before the first one is generated. Takes a client name as its first CLI argument, defaulting to `'my channel'` if omitted.

`download_reports.js` is the other half: it finds every `channel_reach_basic_a1` job for the client (there can be more than one — `create_reporting_job.js` doesn't dedupe), lists their report files, and for each data day keeps only the report with the newest `createTime` (YouTube regenerates a day's file when it reprocesses data). It downloads each kept file over HTTP with the OAuth bearer token, parses the CSV, and aggregates the per-slice rows (`live_or_on_demand` × `subscribed_status` × …) back up to one row per `(video_id, report_date)` — summing `impressions` and taking an impressions-weighted mean of `impressions_click_through_rate`. Results are upserted into `reach_reports` on `(video_id, report_date)`, with `pulled_at` set explicitly so re-pulled days get a fresh timestamp. Takes a client name as its first CLI argument (default `'my channel'`) and an optional RFC 3339 `createdAfter` timestamp as its second, so a re-run only fetches report files generated since last time.

The `reach_reports` Supabase table (`supabase/reach_reports.sql`) holds that output — one row per `(video_id, report_date)`, plus a `pulled_at` timestamp.

### Competitor tracking

This uses the YouTube Data API directly with an API key (`YOUTUBE_API_KEY`) — no OAuth needed, since it's all public data.

`competitors.js` holds the underlying lookup/fetch/save logic as reusable functions:

- `lookupChannelId(handle)` resolves a `@handle` to its channel ID and title via `channels.list({ forHandle })`.
- `fetchRecentVideos(channelId)` pulls a channel's 10 most recent uploads (via the channel's uploads playlist) and returns each one's title, views, likes, comments, published date, plus normalized metrics — views/day (one decimal, matching the audit report format), like rate, and comment rate (both as percents). `channel_name` is read from the channel's own title, not hardcoded.
- `saveSnapshots(snapshots)` inserts rows into the `competitor_snapshots` Supabase table.
- `saveCompetitorChannel(clientName, channelId, channelName)` upserts a client/channel pair into the `competitor_channels` Supabase table, keyed on `(client_name, channel_id)`.

`lookup_channel_id.js` and `fetch_recent_videos.js` are thin CLI wrappers around the first two functions (see **Run** below); the `/competitors` route in `index.js` calls all four directly.

The `competitor_channels` (client/channel pairs to track) and `competitor_snapshots` (per-video stat history) Supabase tables are provisioned in `supabase/`.

### Audit pipeline (findings.json)

The end-to-end pipeline that turns pulled data into a client deliverable. All six stages are built and working.

1. **Schema** — `docs/findings-schema.md` defines `findings.json`'s structure: `client`, `client_videos`, `competitors`, `pairs`, `studio_asks`, and the judgment-call fields (`headline_finding`, `ruled_out`, `recommendations`) that a person writes in rather than the pipeline deriving.
2. **Assembly** — `assemble_findings.js` pulls the client channel into a per-client file, `findings-<slug>.json`, where `<slug>` is the name argument lowercased and hyphenated (`"JB Eckl"` → `findings-jb-eckl.json`, default `'my channel'` → `findings-my-channel.json`), so concurrent audits don't overwrite each other. It prints the exact downstream commands with that path. Two modes:
   - **OAuth mode** (`node assemble_findings.js [name]`): reads the connected client's own channel via its stored token (client name defaults to `'my channel'`). Leaves `client_videos` untouched so the Analytics-backed fields other scripts add aren't clobbered. Competitors are resolved from `competitor_channels` **filtered to that client name** (`competitor_snapshots` has no `client_name` column, so the client's tracked channel IDs are looked up first, then only those channels' snapshots are grouped in).
   - **Public-audit mode** (`node assemble_findings.js <channelName> <channelId>`): no OAuth. Pulls the given channel's recent videos through the same public Data API path competitors use, writes them to `client_videos` with `data_source: 'public_api'`, and leaves every Analytics-only field (`avg_view_duration_seconds`, `avg_percentage_viewed`, `impressions`, `ctr`, `traffic_source_split`) `null`. **`competitors` is left empty** — a public audit analyzes one channel against its own video history (pairs within the library); named competitors only apply to OAuth clients, who submit them through the onboarding form.
3. **Compute** — `reports/compute.py [findings-<slug>.json]` recalculates `views_per_day`/`like_rate`/`comment_rate` and `traffic_source_split` percentages, validates the results (including that pairs reference real videos and use a valid `diagnosis`), and only saves back to that file if validation passes.
4. **Report** — `reports/build_report.py [findings-<slug>.json] [report.md]` renders the findings into a markdown audit report, matching the structure of `docs/example-report.md`.
5. **Workbook** — `reports/build_workbook.py [findings-<slug>.json] [workbook.xlsx]` exports the findings into an Excel workbook with Client/Competitors/Pairs sheets, values written as a static snapshot rather than live formulas.
6. **Deck** — `assets/build_deck.js [findings-<slug>.json] [deck.pptx]` loops the findings' `pairs`, resolves each pair's `video_refs` to full video data, downloads each video's thumbnail (`test_thumbnail.js`'s resolution/download logic, cached under `thumbnails/`), and renders one slide per pair using `assets/slide_template.js`'s layout — real titles, stats, and thumbnails in place of the template's hardcoded example. The higher-`views_per_day` video in a pair gets the "higher performer" badge; the takeaway strip is the pair's own `notes`. Only handles pairs with exactly 2 `video_refs` — anything else is skipped with a warning, since the template is a two-column layout.

Each of stages 3–6 defaults its findings path to `findings.json` and its output to the fixed name (`report.md` / `workbook.xlsx` / `deck.pptx`); pass the per-client findings file (and, if running several clients, a per-client output path) explicitly.

**Note:** `findings.json`, `findings-*.json`, `report.md`, `workbook.xlsx`, `deck.pptx`, and `docs/example-report.md` are all gitignored — they contain real client data, generated per run rather than being source-controlled. Downloaded thumbnails (`*.jpg`, including everything under `thumbnails/`) are gitignored too.

### Keyword research tool

Internal, personal-use tool (not customer-facing). Given a seed term it returns related terms, questions, a competitiveness score, hashtag recommendations, and a (stubbed) search-volume figure. A second mode takes an already-live video's metadata and reports which landscape terms are missing from it. Served by the same Express app in `index.js`:

- `GET /keyword-research` — a single static page (`public/keyword-research.html`, no framework): two forms (keyword research; video-optimization gap analysis) feeding one shared results area. No auth.
- `POST /api/keyword-research` — body `{ "term": "youtube shorts editing" }`. Returns `seed_term`, `related_terms`, `questions`, `search_volume`, `competitiveness` (`score` plus a top-10 `top_videos` list), `hashtags`, and `cached` / `cached_at`.
- `POST /api/optimize-video` — body `{ "topic", "current_title", "current_description", "current_tags" }` (`current_tags` an array or a comma-separated string). Runs the same `runKeywordResearch(topic)` pipeline (shared function, not an HTTP call), then diffs the landscape against the pasted-in metadata. Returns `topic`, `keyword_landscape` (the `related_terms` / `questions` / `competitiveness` / `hashtags` / `search_volume` fields), `gaps` (`missing_from_title_or_description`, `missing_from_tags`), and `cached`. Structured gap data only — it does not generate replacement copy.

The pipeline lives in `keyword/`, one file per concern, orchestrated by `keyword/pipeline.js`:

- `autocomplete.js` — hits YouTube's public suggest endpoint (`suggestqueries.google.com/complete/search?client=youtube`) for the seed term, for the seed prefixed with `how` / `what` / `why` / `best`, and for `<seed> vs` (`vs` trails so autocomplete fills in the competing term — "shorts editing vs capcut", not "vs shorts editing capcut"). Dedupes (dropping the seed and any bare query stem echoed back uncompleted); anything starting with a question word goes to `questions`, the rest to `related_terms`. No API key, no quota cost.
- `competitiveness.js` — `search.list` (100 units) for the seed term, then `videos.list` and one batched `channels.list` (~1 unit each) for view counts, publish dates, and subscriber counts. Computes `view_velocity` (views ÷ days since publish) per video and a rank-weighted, log-scaled 0–100 `score` across the top 10 (higher velocity = more competitive). Uses its own dedicated key, `YOUTUBE_API_KEY_KEYWORD_TOOL` — restrict it to YouTube Data API v3 only in the Cloud Console so this tool's quota stays isolated from `YOUTUBE_API_KEY`.
- `hashtags.js` — ranks `snippet.tags` from the videos `competitiveness.js` already fetched by how many of the top 10 carry each tag, normalizes them to `#hashtags`, returns the top N (default 15). Tags that just repeat the name of a channel in the result set (normalized: lowercase, no spaces/punctuation) are dropped before ranking, so a channel's own name doesn't get recommended as a hashtag on searches it dominates. No extra API calls.
- `volume.js` — stubbed: always returns `{ value: null, source: "google_ads" }`. Wiring it to the Google Ads Keyword Planner is in progress — see **Search volume (Google Ads)** below. The stub keeps the same signature so it can be dropped in without touching the other modules.
- `gaps.js` — `findGaps(landscape, video)` for the `/api/optimize-video` route: normalizes `current_title` + `current_description` into one punctuation-stripped blob and flags every `related_terms` / `questions` entry not found in it as a substring; normalizes `current_tags` the `hashtags.js` way and flags every recommended hashtag (already branded-tag-filtered) not matching one. Plain substring / exact-normalized matching, not fuzzy or semantic — a term covered under different wording still shows as a gap (documented in the file header, same as the branded-tag limitation).
- `cache.js` — before any YouTube call, `pipeline.js` checks `keyword_lookups` for a row for the normalized term (lowercased, trimmed, whitespace-collapsed) whose `created_at` falls on the current UTC calendar date. The cache resets at 00:00 UTC each day rather than expiring a fixed span after it was written — a lookup at 23:58 UTC and the same term at 00:02 UTC are different days and both hit the live API. A hit is returned with `cached: true` and skips all API calls; a miss runs the pipeline, writes the payload to `keyword_lookups`, and returns it with `cached: false`. This table doubles as search history.

Default YouTube Data API quota is 10,000 units/day, so ~100 fresh lookups/day before the ceiling — the cache keeps real usage well under that.

### Search volume (Google Ads)

`volume.js` is meant to return real average-monthly-search figures from the Google Ads Keyword Planner (`KeywordPlanIdeaService.GenerateKeywordIdeas`). Groundwork so far:

- A dedicated OAuth client (`GOOGLE_ADS_CLIENT_ID` / `GOOGLE_ADS_CLIENT_SECRET`), separate from the YouTube one — a refresh token is bound to the client that issued it, and the Ads integration authenticates with the `GOOGLE_ADS_*` client.
- `get_google_ads_refresh_token.js` — one-time helper: runs the consent flow for the `adwords` scope against the Ads client and prints a `GOOGLE_ADS_REFRESH_TOKEN` line to paste into `.env`. Redirects to `http://localhost:3000/oauth2callback` (stop `node index.js` first so the port is free). Delete after use.
- `test_google_ads_keyword_ideas.js` — standalone smoke test: authenticates with the `GOOGLE_ADS_*` credentials and calls `GenerateKeywordIdeas` (REST, `v25` — retired versions 404 with an HTML page; live set as of writing is v22–v25) for a single term, printing the raw response. Keeps credential/access problems separate from the eventual `volume.js` wiring.

**Blocked on:** the developer token is at Test/Explorer access level, which returns `DEVELOPER_TOKEN_NOT_APPROVED` ("not allowed for use with explorer access") for `GenerateKeywordIdeas` against real data. Needs Basic access — apply in the Ads manager account under **Admin → API Center**. OAuth, the request shape, and the API version are all confirmed working; once the token is approved, `volume.js` is a straight port of the smoke test's call.

## Setup

1. `npm install`, then `pip3 install -r reports/requirements.txt` (openpyxl, needed for `build_workbook.py`; `compute.py` and `build_report.py` are stdlib-only).
2. Create a Supabase project, then run the SQL migrations in `supabase/` (in order: `oauth_tokens.sql`, `oauth_tokens_unique_client.sql`, `oauth_tokens_add_expires_at.sql`, `grant_oauth_tokens.sql`, `reach_reports.sql`, `competitor_channels.sql`, `competitor_snapshots.sql`, `competitor_snapshots_add_normalized.sql`, `keyword_lookups.sql`).
3. Create a `.env` file with:
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   SUPABASE_URL=...
   SUPABASE_SERVICE_ROLE_KEY=...
   YOUTUBE_API_KEY=...  # for lookup_channel_id.js and fetch_recent_videos.js
   YOUTUBE_API_KEY_KEYWORD_TOOL=...  # separate key, restricted to YouTube Data API v3, for the keyword research tool
   REDIRECT_URI=...  # optional; only needed outside local dev, e.g. https://<app>.up.railway.app/oauth2callback
   # Google Ads Keyword Planner (for volume.js / the Google Ads scripts; not used by the running app yet):
   GOOGLE_ADS_DEVELOPER_TOKEN=...       # Ads API Center; needs Basic access for real keyword data
   GOOGLE_ADS_CLIENT_ID=...             # dedicated OAuth client, separate from GOOGLE_CLIENT_ID
   GOOGLE_ADS_CLIENT_SECRET=...
   GOOGLE_ADS_REFRESH_TOKEN=...         # produced by get_google_ads_refresh_token.js
   GOOGLE_ADS_LOGIN_CUSTOMER_ID=...     # Ads manager account, digits only (no dashes)
   ```
4. In the Google Cloud Console, add the callback URL as an Authorized redirect URI on that OAuth client — `http://localhost:3000/oauth2callback` for local dev, plus your Railway URL's `/oauth2callback` for deployment.

## Run

```
node index.js
```

For the keyword research tool, visit `http://localhost:3000/keyword-research` and enter a seed term.

For the audit pipeline, visit `http://localhost:3000/connect?client=<name>` (or whatever `PORT` you set) and approve access — `<name>` is the `client_name` the tokens get saved under in Supabase. You'll land back on `/oauth2callback`, which saves the tokens to Supabase and shows the channel title and subscriber count.

Once tokens are stored, fetch analytics without re-authenticating (`<name>` is optional, defaulting to `'my channel'`; use whatever `client_name` you connected under):

```
node analytics.js <name>
```

Create the `channel_reach_basic_a1` reporting job (only needs to be run once per client — rerunning creates a duplicate job, since the script doesn't check for an existing one):

```
node create_reporting_job.js <name>
```

Once report files have been generated (a day or more later), download them into the `reach_reports` table. Safe to re-run — it upserts on `(video_id, report_date)`; pass an RFC 3339 timestamp as a second arg to only pull files generated since then:

```
node download_reports.js <name> [createdAfter]
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
# Assembly writes findings-<slug>.json and prints the commands below with that path filled in.
node assemble_findings.js <name>                       # OAuth: connected client's own channel + its competitors
node assemble_findings.js "<channelName>" <channelId>  # public audit: single channel, no OAuth, no competitors

# Then, with <f> = the findings-<slug>.json that Assembly wrote:
python3 reports/compute.py <f>
python3 reports/build_report.py <f>
python3 reports/build_workbook.py <f>
node assets/build_deck.js <f>
```

Test the thumbnail fetch/download for a single video on its own:

```
node test_thumbnail.js <videoId>
```

Mint a Google Ads refresh token (one-time; stop `node index.js` first), then smoke-test the Keyword Planner credentials:

```
node get_google_ads_refresh_token.js
node test_google_ads_keyword_ideas.js ["seed term"]
```
