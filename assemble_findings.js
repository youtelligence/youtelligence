require('dotenv').config();
const fs = require('fs');
const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');
const { getValidAccessToken } = require('./auth.js');
const { fetchRecentVideos } = require('./competitors.js');

const DEFAULT_CLIENT_NAME = 'my channel';
const FINDINGS_PATH = './findings.json';

// Two modes, picked by whether a channel ID is passed as the second argument:
//
//   node assemble_findings.js [clientName]
//     OAuth mode. Reads the connected client's own channel via its stored
//     token, including Analytics-backed fields added by other scripts.
//     Competitors come from competitor_channels / competitor_snapshots,
//     filtered to this client name (competitors are submitted through the
//     onboarding form, so only OAuth clients have them).
//
//   node assemble_findings.js <channelName> <channelId>
//     Public-audit mode. No OAuth. Pulls the given channel's videos through
//     the same public Data API path competitor channels use, writes them to
//     client_videos with data_source 'public_api', and leaves every
//     Analytics-only field (avg_view_duration_seconds, avg_percentage_viewed,
//     impressions, ctr, traffic_source_split) null. A public audit analyses
//     one channel against its own video history, so competitors is left empty.
const clientName = process.argv[2] || DEFAULT_CLIENT_NAME;
const publicChannelId = process.argv[3];

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
    // Judgment calls written by a person reviewing the data, not derived
    // from it — this script never overwrites them once set.
    headline_finding: null,
    ruled_out: [],
    recommendations: [],
  };
}

function loadFindings() {
  if (!fs.existsSync(FINDINGS_PATH)) return emptyFindings();
  return JSON.parse(fs.readFileSync(FINDINGS_PATH, 'utf8'));
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Base public-data video shape shared by client_videos and competitor videos.
// Works off either a fetchRecentVideos() row or a competitor_snapshots row --
// both carry the same field names.
function toPublicVideo(v) {
  return {
    video_id: v.video_id,
    title: v.title,
    published_at: v.published_at,
    views: v.views,
    likes: v.likes,
    comments: v.comments,
    views_per_day: v.views_per_day,
    like_rate: v.like_rate,
    comment_rate: v.comment_rate,
    data_source: 'public_api',
  };
}

// client_videos entry: the base shape plus every Analytics-only field pinned
// to null, since a public pull can't see them.
function toPublicClientVideo(v) {
  return {
    ...toPublicVideo(v),
    avg_view_duration_seconds: null,
    avg_percentage_viewed: null,
    impressions: null,
    ctr: null,
    traffic_source_split: null,
  };
}

// Competitors for an OAuth client, scoped to that client. competitor_snapshots
// has no client_name column, so the client's tracked channels are resolved
// through competitor_channels first, then only those channels' snapshots are
// read. Keeps the most recent snapshot per video.
async function buildCompetitors(client) {
  const { data: channelRows, error: channelsError } = await supabase
    .from('competitor_channels')
    .select('channel_id, channel_name')
    .eq('client_name', client);

  if (channelsError) throw channelsError;
  if (channelRows.length === 0) return [];

  const channelIds = channelRows.map((r) => r.channel_id);
  const nameById = new Map(channelRows.map((r) => [r.channel_id, r.channel_name]));

  const { data: rows, error } = await supabase
    .from('competitor_snapshots')
    .select('*')
    .in('channel_id', channelIds)
    .order('pulled_at', { ascending: false });

  if (error) throw error;

  const channels = new Map();

  for (const row of rows) {
    if (!channels.has(row.channel_id)) {
      channels.set(row.channel_id, {
        channel_name: row.channel_name || nameById.get(row.channel_id),
        videos: new Map(),
      });
    }
    const { videos } = channels.get(row.channel_id);
    // Rows are ordered by pulled_at descending, so the first row seen per
    // video_id is already the latest snapshot.
    if (!videos.has(row.video_id)) {
      videos.set(row.video_id, toPublicVideo(row));
    }
  }

  return Array.from(channels.entries()).map(([channel_id, { channel_name, videos }]) => ({
    channel_name,
    channel_id,
    videos: Array.from(videos.values()),
  }));
}

// OAuth mode: read the connected client's own channel from its stored token.
// Does not touch client_videos (unchanged behaviour).
async function buildClientFromOAuth() {
  const accessToken = await getValidAccessToken(clientName);

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

  return {
    client: {
      name: channel.snippet.title,
      channel_id: channel.id,
      subscribers: Number(channel.statistics.subscriberCount),
      capture_date: today(),
    },
  };
}

// Public-audit mode: no OAuth. Pull the named channel's recent videos with the
// public API key, exactly the way competitor channels are pulled.
async function buildClientFromPublic(channelName, channelId) {
  if (!process.env.YOUTUBE_API_KEY) {
    throw new Error('Missing YOUTUBE_API_KEY in .env');
  }
  const youtube = google.youtube({ version: 'v3', auth: process.env.YOUTUBE_API_KEY });
  const { data } = await youtube.channels.list({
    part: ['statistics'],
    id: [channelId],
  });

  const channel = data.items && data.items[0];
  if (!channel) {
    console.error(`No channel found for id "${channelId}".`);
    process.exit(1);
  }

  const videos = await fetchRecentVideos(channelId);

  return {
    client: {
      name: channelName,
      channel_id: channelId,
      subscribers: Number(channel.statistics.subscriberCount),
      capture_date: today(),
    },
    clientVideos: videos.map(toPublicClientVideo),
  };
}

async function main() {
  const findings = loadFindings();

  const built = publicChannelId
    ? await buildClientFromPublic(clientName, publicChannelId)
    : await buildClientFromOAuth();

  findings.client = built.client;
  if (built.clientVideos) {
    findings.client_videos = built.clientVideos;
  }

  // Competitors only apply to OAuth clients, who submit them through the
  // onboarding form. A public audit compares a channel against its own video
  // history, so its competitors array stays empty.
  findings.competitors = publicChannelId ? [] : await buildCompetitors(clientName);

  // Not derivable from the API data pulled above — pairs need a human to
  // pick comparisons, and studio_asks need a human to judge what's
  // actually missing for this client.
  findings.pairs = [];
  findings.studio_asks = [
    'TODO: fill in based on what metrics are actually missing for this client',
  ];

  fs.writeFileSync(FINDINGS_PATH, JSON.stringify(findings, null, 2) + '\n');

  const mode = publicChannelId ? 'public audit' : 'OAuth';
  console.log(`Wrote client section (${mode}) to ${FINDINGS_PATH}:`, findings.client);
  if (built.clientVideos) {
    console.log(
      `Wrote ${findings.client_videos.length} client video(s) with data_source=public_api.`
    );
  }
  if (publicChannelId) {
    console.log('Skipped competitors (public audit — single-channel analysis).');
  } else {
    console.log(
      `Wrote ${findings.competitors.length} competitor channel(s) to ${FINDINGS_PATH} ` +
      `(from competitor_channels for "${clientName}").`
    );
  }
}

main().catch((err) => {
  console.error('Failed to assemble findings:', err);
  process.exit(1);
});
