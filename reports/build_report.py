#!/usr/bin/env python3
"""Build a markdown audit report from a findings file already
processed by compute.py. Structure follows docs/example-report.md.

headline_finding, ruled_out, and recommendations are judgment calls
written by a person reviewing the data — this script reads them as-is
rather than trying to derive them.

Usage: build_report.py [FINDINGS_PATH] [REPORT_PATH]
FINDINGS_PATH defaults to ../findings.json; pass a per-client file
(e.g. ../findings-jb-eckl.json) to render that audit instead.
"""

import json
import sys
from pathlib import Path

DEFAULT_FINDINGS_PATH = Path(__file__).resolve().parent.parent / "findings.json"
DEFAULT_REPORT_PATH = Path(__file__).resolve().parent.parent / "report.md"


def load_findings(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def esc(text):
    return str(text).replace("|", "\\|")


def fmt_int(n):
    return f"{n:,}" if isinstance(n, (int, float)) else "N/A"


def fmt_pct(n):
    return f"{n}%" if n is not None else "N/A"


def fmt_date(s):
    return s[:10] if s else "N/A"


def build_video_lookup(findings):
    lookup = {}
    for video in findings.get("client_videos", []):
        lookup[video.get("video_id")] = video
    for competitor in findings.get("competitors", []):
        for video in competitor.get("videos", []):
            lookup[video.get("video_id")] = video
    return lookup


def build_video_table(videos):
    lines = [
        "| Title | Views | Views/day | Like rate | Comment rate | Published |",
        "|---|---|---|---|---|---|",
    ]
    for video in videos:
        lines.append(
            "| {title} | {views} | {vpd} | {like} | {comment} | {published} |".format(
                title=esc(video.get("title", "")),
                views=fmt_int(video.get("views")),
                vpd=video.get("views_per_day", "N/A"),
                like=fmt_pct(video.get("like_rate")),
                comment=fmt_pct(video.get("comment_rate")),
                published=fmt_date(video.get("published_at")),
            )
        )
    return "\n".join(lines)


def build_pair_heading(pair, lookup):
    refs = pair.get("video_refs", [])
    label = pair.get("label", "Untitled comparison")
    if len(refs) == 2:
        videos = [lookup.get(ref) for ref in refs]
        if all(videos):
            parts = [f'{v.get("title")} ({fmt_int(v.get("views"))})' for v in videos]
            return f"{label}: {parts[0]} vs {parts[1]}"
    return label


def build_pair_block(pair, lookup):
    lines = [f"### {build_pair_heading(pair, lookup)}", ""]

    held_constant = pair.get("held_constant") or []
    if held_constant:
        lines.append(f"**Identical:** {', '.join(held_constant)}.")
        lines.append("")

    differs = pair.get("differs") or []
    if differs:
        lines.append("**Differs:**")
        lines.append("")
        for item in differs:
            lines.append(f"- {item}")
        lines.append("")

    diagnosis = pair.get("diagnosis", "insufficient_data")
    confidence = pair.get("confidence", "low")
    notes = pair.get("notes", "")
    lines.append(f"**Diagnosis:** {diagnosis}, {confidence} confidence. {notes}")

    return "\n".join(lines)


def build_confidence_summary(pairs):
    if not pairs:
        return ""
    lines = [
        "## Confidence summary",
        "",
        "| Claim | Basis | Confidence |",
        "|---|---|---|",
    ]
    for pair in pairs:
        lines.append(
            "| {claim} | {basis} | {confidence} |".format(
                claim=esc(pair.get("label", "")),
                basis=esc(pair.get("notes", "")),
                confidence=pair.get("confidence", "low").title(),
            )
        )
    return "\n".join(lines)


def build_report(findings):
    client = findings.get("client") or {}
    lookup = build_video_lookup(findings)
    sections = []

    sections.append(f"# {client.get('name', 'Client')} Channel Audit")
    sections.append(
        f"Channel: {client.get('channel_id', 'N/A')} · "
        f"{fmt_int(client.get('subscribers'))} subscribers  \n"
        f"Data captured: {fmt_date(client.get('capture_date'))}"
    )

    sections.append("## Headline finding")
    sections.append(findings.get("headline_finding") or "*(not yet filled in)*")

    client_videos = findings.get("client_videos", [])
    if client_videos:
        sections.append(f"### {client.get('name', 'Client')}")
        sections.append(build_video_table(client_videos))

    for competitor in findings.get("competitors", []):
        videos = competitor.get("videos", [])
        if not videos:
            continue
        sections.append(f"### {competitor.get('channel_name', 'Competitor')}")
        sections.append(build_video_table(videos))

    pairs = findings.get("pairs", [])
    for pair in pairs:
        sections.append(build_pair_block(pair, lookup))

    ruled_out = findings.get("ruled_out") or []
    if ruled_out:
        sections.append("## What we ruled out")
        sections.append("\n\n".join(ruled_out))

    recommendations = findings.get("recommendations") or []
    if recommendations:
        sections.append("## What to do")
        sections.append("\n".join(f"- {item}" for item in recommendations))

    studio_asks = findings.get("studio_asks", [])
    if studio_asks:
        sections.append("## What public data cannot tell us")
        sections.append("\n".join(f"- {item}" for item in studio_asks))

    confidence_summary = build_confidence_summary(pairs)
    if confidence_summary:
        sections.append(confidence_summary)

    return "\n\n".join(sections) + "\n"


def main():
    findings_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_FINDINGS_PATH
    report_path = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_REPORT_PATH

    findings = load_findings(findings_path)
    report = build_report(findings)

    with open(report_path, "w", encoding="utf-8") as f:
        f.write(report)

    print(f"Wrote report to {report_path}.")


if __name__ == "__main__":
    main()
