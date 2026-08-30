# Analysis framework

## The funnel model

Sort metrics by where they sit in the viewer journey. This keeps a diagnosis pointed at a specific fix rather than a vague "make it better."

**Top of funnel, discovery**: impressions, click-through rate. Governed by thumbnail, title, topic demand. *Not visible in public data.* Its effects are visible in views per day.

**Mid funnel, retention**: average view duration, average percentage viewed, retention curve shape. Governed by the hook, pacing, and delivering what the packaging promised. *Not visible in public data.* Its effects leak into engagement rates.

**Bottom of funnel, engagement**: likes, comments, shares, subscribers gained. Partly visible publicly.

Public-data audits observe the bottom and infer upward. Say so.

## Normalization

**Views per day** = views / days since publish.

Caveat worth stating when age gaps are wide: YouTube traffic is front-loaded. A video's first days run hot, so this metric flatters newer videos. If a newer video still loses badly on views per day, the finding is strong, because the metric was biased in its favor.

**Like rate** = likes / views × 100.
**Comment rate** = comments / views × 100.

Compare rates against the channel's own baseline, not against internet-wide benchmarks. Channel norms vary enormously by niche, audience, and how hard the host asks for engagement. A rate that is low for one channel is high for another, so the only meaningful reference point is the channel's other videos.

## The core diagnostic split

| Signal | Discovery problem | Satisfaction problem |
|---|---|---|
| Views per day | Low | Was fine, then decayed |
| Like rate vs channel norm | At or above | Below |
| Comment rate vs channel norm | At or above | Below |
| Where to look | Thumbnail, title, topic | Hook, pacing, payoff |

**The inversion is the valuable finding.** When a video has far fewer total likes but a *higher* like rate, the people reaching it are more satisfied than average. That is a distribution failure, not a content failure, and the fix is packaging rather than production.

## CTR interpretation, when Studio data is available

CTR is a blended average across traffic sources. Subscriber impressions convert far better than cold Browse and Suggested impressions, because subscribers already opted in.

Consequence: when a video breaks out, YouTube floods it with cold impressions, and CTR falls even though the video is winning. **Falling CTR alongside rising views is a success signal.**

So never compare CTR across videos with different traffic mixes, and never treat a single CTR benchmark as a pass/fail line. Ask where the impressions came from before judging the number.

## Confounds to name explicitly

- **Age gap.** Different exposure windows and different positions in the traffic decay curve.
- **Topic demand.** Some subjects carry pre-existing search volume and cultural curiosity. This is often the largest single factor and the easiest to overlook, because it is invisible in the video itself.
- **Seasonality and timing.** Day of week, time of day, competing news cycles.
- **Algorithmic randomness.** Individual videos have genuinely high variance. Two data points do not establish a pattern.
- **Channel trajectory.** A growing channel lifts all later videos; a declining one drags them.

Naming confounds before someone else does is what separates an analysis that holds up from one that gets dismantled.

## Thumbnail evaluation

Judge thumbnails at the size they are actually seen, which is small. Scale down before assessing.

- **Element count.** Every added element shrinks the rest. Three points read better than five.
- **Contrast against background.** Bright subject on a busy or dark background loses definition.
- **Face and expression.** Present, large, legible emotion.
- **Text length.** Short enough to read in roughly one second.
- **Redundancy with the title.** Thumbnail and title should add information to each other rather than repeat.

## Calibrating claims

Use explicit confidence language:
- "The data shows" for observed and derived numbers.
- "This suggests" for well-supported inference.
- "One possible explanation" for speculation.

Sample size discipline: two videos is an observation. Five or more within a format cluster starts to be a pattern. Say which you have.

## Gate on reach before reading engagement

Cold Browse and Suggested traffic engages at lower rates than subscriber traffic. A video that breaks out is flooded with cold impressions, so its own success dilutes its engagement rate.

Consequence: a video pulling many times the channel's median views per day is not a bottleneck of any kind, however its like rate compares to the channel median. Read that as "reach strong, response below norm", never as a satisfaction failure. The diagnostic split above applies to videos that are *under*-reaching.

Without this gate, the channel's biggest video gets labelled a satisfaction problem, which is both wrong and the kind of wrong that ends a client meeting badly.

## Use the median, not the mean

One 340K breakout on a channel whose other videos sit in the thousands drags the mean so far that every remaining video reads as below par. Every baseline in this skill is a median for that reason.
