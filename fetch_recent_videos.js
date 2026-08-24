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
    console.log(`Title: ${item.snippet.title}`);
    console.log(`Views: ${stats.viewCount ?? 'N/A'}`);
    console.log(`Likes: ${stats.likeCount ?? 'N/A'}`);
    console.log(`Comments: ${stats.commentCount ?? 'N/A'}`);
    console.log(`Published: ${item.snippet.publishedAt}`);
    console.log('---');
  }
}

main().catch((err) => {
  console.error('Failed to fetch channel videos:', err);
  process.exit(1);
});
