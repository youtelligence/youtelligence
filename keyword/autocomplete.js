// Pulls query suggestions from YouTube's public autocomplete endpoint.
// No API key, no quota cost. The endpoint returns JSONP of the shape
//   window.google.ac.h(["seed",[["suggestion",0,[...]], ...],{...}])
// so we slice out the array literal between the first "(" and last ")".

const SUGGEST_URL = 'https://suggestqueries.google.com/complete/search';

// Prepended to the seed term to tease out question-style and comparison queries.
const PREFIXES = ['how', 'what', 'why', 'best', 'vs'];

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

// Runs the seed term plus each prefixed variant through the suggest endpoint,
// dedupes case-insensitively, drops the seed term itself, and splits the rest
// into `questions` (first word is a question word) and `related_terms`.
async function getSuggestions(seedTerm) {
  const seed = seedTerm.trim();
  const queries = [seed, ...PREFIXES.map((p) => `${p} ${seed}`)];

  const batches = await Promise.all(queries.map(fetchSuggestions));

  const seen = new Set();
  const questions = [];
  const relatedTerms = [];
  const seedKey = seed.toLowerCase();

  for (const suggestion of batches.flat()) {
    const key = suggestion.trim().toLowerCase();
    if (!key || key === seedKey || seen.has(key)) continue;
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
