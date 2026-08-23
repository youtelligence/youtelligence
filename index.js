require('dotenv').config();
const express = require('express');
const { getAuthUrl, handleOAuthCallback } = require('./auth.js');

const CLIENT_NAME = 'my channel';
const PORT = process.env.PORT || 3000;

const app = express();

app.get('/', (req, res) => {
  res.send('<a href="/auth">Connect your YouTube channel</a>');
});

app.get('/auth', (req, res) => {
  res.redirect(getAuthUrl());
});

app.get('/oauth2callback', async (req, res) => {
  const { code } = req.query;
  if (!code) {
    res.status(400).send('Missing authorization code.');
    return;
  }

  try {
    const { title, subscriberCount } = await handleOAuthCallback(code, CLIENT_NAME);
    console.log(`Saved tokens to Supabase for "${CLIENT_NAME}".`);
    res.send(`Authentication successful! Channel: ${title} (${subscriberCount} subscribers). You can close this tab.`);
  } catch (err) {
    console.error('OAuth callback failed:', err);
    res.status(500).send('Authentication failed — check server logs.');
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
