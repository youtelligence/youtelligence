# findings.json schema

Structure for the per-client output file produced by an audit run. Top-level keys: `client`, `client_videos`, `competitors`, `pairs`, `studio_asks`, `headline_finding`, `ruled_out`, `recommendations`.

## `client`

Object.

| Field | Type | Notes |
|---|---|---|
| `name` | string | |
| `channel_id` | string | |
| `subscribers` | number | |
| `capture_date` | string | Date the audit data was captured. |

## `client_videos`

Array of objects — one per client video pulled for the audit.

| Field | Type | Notes |
|---|---|---|
| `video_id` | string | |
| `title` | string | |
| `published_at` | string | |
| `views` | number | |
| `likes` | number | |
| `comments` | number | |
| `views_per_day` | number | |
| `like_rate` | number | Percent. |
| `comment_rate` | number | Percent. |
| `avg_view_duration_seconds` | number \| null | Analytics API only — `null` if not available. |
| `avg_percentage_viewed` | number \| null | Analytics API only — `null` if not available. |
| `impressions` | number \| null | Analytics API only — `null` if not available. |
| `ctr` | number \| null | Analytics API only — `null` if not available. |
| `traffic_source_split` | object \| null | Raw view counts by source, no percentages. `null` if not available. See below. |
| `data_source` | `'public_api'` \| `'analytics_api'` | Which API produced this row — see [Data source tracking](#data-source-tracking). |

### `traffic_source_split`

Present only when traffic source data is available (`data_source: 'analytics_api'`). Each key holds an object with a single `views` count — raw counts only, not percentages.

```json
{
  "browse": { "views": 0 },
  "suggested": { "views": 0 },
  "search": { "views": 0 },
  "external": { "views": 0 },
  "subscriber_direct": { "views": 0 },
  "notification": { "views": 0 },
  "other": { "views": 0 }
}
```

### Data source tracking

`data_source` records which API produced a given `client_videos` row, since the audit blends two sources with different capabilities:

- `'public_api'` — YouTube Data API (public, no OAuth). Only the base stats (`views`, `likes`, `comments`, and the metrics derived from them) are available; the Analytics-only fields above are `null`.
- `'analytics_api'` — YouTube Analytics API (OAuth, client-authorized). Adds `avg_view_duration_seconds`, `avg_percentage_viewed`, `impressions`, `ctr`, and `traffic_source_split`.

## `competitors`

Array of objects — one per tracked competitor channel.

| Field | Type | Notes |
|---|---|---|
| `channel_name` | string | |
| `channel_id` | string | |
| `videos` | array | Same shape as `client_videos`, **except** it never includes `avg_view_duration_seconds`, `avg_percentage_viewed`, `impressions`, `ctr`, or `traffic_source_split` — competitor channels are public-data only, since there's no OAuth access to a competitor's own Analytics. `data_source` on these rows is always `'public_api'`. |

## `pairs`

Array of objects. A pair is a comparison between videos (client vs. competitor, or client vs. client) chosen to isolate one variable.

| Field | Type | Notes |
|---|---|---|
| `label` | string | Human-readable name for the comparison. |
| `video_refs` | string[] | `video_id`s of the videos being compared. |
| `held_constant` | string[] | Which variables are matched across the pair (e.g. topic, format, length). |
| `differs` | string[] | Which variables differ across the pair — the thing the comparison is isolating. |
| `diagnosis` | `'discovery'` \| `'satisfaction'` \| `'mixed'` \| `'insufficient_data'` | Read of what's driving the performance difference. |
| `confidence` | `'high'` \| `'medium'` \| `'low'` | Confidence in `diagnosis`. |
| `notes` | string | Free-text rationale. |

## `studio_asks`

Array of strings. Metrics the audit would want but that aren't obtainable even with the client's OAuth access — i.e. asks for the studio/client to provide manually (not an API gap that more scopes would fix).

## Judgment-call fields

`headline_finding`, `ruled_out`, and `recommendations` are written by a person reviewing the data, not calculated from it — nothing in `client_videos`, `competitors`, or `pairs` mechanically determines them. A report generator should read them as-is rather than trying to derive them.

| Field | Type | Notes |
|---|---|---|
| `headline_finding` | string | The one-sentence editorial takeaway of the whole audit. |
| `ruled_out` | string[] | Explanations someone considered and rejected (e.g. tag density, a channel-level penalty) — each entry is a self-contained paragraph. |
| `recommendations` | string[] | Actions to take, in priority order — each entry is a self-contained paragraph, conventionally ending with an effort/impact label in parentheses (e.g. `"... (High effort)"`). |

## Example

```json
{
  "client": {
    "name": "JB Eckl",
    "channel_id": "UCpsSp97Gyvqvz8ZXJA8H4uQ",
    "subscribers": 4200,
    "capture_date": "2026-08-24"
  },
  "client_videos": [
    {
      "video_id": "lJKF6AByM7g",
      "title": "Get some blues vibe into your pentatonics QUICKLY",
      "published_at": "2026-07-22T19:31:18Z",
      "views": 226,
      "likes": 10,
      "comments": 5,
      "views_per_day": 7.1,
      "like_rate": 4.42,
      "comment_rate": 2.21,
      "avg_view_duration_seconds": 118,
      "avg_percentage_viewed": 42.5,
      "impressions": 3100,
      "ctr": 4.1,
      "traffic_source_split": {
        "browse": { "views": 60 },
        "suggested": { "views": 90 },
        "search": { "views": 40 },
        "external": { "views": 5 },
        "subscriber_direct": { "views": 20 },
        "notification": { "views": 8 },
        "other": { "views": 3 }
      },
      "data_source": "analytics_api"
    }
  ],
  "competitors": [
    {
      "channel_name": "Some Guitar Channel",
      "channel_id": "UCxxxxxxxxxxxxxxxxxxxxxx",
      "videos": [
        {
          "video_id": "abc123",
          "title": "Blues Licks Every Guitarist Should Know",
          "published_at": "2026-07-20T15:00:00Z",
          "views": 15200,
          "likes": 890,
          "comments": 120,
          "views_per_day": 380.0,
          "like_rate": 5.86,
          "comment_rate": 0.79,
          "data_source": "public_api"
        }
      ]
    }
  ],
  "pairs": [
    {
      "label": "Pentatonics video vs. competitor blues-licks video",
      "video_refs": ["lJKF6AByM7g", "abc123"],
      "held_constant": ["topic", "format"],
      "differs": ["channel_size", "thumbnail_style"],
      "diagnosis": "discovery",
      "confidence": "medium",
      "notes": "Similar satisfaction signals (like_rate in the same range); the gap looks driven by suggested/browse reach, not content quality."
    }
  ],
  "studio_asks": [
    "End-screen click-through by destination",
    "Audience retention graph (second-by-second), not just the average"
  ],
  "headline_finding": "The pentatonics format has the best reach-to-effort ratio in the library, and it's the format being published least.",
  "ruled_out": [
    "Upload time. Both videos went out on the same weekday within an hour of each other; time-of-day doesn't explain the gap."
  ],
  "recommendations": [
    "Publish more pentatonics-format videos — it's the only format with proven cold reach. (High effort)"
  ]
}
```
