require('dotenv').config();
const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');

const channelId = process.argv[2];
const apiKey = process.env.YOUTUBE_API_KEY;

const CHANNEL_NAME = 'JB Eckl';

if (!channelId) {
  console.error('Usage: node fetch_recent_videos.js <channelId>');
  process.exit(1);
}
if (!apiKey) {
  console.error('Missing YOUTUBE_API_KEY in .env');
  process.exit(1);
}

const youtube = google.youtube({ version: 'v3', auth: apiKey });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

function formatMetric(value, suffix = '') {
  return value == null ? 'N/A' : `${value}${suffix}`;
}

async function main() {
  const { data: channelData } = await youtube.channels.list({
    part: ['contentDetails'],
    id: [channelId],
  });

  const channel = channelData.items && channelData.items[0];
  if (!channel) {
    console.error(`No channel found for id ${channelId}`);
    process.exit(1);
  }

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

  const snapshots = [];

  for (const item of playlistData.items) {
    const videoId = item.snippet.resourceId.videoId;
    const stats = statsById[videoId] || {};
    const views = stats.viewCount != null ? Number(stats.viewCount) : null;
    const likes = stats.likeCount != null ? Number(stats.likeCount) : null;
    const comments = stats.commentCount != null ? Number(stats.commentCount) : null;
    const viewsPerDay = views != null
      ? Number((views / daysSincePublished(item.snippet.publishedAt)).toFixed(1))
      : null;
    const likeRate = rate(likes, views);
    const commentRate = rate(comments, views);

    console.log(`Title: ${item.snippet.title}`);
    console.log(`Views: ${views ?? 'N/A'}`);
    console.log(`Likes: ${likes ?? 'N/A'}`);
    console.log(`Comments: ${comments ?? 'N/A'}`);
    console.log(`Published: ${item.snippet.publishedAt}`);
    console.log(`Views/day: ${formatMetric(viewsPerDay)}`);
    console.log(`Like rate: ${formatMetric(likeRate, '%')}`);
    console.log(`Comment rate: ${formatMetric(commentRate, '%')}`);
    console.log('---');

    snapshots.push({
      channel_id: channelId,
      channel_name: CHANNEL_NAME,
      video_id: videoId,
      title: item.snippet.title,
      views,
      likes,
      comments,
      published_at: item.snippet.publishedAt,
      views_per_day: viewsPerDay,
      like_rate: likeRate,
      comment_rate: commentRate,
    });
  }

  const { error } = await supabase.from('competitor_snapshots').insert(snapshots);
  if (error) {
    console.error('Failed to save snapshots to Supabase:', error);
    process.exit(1);
  }
  console.log(`Saved ${snapshots.length} snapshots to Supabase.`);
}

main().catch((err) => {
  console.error('Failed to fetch channel videos:', err);
  process.exit(1);
});
