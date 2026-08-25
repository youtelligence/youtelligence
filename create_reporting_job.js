require('dotenv').config();
const { google } = require('googleapis');
const { getValidAccessToken } = require('./auth.js');

const DEFAULT_CLIENT_NAME = 'my channel';
const REPORT_TYPE_ID = 'channel_reach_basic_a1';
const clientName = process.argv[2] || DEFAULT_CLIENT_NAME;

async function main() {
  const accessToken = await getValidAccessToken(clientName);

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });

  const youtubeReporting = google.youtubereporting({ version: 'v1', auth: oauth2Client });

  const { data: job } = await youtubeReporting.jobs.create({
    requestBody: {
      reportTypeId: REPORT_TYPE_ID,
      name: REPORT_TYPE_ID,
    },
  });

  console.log(`Created job "${job.name}" (id: ${job.id}) for report type ${job.reportTypeId}`);
}

main().catch((err) => {
  console.error('Failed to create reporting job:', err);
  process.exit(1);
});
