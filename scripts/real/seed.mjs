// -----------------------------------------------------------------------------
// Seeds the configuration directory of a real Overseerr, Jellyseerr or Seerr
// with users, requests and issues, for `npm run test:real` (see
// scripts/real/README.md). Their setup wizard needs a Plex or Jellyfin login
// and new requests need TMDB: neither is reachable from a test machine, so
// the rows go straight into the SQLite database the application created on its
// first start (stop it first), and settings.json gets a known API key.
//
//   node scripts/real/seed.mjs <config directory> <api key>
//
// Fictional users only. The TMDB ids are real movies and series, so a machine
// that reaches TMDB also shows their titles.
// -----------------------------------------------------------------------------

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const [directory, apiKey] = process.argv.slice(2);
if (!directory || !apiKey) {
  console.error('Usage: node scripts/real/seed.mjs <config directory> <api key>');
  process.exit(2);
}

// settings.json: initialized and a known API key. The media server stays
// unconfigured: a Jellyfin without its address fails a settings migration.
const settingsPath = join(directory, 'settings.json');
const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
settings.main.apiKey = apiKey;
settings.public = { ...settings.public, initialized: true };
writeFileSync(settingsPath, JSON.stringify(settings, null, 1));

const db = new DatabaseSync(join(directory, 'db', 'db.sqlite3'));
const columns = (table) =>
  new Set(
    db
      .prepare(`PRAGMA table_info("${table}")`)
      .all()
      .map((c) => c.name),
  );
const userColumns = columns('user');

function insert(table, row) {
  const known = columns(table);
  const entries = Object.entries(row).filter(([key]) => known.has(key));
  const sql = `INSERT INTO "${table}" (${entries.map(([k]) => `"${k}"`).join(', ')}) VALUES (${entries.map(() => '?').join(', ')})`;
  return Number(db.prepare(sql).run(...entries.map(([, value]) => value)).lastInsertRowid);
}

const ago = (minutes) =>
  new Date(Date.now() - minutes * 60_000).toISOString().replace('T', ' ').slice(0, 19);

// Permissions: 2 = ADMIN, 32 = REQUEST. User types: 2 = Jellyfin, 3 = local.
const user = (id, name, permissions, type) =>
  insert('user', {
    id,
    email: `${name}@example.org`,
    username: name,
    permissions,
    avatar: '/os_logo_square.png',
    userType: type,
    ...(type === 2 && userColumns.has('jellyfinUsername')
      ? { jellyfinUsername: name, jellyfinUserId: `0000000000000000000000000000000${id}` }
      : {}),
  });
user(1, 'admin', 2, 3);
user(2, 'alice', 32, 3);
user(3, 'bob', 32, 2);

// Media status: 1 unknown, 2 pending, 3 processing, 4 partially available, 5 available.
const media = (type, tmdbId, status, extra = {}) =>
  insert('media', { mediaType: type, tmdbId, status, status4k: 1, ...extra });
const matrix = media('movie', 603, 5, { mediaAddedAt: ago(30) });
const fightClub = media('movie', 550, 2);
const got = media('tv', 1399, 3, { tvdbId: 121361 });
const inception = media('movie', 27205, 1);
const interstellar = media('movie', 157336, 2);

// Request status: 1 pending approval, 2 approved, 3 declined.
const request = (mediaId, type, status, by, minutes, modifiedBy = null) =>
  insert('media_request', {
    mediaId,
    type,
    status,
    requestedById: by,
    modifiedById: modifiedBy,
    createdAt: ago(minutes),
    updatedAt: ago(minutes),
  });
request(matrix, 'movie', 2, 2, 600, 1);
const gotRequest = request(got, 'tv', 2, 3, 300, 1);
insert('season_request', { requestId: gotRequest, seasonNumber: 1, status: 2 });
insert('season_request', { requestId: gotRequest, seasonNumber: 2, status: 2 });
request(inception, 'movie', 3, 2, 200, 1);
request(fightClub, 'movie', 1, 3, 20);
request(interstellar, 'movie', 1, 2, 10);

// Issue types: 1 video, 2 audio, 3 subtitles, 4 other. Status 1 open, 2 resolved.
const issue = insert('issue', {
  issueType: 3,
  status: 1,
  mediaId: matrix,
  createdById: 3,
  createdAt: ago(5),
  updatedAt: ago(5),
});
insert('issue_comment', {
  issueId: issue,
  userId: 3,
  message: 'Subtitles are out of sync.',
  createdAt: ago(5),
});

db.close();
console.log('Seeded: 3 users, 5 requests (2 pending), 1 open issue');
