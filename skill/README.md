# `skill/` — YouTube channel audit methodology docs

This folder is the **canonical, version-controlled home** for the audit
methodology documentation. It exists because these files previously lived only in
Claude Code's local skills cache — untracked, and at risk of being silently
overwritten or lost on a session reset.

## What's here

| File | What it is |
|---|---|
| `references/SKILL.md` | The skill definition: pipeline overview, the six audit stages, common failure modes. |
| `references/analysis-framework.md` | Pair selection, normalization, discovery-vs-satisfaction diagnosis, gating on reach, comparing to median. |
| `references/data-capture.md` | The two API capture paths (public Data API v3 / client Analytics + Reporting API), the on-page SEO checklist, and the fields no API exposes. Chrome scraping is documented here as a legacy fallback only. |

**Not here on purpose:** the audit's `findings.json` schema. The real, git-tracked
schema is [`docs/findings-schema.md`](../docs/findings-schema.md) — the one the
pipeline (`reports/compute.py`, `reports/build_workbook.py`,
`assemble_findings.js`) actually validates against. Do not add a second schema
file under `skill/`; that fork is exactly the drift this folder was created to
stop.

## The cache workflow

The Claude Code runtime does **not** load the skill from this folder. It loads
from a local cache directory, roughly:

```
~/Library/Application Support/Claude/local-agent-mode-sessions/skills-plugin/<uuid>/<uuid>/skills/youtube-channel-audit/
```

The `<uuid>` path segments are not stable — to find the live copy, search for it:

```sh
find ~/Library/Application\ Support/Claude -type d -name youtube-channel-audit
```

The cache also holds files this folder does **not** mirror (`deliverables.md`,
`assets/`). Only the three files above are maintained here.

### To change the methodology docs

1. Edit the file(s) under `skill/references/` in this repo.
2. Copy the changed file(s) out to the cache directory (found via the `find`
   above), preserving `SKILL.md` at the skill root and the rest under
   `references/`.
3. Commit the repo change.

### After a session reset or skill re-sync

The cache may be repopulated from wherever the skill was originally installed,
which can silently revert changes. After a reset, diff the cache against this
folder and re-apply as needed:

```sh
CACHE=$(find ~/Library/Application\ Support/Claude -type d -name youtube-channel-audit)
# run from the repo root
diff -r skill/references "$CACHE" \
  --exclude findings-schema.md --exclude deliverables.md --exclude assets
```

(`SKILL.md` sits at the cache root, not under `references/`, so `diff -r` will
report it as "Only in skill/references" — compare that file directly:
`diff skill/references/SKILL.md "$CACHE/SKILL.md"`.)

If a cache change is a genuine improvement, bring it back into `skill/references/`
and commit it. If it's a revert, copy this folder's version back out.

### Fully closing the loop

The durable fix is to point the skill's install source at these repo files so the
cache is generated from version control rather than maintained by hand. That
requires knowing where the skill is installed from (as of this writing,
unidentified — not a plugin marketplace dir or `~/.claude/skills/`). Until then,
the manual copy-out step above is the process.
