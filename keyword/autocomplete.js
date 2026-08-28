// Pulls query suggestions from YouTube's public autocomplete endpoint.
// No API key, no quota cost. The endpoint returns JSONP of the shape
//   window.google.ac.h(["seed",[["suggestion",0,[...]], ...],{...}])
// so we slice out the array literal between the first "(" and last ")".

const SUGGEST_URL = 'https://suggestqueries.google.com/complete/search';

// Prepended to the seed term. These all read naturally leading a query
// ("how to edit <seed>", "best <seed> software"), so autocomplete completes
// them the way a person would actually type them.
const PREFIXES = ['how', 'what', 'why', 'best'];

// Appended to the seed term. Comparison phrasing puts the subject first
// ("<seed> vs capcut"), not "vs <seed> capcut", so "vs" has to trail the
// seed for autocomplete to fill in the competing term after it.
const SUFFIXES = ['vs'];

// A suggestion is filed under `questions` when its first word is one of these.
const QUESTION_WORDS = new Set([
  'how', 'what', 'why', 'when', 'where', 'who', 'which', 'whose', 'whom',
  'is', 'are', 'was', 'were', 'can', 'could', 'do', 'does', 'did',
  'will', 'would', 'should',
]);

async function fetchSuggestions(query) {
  const url = `${SUGGEST_URL}?client=youtube&ds=yt&q=${encodeURIComponent(query)}`;

  let text;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (youtelligence keyword tool)' },
    });
    if (!res.ok) return [];
    text = await res.text();
  } catch {
    return [];
  }

  const start = text.indexOf('(');
  const end = text.lastIndexOf(')');
  if (start === -1 || end <= start) return [];

  try {
    const parsed = JSON.parse(text.slice(start + 1, end));
    if (!Array.isArray(parsed[1])) return [];
    return parsed[1]
      .map((entry) => (Array.isArray(entry) ? entry[0] : entry))
      .filter((s) => typeof s === 'string');
  } catch {
    return [];
  }
}

function firstWord(phrase) {
  return phrase.trim().toLowerCase().split(/\s+/)[0];
}

// Runs the seed term plus each prefixed and suffixed variant through the
// suggest endpoint, dedupes case-insensitively, drops the seed term itself,
// and splits the rest into `questions` (first word is a question word) and
// `related_terms`.
async function getSuggestions(seedTerm) {
  const seed = seedTerm.trim();
  const queries = [
    seed,
    ...PREFIXES.map((p) => `${p} ${seed}`),
    ...SUFFIXES.map((s) => `${seed} ${s}`),
  ];

  const batches = await Promise.all(queries.map(fetchSuggestions));

  // Drop the seed and any bare query stem the endpoint echoes back
  // uncompleted (e.g. "<seed> vs" with no competing term after it).
  const seen = new Set();
  const queryKeys = new Set(queries.map((q) => q.toLowerCase()));
  const questions = [];
  const relatedTerms = [];

  for (const suggestion of batches.flat()) {
    const key = suggestion.trim().toLowerCase();
    if (!key || queryKeys.has(key) || seen.has(key)) continue;
    seen.add(key);

    if (QUESTION_WORDS.has(firstWord(suggestion))) {
      questions.push(suggestion);
    } else {
      relatedTerms.push(suggestion);
    }
  }

  return { relatedTerms, questions };
}

module.exports = { getSuggestions };
