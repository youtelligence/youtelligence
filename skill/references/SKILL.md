---
name: youtube-channel-audit
description: "Audit a YouTube channel from public data and produce the full deliverable set: written report, spreadsheet, and client deck. Use this skill whenever the user mentions auditing a YouTube channel, comparing videos, analyzing video performance, YouTube content strategy, why a video flopped or popped, CTR, watch time, retention, thumbnails, titles, or tags, or shares a YouTube channel or video URL and wants analysis. Also use it when preparing a content strategy presentation or interview deck about a channel, even if the user does not say the word 'audit.'"
---

# YouTube Channel Audit

Turn a channel URL into four deliverables: a defensible analysis, a written report, a workbook, and a client-facing deck.

The whole value of this skill is producing conclusions that survive being questioned. Raw view counts are misleading, public data has a hard ceiling, and the most common analytical mistake is comparing videos that were never comparable. The stages below exist to prevent those three failures.

## The pipeline

```
channel URL
   |
   v
[1] capture      YouTube APIs -> metrics per video        references/data-capture.md
   |
   v
[2] analyze      pairs, normalization, diagnosis          references/analysis-framework.md
   |
   v
[3] findings.json   <-- THE CONTRACT. Everything downstream reads this.
   |                    references/findings-schema.md
   +---> [4] report.md      written analysis, in the conversation and as a file
   +---> [5] workbook.xlsx  assets/build_workbook.py
   +---> [6] deck.pptx      assets/build_deck.js
```

**Run all six stages by default.** The user asked for an end-to-end audit, so do not stop after the report to ask whether they want the spreadsheet and deck. Stop early only if they say "report only", "skip the deck", or similar.

`findings.json` is the load-bearing idea. Prose cannot be chained into a spreadsheet without re-deriving numbers by hand, and hand-derived numbers drift: the deck says 8.4% and the workbook says 8.41% and the report says "roughly 8%", and the moment a client spots that, the whole audit is suspect. Write the findings once, as data, and let all three deliverables render from it. `assets/compute.py` owns every derived metric; `build_deck.js` shells out to it rather than reimplementing the math in JavaScript.

## Stage 1: Select comparison pairs

Pull the channel's video list first — Path 1 (Data API v3, no OAuth), per `references/data-capture.md`. Look for **format clusters**: groups of videos sharing a series template, runtime band, host, and thumbnail style.

Compare only within a cluster. A long-form breakdown against a short vlog tells you nothing, because too many variables move at once. The ideal pair holds everything constant except one or two things, so the difference actually points somewhere.

Pick 2 to 4 pairs. Favor pairs where one video clearly outperformed, since a flat pair yields no signal. Show the user the proposed pairs and what varies within each before the full capture, so they can redirect early. In an unattended run, state the pairs you chose and why, then proceed.

If no clean cluster exists, say so rather than forcing a comparison. A channel with no repeated format needs theme-level analysis, not video-level.

## Stage 2: Capture

Read `references/data-capture.md` first. It has the two API capture paths, the on-page SEO checklist, and the fields no API exposes.

Capture runs on the **YouTube APIs**, not browser scraping. Two paths, matched to `findings.json`'s `data_source` field:

- **Path 1 — public data (`data_source: 'public_api'`).** Data API v3 with an API key, no OAuth. Works for any channel, and it's the only path for competitors. Gives title, description, tags, publish timestamp, runtime, exact views, likes, comments, and the normalized rates (`views_per_day`, `like_rate`, `comment_rate`). This is the `competitors.js` / `fetch_recent_videos.js` pattern — reuse it, don't recompute the rates by hand.
- **Path 2 — client Analytics (`data_source: 'analytics_api'`).** Only for the client's own OAuth-connected channel, never competitors. The `analytics.js` pattern adds average view duration, average percentage viewed, and traffic source split; the Reporting API job (`create_reporting_job.js` once, then `download_reports.js` into `reach_reports`) adds impressions and CTR. Fields that haven't landed yet stay `null`.

Also run the **on-page SEO checklist** (Data API only, so it works for every audit): keyword in title and in the first line of the description, hashtag count (2–3 recommended), `0:00`-anchored chapters, public-playlist membership.

Two things no API returns — **end screens / cards** and **captions**. Flag them as an explicit manual-review gap; don't drop them from the checklist silently.

Chrome scraping is a **fallback only**, for when neither an API key nor an OAuth token is configured. `references/data-capture.md` keeps the extraction code for that case.

**Capture the entire long-form library, not a sample around the pairs.** Every rate in the audit is judged against the channel median, and a sample chosen around the comparison pairs is a barbell of breakouts and recent flops rather than the channel's centre. It produces a median that is wrong in a way nothing downstream reveals. Full capture also unlocks the cluster table, which is usually the most actionable output in the whole audit and is impossible from a partial sample.

If you genuinely cannot capture everything, set `channel.coverage` to state what was excluded and why. The validator blocks a partial capture that does not declare itself.

Timestamp the capture. View counts move, and an audit with undated numbers cannot be checked later.

## Stage 3: Normalize and diagnose

Never compare raw view totals across videos published at different times.

- **Views per day** = views / days since publish
- **Like rate** = likes / views, as a percent
- **Comment rate** = comments / views, as a percent

Views per day is a rough instrument. YouTube traffic is front-loaded, so a video's first week outperforms its steady state, which flatters newer videos. Say this out loud when the age gap is large. It is better to name the imprecision than to have someone else name it.

Then sort every finding into one of two buckets, because they have opposite fixes.

**Discovery problem**: low views per day, engagement rates at or above the channel's norm. People who watch it like it. The bottleneck is the click.

**Satisfaction problem**: views per day fine or fine early, engagement rates below the channel's norm. People click and bounce. The bottleneck is the content or its opening.

Gate on reach first. A video pulling many times the median views per day is not a bottleneck of any kind, whatever its like rate looks like against the channel median: cold Browse and Suggested traffic engages at lower rates than subscriber traffic, so a breakout's engagement rate is diluted by its own success. Read that as "reach strong, response below norm", never as a satisfaction failure.

The diagnosis flips on engagement **rate**, not raw counts. A video with 143 likes and one with 3,500 likes can have the smaller one performing better per viewer. This inversion is the single most useful thing this analysis produces, so lead with it when it appears.

Compare rates to the channel's own **median**, not its mean. One 340K breakout drags a mean so far that every other video reads as below par against it.

Then look at the **cluster table** `compute.py` prints. Reach usually varies far more between format clusters than within them, and a cluster median is a claim about what to make next rather than about which video won. Read the n on each cluster before acting on it: two videos is an observation.

**Interrogate the engagement inversion before leaning on it.** If like rate correlates strongly and monotonically with views across the whole library, that is equally consistent with "recent videos are better" and with "low-view videos are watched only by subscribers, who engage harder." Public data cannot separate them. What you can still say is that there is no *satisfaction* failure: nothing is below the channel norm. Claim that, not the stronger version.

## Stage 4: Write findings.json

Read `references/findings-schema.md`. Then write the file and validate it:

```bash
python3 assets/compute.py findings.json          # derived table + validation
```

It exits non-zero on a structural problem: a pair pointing at a video that was never captured, a diagnosis outside the allowed vocabulary, a pair with no held-constant variables (which means the pair is uncontrolled and proves nothing), empty `studio_asks`, or a fabricated Studio metric. Fix what it names before building anything.

## Stage 5: The written report

Deliver the analysis in the conversation and as a markdown file. Structure:

```
## Headline finding          lead with the counterintuitive one if there is one
## What was compared         the pairs, and what is held constant in each
## Normalized numbers        table: views, views/day, like rate, comment rate
## Pair by pair              identical / differs / diagnosis, per pair
## What we ruled out         negative findings, tags especially
## What public data cannot tell us
## Working hypothesis
```

Label every claim:

- **Observed**: pulled directly from the page
- **Derived**: calculated from observed values
- **Inferred**: an interpretation, clearly hedged

Never state an impressions or CTR figure. If the user wants that layer, tell them what to export from Studio and how it would change the analysis. An audit that flags its own ceiling is more credible than one that papers over it, and in a presentation the gap will be found anyway.

## Stage 6: The workbook and the deck

Read `references/deliverables.md` for the build and QA loops. Short version:

```bash
python3 assets/build_workbook.py findings.json audit.xlsx
python3 /mnt/skills/public/xlsx/scripts/recalc.py audit.xlsx        # must be clean

node assets/build_deck.js findings.json audit.pptx
python3 /mnt/skills/public/pptx/scripts/office/validate.py audit.pptx
python3 /mnt/skills/public/pptx/scripts/office/soffice.py --headless --convert-to pdf audit.pptx
pdftoppm -jpeg -r 100 audit.pdf slide
```

Then **look at every slide image**. Text collisions and overflow are invisible in code and obvious in the render. Never skip the visual check; the generator is data-driven, so a channel with long video titles produces different overflow than the one it was tuned against.

Deliver all four files with SendUserFile, and save the report to the project.

## Common failure modes

**Sampling around the pairs.** Capturing only the videos you plan to compare gives you correct pair findings and a corrupted baseline, because every "above norm" and "below norm" read in the audit is measured against a median built from extremes.

**Treating an engagement inversion as proof of quality.** Small audiences are subscriber-heavy and subscribers engage harder. The inversion rules out a satisfaction problem; it does not establish that the work improved.

**Comparing across formats.** The most frequent error. If runtime, series, or host differ, the comparison is contaminated.

**Treating tags as a cause.** Tags carry little weight in current YouTube ranking. If two videos share identical tags, that rules tags out, which is a useful negative finding, but tags are rarely the explanation for a gap.

**Reading raw views as quality.** Age, traffic source, and topic demand all move raw views independently of video quality.

**Reading a low CTR as failure.** CTR averages across subscriber traffic (high click rate) and cold Browse/Suggested traffic (low click rate). A video that breaks out gets flooded with cold impressions, which pulls the average down. Falling CTR alongside rising views is usually a success signal. Never compare CTR across videos with different traffic mixes.

**Over-claiming from a sample of two.** Two videos is an observation, not a pattern. Say which it is. An era-level trend across ten or more videos is stronger evidence than any single pair.

**Letting the three deliverables drift apart.** If a number in the deck disagrees with the workbook, the cause is always the same: something was derived twice. Everything derives once, in `compute.py`.
