const { fetchRecentVideos, saveSnapshots } = require('./competitors.js');

const channelId = process.argv[2];

if (!channelId) {
  console.error('Usage: node fetch_recent_videos.js <channelId>');
  process.exit(1);
}

function formatMetric(value, suffix = '') {
  return value == null ? 'N/A' : `${value}${suffix}`;
}

async function main() {
  const snapshots = await fetchRecentVideos(channelId);

  for (const snapshot of snapshots) {
    console.log(`Title: ${snapshot.title}`);
    console.log(`Views: ${snapshot.views ?? 'N/A'}`);
    console.log(`Likes: ${snapshot.likes ?? 'N/A'}`);
    console.log(`Comments: ${snapshot.comments ?? 'N/A'}`);
    console.log(`Published: ${snapshot.published_at}`);
    console.log(`Views/day: ${formatMetric(snapshot.views_per_day)}`);
    console.log(`Like rate: ${formatMetric(snapshot.like_rate, '%')}`);
    console.log(`Comment rate: ${formatMetric(snapshot.comment_rate, '%')}`);
    console.log('---');
  }

  await saveSnapshots(snapshots);
  console.log(`Saved ${snapshots.length} snapshots to Supabase.`);
}

main().catch((err) => {
  console.error('Failed to fetch channel videos:', err);
  process.exit(1);
});
