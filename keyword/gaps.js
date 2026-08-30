// Gap analysis between a keyword landscape (a runKeywordResearch payload) and
// a video's existing title / description / tags.
//
// Known limitation (same spirit as the branded-tag filter in hashtags.js):
// matching here is plain normalized substring / exact normalized-tag
// comparison -- not fuzzy, not semantic. A landscape term the video already
// covers under different wording ("crumble recipe" vs "crumble cooking
// guide") still shows up as a gap. That's an accepted v1 tradeoff, not a
// bug to chase.

// lowercase, drop punctuation, collapse whitespace -- for substring checks
// against the combined title + description text.
function normalizeText(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// lowercase, strip every non-alphanumeric char -- matches how hashtags.js
// normalizes tags ("#Video Editing" / "video-editing" -> "videoediting").
function normalizeTag(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// landscape: { related_terms, questions, hashtags, ... } from runKeywordResearch.
// video: { current_title, current_description, current_tags }.
function findGaps(landscape, video) {
  const blob = [
    normalizeText(video.current_title),
    normalizeText(video.current_description),
  ].filter(Boolean).join(' ');

  const terms = [
    ...(landscape.related_terms || []),
    ...(landscape.questions || []),
  ];
  const missingFromText = terms.filter((term) => {
    const norm = normalizeText(term);
    return norm && !blob.includes(norm);
  });

  const currentTags = new Set(
    (video.current_tags || []).map(normalizeTag).filter(Boolean)
  );
  const missingFromTags = (landscape.hashtags || []).filter((hashtag) => {
    const norm = normalizeTag(hashtag); // "#videoediting" -> "videoediting"
    return norm && !currentTags.has(norm);
  });

  return {
    missing_from_title_or_description: missingFromText,
    missing_from_tags: missingFromTags,
  };
}

module.exports = { findGaps };
