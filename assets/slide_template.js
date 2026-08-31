// Reusable comparison slide template (pptxgenjs).
//
// Usage:
//   1. npm install pptxgenjs
//   2. Place two thumbnail images in this directory as THUMB_A.png and THUMB_B.png
//   3. Edit the BRAND colors and the two buildColumn() config blocks below
//   4. node slide_template.js
//
// Layout: thumbnails side by side up top, six stat cards under each,
// takeaway strip across the bottom. Tuned for LAYOUT_WIDE (13.33 x 7.5).
//
// Swap the BRAND block for the target channel's colors. Everything else
// keys off those constants.

const pptxgen = require("pptxgenjs");

const GREEN = "0B3D2E";
const GREEN_DARK = "072A20";
const GOLD = "A8861C";
const GOLD_BRIGHT = "C9A227";
const CREAM = "F7F5EF";
const CREAM_WARM = "FBF6E7";
const WHITE = "FFFFFF";
const GRAY = "5F5E5A";

let pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.33 x 7.5

let slide = pres.addSlide();
slide.background = { color: WHITE };

// Header
slide.addShape("rect", { x: 0, y: 0, w: 13.33, h: 0.95, fill: { color: GREEN } });
slide.addText("Video comp: In-N-Out vs Chili's", {
  x: 0.5, y: 0.12, w: 9.5, h: 0.45, fontFace: "Arial", fontSize: 22, bold: true, color: WHITE, margin: 0
});
slide.addText("Learn with Owner.com  \u2022  same format, same tags, different outcome", {
  x: 0.5, y: 0.55, w: 9.5, h: 0.3, fontFace: "Arial", fontSize: 11, color: GOLD_BRIGHT, margin: 0
});

const colW = 6.0;
const colGap = 0.33;
const col1X = 0.5;
const col2X = col1X + colW + colGap;

const thumbW = 3.68;
const thumbH = (thumbW * 9) / 16; // real 16:9, not a fixed guess
const thumbY = 1.10;

const cardGap = 0.15;
const cardW = (colW - cardGap * 2) / 3;
const cardH = 0.72;
// Stat cards sit a fixed gap below the meta line, which itself sits below the
// thumbnail — so everything downstream tracks thumbH rather than assuming it.
const row1Y = thumbY + thumbH + 0.72;
const row2Y = row1Y + cardH + 0.12;

function buildColumn(colX, cfg) {
  slide.addImage({ path: cfg.img, x: colX + (colW - thumbW) / 2, y: thumbY, w: thumbW, h: thumbH });

  slide.addText(cfg.name, {
    x: colX, y: thumbY + thumbH + 0.06, w: colW - 1.9, h: 0.28,
    fontFace: "Arial", fontSize: 14, bold: true, color: GREEN_DARK, margin: 0
  });
  slide.addShape("roundRect", {
    x: colX + colW - 1.85, y: thumbY + thumbH + 0.06, w: 1.85, h: 0.28,
    fill: { color: cfg.badgeFill }, line: { type: "none" }, rectRadius: 0.13
  });
  slide.addText(cfg.badge, {
    x: colX + colW - 1.85, y: thumbY + thumbH + 0.06, w: 1.85, h: 0.28,
    fontFace: "Arial", fontSize: 9, bold: true, color: cfg.badgeText,
    align: "center", valign: "middle", margin: 0
  });

  slide.addText(cfg.meta, {
    x: colX, y: thumbY + thumbH + 0.38, w: colW, h: 0.22,
    fontFace: "Arial", fontSize: 9.5, color: GRAY, margin: 0
  });

  cfg.stats.forEach((s, i) => {
    const r = Math.floor(i / 3);
    const c = i % 3;
    const x = colX + c * (cardW + cardGap);
    const y = r === 0 ? row1Y : row2Y;
    slide.addShape("rect", { x, y, w: cardW, h: cardH, fill: { color: cfg.cardFill }, line: { type: "none" } });
    slide.addText(s.label, {
      x: x + 0.1, y: y + 0.06, w: cardW - 0.2, h: 0.2,
      fontFace: "Arial", fontSize: 8.5, color: GRAY, margin: 0
    });
    slide.addText(s.value, {
      x: x + 0.1, y: y + 0.26, w: cardW - 0.2, h: 0.38,
      fontFace: "Arial", fontSize: 16, bold: true, color: cfg.valueColor, margin: 0
    });
  });
}

buildColumn(col1X, {
  img: "THUMB_A.png",
  name: "In-N-Out, $6B empire",
  badge: "HIGHER PERFORMER",
  badgeFill: GREEN,
  badgeText: WHITE,
  meta: "Published Jul 22, 2026  \u2022  14:08 runtime  \u2022  25 days live",
  cardFill: CREAM,
  valueColor: GREEN,
  stats: [
    { label: "Views", value: "167,912" },
    { label: "Views / day", value: "~6,716" },
    { label: "Likes", value: "3,500" },
    { label: "Like rate", value: "2.1%" },
    { label: "Comments", value: "103" },
    { label: "Tags", value: "5 (shared)" },
  ],
});

buildColumn(col2X, {
  img: "THUMB_B.png",
  name: "Chili's, $7.9B empire",
  badge: "LOWER SO FAR",
  badgeFill: GOLD_BRIGHT,
  badgeText: GREEN_DARK,
  meta: "Published Aug 11, 2026  \u2022  13:04 runtime  \u2022  5 days live",
  cardFill: CREAM_WARM,
  valueColor: GOLD,
  stats: [
    { label: "Views", value: "4,104" },
    { label: "Views / day", value: "~821" },
    { label: "Likes", value: "143" },
    { label: "Like rate", value: "3.5%" },
    { label: "Comments", value: "2" },
    { label: "Tags", value: "5 (shared)" },
  ],
});

// divider between columns — thumbnail top to the bottom of the stat cards
slide.addShape("rect", {
  x: col1X + colW + colGap / 2 - 0.005, y: thumbY, w: 0.01, h: row2Y + cardH - thumbY,
  fill: { color: "E3E0D6" }, line: { type: "none" }
});

// takeaway strip
const noteY = row2Y + cardH + 0.3;
slide.addShape("rect", { x: 0.5, y: noteY, w: 12.33, h: 0.72, fill: { color: GREEN }, line: { type: "none" } });
slide.addText(
  "Identical tags and format. Chili's has the higher like rate once viewers click, so the gap reads as a discovery / CTR problem, not a satisfaction problem.",
  { x: 0.75, y: noteY + 0.06, w: 11.83, h: 0.6, fontFace: "Arial", fontSize: 11.5, color: WHITE, italic: true, valign: "middle", margin: 0 }
);

pres.writeFile({ fileName: "video_comp_slide.pptx" }).then(() => console.log("done"));