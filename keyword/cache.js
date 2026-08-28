require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Cache window in days. Start at 7; override with KEYWORD_CACHE_WINDOW_DAYS.
const CACHE_WINDOW_DAYS = Number(process.env.KEYWORD_CACHE_WINDOW_DAYS || 7);
const MS_PER_DAY = 1000 * 60 * 60 * 24;

// Lowercase, trim, collapse internal whitespace -- the cache key.
function normalizeTerm(term) {
  return term.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Most recent keyword_lookups row for the normalized term that still falls
// inside the cache window, or null. Returns { result, created_at }.
async function getCachedLookup(term) {
  const cutoff = new Date(Date.now() - CACHE_WINDOW_DAYS * MS_PER_DAY).toISOString();

  const { data, error } = await supabase
    .from('keyword_lookups')
    .select('result, created_at')
    .eq('term', normalizeTerm(term))
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function saveLookup(term, result) {
  const { error } = await supabase
    .from('keyword_lookups')
    .insert({ term: normalizeTerm(term), result });
  if (error) throw error;
}

module.exports = { normalizeTerm, getCachedLookup, saveLookup, CACHE_WINDOW_DAYS };
