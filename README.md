# youtelligence

## What's built so far

`auth.js` runs a local OAuth2 flow against the YouTube Data API and persists tokens to Supabase:

1. Starts a local server on `http://localhost:3000` and opens the browser to Google's consent screen (scopes: `youtube.readonly`, `yt-analytics.readonly`).
2. On the `/oauth2callback` redirect, exchanges the auth code for an access/refresh token pair.
3. Upserts the tokens into the `oauth_tokens` Supabase table, keyed by `client_name` (refresh token is only overwritten when Google actually returns a new one, since it's only issued on first consent).
4. Calls `channels.list` with `mine=true` and prints the authenticated user's channel title and subscriber count.

It also exports `getValidAccessToken(clientName)`, which reads the stored tokens from Supabase and transparently refreshes (and re-persists) the access token if it's expired.

`analytics.js` uses `getValidAccessToken` to call the YouTube Analytics API and prints average view duration over the last 28 days for the channel — no browser interaction needed once a refresh token is stored.

## Setup

1. `npm install`
2. Create a Supabase project, then run the SQL migrations in `supabase/` (in order: `oauth_tokens.sql`, `oauth_tokens_unique_client.sql`, `oauth_tokens_add_expires_at.sql`, `grant_oauth_tokens.sql`).
3. Create a `.env` file with:
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   SUPABASE_URL=...
   SUPABASE_SERVICE_ROLE_KEY=...
   ```
4. In the Google Cloud Console, add `http://localhost:3000/oauth2callback` as an Authorized redirect URI on that OAuth client.

## Run

```
node auth.js
```

Approve access in the browser tab that opens. The script logs the token response, saves it to Supabase, then prints the channel title and subscriber count.

**Note:** the script logs the raw access token to stdout — treat that output as a credential and don't share it.

Once tokens are stored, fetch analytics without re-authenticating:

```
node analytics.js
```
