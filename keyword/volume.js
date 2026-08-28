// Search-volume lookup. Stubbed until a Google Ads account exists.
//
// Drop-in replacement plan: once Google Ads is set up, implement this against
// the Keyword Planner API's GenerateKeywordIdeas call for `term` and return
// { value: <avg monthly searches>, source: 'google_ads' }. The pipeline only
// depends on this signature, so nothing else has to change.

async function getSearchVolume(term) { // eslint-disable-line no-unused-vars
  return { value: null, source: 'google_ads' };
}

module.exports = { getSearchVolume };
