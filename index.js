require('dotenv').config();
const path = require('path');
const express = require('express');
const { getAuthUrl, handleOAuthCallback } = require('./auth.js');
const { runKeywordResearch } = require('./keyword/pipeline.js');
const { findGaps } = require('./keyword/gaps.js');
const {
  parseCompetitorInput,
  lookupChannelId,
  getChannelTitle,
  fetchRecentVideos,
  saveSnapshots,
  saveCompetitorChannel,
} = require('./competitors.js');

const DEFAULT_CLIENT_NAME = 'my channel';
const NUM_COMPETITOR_FIELDS = 5;
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Shared design system for the three onboarding pages. --signal (blue) is
// reserved for real, measured data pulled from the person's own channel:
// their subscriber count, a resolved competitor's channel name, the active
// step number. It is never used for buttons, borders, or decoration.
const ONBOARD_STYLES = `
  :root {
    --bg: #F7F6F3;
    --ink: #14171F;
    --signal: #2D5BFF;
    --border: #E4E2DC;
    --muted: #8C8A82;
  }
  *, *::before, *::after { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font-family: "IBM Plex Sans", system-ui, -apple-system, sans-serif;
    font-size: 16px;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  .col {
    max-width: 480px;
    margin: 0 auto;
    padding: 72px 24px 112px;
  }
  .wordmark {
    margin: 0;
    text-align: center;
    font-size: 14px;
    font-weight: 500;
    letter-spacing: 0.01em;
  }
  .steps {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
    margin-top: 32px;
  }
  .step {
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    color: var(--muted);
  }
  .step.is-current { color: var(--signal); }
  .rule { width: 32px; height: 1px; background: var(--border); }
  .content {
    margin-top: 64px;
    text-align: center;
    animation: onboard-fade 220ms ease-out both;
  }
  @keyframes onboard-fade { from { opacity: 0; } to { opacity: 1; } }
  h1 {
    margin: 0 0 20px;
    font-family: "Fraunces", Georgia, "Times New Roman", serif;
    font-weight: 500;
    font-size: 34px;
    line-height: 1.15;
    letter-spacing: -0.01em;
  }
  p { margin: 0 auto 28px; max-width: 42ch; }
  .channel {
    color: var(--signal);
    font-weight: 500;
    font-size: 17px;
    margin-bottom: 40px;
  }
  form { margin: 0; }
  .field { margin-bottom: 18px; text-align: left; }
  .field label {
    display: block;
    margin-bottom: 6px;
    font-size: 13px;
    color: var(--muted);
  }
  .field input {
    width: 100%;
    padding: 11px 13px;
    font: inherit;
    color: var(--ink);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 0;
  }
  .field input:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 1px;
    border-color: var(--ink);
  }
  .actions { margin-top: 8px; }
  .btn {
    display: inline-block;
    font: inherit;
    font-weight: 500;
    padding: 13px 24px;
    color: var(--bg);
    background: var(--ink);
    border: 1px solid var(--ink);
    border-radius: 0;
    cursor: pointer;
    text-decoration: none;
  }
  .btn:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 3px;
  }
  .results { list-style: none; padding: 0; margin: 0; }
  .results li { margin-bottom: 12px; }
  .results .ok { color: var(--signal); font-weight: 500; }
  .results .fail { color: var(--ink); }
  @media (prefers-reduced-motion: reduce) {
    .content { animation: none; }
    * { transition: none !important; }
  }
`;

function renderOnboardPage({ title, step, headline, body }) {
  const steps = [1, 2, 3]
    .map((n) => {
      const current = n === step;
      return `<span class="step${current ? ' is-current' : ''}"${current ? ' aria-current="step"' : ''}>${n}</span>`;
    })
    .join('<span class="rule" aria-hidden="true"></span>');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500&family=IBM+Plex+Sans:wght@400;500&display=swap">
<style>${ONBOARD_STYLES}</style>
</head>
<body>
<main class="col">
<p class="wordmark">illumetrix</p>
<nav class="steps" aria-label="Onboarding progress">${steps}</nav>
<div class="content">
<h1>${headline}</h1>
${body}
</div>
</main>
</body>
</html>`;
}

// "1 subscriber" / "12,540 subscribers", from the real count Google returns.
function subscriberLine(count) {
  const n = Number(count);
  if (!Number.isFinite(n)) return `${escapeHtml(String(count))} subscribers`;
  return `${n.toLocaleString('en-US')} subscriber${n === 1 ? '' : 's'}`;
}

// Short, direct reason a competitor handle didn't resolve — no apology.
function competitorFailureReason(message) {
  if (/no channel found/i.test(message)) return 'channel not found';
  if (/quota|rate limit/i.test(message)) return 'lookup limit reached, try again later';
  return message || 'could not be resolved';
}

app.get('/', (req, res) => {
  res.send('Connect a channel via <code>/connect?client=&lt;client-name&gt;</code>.');
});

app.get('/onboard', (req, res) => {
  const { client } = req.query;
  if (!client) {
    res.status(400).send('Missing client query parameter, e.g. /onboard?client=jb-eckl');
    return;
  }

  const connectUrl = `/connect?client=${encodeURIComponent(client)}`;

  res.send(renderOnboardPage({
    title: 'Connect your channel',
    step: 1,
    headline: 'Connect your channel',
    body: `<p>You'll log into your own Google account to grant read access to your channel's analytics. Nothing else changes on your end.</p>
<div class="actions"><a class="btn" href="${connectUrl}">Connect with Google</a></div>`,
  }));
});

app.get('/connect', (req, res) => {
  const { client } = req.query;
  res.redirect(getAuthUrl(client || DEFAULT_CLIENT_NAME));
});

app.get('/oauth2callback', async (req, res) => {
  const { code, state: clientName } = req.query;
  if (!code) {
    res.status(400).send('Missing authorization code.');
    return;
  }
  if (!clientName) {
    res.status(400).send('Missing state parameter.');
    return;
  }

  try {
    const { title, subscriberCount } = await handleOAuthCallback(code, clientName);
    console.log(`Saved tokens to Supabase for "${clientName}".`);

    const competitorFields = Array.from({ length: NUM_COMPETITOR_FIELDS }, (_, i) => i + 1)
      .map((n) => `<div class="field">
<label for="competitor${n}">Competitor ${n}</label>
<input type="text" id="competitor${n}" name="competitor${n}" autocomplete="off">
</div>`)
      .join('\n');

    res.send(renderOnboardPage({
      title: "You're connected",
      step: 2,
      headline: "You're connected.",
      body: `<p class="channel">${escapeHtml(title)} · ${subscriberLine(subscriberCount)}</p>
<p>Add up to 5 channels you'd consider direct competition.</p>
<form action="/competitors" method="POST">
<input type="hidden" name="client" value="${escapeHtml(clientName)}">
${competitorFields}
<div class="actions"><button type="submit" class="btn">Save competitors</button></div>
</form>`,
    }));
  } catch (err) {
    console.error('OAuth callback failed:', err);
    res.status(500).send('Authentication failed — check server logs.');
  }
});

app.post('/competitors', async (req, res) => {
  const { client } = req.body;
  const handles = Array.from({ length: NUM_COMPETITOR_FIELDS }, (_, i) => req.body[`competitor${i + 1}`])
    .map((handle) => (handle || '').trim())
    .filter(Boolean);

  if (!client) {
    res.status(400).send('Missing client field.');
    return;
  }

  let body;
  if (handles.length === 0) {
    // Every competitor field was left blank. That's a valid, complete state —
    // nothing to resolve, so go straight to the completion page.
    body = '<p>No competitors added yet.</p>';
  } else {
    const results = [];
    for (const handle of handles) {
      try {
        const parsed = parseCompetitorInput(handle);
        let channelId, title;
        if (parsed.channelId) {
          channelId = parsed.channelId;
          title = await getChannelTitle(channelId);
        } else {
          ({ id: channelId, title } = await lookupChannelId(parsed.handle));
        }

        await saveCompetitorChannel(client, channelId, title);
        const snapshots = await fetchRecentVideos(channelId);
        await saveSnapshots(snapshots);
        results.push({ ok: true, name: title });
      } catch (err) {
        console.error(`Failed to process competitor ${handle}:`, err);
        results.push({ ok: false, input: handle, reason: competitorFailureReason(err.message) });
      }
    }

    const items = results
      .map((r) =>
        r.ok
          ? `<li class="ok">${escapeHtml(r.name)}</li>`
          : `<li class="fail">${escapeHtml(r.input)} — ${escapeHtml(r.reason)}</li>`
      )
      .join('\n');
    body = `<ul class="results">
${items}
</ul>`;
  }

  res.send(renderOnboardPage({
    title: 'Setup complete',
    step: 3,
    headline: 'Setup complete.',
    body,
  }));
});

// Personal keyword-research tool: static page + its one JSON endpoint.
app.get('/keyword-research', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'keyword-research.html'));
});

app.post('/api/keyword-research', async (req, res) => {
  const { term } = req.body || {};
  if (typeof term !== 'string' || !term.trim()) {
    res.status(400).json({ error: 'Missing or empty "term" in request body.' });
    return;
  }

  try {
    const result = await runKeywordResearch(term.trim());
    res.json(result);
  } catch (err) {
    console.error('Keyword research failed:', err);
    res.status(500).json({ error: 'Keyword research failed — check server logs.' });
  }
});

// Gap analysis for an already-live video: same keyword landscape as above,
// plus which landscape terms are missing from the pasted-in title/description
// and tags. Returns structured gaps only -- no rewritten copy.
app.post('/api/optimize-video', async (req, res) => {
  const { topic, current_title, current_description, current_tags } = req.body || {};
  if (typeof topic !== 'string' || !topic.trim()) {
    res.status(400).json({ error: 'Missing or empty "topic" in request body.' });
    return;
  }

  // Accept current_tags as an array or a comma-separated string.
  const tags = Array.isArray(current_tags)
    ? current_tags
    : typeof current_tags === 'string'
      ? current_tags.split(',')
      : [];

  try {
    const landscape = await runKeywordResearch(topic.trim());
    const gaps = findGaps(landscape, {
      current_title: typeof current_title === 'string' ? current_title : '',
      current_description: typeof current_description === 'string' ? current_description : '',
      current_tags: tags,
    });

    res.json({
      topic: topic.trim(),
      keyword_landscape: {
        related_terms: landscape.related_terms,
        questions: landscape.questions,
        competitiveness: landscape.competitiveness,
        hashtags: landscape.hashtags,
        search_volume: landscape.search_volume,
      },
      gaps,
      cached: landscape.cached,
    });
  } catch (err) {
    console.error('Video optimization failed:', err);
    res.status(500).json({ error: 'Video optimization failed — check server logs.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
