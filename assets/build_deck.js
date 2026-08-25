require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');
const pptxgen = require('pptxgenjs');
const { google } = require('googleapis');

const FINDINGS_PATH = path.resolve(process.argv[2] || path.join(__dirname, '..', 'findings.json'));
const DECK_PATH = path.resolve(process.argv[3] || path.join(__dirname, '..', 'deck.pptx'));
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

const colW = 6.0;
const colGap = 0.33;
const col1X = 0.5;
const col2X = col1X + colW + colGap;

const thumbW = 3.68;
const thumbH = 2.6;
const thumbY = 1.1;

const cardGap = 0.15;
const cardW = (colW - cardGap * 2) / 3;
const cardH = 0.72;
const row1Y = 4.42;
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
    return;
  }

  const videos = refs.map((id) => lookup.get(id));
  if (videos.some((v) => !v)) {
    console.warn(`Skipping pair "${pair.label}": one or more video_refs not found in findings.json.`);
    return;
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

  // Divider between columns.
  slide.addShape('rect', {
    x: col1X + colW + colGap / 2 - 0.005, y: thumbY, w: 0.01, h: 4.86,
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
}

async function main() {
  const findings = JSON.parse(fs.readFileSync(FINDINGS_PATH, 'utf8'));
  const pairs = findings.pairs || [];
  if (pairs.length === 0) {
    console.error('No pairs in findings.json — nothing to build.');
    process.exit(1);
  }

  fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });

  const pres = new pptxgen();
  pres.layout = 'LAYOUT_WIDE';

  const lookup = buildVideoLookup(findings);

  for (const pair of pairs) {
    await buildPairSlide(pres, pair, lookup);
  }

  await pres.writeFile({ fileName: DECK_PATH });
  console.log(`Wrote deck to ${DECK_PATH}.`);
}

main().catch((err) => {
  console.error('Failed to build deck:', err);
  process.exit(1);
});
