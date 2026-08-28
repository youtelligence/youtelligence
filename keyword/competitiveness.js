require('dotenv').config();
const { google } = require('googleapis');

// Dedicated key, restricted to YouTube Data API v3 only, so this tool's quota
// is isolated from the audit pipeline's YOUTUBE_API_KEY.
function createYoutubeClient() {
  if (!process.env.YOUTUBE_API_KEY_KEYWORD_TOOL) {
    throw new Error('Missing YOUTUBE_API_KEY_KEYWORD_TOOL in .env');
  }
  return google.youtube({
    version: 'v3',
    auth: process.env.YOUTUBE_API_KEY_KEYWORD_TOOL,
  });
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

// Age in whole days, floored at 1 so same-day uploads don't produce an
// inflated or infinite view-velocity figure. Matches competitors.js.
function daysSincePublished(publishedAt) {
  const days = (Date.now() - new Date(publishedAt).getTime()) / MS_PER_DAY;
  return Math.max(1, Math.floor(days));
}

// Weighted-average view velocity across the top 10, with rank 1 weighted
// heaviest (10) down to rank 10 (1), mapped onto a 0-100 log scale. A
// weighted-average velocity of SATURATION views/day (or more) scores 100;
// the log makes the low end readable, where most niche terms land.
const SATURATION_VPD = 100000;

function competitivenessScore(velocities) {
  if (velocities.length === 0) return 0;

  let weightedSum = 0;
  let weightTotal = 0;
  velocities.forEach((v, i) => {
    const weight = velocities.length - i; // 10, 9, 8, ... for a full page
    weightedSum += weight * v;
    weightTotal += weight;
  });

  const weightedAvg = weightedSum / weightTotal;
  const scaled = (Math.log10(weightedAvg + 1) / Math.log10(SATURATION_VPD)) * 100;
  return Number(Math.min(100, Math.max(0, scaled)).toFixed(1));
}

// search.list (100 units) for the seed term, then videos.list (~1 unit/video)
// and one batched channels.list (~1 unit/channel) to fill in stats. Returns
// the score, the contract-shaped top_videos list, and the raw video items
// (with snippet.tags) so hashtags.js can reuse them without more API calls.
async function analyzeCompetitiveness(seedTerm) {
  const youtube = createYoutubeClient();

  const { data: search } = await youtube.search.list({
    part: ['snippet'],
    q: seedTerm,
    type: ['video'],
    maxResults: 10,
  });

  const videoIds = (search.items || [])
    .map((item) => item.id && item.id.videoId)
    .filter(Boolean);

  if (videoIds.length === 0) {
    return { score: 0, topVideos: [], rawVideos: [] };
  }

  const { data: videosData } = await youtube.videos.list({
    part: ['snippet', 'statistics'],
    id: videoIds,
  });
  const videos = videosData.items || [];

  const channelIds = [...new Set(videos.map((v) => v.snippet.channelId).filter(Boolean))];
  const { data: channelsData } = await youtube.channels.list({
    part: ['statistics'],
    id: channelIds,
  });
  const subsByChannel = Object.fromEntries(
    (channelsData.items || []).map((c) => [
      c.id,
      c.statistics && c.statistics.subscriberCount != null
        ? Number(c.statistics.subscriberCount)
        : 0,
    ])
  );

  // Preserve search-result ranking order.
  const videoById = Object.fromEntries(videos.map((v) => [v.id, v]));
  const ordered = videoIds.map((id) => videoById[id]).filter(Boolean);

  const topVideos = ordered.map((video) => {
    const views = video.statistics && video.statistics.viewCount != null
      ? Number(video.statistics.viewCount)
      : 0;
    const ageDays = daysSincePublished(video.snippet.publishedAt);
    const viewVelocity = Number((views / ageDays).toFixed(1));

    return {
      title: video.snippet.title,
      channel: video.snippet.channelTitle,
      subscriber_count: subsByChannel[video.snippet.channelId] || 0,
      views,
      video_age_days: ageDays,
      view_velocity: viewVelocity,
    };
  });

  return {
    score: competitivenessScore(topVideos.map((v) => v.view_velocity)),
    topVideos,
    rawVideos: ordered,
  };
}

module.exports = { analyzeCompetitiveness };
