require('dotenv').config();
const { google } = require('googleapis');
const https = require('https');
const fs = require('fs');
const path = require('path');

const videoId = process.argv[2];
const apiKey = process.env.YOUTUBE_API_KEY;

if (!videoId) {
  console.error('Usage: node test_thumbnail.js <videoId>');
  process.exit(1);
}
if (!apiKey) {
  console.error('Missing YOUTUBE_API_KEY in .env');
  process.exit(1);
}

const youtube = google.youtube({ version: 'v3', auth: apiKey });

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

async function main() {
  const { data } = await youtube.videos.list({
    part: ['snippet'],
    id: [videoId],
  });

  const video = data.items && data.items[0];
  if (!video) {
    console.error(`No video found for id ${videoId}`);
    process.exit(1);
  }

  const thumbnails = video.snippet.thumbnails;
  const best =
    thumbnails.maxres || thumbnails.standard || thumbnails.high || thumbnails.medium || thumbnails.default;

  if (!best) {
    console.error('No thumbnail available for this video.');
    process.exit(1);
  }

  const ext = path.extname(new URL(best.url).pathname) || '.jpg';
  const destPath = path.join(__dirname, `${videoId}${ext}`);

  await downloadImage(best.url, destPath);
  console.log(`Saved thumbnail (${best.width}x${best.height}) to ${destPath}`);
}

main().catch((err) => {
  console.error('Failed to fetch/download thumbnail:', err);
  process.exit(1);
});
