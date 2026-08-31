#!/usr/bin/env python3
"""Recompute normalized metrics in a findings file and print a summary table.

Usage: compute.py [FINDINGS_PATH]
FINDINGS_PATH defaults to ../findings.json; pass a per-client file
(e.g. ../findings-jb-eckl.json) to work on that audit instead.
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_FINDINGS_PATH = Path(__file__).resolve().parent.parent / "findings.json"
TITLE_WIDTH = 40


def load_findings(path):
    with open(path) as f:
        return json.load(f)


def days_since_published(published_at):
    published = datetime.fromisoformat(published_at.replace("Z", "+00:00"))
    days = (datetime.now(timezone.utc) - published).total_seconds() / 86400
    # Floor at 1 so same-day uploads don't produce an inflated/infinite figure.
    return max(1, int(days))


def rate(count, views):
    if count is None or not views:
        return None
    return round((count / views) * 100, 2)


def views_per_day(views, published_at):
    if views is None:
        return None
    return round(views / days_since_published(published_at), 1)


def recompute_video(video):
    views = video.get("views")
    likes = video.get("likes")
    comments = video.get("comments")
    published_at = video.get("published_at")

    video["views_per_day"] = views_per_day(views, published_at)
    video["like_rate"] = rate(likes, views)
    video["comment_rate"] = rate(comments, views)

    split = video.get("traffic_source_split")
    if split:
        total = sum(source["views"] for source in split.values())
        for source in split.values():
            source["percentage"] = round((source["views"] / total) * 100, 2) if total else None

    return video


VALID_DIAGNOSES = {"discovery", "satisfaction", "mixed", "insufficient_data"}


def validate_video(video, label):
    errors = []

    for field in ("views", "likes", "comments", "views_per_day", "like_rate", "comment_rate"):
        value = video.get(field)
        if value is not None and value < 0:
            errors.append(f"{label}: {field} is negative ({value})")

    split = video.get("traffic_source_split")
    if split:
        total_pct = sum(source.get("percentage") or 0 for source in split.values())
        if abs(total_pct - 100) > 0.5:
            errors.append(f"{label}: traffic_source_split percentages sum to {total_pct}, expected ~100")

    data_source = video.get("data_source")
    if (video.get("ctr") is not None or video.get("impressions") is not None) and data_source != "analytics_api":
        errors.append(
            f"{label}: has ctr/impressions but data_source is '{data_source}', expected 'analytics_api'"
        )

    return errors


def validate_pairs(pairs, known_video_ids):
    errors = []
    for i, pair in enumerate(pairs):
        label = f"pairs[{i}] ({pair.get('label', '?')})"

        for video_id in pair.get("video_refs", []):
            if video_id not in known_video_ids:
                errors.append(f"{label}: video_refs references unknown video_id '{video_id}'")

        diagnosis = pair.get("diagnosis")
        if diagnosis not in VALID_DIAGNOSES:
            errors.append(f"{label}: diagnosis '{diagnosis}' is not one of {sorted(VALID_DIAGNOSES)}")

    return errors


def truncate(text, width=TITLE_WIDTH):
    return text if len(text) <= width else text[: width - 1] + "…"


def print_table(headers, rows):
    if not rows:
        print("(no rows)")
        return
    widths = [
        max(len(str(headers[i])), *(len(str(row[i])) for row in rows))
        for i in range(len(headers))
    ]

    def fmt_row(row):
        return "  ".join(str(v).ljust(w) for v, w in zip(row, widths))

    print(fmt_row(headers))
    print("  ".join("-" * w for w in widths))
    for row in rows:
        print(fmt_row(row))


def main():
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_FINDINGS_PATH
    findings = load_findings(path)

    rows = []
    errors = []
    known_video_ids = set()

    client_name = (findings.get("client") or {}).get("name", "client")
    for video in findings.get("client_videos", []):
        recompute_video(video)
        known_video_ids.add(video.get("video_id"))
        label = f"client video {video.get('video_id', '?')}"
        errors.extend(validate_video(video, label))
        rows.append((
            "client",
            client_name,
            truncate(video.get("title", "")),
            video["views_per_day"],
            video["like_rate"],
            video["comment_rate"],
        ))

    for competitor in findings.get("competitors", []):
        for video in competitor.get("videos", []):
            recompute_video(video)
            known_video_ids.add(video.get("video_id"))
            label = f"{competitor.get('channel_name', '?')} video {video.get('video_id', '?')}"
            errors.extend(validate_video(video, label))
            rows.append((
                "competitor",
                competitor.get("channel_name", ""),
                truncate(video.get("title", "")),
                video["views_per_day"],
                video["like_rate"],
                video["comment_rate"],
            ))

    print_table(
        ["Type", "Channel", "Title", "Views/day", "Like rate %", "Comment rate %"],
        rows,
    )

    errors.extend(validate_pairs(findings.get("pairs", []), known_video_ids))

    if errors:
        print("\nValidation failed — not saving:")
        for error in errors:
            print(f"  - {error}")
        sys.exit(1)

    with open(path, "w", encoding="utf-8") as f:
        json.dump(findings, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"\nValidation passed. Saved recalculated values to {path}.")


if __name__ == "__main__":
    main()
