// Ranks hashtag recommendations from the tags already attached to the top-10
// videos fetched by competitiveness.js. No extra API calls.

const DEFAULT_LIMIT = Number(process.env.KEYWORD_HASHTAG_LIMIT || 15);

// "video editing" -> "#videoediting"
function toHashtag(tag) {
  const cleaned = tag.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return cleaned ? `#${cleaned}` : null;
}

// Frequency = number of videos whose snippet.tags contain the tag (counted
// once per video, case-insensitive). Ties break by first appearance.
function rankHashtags(rawVideos, limit = DEFAULT_LIMIT) {
  const counts = new Map();
  const order = new Map();
  let seq = 0;

  for (const video of rawVideos || []) {
    const tags = (video.snippet && video.snippet.tags) || [];
    const seenInThisVideo = new Set();

    for (const tag of tags) {
      const hashtag = toHashtag(tag);
      if (!hashtag || seenInThisVideo.has(hashtag)) continue;
      seenInThisVideo.add(hashtag);

      counts.set(hashtag, (counts.get(hashtag) || 0) + 1);
      if (!order.has(hashtag)) order.set(hashtag, seq++);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || order.get(a[0]) - order.get(b[0]))
    .slice(0, limit)
    .map(([hashtag]) => hashtag);
}

module.exports = { rankHashtags };
