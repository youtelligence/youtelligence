require('dotenv').config();
const express = require('express');
const { getAuthUrl, handleOAuthCallback } = require('./auth.js');

const DEFAULT_CLIENT_NAME = 'my channel';
const PORT = process.env.PORT || 3000;

const app = express();

app.get('/', (req, res) => {
  res.send('Connect a channel via <code>/connect?client=&lt;client-name&gt;</code>.');
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
    res.send(`Authentication successful! Channel: ${title} (${subscriberCount} subscribers). You can close this tab.`);
  } catch (err) {
    console.error('OAuth callback failed:', err);
    res.status(500).send('Authentication failed — check server logs.');
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
