# Data capture from YouTube

There are now real API paths for almost everything the audit needs. Use them. The
Chrome-scraping method that used to be the whole of this document is a **legacy
fallback** — it still works and is kept at the bottom for the case where no API
keys are configured and only the browser tool is available, but it is no longer
the primary way to capture data.

Every video record written into `findings.json` carries `data_source`, either
`'public_api'` or `'analytics_api'`, so the report generator can tell observed
Studio data apart from public-data inference. The two capture paths below line up
one-to-one with those two values. See `references/findings-schema.md`.

---

## Path 1 — Public audits (any channel, no OAuth)

Works for **any** channel: the client's, a competitor's, a channel the user has
no relationship with. This is the default path and the only one available for
competitors.

Use the existing competitor-pull logic — the `competitors.js` /
`fetch_recent_videos.js` pattern — which calls the **YouTube Data API v3** with an
API key (`YOUTUBE_API_KEY`), *not* OAuth. The channel's uploads playlist gives the
video list; `videos.list(part=snippet,statistics)` gives the per-video fields.

Captured per video:

| Field | Source |
|---|---|
| `title`, `description`, `published_at` | `snippet` |
| `views`, `likes`, `comments` | `statistics` (exact integers, not the rounded "167K") |
| `views_per_day` | derived: `views / days_since_publish` |
| `like_rate` | derived: `likes / views`, as a percent |
| `comment_rate` | derived: `comments / views`, as a percent |

The normalized metrics (`views_per_day`, `like_rate`, `comment_rate`) are already
defined and computed in that code — reuse it, don't recompute by hand.

**`data_source: 'public_api'`** on every row from this path. The Analytics-only
fields (`impressions`, `ctr`, `avg_view_duration_seconds`,
`avg_percentage_viewed`, `traffic_source_split`) stay `null` — they are not
available for a channel you don't have an OAuth token for, and that includes every
competitor.

Quota: `playlistItems.list` and `videos.list` are ~1 unit per call; the default
ceiling is 10,000 units/day, which is far more than one audit needs.

---

## Path 2 — Private / client audits (OAuth-connected channel only)

Only possible for the **client's own channel**, once they've completed the OAuth
connect flow and a refresh token is stored (scopes: `youtube.readonly`,
`yt-analytics.readonly`). Never available for competitors — there is no OAuth
access to someone else's Analytics, so don't try.

Two APIs feed this path:

### YouTube Analytics API — `analytics.js` pattern

`getValidAccessToken(clientName)` → `youtubeAnalytics.reports.query`. Per-video
figures come from `dimensions=video` with `filters=video==<id>` (or a batched set),
over the audit window.

| `findings.json` field | Analytics API metric / dimension |
|---|---|
| `avg_view_duration_seconds` | `averageViewDuration` |
| `avg_percentage_viewed` | `averageViewPercentage` |
| `traffic_source_split` | second query with `dimensions=insightTrafficSourceType`, `metrics=views`; fold the source types into the schema's `browse` / `suggested` / `search` / `external` / `subscriber_direct` / `notification` / `other` keys as raw view counts (no percentages — `compute.py` derives the split) |

### YouTube Reporting API — `create_reporting_job.js` + `download_reports.js`

Impressions and impressions CTR are **not** in the Analytics API; they come from
the `channel_reach_basic_a1` bulk report.

1. `create_reporting_job.js <client>` — once per client. Creates the recurring
   job. Report files aren't generated immediately; expect a day or more of lag
   before the first one exists.
2. `download_reports.js <client> [createdAfter]` — lists the job's report files,
   keeps the newest regeneration of each data day, downloads and parses the CSV,
   aggregates to one row per `(video_id, report_date)`, and upserts into the
   `reach_reports` Supabase table (`impressions` summed, `ctr` as an
   impressions-weighted mean). Safe to re-run.

| `findings.json` field | `reach_reports` column |
|---|---|
| `impressions` | `impressions` |
| `ctr` | `click_through_rate` |

`assemble_findings.js` joins the Analytics figures and the `reach_reports` rows
onto the client's video list and writes them with **`data_source:
'analytics_api'`**. A client video for which the reach report hasn't landed yet
keeps those fields `null` — that's a timing gap, not a different data source.

---

## On-page SEO checklist capture

Data API v3 only — no OAuth — so this runs for **both** public and private audits,
against any channel. All of it reads from `videos.list(part=snippet)` plus one
playlist enumeration.

| Check | How |
|---|---|
| **Keyword in title** | target keyword appears in `snippet.title` (case-insensitive substring) |
| **Keyword in first line of description** | keyword appears in `snippet.description` up to the first `\n` — the part shown above the fold |
| **Hashtag count in description** | count `#token` matches in `snippet.description`; **2–3 is the recommended range**, flag 0 and flag 4+ (YouTube only renders the first 3 anyway) |
| **Timestamped chapters** | `snippet.description` contains a `0:00` (or `00:00`) timestamp as the first of at least three `M:SS` / `H:MM:SS` lines — YouTube requires the list to start at `0:00` for chapters to activate |
| **In a public playlist** | enumerate the channel's public playlists with `playlists.list(channelId=…)`, then `playlistItems.list` per playlist and check whether the video id appears in any. There is no reverse "playlists containing this video" endpoint, so this is O(number of playlists) calls — cheap at ~1 unit each, but note it in the quota budget for a channel with many playlists |

Record each as a boolean (or a small count for hashtags) per video. These are
inputs to the checklist in the deliverables, not to the pair analysis.

---

## Known gap: not capturable through any API

Two on-page elements cannot be read programmatically through the Data API, the
Analytics API, or the Reporting API. **Flag them as a known gap in the audit —
don't silently drop them from the checklist.**

- **End screens and cards.** Not exposed in any API response. `videos.list` has no
  part for them. The only way to know what a video's end screen links to, or
  whether it has cards, is to watch the last 20 seconds and look.
- **Captions.** Visibility through the API is ambiguous and gated by ownership:
  `captions.list` is authorized-owner-only for most videos, and `snippet` carries
  no reliable "has captions" signal, so a negative result doesn't mean captions
  are absent. Confirm by eye on the watch page.

Both require manual / visual review. In an unattended run, list them explicitly as
unchecked with the reason, rather than reporting the checklist as complete.

---

## Timestamp everything

Record capture date and time alongside the numbers, and put it in `findings.json`
as `client.capture_date`. Every rate in the workbook is computed against that
date, so it is the one input that ages the whole analysis. Views move
continuously, and an undated audit cannot be verified or refreshed later.

---

## Legacy fallback: Chrome scraping

Use this **only** when the API paths above are unavailable — no `YOUTUBE_API_KEY`
configured and no OAuth token — but the Chrome browsing tool is connected. It
predates real API access and is slower, lossier, and full of silent-failure
modes. Prefer Path 1 in every case where a key exists.

If the Chrome tool is not connected either, stop and tell the user, offering the
fallback of pasting raw numbers from YouTube Studio into the conversation.

### web_fetch does not work

YouTube pages are JavaScript-rendered. `web_fetch` returns either a 429 or a shell
with no metrics in it. The XML feed and third-party stat sites do not fill the gap
either. The Chrome browsing tool is the only browser-based path.

### The URL-blocking gotcha

The JavaScript execution tool **rejects any output containing a URL**, returning
`[BLOCKED: Cookie/query string data]`. Video descriptions are full of links, so
reading a description raw will always fail. Strip URLs before returning:

```javascript
someText.replace(/https?:\/\/\S+/g, '[LINK]')
```

When a JS call returns BLOCKED unexpectedly, an unstripped URL is almost always
the reason.

### Listing the channel's videos

**Do not scrape the rendered DOM.** YouTube's grid selectors
(`ytd-rich-item-renderer`, `#video-title`, `#metadata-line`) still match, so the
query looks like it worked, but every field comes back empty — the content lives
behind view-model components. Read `window.ytInitialData` instead. Navigate to
`/@handle/videos`, scroll to load the full grid, then walk the object for
`lockupViewModel` nodes:

```javascript
for (let i = 0; i < 10; i++) { window.scrollTo(0, document.body.scrollHeight); await new Promise(r => setTimeout(r, 900)); }
const out = [];
const walk = (o) => { if (!o || typeof o !== 'object') return; if (o.lockupViewModel) out.push(o.lockupViewModel); for (const k in o) walk(o[k]); };
walk(window.ytInitialData);
window.__rows = out.map(lv => {
  const id = lv.contentId;
  const title = lv.metadata?.lockupMetadataViewModel?.title?.content || '';
  let meta = '';
  try {
    const rs = lv.metadata.lockupMetadataViewModel.metadata.contentMetadataViewModel.metadataRows;
    meta = rs.map(r => r.metadataParts.map(p => p.text?.content).filter(Boolean).join(' / ')).join(' | ');
  } catch (e) {}
  return id + ' ~~ ' + title + ' ~~ ' + meta;
});
JSON.stringify(window.__rows.slice(0, 10));
```

Stash the result on `window` and return it in slices — the tool truncates long
outputs mid-string, and a truncated JSON blob looks complete until it fails to
parse. The scroll only loads what the grid paginates; a channel listing "39
videos" may yield 30 long-form entries with the rest being Shorts and past live
streams on their own tabs. Say which count you actually captured.

### Per-video metrics, without navigating

From any page on the youtube.com origin, `fetch('/watch?v=ID')` is same-origin and
returns the full server-rendered HTML — faster than navigating to each watch page,
and it gives exact integers:

```javascript
const h = await fetch('/watch?v=' + id).then(r => r.text());
const g = (re) => { const m = h.match(re); return m ? m[1] : null; };
({
  views:   g(/"viewCount":"(\d+)"/),
  pub:     g(/"publishDate":"([^"]*)"/),
  len:     g(/"lengthSeconds":"(\d+)"/),
  title:   g(/"title":"([^"]*)"/),
  keywords: g(/<meta name="keywords" content="([^"]*)"/),
  likes:   g(/"likeCountIfLikedNumber":"(\d+)"/),
})
```

Loop over your id list, push each result onto `window.__d`, and return it in
slices.

### Comment counts

Not in the watch-page HTML — loaded by a follow-up request. Call the internal
endpoint directly:

```javascript
const ctx = window.ytcfg.get('INNERTUBE_CONTEXT');
const key = window.ytcfg.get('INNERTUBE_API_KEY');
const j = await fetch('/youtubei/v1/next?key=' + key, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ context: ctx, videoId: id })
}).then(r => r.json());
const s = JSON.stringify(j);
(s.match(/"commentCount":\{"simpleText":"([^"]+)"/) || [])[1];
```

This returns the display string ("2.1K", "87"), so expand the K and M suffixes
yourself. Comment rate is a three-decimal metric, so a rounded "2.1K" carries real
imprecision at low view counts — note it if a pair hinges on comment rate alone.

### Descriptions

Collapsed by default. Find and click "...more", then read it. The click sometimes
doesn't take on the first try because the page is still settling, so verify the
text got longer and retry once if not.

```javascript
const el = document.querySelector('ytd-text-inline-expander#description-inline-expander');
el.innerText.replace(/https?:\/\/\S+/g, '[LINK]');
```

The returned text includes trailing page furniture ("Show transcript",
"subscribers", "Show less"). Trim it. If it is long, slice it in chunks.

### Thumbnails

Direct image URLs at `i.ytimg.com` are frequently blocked to both fetch and
navigation. The reliable path is asking the user to screenshot the thumbnail from
the channel page, which also captures the title and view count as displayed. The
deck generator lays out stat cards when a thumbnail is missing, so this degrades
the deck rather than blocking it.

### What scraping cannot produce

No amount of scraping produces: impressions, click-through rate, average view
duration, audience retention curve, traffic source breakdown,
subscriber-vs-non-subscriber split, or revenue. Those need Path 2 (the client's
OAuth connection) or a YouTube Studio export. Do not estimate them — name the gap
and hand the user the export list on the closing slide.
