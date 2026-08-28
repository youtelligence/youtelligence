const { getSuggestions } = require('./autocomplete.js');
const { analyzeCompetitiveness } = require('./competitiveness.js');
const { getSearchVolume } = require('./volume.js');
const { rankHashtags } = require('./hashtags.js');
const { getCachedLookup, saveLookup } = require('./cache.js');

// Runs the full keyword-research pipeline for a seed term, going through the
// Supabase cache first. On a cache miss it fans out to the free autocomplete
// endpoint and the YouTube Data API (search + videos + channels), assembles
// the response payload, writes it to keyword_lookups, and returns it.
async function runKeywordResearch(term) {
  const seedTerm = term.trim();

  const cached = await getCachedLookup(seedTerm);
  if (cached) {
    return { ...cached.result, cached: true, cached_at: cached.created_at };
  }

  // autocomplete needs no key/quota; competitiveness is the API-heavy half.
  const [suggestions, competitiveness] = await Promise.all([
    getSuggestions(seedTerm),
    analyzeCompetitiveness(seedTerm),
  ]);
  const searchVolume = await getSearchVolume(seedTerm);

  const payload = {
    seed_term: seedTerm,
    related_terms: suggestions.relatedTerms,
    questions: suggestions.questions,
    search_volume: searchVolume,
    competitiveness: {
      score: competitiveness.score,
      top_videos: competitiveness.topVideos,
    },
    hashtags: rankHashtags(competitiveness.rawVideos),
    cached: false,
    cached_at: null,
  };

  await saveLookup(seedTerm, payload);
  return payload;
}

module.exports = { runKeywordResearch };
