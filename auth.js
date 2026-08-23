require('dotenv').config();
const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PORT = process.env.PORT || 3000;
// Must exactly match an "Authorized redirect URI" on the OAuth client in Google Cloud Console.
// Set REDIRECT_URI in deployed environments (e.g. Railway) to the public callback URL;
// it defaults to localhost for local development.
const REDIRECT_URI = process.env.REDIRECT_URI || `http://localhost:${PORT}/oauth2callback`;
const SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
];

function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    REDIRECT_URI
  );
}

function getAuthUrl() {
  return createOAuthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });
}

// Exchanges an OAuth code for tokens, saves them to Supabase under
// clientName, and returns the authenticated user's channel title and
// subscriber count.
async function handleOAuthCallback(code, clientName) {
  const oauth2Client = createOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  const tokenRow = {
    client_name: clientName,
    access_token: tokens.access_token,
    expires_at: new Date(tokens.expiry_date).toISOString(),
    updated_at: new Date().toISOString(),
  };
  // Google only returns refresh_token on first consent; omit the key so an
  // upsert on a later run doesn't null out the one already stored.
  if (tokens.refresh_token) {
    tokenRow.refresh_token = tokens.refresh_token;
  }

  const { error: upsertError } = await supabase
    .from('oauth_tokens')
    .upsert(tokenRow, { onConflict: 'client_name' });

  if (upsertError) throw upsertError;

  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
  const { data } = await youtube.channels.list({
    part: ['snippet', 'statistics'],
    mine: true,
  });

  const channel = data.items[0];
  return {
    title: channel.snippet.title,
    subscriberCount: channel.statistics.subscriberCount,
  };
}

// Returns a valid access token for clientName, refreshing and persisting a
// new one via the stored refresh_token if the current one has expired.
async function getValidAccessToken(clientName) {
  const { data: row, error: fetchError } = await supabase
    .from('oauth_tokens')
    .select('access_token, refresh_token, expires_at')
    .eq('client_name', clientName)
    .single();

  if (fetchError) throw fetchError;
  if (!row.refresh_token) {
    throw new Error(`No refresh token stored for client "${clientName}"`);
  }

  const isExpired = !row.expires_at || new Date(row.expires_at).getTime() <= Date.now();
  if (!isExpired) {
    return row.access_token;
  }

  const refreshClient = createOAuthClient();
  refreshClient.setCredentials({ refresh_token: row.refresh_token });

  const { token: newAccessToken } = await refreshClient.getAccessToken();
  const { expiry_date } = refreshClient.credentials;

  const { error: updateError } = await supabase
    .from('oauth_tokens')
    .update({
      access_token: newAccessToken,
      expires_at: new Date(expiry_date).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('client_name', clientName);

  if (updateError) throw updateError;

  return newAccessToken;
}

module.exports = { getAuthUrl, handleOAuthCallback, getValidAccessToken };
