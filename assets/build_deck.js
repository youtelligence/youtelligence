// Usage: node assets/build_deck.js <client-name-or-slug>
// Reads output/<slug>/findings.json and writes output/<slug>/deck.pptx, where
// <slug> is the client name lowercased with non-alphanumeric runs collapsed to
// hyphens (an already-slugified name works too). E.g. "JB Eckl" and jb-eckl
// both resolve to output/jb-eckl/.
//
// Slide order, all driven off findings.json:
//   1. Title           client name, subscribers, capture date, headline_finding
//   2. Video overview   every client_videos row in a table, split across slides
//                       if it doesn't fit on one
//   3. Pair slides      one per pairs[] entry (unchanged)
//   4. Ruled out        ruled_out[] as a list (omitted if empty)
//   5. Studio asks      studio_asks[] as a list (omitted if empty)
//   6. Recommendations  recommendations[] as a numbered list (omitted if empty)
//
// Colors come from an optional findings.brand object ({ primary, primary_dark,
// accent, accent_deep }, hex with or without '#'); anything missing falls back
// to the green/gold palette below. Font is Arial throughout.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');
const pptxgen = require('pptxgenjs');
const { google } = require('googleapis');

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'client';
}

if (!process.argv[2]) {
  console.error('Usage: node assets/build_deck.js <client-name-or-slug>');
  process.exit(1);
}

const OUTPUT_DIR = path.join(__dirname, '..', 'output', slugify(process.argv[2]));
const FINDINGS_PATH = path.join(OUTPUT_DIR, 'findings.json');
const DECK_PATH = path.join(OUTPUT_DIR, 'deck.pptx');
const THUMBNAIL_DIR = path.join(__dirname, '..', 'thumbnails');

const apiKey = process.env.YOUTUBE_API_KEY;
if (!apiKey) {
  console.error('Missing YOUTUBE_API_KEY in .env');
  process.exit(1);
}
const youtube = google.youtube({ version: 'v3', auth: apiKey });

// Palette + layout constants copied from slide_template.js.
const GREEN = '0B3D2E';
const GREEN_DARK = '072A20';
const GOLD = 'A8861C';
const GOLD_BRIGHT = 'C9A227';
const CREAM = 'F7F5EF';
const CREAM_WARM = 'FBF6E7';
const WHITE = 'FFFFFF';
const GRAY = '5F5E5A';

// Resolves the deck palette: findings.brand overrides, green/gold fallback.
function resolveBrand(findings) {
  const b = (findings && findings.brand) || {};
  const hex = (value, fallback) =>
    typeof value === 'string' && /^#?[0-9a-fA-F]{6}$/.test(value.trim())
      ? value.trim().replace(/^#/, '').toUpperCase()
      : fallback;
  return {
    primary: hex(b.primary, GREEN),
    primaryDark: hex(b.primary_dark, GREEN_DARK),
    accent: hex(b.accent, GOLD_BRIGHT),
    accentDeep: hex(b.accent_deep, GOLD),
  };
}

const colW = 6.0;
const colGap = 0.33;
const col1X = 0.5;
const col2X = col1X + colW + colGap;

const thumbW = 3.68;
const thumbH = (thumbW * 9) / 16; // real 16:9, not a fixed guess
const thumbY = 1.1;

const cardGap = 0.15;
const cardW = (colW - cardGap * 2) / 3;
const cardH = 0.72;
// Stat cards sit a fixed gap below the meta line, which itself sits below the
// thumbnail — so everything downstream tracks thumbH rather than assuming it.
const row1Y = thumbY + thumbH + 0.72;
const row2Y = row1Y + cardH + 0.12;

// Same column layout as slide_template.js's buildColumn(), parameterized
// per-slide instead of module-level.
function buildColumn(slide, colX, cfg) {
  slide.addImage({ path: cfg.img, x: colX + (colW - thumbW) / 2, y: thumbY, w: thumbW, h: thumbH });

  slide.addText(cfg.name, {
    x: colX, y: thumbY + thumbH + 0.06, w: colW - 1.9, h: 0.28,
    fontFace: 'Arial', fontSize: 14, bold: true, color: GREEN_DARK, margin: 0,
  });
  slide.addShape('roundRect', {
    x: colX + colW - 1.85, y: thumbY + thumbH + 0.06, w: 1.85, h: 0.28,
    fill: { color: cfg.badgeFill }, line: { type: 'none' }, rectRadius: 0.13,
  });
  slide.addText(cfg.badge, {
    x: colX + colW - 1.85, y: thumbY + thumbH + 0.06, w: 1.85, h: 0.28,
    fontFace: 'Arial', fontSize: 9, bold: true, color: cfg.badgeText,
    align: 'center', valign: 'middle', margin: 0,
  });

  slide.addText(cfg.meta, {
    x: colX, y: thumbY + thumbH + 0.38, w: colW, h: 0.22,
    fontFace: 'Arial', fontSize: 9.5, color: GRAY, margin: 0,
  });

  cfg.stats.forEach((s, i) => {
    const r = Math.floor(i / 3);
    const c = i % 3;
    const x = colX + c * (cardW + cardGap);
    const y = r === 0 ? row1Y : row2Y;
    slide.addShape('rect', { x, y, w: cardW, h: cardH, fill: { color: cfg.cardFill }, line: { type: 'none' } });
    slide.addText(s.label, {
      x: x + 0.1, y: y + 0.06, w: cardW - 0.2, h: 0.2,
      fontFace: 'Arial', fontSize: 8.5, color: GRAY, margin: 0,
    });
    slide.addText(s.value, {
      x: x + 0.1, y: y + 0.26, w: cardW - 0.2, h: 0.38,
      fontFace: 'Arial', fontSize: 16, bold: true, color: cfg.valueColor, margin: 0,
    });
  });
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function daysSincePublished(publishedAt) {
  const days = (Date.now() - new Date(publishedAt).getTime()) / MS_PER_DAY;
  return Math.max(1, Math.floor(days));
}

function fmtInt(n) {
  return n == null ? 'N/A' : n.toLocaleString('en-US');
}

function fmtPct(n) {
  return n == null ? 'N/A' : `${n}%`;
}

// runtime_seconds -> "M:SS" (or "H:MM:SS" past an hour), "N/A" if missing.
function fmtDuration(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return 'N/A';
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

function truncate(text, width) {
  return text.length <= width ? text : text.slice(0, width - 1) + '…';
}

function buildVideoLookup(findings) {
  const lookup = new Map();
  const clientName = (findings.client || {}).name;
  for (const video of findings.client_videos || []) {
    lookup.set(video.video_id, { ...video, channelName: clientName });
  }
  for (const competitor of findings.competitors || []) {
    for (const video of competitor.videos || []) {
      lookup.set(video.video_id, { ...video, channelName: competitor.channel_name });
    }
  }
  return lookup;
}

function downloadImage(url, destPath) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Failed to download image: HTTP ${res.statusCode}`));
          return;
        }
        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', reject);
      })
      .on('error', reject);
  });
}

// Same thumbnail-resolution + download logic as test_thumbnail.js, except
// files are cached under thumbnails/<videoId>.jpg so a video referenced by
// more than one pair is only fetched once.
async function ensureThumbnail(videoId) {
  const destPath = path.join(THUMBNAIL_DIR, `${videoId}.jpg`);
  if (fs.existsSync(destPath)) return destPath;

  const { data } = await youtube.videos.list({ part: ['snippet'], id: [videoId] });
  const video = data.items && data.items[0];
  if (!video) throw new Error(`No video found for id ${videoId}`);

  const thumbnails = video.snippet.thumbnails;
  const best =
    thumbnails.maxres || thumbnails.standard || thumbnails.high || thumbnails.medium || thumbnails.default;
  if (!best) throw new Error(`No thumbnail available for video ${videoId}`);

  await downloadImage(best.url, destPath);
  return destPath;
}

function videoStats(video) {
  return [
    { label: 'Views', value: fmtInt(video.views) },
    { label: 'Views / day', value: video.views_per_day != null ? String(video.views_per_day) : 'N/A' },
    { label: 'Likes', value: fmtInt(video.likes) },
    { label: 'Like rate', value: fmtPct(video.like_rate) },
    { label: 'Comments', value: fmtInt(video.comments) },
    { label: 'Comment rate', value: fmtPct(video.comment_rate) },
  ];
}

async function buildPairSlide(pres, pair, lookup) {
  const refs = pair.video_refs || [];
  if (refs.length !== 2) {
    console.warn(`Skipping pair "${pair.label}": expected 2 video_refs, got ${refs.length}.`);
    return 0;
  }

  const videos = refs.map((id) => lookup.get(id));
  if (videos.some((v) => !v)) {
    console.warn(`Skipping pair "${pair.label}": one or more video_refs not found in ${FINDINGS_PATH}.`);
    return 0;
  }

  const [imgA, imgB] = await Promise.all(videos.map((v) => ensureThumbnail(v.video_id)));

  // Higher views/day is the "higher performer" column — matches how the
  // rest of this pipeline treats reach.
  const [winner, loser] =
    videos[0].views_per_day >= videos[1].views_per_day
      ? [{ video: videos[0], img: imgA }, { video: videos[1], img: imgB }]
      : [{ video: videos[1], img: imgB }, { video: videos[0], img: imgA }];

  const slide = pres.addSlide();
  slide.background = { color: WHITE };

  slide.addShape('rect', { x: 0, y: 0, w: 13.33, h: 0.95, fill: { color: GREEN } });
  slide.addText(`Video comp: ${truncate(winner.video.title, 35)} vs ${truncate(loser.video.title, 35)}`, {
    x: 0.5, y: 0.12, w: 12.3, h: 0.45, fontFace: 'Arial', fontSize: 20, bold: true, color: WHITE, margin: 0,
  });

  const channelNames = [...new Set([winner.video.channelName, loser.video.channelName])].join(' vs ');
  const heldConstant = (pair.held_constant || []).join(', ');
  slide.addText(
    `${channelNames}${heldConstant ? `  •  Held constant: ${heldConstant}` : ''}`,
    { x: 0.5, y: 0.55, w: 12.3, h: 0.3, fontFace: 'Arial', fontSize: 11, color: GOLD_BRIGHT, margin: 0 }
  );

  buildColumn(slide, col1X, {
    img: winner.img,
    name: truncate(winner.video.title, 40),
    badge: 'HIGHER PERFORMER',
    badgeFill: GREEN,
    badgeText: WHITE,
    meta: `Published ${(winner.video.published_at || '').slice(0, 10)}  •  ${daysSincePublished(winner.video.published_at)} days live`,
    cardFill: CREAM,
    valueColor: GREEN,
    stats: videoStats(winner.video),
  });

  buildColumn(slide, col2X, {
    img: loser.img,
    name: truncate(loser.video.title, 40),
    badge: 'LOWER SO FAR',
    badgeFill: GOLD_BRIGHT,
    badgeText: GREEN_DARK,
    meta: `Published ${(loser.video.published_at || '').slice(0, 10)}  •  ${daysSincePublished(loser.video.published_at)} days live`,
    cardFill: CREAM_WARM,
    valueColor: GOLD,
    stats: videoStats(loser.video),
  });

  // Divider between columns — spans thumbnail top to the bottom of the stat cards.
  slide.addShape('rect', {
    x: col1X + colW + colGap / 2 - 0.005, y: thumbY, w: 0.01, h: row2Y + cardH - thumbY,
    fill: { color: 'E3E0D6' }, line: { type: 'none' },
  });

  // Takeaway strip — pulled straight from the pair's own notes, since
  // that's exactly the kind of reasoning this box is for.
  const noteY = row2Y + cardH + 0.3;
  slide.addShape('rect', { x: 0.5, y: noteY, w: 12.33, h: 0.72, fill: { color: GREEN }, line: { type: 'none' } });
  slide.addText(pair.notes || `Diagnosis: ${pair.diagnosis}, ${pair.confidence} confidence.`, {
    x: 0.75, y: noteY + 0.06, w: 11.83, h: 0.6,
    fontFace: 'Arial', fontSize: 11.5, color: WHITE, italic: true, valign: 'middle', margin: 0,
  });

  return 1;
}

// --- Slide types added around the pair slides, all read straight from findings ---

// Header bar + title, shared by the overview and list slides.
function addHeader(slide, brand, title) {
  slide.background = { color: WHITE };
  slide.addShape('rect', { x: 0, y: 0, w: 13.33, h: 0.95, fill: { color: brand.primary }, line: { type: 'none' } });
  slide.addText(title, {
    x: 0.5, y: 0.12, w: 12.3, h: 0.6,
    fontFace: 'Arial', fontSize: 22, bold: true, color: WHITE, valign: 'middle', margin: 0,
  });
}

// Slide 1: client identity + the headline finding.
function buildTitleSlide(pres, brand, findings) {
  const client = findings.client || {};
  const slide = pres.addSlide();
  slide.background = { color: brand.primary };

  slide.addText(client.name || 'Channel audit', {
    x: 0.6, y: 0.7, w: 12.1, h: 1.5,
    fontFace: 'Arial', fontSize: 36, bold: true, color: WHITE, valign: 'top', margin: 0,
  });
  slide.addShape('rect', { x: 0.62, y: 2.35, w: 3.0, h: 0.06, fill: { color: brand.accent }, line: { type: 'none' } });

  const meta = [
    client.subscribers != null ? `${fmtInt(client.subscribers)} subscribers` : null,
    client.capture_date ? `Captured ${client.capture_date}` : null,
  ].filter(Boolean).join('   •   ');
  if (meta) {
    slide.addText(meta, {
      x: 0.6, y: 2.6, w: 12.1, h: 0.4, fontFace: 'Arial', fontSize: 15, color: brand.accent, margin: 0,
    });
  }

  if (findings.headline_finding) {
    slide.addText('HEADLINE FINDING', {
      x: 0.6, y: 3.5, w: 12.1, h: 0.35, fontFace: 'Arial', fontSize: 12, bold: true, color: brand.accent, margin: 0,
    });
    slide.addText(findings.headline_finding, {
      x: 0.6, y: 3.95, w: 12.1, h: 3.1,
      fontFace: 'Arial', fontSize: 20, color: WHITE, valign: 'top', margin: 0, lineSpacingMultiple: 1.15,
    });
  }
  return 1;
}

// Slide 2 (or more): every client_videos row in a table, paginated so text
// never has to shrink to fit.
const OVERVIEW_ROWS_PER_SLIDE = 13;

function buildOverviewSlides(pres, brand, findings) {
  const videos = findings.client_videos || [];
  if (videos.length === 0) return 0;

  const chunks = [];
  for (let i = 0; i < videos.length; i += OVERVIEW_ROWS_PER_SLIDE) {
    chunks.push(videos.slice(i, i + OVERVIEW_ROWS_PER_SLIDE));
  }

  const headerLabels = ['Title', 'Views', 'Views/day', 'Like rate', 'Comment rate', 'Runtime'];
  const headerRow = headerLabels.map((text, i) => ({
    text,
    options: {
      bold: true, color: WHITE, fill: { color: brand.primary }, fontFace: 'Arial',
      fontSize: 10, align: i === 0 ? 'left' : 'right', valign: 'middle',
    },
  }));

  chunks.forEach((chunk, idx) => {
    const slide = pres.addSlide();
    addHeader(slide, brand, chunks.length > 1 ? `Video overview  (${idx + 1}/${chunks.length})` : 'Video overview');

    const rows = chunk.map((v, i) => {
      const fill = { color: i % 2 ? WHITE : CREAM };
      const num = (text) => ({
        text,
        options: { fontFace: 'Arial', fontSize: 9.5, color: GRAY, align: 'right', valign: 'middle', fill },
      });
      return [
        {
          text: truncate(v.title || '', 62),
          options: { fontFace: 'Arial', fontSize: 9.5, color: brand.primaryDark, align: 'left', valign: 'middle', fill },
        },
        num(fmtInt(v.views)),
        num(v.views_per_day != null ? String(v.views_per_day) : 'N/A'),
        num(fmtPct(v.like_rate)),
        num(fmtPct(v.comment_rate)),
        num(fmtDuration(v.runtime_seconds)),
      ];
    });

    slide.addTable([headerRow, ...rows], {
      x: 0.5, y: 1.2, w: 12.33,
      colW: [5.6, 1.35, 1.35, 1.35, 1.5, 1.18],
      rowH: 0.4,
      border: { type: 'solid', color: 'E3E0D6', pt: 1 },
      fontFace: 'Arial', fontSize: 9.5, valign: 'middle',
    });
  });

  return chunks.length;
}

// Slides 4-6: a titled bullet (or numbered) list. Returns 0 — no slide — when
// the source array is empty.
function buildListSlide(pres, brand, title, items, { numbered = false } = {}) {
  if (!Array.isArray(items) || items.length === 0) return 0;

  const slide = pres.addSlide();
  addHeader(slide, brand, title);

  const body = items.map((item) => ({
    text: String(item),
    options: {
      bullet: numbered ? { type: 'number' } : true,
      fontFace: 'Arial', fontSize: 14, color: brand.primaryDark, paraSpaceAfter: 12,
    },
  }));
  slide.addText(body, {
    x: 0.7, y: 1.35, w: 12.0, h: 5.8, valign: 'top', margin: 0, lineSpacingMultiple: 1.15,
  });
  return 1;
}

async function main() {
  if (!fs.existsSync(FINDINGS_PATH)) {
    console.error(`No findings file at ${FINDINGS_PATH} — run assemble_findings.js then compute.py first.`);
    process.exit(1);
  }
  const findings = JSON.parse(fs.readFileSync(FINDINGS_PATH, 'utf8'));
  const pairs = findings.pairs || [];

  fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });

  const pres = new pptxgen();
  pres.layout = 'LAYOUT_WIDE';

  const brand = resolveBrand(findings);
  const lookup = buildVideoLookup(findings);

  let slides = 0;
  slides += buildTitleSlide(pres, brand, findings);
  slides += buildOverviewSlides(pres, brand, findings);

  for (const pair of pairs) {
    slides += await buildPairSlide(pres, pair, lookup);
  }

  slides += buildListSlide(pres, brand, 'What we ruled out', findings.ruled_out);
  slides += buildListSlide(pres, brand, "What public data can't tell us", findings.studio_asks);
  slides += buildListSlide(pres, brand, 'Recommendations', findings.recommendations, { numbered: true });

  if (slides === 0) {
    console.error(`Nothing to render from ${FINDINGS_PATH} — no client, videos, pairs, or lists.`);
    process.exit(1);
  }

  await pres.writeFile({ fileName: DECK_PATH });
  console.log(`Wrote deck to ${DECK_PATH} (${slides} slide${slides === 1 ? '' : 's'}).`);
}

main().catch((err) => {
  console.error('Failed to build deck:', err);
  process.exit(1);
});
