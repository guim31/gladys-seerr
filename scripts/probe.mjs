// -----------------------------------------------------------------------------
// Read-only probe of a real Overseerr / Jellyseerr / Seerr server, through the
// client of the integration: what it reads, as it reads it. Nothing is written
// to the server; the API key and the email addresses are never printed.
//
//   SEERR_URL=http://192.168.1.2:5055 SEERR_API_KEY=... node scripts/probe.mjs
//   (SEERR_INSECURE=1 accepts a self-signed certificate)
// -----------------------------------------------------------------------------

import { SeerrClient } from '../src/seerr/client.js';
import {
  parseCounts,
  parseDetails,
  parseIssues,
  parseRequests,
  parseStatus,
} from '../src/seerr/model.js';

const { SEERR_URL: url, SEERR_API_KEY: apiKey, SEERR_INSECURE: insecure } = process.env;
if (!url || !apiKey) {
  console.error('Usage: SEERR_URL=http://host:5055 SEERR_API_KEY=... node scripts/probe.mjs');
  process.exit(2);
}

const client = new SeerrClient({ url, apiKey, insecure: insecure === '1' });
const step = async (label, run) => {
  try {
    const result = await run();
    console.log(`✓ ${label}`, result === undefined ? '' : JSON.stringify(result));
    return result;
  } catch (err) {
    console.log(`✗ ${label}: ${err.kind ?? 'error'} — ${err.message}`);
    return null;
  }
};

await step('status', async () => parseStatus(await client.status()));
await step('application', async () => (await client.publicSettings())?.applicationTitle);
await step('counts', async () =>
  parseCounts(await client.requestCount(), await client.issueCount(), await client.failedCount()),
);
const requests = parseRequests(await client.requests(5).catch(() => null));
await step('newest requests', async () =>
  requests.map((r) => ({
    id: r.id,
    type: r.mediaType,
    state: r.state,
    by: r.requestedBy,
    seasons: r.seasons,
  })),
);
let posterPath = null;
for (const request of requests) {
  const details = await step(`title of request ${request.id}`, async () =>
    parseDetails(await client.details(request.mediaType, request.tmdbId, 'en')),
  );
  posterPath ??= details?.posterPath ?? null;
}
await step('newest issues', async () =>
  parseIssues(await client.issues(5)).map((i) => ({
    id: i.id,
    type: i.type,
    open: i.open,
    by: i.reportedBy,
    message: i.message === undefined ? '(not in the list)' : 'yes',
  })),
);
if (posterPath) {
  await step('poster through the image proxy', async () => {
    const bytes = await client.poster(posterPath);
    return `${bytes.length} bytes`;
  });
}
