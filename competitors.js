require('dotenv').config();
const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function createYoutubeClient() {
  if (!process.env.YOUTUBE_API_KEY) {
    throw new Error('Missing YOUTUBE_API_KEY in .env');
  }
  return google.youtube({ version: 'v3', auth: process.env.YOUTUBE_API_KEY });
}

// Parses whatever a user might paste into a competitor field: a bare handle
// (with or without the leading @), a handle-style URL
// (youtube.com/@handle[/videos]), or a /channel/<id> URL. /channel/ URLs
// already carry a real channel ID, so they're returned as-is rather than
// being run through the @handle lookup.
function parseCompetitorInput(input) {
  const trimmed = input.trim();

  const channelUrlMatch = trimmed.match(/youtube\.com\/channel\/([^/?#]+)/i);
  if (channelUrlMatch) {
    return { channelId: channelUrlMatch[1] };
  }

  const handleUrlMatch = trimmed.match(/youtube\.com\/(@[^/?#]+)/i);
  if (handleUrlMatch) {
    return { handle: handleUrlMatch[1] };
  }

  return { handle: trimmed };
}

// Resolves a @handle to its channel id and title.
async function lookupChannelId(handle) {
  const youtube = createYoutubeClient();
  const { data } = await youtube.channels.list({
    part: ['id', 'snippet'],
    forHandle: handle,
  });

  const channel = data.items && data.items[0];
  if (!channel) {
    throw new Error(`No channel found for handle ${handle}`);
  }

  return { id: channel.id, title: channel.snippet.title };
}

// Fetches a channel's title directly by ID, for inputs that already carry a
// real channel ID (e.g. /channel/ URLs) -- no @handle lookup involved.
async function getChannelTitle(channelId) {
  const youtube = createYoutubeClient();
  const { data } = await youtube.channels.list({
    part: ['snippet'],
    id: [channelId],
  });

  const channel = data.items && data.items[0];
  if (!channel) {
    throw new Error(`No channel found for id ${channelId}`);
  }

  return channel.snippet.title;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

// Age in whole days, floored at 1 so same-day uploads don't produce
// an inflated or infinite views-per-day figure.
function daysSincePublished(publishedAt) {
  const days = (Date.now() - new Date(publishedAt).getTime()) / MS_PER_DAY;
  return Math.max(1, Math.floor(days));
}

// count/views as a percent (2 decimal places), or null if either is missing.
function rate(count, views) {
  if (count == null || !views) return null;
  return Number(((count / views) * 100).toFixed(2));
}

// Pulls a channel's 10 most recent uploads and computes normalized metrics.
// Does not save anything to Supabase -- pair with saveSnapshots.
async function fetchRecentVideos(channelId) {
  const youtube = createYoutubeClient();

  const { data: channelData } = await youtube.channels.list({
    part: ['snippet', 'contentDetails'],
    id: [channelId],
  });

  const channel = channelData.items && channelData.items[0];
  if (!channel) {
    throw new Error(`No channel found for id ${channelId}`);
  }

  const channelName = channel.snippet.title;
  const uploadsPlaylistId = channel.contentDetails.relatedPlaylists.uploads;

  const { data: playlistData } = await youtube.playlistItems.list({
    part: ['snippet'],
    playlistId: uploadsPlaylistId,
    maxResults: 10,
  });

  const videoIds = playlistData.items.map((item) => item.snippet.resourceId.videoId);

  const { data: videosData } = await youtube.videos.list({
    part: ['statistics'],
    id: videoIds,
  });

  const statsById = Object.fromEntries(
    videosData.items.map((video) => [video.id, video.statistics])
  );

  return playlistData.items.map((item) => {
    const videoId = item.snippet.resourceId.videoId;
    const stats = statsById[videoId] || {};
    const views = stats.viewCount != null ? Number(stats.viewCount) : null;
    const likes = stats.likeCount != null ? Number(stats.likeCount) : null;
    const comments = stats.commentCount != null ? Number(stats.commentCount) : null;
    const viewsPerDay = views != null
      ? Number((views / daysSincePublished(item.snippet.publishedAt)).toFixed(1))
      : null;

    return {
      channel_id: channelId,
      channel_name: channelName,
      video_id: videoId,
      title: item.snippet.title,
      views,
      likes,
      comments,
      published_at: item.snippet.publishedAt,
      views_per_day: viewsPerDay,
      like_rate: rate(likes, views),
      comment_rate: rate(comments, views),
    };
  });
}

async function saveSnapshots(snapshots) {
  if (snapshots.length === 0) return;
  const { error } = await supabase.from('competitor_snapshots').insert(snapshots);
  if (error) throw error;
}

// Registers a client/channel pair to track, keyed by (client_name, channel_id).
async function saveCompetitorChannel(clientName, channelId, channelName) {
  const { error } = await supabase
    .from('competitor_channels')
    .upsert(
      { client_name: clientName, channel_id: channelId, channel_name: channelName },
      { onConflict: 'client_name,channel_id' }
    );
  if (error) throw error;
}

module.exports = {
  parseCompetitorInput,
  lookupChannelId,
  getChannelTitle,
  fetchRecentVideos,
  saveSnapshots,
  saveCompetitorChannel,
};
