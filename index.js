require('dotenv').config();
const express = require('express');
const { getAuthUrl, handleOAuthCallback } = require('./auth.js');
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

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
