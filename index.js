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

app.get('/', (req, res) => {
  res.send('Connect a channel via <code>/connect?client=&lt;client-name&gt;</code>.');
});

app.get('/onboard', (req, res) => {
  const { client } = req.query;
  if (!client) {
    res.status(400).send('Missing client query parameter, e.g. /onboard?client=jb-eckl');
    return;
  }

  const safeClient = escapeHtml(client);
  const connectUrl = `/connect?client=${encodeURIComponent(client)}`;

  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Connect your channel</title>
</head>
<body>
  <h1>Connect your YouTube channel</h1>
  <p>This links your YouTube channel to youtelligence for <strong>${safeClient}</strong>, so we can pull your channel's stats and analytics to build your audit.</p>
  <a href="${connectUrl}"><button type="button">Connect Your Channel</button></a>
</body>
</html>`);
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
      .map((n) => `<label>Competitor ${n}: <input type="text" name="competitor${n}"></label><br>`)
      .join('\n    ');

    res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Connected</title>
</head>
<body>
  <h1>Authentication successful!</h1>
  <p>Channel: ${escapeHtml(title)} (${escapeHtml(String(subscriberCount))} subscribers)</p>
  <h2>Track your competitors</h2>
  <form action="/competitors" method="POST">
    <input type="hidden" name="client" value="${escapeHtml(clientName)}">
    ${competitorFields}
    <button type="submit">Submit</button>
  </form>
</body>
</html>`);
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
  if (handles.length === 0) {
    res.status(400).send('No competitor handles submitted.');
    return;
  }

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
      results.push(`<li>${escapeHtml(handle)} (${escapeHtml(title)}) — saved ${snapshots.length} videos</li>`);
    } catch (err) {
      console.error(`Failed to process competitor ${handle}:`, err);
      results.push(`<li>${escapeHtml(handle)} — failed: ${escapeHtml(err.message)}</li>`);
    }
  }

  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Setup complete</title>
</head>
<body>
  <h1>Thanks — your setup is complete!</h1>
  <p>Your channel and competitors are connected. Here's what we saved:</p>
  <ul>
    ${results.join('\n    ')}
  </ul>
</body>
</html>`);
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
