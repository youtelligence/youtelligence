require('dotenv').config();
const { google } = require('googleapis');
const { getValidAccessToken } = require('./auth.js');

const CLIENT_NAME = 'my channel';

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

async function main() {
  const accessToken = await getValidAccessToken(CLIENT_NAME);

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });

  const youtubeAnalytics = google.youtubeAnalytics({ version: 'v2', auth: oauth2Client });

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 28);

  const { data } = await youtubeAnalytics.reports.query({
    ids: 'channel==MINE',
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
    metrics: 'averageViewDuration',
  });

  const row = data.rows && data.rows[0];
  if (!row) {
    console.log('No data returned for the last 28 days.');
    return;
  }

  const columns = data.columnHeaders.map((header) => header.name);
  const result = Object.fromEntries(columns.map((name, i) => [name, row[i]]));

  console.log(`Average view duration: ${result.averageViewDuration}s`);
}

main().catch((err) => {
  console.error('Failed to fetch YouTube Analytics:', err);
  process.exit(1);
});
