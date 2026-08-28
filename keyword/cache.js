require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Lowercase, trim, collapse internal whitespace -- the cache key.
function normalizeTerm(term) {
  return term.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Midnight UTC at the start of `date`'s calendar day.
function startOfUtcDay(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

// Most recent keyword_lookups row for the normalized term whose created_at
// falls on the current UTC calendar date, or null. The cache resets at
// 00:00 UTC each day rather than expiring N days after it was written: a
// lookup at 23:58 UTC and the same term at 00:02 UTC are different days and
// both hit the live API. Returns { result, created_at }.
async function getCachedLookup(term) {
  const cutoff = startOfUtcDay().toISOString();

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

module.exports = { normalizeTerm, getCachedLookup, saveLookup };
