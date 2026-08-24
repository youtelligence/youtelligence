require('dotenv').config();
const { google } = require('googleapis');

const handle = process.argv[2];
const apiKey = process.env.YOUTUBE_API_KEY;

if (!handle) {
  console.error('Usage: node lookup_channel_id.js <@handle>');
  process.exit(1);
}
if (!apiKey) {
  console.error('Missing YOUTUBE_API_KEY in .env');
  process.exit(1);
}

const youtube = google.youtube({ version: 'v3', auth: apiKey });

async function main() {
  const { data } = await youtube.channels.list({
    part: ['id'],
    forHandle: handle,
  });

  const channel = data.items && data.items[0];
  if (!channel) {
    console.error(`No channel found for handle ${handle}`);
    process.exit(1);
  }

  console.log(channel.id);
}

main().catch((err) => {
  console.error(`Failed to look up channel id for ${handle}:`, err);
  process.exit(1);
});
