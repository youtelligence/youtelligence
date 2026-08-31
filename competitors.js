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

// Parses an ISO 8601 duration as returned by videos.list contentDetails.duration
// (e.g. "PT10M33S", "PT1H2S", "P1DT2H", "PT0S") into whole seconds. Returns null
// for anything it can't parse.
function parseIsoDuration(iso) {
  if (typeof iso !== 'string') return null;
  const match = iso.match(
    /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/
  );
  if (!match) return null;
  const [weeks, days, hours, minutes, seconds] = match.slice(1).map((n) => Number(n || 0));
  return weeks * 604800 + days * 86400 + hours * 3600 + minutes * 60 + seconds;
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
    part: ['statistics', 'contentDetails'],
    id: videoIds,
  });

  const detailsById = Object.fromEntries(
    videosData.items.map((video) => [video.id, video])
  );

  return playlistData.items.map((item) => {
    const videoId = item.snippet.resourceId.videoId;
    const video = detailsById[videoId] || {};
    const stats = video.statistics || {};
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
      runtime_seconds: parseIsoDuration(video.contentDetails && video.contentDetails.duration),
      views_per_day: viewsPerDay,
      like_rate: rate(likes, views),
      comment_rate: rate(comments, views),
    };
  });
}

// Maps a playlistItems row + its videos.list entry into the record shape
// fetchRecentVideos returns. Used by fetchVideosSince; fetchRecentVideos has a
// parallel inline copy.
function toVideoRecord(item, channelId, channelName, video) {
  const stats = (video && video.statistics) || {};
  const duration = video && video.contentDetails && video.contentDetails.duration;
  const views = stats.viewCount != null ? Number(stats.viewCount) : null;
  const likes = stats.likeCount != null ? Number(stats.likeCount) : null;
  const comments = stats.commentCount != null ? Number(stats.commentCount) : null;
  const viewsPerDay = views != null
    ? Number((views / daysSincePublished(item.snippet.publishedAt)).toFixed(1))
    : null;

  return {
    channel_id: channelId,
    channel_name: channelName,
    video_id: item.snippet.resourceId.videoId,
    title: item.snippet.title,
    views,
    likes,
    comments,
    published_at: item.snippet.publishedAt,
    runtime_seconds: parseIsoDuration(duration),
    views_per_day: viewsPerDay,
    like_rate: rate(likes, views),
    comment_rate: rate(comments, views),
  };
}

// Pages through a channel's uploads playlist (newest-first, 50 per page) and
// returns every upload published on or after sinceDate (a Date). Stops paging
// as soon as it hits a video older than sinceDate. Same field shape as
// fetchRecentVideos; does not save anything to Supabase.
async function fetchVideosSince(channelId, sinceDate) {
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
  const sinceMs = sinceDate.getTime();

  const items = [];
  let pageToken;
  let reachedCutoff = false;

  do {
    const { data } = await youtube.playlistItems.list({
      part: ['snippet'],
      playlistId: uploadsPlaylistId,
      maxResults: 50,
      pageToken,
    });

    for (const item of data.items) {
      if (new Date(item.snippet.publishedAt).getTime() < sinceMs) {
        reachedCutoff = true;
        break;
      }
      items.push(item);
    }

    pageToken = reachedCutoff ? undefined : data.nextPageToken;
  } while (pageToken);

  if (items.length === 0) return [];

  // videos.list also caps at 50 ids per call.
  const detailsById = {};
  for (let i = 0; i < items.length; i += 50) {
    const ids = items.slice(i, i + 50).map((item) => item.snippet.resourceId.videoId);
    const { data } = await youtube.videos.list({ part: ['statistics', 'contentDetails'], id: ids });
    for (const video of data.items) {
      detailsById[video.id] = video;
    }
  }

  return items.map((item) =>
    toVideoRecord(item, channelId, channelName, detailsById[item.snippet.resourceId.videoId] || {})
  );
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
  fetchVideosSince,
  saveSnapshots,
  saveCompetitorChannel,
};
