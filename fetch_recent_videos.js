require('dotenv').config();
const { google } = require('googleapis');

const channelId = process.argv[2];
const apiKey = process.env.YOUTUBE_API_KEY;

if (!channelId) {
  console.error('Usage: node fetch_recent_videos.js <channelId>');
  process.exit(1);
}
if (!apiKey) {
  console.error('Missing YOUTUBE_API_KEY in .env');
  process.exit(1);
}

const youtube = google.youtube({ version: 'v3', auth: apiKey });

const MS_PER_DAY = 1000 * 60 * 60 * 24;

// Age in whole days, floored at 1 so same-day uploads don't produce
// an inflated or infinite views-per-day figure.
function daysSincePublished(publishedAt) {
  const days = (Date.now() - new Date(publishedAt).getTime()) / MS_PER_DAY;
  return Math.max(1, Math.floor(days));
}

function formatRate(count, views) {
  if (count == null || !views) return 'N/A';
  return `${((count / views) * 100).toFixed(2)}%`;
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

  for (const item of playlistData.items) {
    const videoId = item.snippet.resourceId.videoId;
    const stats = statsById[videoId] || {};
    const views = stats.viewCount != null ? Number(stats.viewCount) : null;
    const likes = stats.likeCount != null ? Number(stats.likeCount) : null;
    const comments = stats.commentCount != null ? Number(stats.commentCount) : null;
    const viewsPerDay = views != null
      ? (views / daysSincePublished(item.snippet.publishedAt)).toFixed(1)
      : 'N/A';

    console.log(`Title: ${item.snippet.title}`);
    console.log(`Views: ${views ?? 'N/A'}`);
    console.log(`Likes: ${likes ?? 'N/A'}`);
    console.log(`Comments: ${comments ?? 'N/A'}`);
    console.log(`Published: ${item.snippet.publishedAt}`);
    console.log(`Views/day: ${viewsPerDay}`);
    console.log(`Like rate: ${formatRate(likes, views)}`);
    console.log(`Comment rate: ${formatRate(comments, views)}`);
    console.log('---');
  }
}

main().catch((err) => {
  console.error('Failed to fetch channel videos:', err);
  process.exit(1);
});
