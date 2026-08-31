require('dotenv').config();
const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');
const { getValidAccessToken } = require('./auth.js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DEFAULT_CLIENT_NAME = 'my channel';
const REPORT_TYPE_ID = 'channel_reach_basic_a1';

const clientName = process.argv[2] || DEFAULT_CLIENT_NAME;
// Optional RFC 3339 lower bound (e.g. 2026-08-01T00:00:00Z) so a re-run only
// pulls report files generated since the last one.
const createdAfter = process.argv[3];

// channel_reach_basic_a1 emits one row per
// (date, video, live_or_on_demand, subscribed_status, ...) combination, so the
// rows are aggregated back up to one per (video_id, date) before saving.
const DATE_COL = 'date';
const VIDEO_COL = 'video_id';
const IMPRESSIONS_COL = 'impressions';
const CTR_COL = 'impressions_click_through_rate';

// Walks a paginated youtubereporting list method (jobs.list / jobs.reports.list)
// and returns every item under itemsKey.
async function listAllPages(listFn, params, itemsKey) {
  const items = [];
  let pageToken;
  do {
    const { data } = await listFn({ ...params, pageToken });
    if (data[itemsKey]) items.push(...data[itemsKey]);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return items;
}

async function downloadReport(accessToken, downloadUrl) {
  const res = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Download failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return res.text();
}

// Parses one report CSV and folds its rows into acc, keyed by
// `${video_id}|${report_date}`. impressions are summed; CTR is accumulated as
// impressions * ctr so a weighted mean can be taken once every row is in
// (the report gives a per-slice rate, not raw clicks).
function aggregateInto(acc, csv, reportId) {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return;

  const header = lines[0].split(',').map((h) => h.trim());
  const dateIdx = header.indexOf(DATE_COL);
  const videoIdx = header.indexOf(VIDEO_COL);
  const impressionsIdx = header.indexOf(IMPRESSIONS_COL);
  const ctrIdx = header.indexOf(CTR_COL);

  if ([dateIdx, videoIdx, impressionsIdx, ctrIdx].includes(-1)) {
    throw new Error(
      `Report ${reportId} is missing an expected column. Header was: ${header.join(', ')}`
    );
  }

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    if (cells.length < header.length) continue;

    const rawDate = cells[dateIdx].trim(); // YYYYMMDD in bulk reports
    const report_date = rawDate.length === 8
      ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
      : rawDate;
    const video_id = cells[videoIdx].trim();
    if (!video_id || !report_date) continue;

    const impressions = Number(cells[impressionsIdx]) || 0;
    const ctr = Number(cells[ctrIdx]) || 0;

    const key = `${video_id}|${report_date}`;
    const entry = acc.get(key) || { video_id, report_date, impressions: 0, weightedCtr: 0 };
    entry.impressions += impressions;
    entry.weightedCtr += impressions * ctr;
    acc.set(key, entry);
  }
}

async function main() {
  const accessToken = await getValidAccessToken(clientName);

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  const reporting = google.youtubereporting({ version: 'v1', auth: oauth2Client });

  // 1. Find the reporting job(s) for this report type. create_reporting_job.js
  //    makes a fresh job every time it's run, so there may be more than one --
  //    pull reports from all of them and dedupe below.
  const jobs = await listAllPages((p) => reporting.jobs.list(p), {}, 'jobs');
  const matchingJobs = jobs.filter((j) => j.reportTypeId === REPORT_TYPE_ID);
  if (matchingJobs.length === 0) {
    const arg = clientName === DEFAULT_CLIENT_NAME ? '' : ` ${clientName}`;
    throw new Error(
      `No "${REPORT_TYPE_ID}" reporting job found for client "${clientName}". ` +
      `Run: node create_reporting_job.js${arg}`
    );
  }

  // 2. List every report file across those jobs.
  const reports = [];
  for (const job of matchingJobs) {
    const jobReports = await listAllPages(
      (p) => reporting.jobs.reports.list(p),
      { jobId: job.id, createdAfter },
      'reports'
    );
    reports.push(...jobReports);
  }

  // 3. YouTube regenerates a day's report when it reprocesses data, so the same
  //    startTime shows up more than once -- keep only the newest createTime.
  const newestByDay = new Map();
  for (const report of reports) {
    const existing = newestByDay.get(report.startTime);
    if (!existing || new Date(report.createTime) > new Date(existing.createTime)) {
      newestByDay.set(report.startTime, report);
    }
  }
  const toDownload = [...newestByDay.values()];
  if (toDownload.length === 0) {
    console.log(
      'No report files available yet.' +
      (createdAfter ? ` (createdAfter ${createdAfter})` : '')
    );
    return;
  }

  // 4. Download + parse each, aggregating to one row per (video_id, date).
  const byVideoDate = new Map();
  for (const report of toDownload) {
    if (!report.downloadUrl) {
      console.warn(`Report ${report.id} has no downloadUrl -- skipping`);
      continue;
    }
    const csv = await downloadReport(accessToken, report.downloadUrl);
    aggregateInto(byVideoDate, csv, report.id);
  }

  if (byVideoDate.size === 0) {
    console.log(`Downloaded ${toDownload.length} report file(s); no data rows in them.`);
    return;
  }

  // 5. Upsert. pulled_at is set explicitly so re-pulled days get a fresh
  //    timestamp (the column default only fires on insert).
  const pulledAt = new Date().toISOString();
  const rows = [...byVideoDate.values()].map((r) => ({
    video_id: r.video_id,
    report_date: r.report_date,
    impressions: r.impressions,
    click_through_rate: r.impressions > 0
      ? Number((r.weightedCtr / r.impressions).toFixed(6))
      : null,
    pulled_at: pulledAt,
  }));

  const { error } = await supabase
    .from('reach_reports')
    .upsert(rows, { onConflict: 'video_id,report_date' });
  if (error) throw error;

  const dates = rows.map((r) => r.report_date).sort();
  console.log(
    `Downloaded ${toDownload.length} report file(s), upserted ${rows.length} ` +
    `(video, date) row(s) spanning ${dates[0]}..${dates[dates.length - 1]}.`
  );
}

main().catch((err) => {
  console.error('Failed to download reach reports:', err);
  process.exit(1);
});
