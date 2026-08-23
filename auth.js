require('dotenv').config();
const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');
const http = require('http');
const { exec } = require('child_process');
const url = require('url');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Must exactly match an "Authorized redirect URI" on the OAuth client in Google Cloud Console.
const REDIRECT_URI = 'http://localhost:3000/oauth2callback';
const SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
];

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  REDIRECT_URI
);

function runConsentFlow() {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });

  const server = http.createServer(async (req, res) => {
    const reqUrl = url.parse(req.url, true);
    if (reqUrl.pathname !== '/oauth2callback') return;

    const code = reqUrl.query.code;
    res.end('Authentication successful! You can close this tab.');
    server.close();

    const { tokens } = await oauth2Client.getToken(code);
    console.log(tokens);
    oauth2Client.setCredentials(tokens);

    const tokenRow = {
      client_name: 'my channel',
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

    if (upsertError) {
      console.error('Failed to save tokens to Supabase:', upsertError);
    } else {
      console.log('Saved tokens to Supabase.');
    }

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    const { data } = await youtube.channels.list({
      part: ['snippet', 'statistics'],
      mine: true,
    });

    const channel = data.items[0];
    console.log(`Channel: ${channel.snippet.title}`);
    console.log(`Subscribers: ${channel.statistics.subscriberCount}`);
  });

  server.listen(3000, () => {
    exec(`open "${authUrl}"`);
    console.log('Opening browser for Google consent...');
  });
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

  const refreshClient = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    REDIRECT_URI
  );
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

if (require.main === module) {
  runConsentFlow();
}

module.exports = { getValidAccessToken };
