require('dotenv').config();
const fs = require('fs');
const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');
const { getValidAccessToken } = require('./auth.js');

const CLIENT_NAME = 'my channel';
const FINDINGS_PATH = './findings.json';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function emptyFindings() {
  return {
    client: null,
    client_videos: [],
    competitors: [],
    pairs: [],
    studio_asks: [],
  };
}

function loadFindings() {
  if (!fs.existsSync(FINDINGS_PATH)) return emptyFindings();
  return JSON.parse(fs.readFileSync(FINDINGS_PATH, 'utf8'));
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Reads all competitor_snapshots rows, groups them by channel, and keeps
// only the most recent snapshot per video (a video may have been pulled
// more than once).
async function buildCompetitors() {
  const { data: rows, error } = await supabase
    .from('competitor_snapshots')
    .select('*')
    .order('pulled_at', { ascending: false });

  if (error) throw error;

  const channels = new Map();

  for (const row of rows) {
    if (!channels.has(row.channel_id)) {
      channels.set(row.channel_id, { channel_name: row.channel_name, videos: new Map() });
    }
    const { videos } = channels.get(row.channel_id);
    // Rows are ordered by pulled_at descending, so the first row seen per
    // video_id is already the latest snapshot.
    if (!videos.has(row.video_id)) {
      videos.set(row.video_id, {
        video_id: row.video_id,
        title: row.title,
        published_at: row.published_at,
        views: row.views,
        likes: row.likes,
        comments: row.comments,
        views_per_day: row.views_per_day,
        like_rate: row.like_rate,
        comment_rate: row.comment_rate,
        data_source: 'public_api',
      });
    }
  }

  return Array.from(channels.entries()).map(([channel_id, { channel_name, videos }]) => ({
    channel_name,
    channel_id,
    videos: Array.from(videos.values()),
  }));
}

async function main() {
  const accessToken = await getValidAccessToken(CLIENT_NAME);

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });

  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
  const { data } = await youtube.channels.list({
    part: ['snippet', 'statistics'],
    mine: true,
  });

  const channel = data.items && data.items[0];
  if (!channel) {
    console.error('No channel found for the stored access token.');
    process.exit(1);
  }

  const findings = loadFindings();
  findings.client = {
    name: channel.snippet.title,
    channel_id: channel.id,
    subscribers: Number(channel.statistics.subscriberCount),
    capture_date: today(),
  };
  findings.competitors = await buildCompetitors();
  // Not derivable from the API data pulled above — pairs need a human to
  // pick comparisons, and studio_asks need a human to judge what's
  // actually missing for this client.
  findings.pairs = [];
  findings.studio_asks = [
    'TODO: fill in based on what metrics are actually missing for this client',
  ];

  fs.writeFileSync(FINDINGS_PATH, JSON.stringify(findings, null, 2) + '\n');
  console.log(`Wrote client section to ${FINDINGS_PATH}:`, findings.client);
  console.log(`Wrote ${findings.competitors.length} competitor channel(s) to ${FINDINGS_PATH}.`);
}

main().catch((err) => {
  console.error('Failed to assemble findings:', err);
  process.exit(1);
});
