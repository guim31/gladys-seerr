// The parsers, on real answers of Overseerr 1.35.0, Jellyseerr 2.7.3 and
// Seerr 3.5.0, and on those published with python-overseerr.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATES,
  parseCounts,
  parseDetails,
  parseIssue,
  parseIssues,
  parseRequests,
  parseStatus,
  requestState,
  seasonsAvailable,
  userName,
} from '../src/seerr/model.js';
import { APPS, fixture } from './helpers/fakeSeerr.js';

test('the status gives the version and the update flag', () => {
  for (const dir of Object.values(APPS)) {
    const status = parseStatus(fixture(`${dir}/status`));
    assert.equal(typeof status.version, 'string');
    assert.equal(status.updateAvailable, false);
  }
  assert.deepEqual(parseStatus({ version: '1.33.2', updateAvailable: true }), {
    version: '1.33.2',
    updateAvailable: true,
  });
  assert.deepEqual(parseStatus(null), { version: null, updateAvailable: false });
});

test('the counts are the same on the three applications, Seerr completed ones included', () => {
  for (const dir of Object.values(APPS)) {
    const counts = parseCounts(fixture(`${dir}/request-count`), fixture(`${dir}/issue-count`), 0);
    assert.deepEqual(
      counts,
      { total: 5, pending: 2, processing: 1, available: 1, declined: 1, failed: 0, issuesOpen: 1 },
      dir,
    );
  }
  // A real Seerr whose available requests were closed (completed).
  const seerr = parseCounts(fixture('python-overseerr/seerr-request-count'), null, null);
  assert.equal(seerr.available, 8 + 5);
  assert.equal(seerr.issuesOpen, null);
  assert.equal(seerr.failed, null);
});

test('the requests of every application parse, newest first, with their state', () => {
  for (const dir of Object.values(APPS)) {
    const requests = parseRequests(fixture(`${dir}/requests`));
    assert.deepEqual(
      requests.map((request) => [
        request.id,
        request.mediaType,
        request.state,
        request.requestedBy,
      ]),
      [
        [5, 'movie', STATES.PENDING, 'alice'],
        [4, 'movie', STATES.PENDING, 'bob'],
        [3, 'movie', STATES.DECLINED, 'alice'],
        [2, 'tv', STATES.PROCESSING, 'bob'],
        [1, 'movie', STATES.AVAILABLE, 'alice'],
      ],
      dir,
    );
    assert.deepEqual(requests[3].seasons, [1, 2]);
  }
});

test('the requests published with python-overseerr parse too', () => {
  const overseerr = parseRequests(fixture('python-overseerr/overseerr-requests'));
  assert.equal(overseerr.length, 10);
  // A series partly in the library.
  assert.equal(overseerr.find((request) => request.id === 14).state, STATES.PARTIAL);
  const seerr = parseRequests(fixture('python-overseerr/seerr-requests'));
  // Seerr closes the requests whose media arrived (status 5).
  assert.equal(seerr.find((request) => request.id === 60).state, STATES.AVAILABLE);
  for (const request of [...overseerr, ...seerr]) {
    assert.ok(request.requestedBy && !request.requestedBy.includes('@'), request.requestedBy);
  }
});

test('the state follows the 4K status of the media for a 4K request', () => {
  const [request] = parseRequests({
    results: [
      {
        id: 9,
        status: 2,
        is4k: true,
        type: 'movie',
        media: { tmdbId: 1, mediaType: 'movie', status: 5, status4k: 3 },
      },
    ],
  });
  assert.equal(request.state, STATES.PROCESSING);
  assert.equal(requestState(5, 7), STATES.COMPLETED);
  assert.equal(requestState(4, 2), STATES.FAILED);
});

test('a user is named by its display name, never by an email address', () => {
  assert.equal(userName({ displayName: 'alice' }), 'alice');
  assert.equal(userName({ displayName: 'someone@example.org' }), 'someone');
  assert.equal(userName({ email: 'bob@example.org' }), 'bob');
  assert.equal(userName(null), null);
});

test('a series is available once every season it asked for is', () => {
  const raw = fixture(`${APPS.jellyseerr}/request-tv`);
  assert.equal(seasonsAvailable(raw), false);
  raw.media.status = 4;
  raw.media.seasons = [
    { seasonNumber: 1, status: 5, status4k: 1 },
    { seasonNumber: 2, status: 3, status4k: 1 },
  ];
  assert.equal(seasonsAvailable(raw), false);
  raw.media.seasons[1].status = 5;
  assert.equal(seasonsAvailable(raw), true);
  raw.media.seasons = [];
  raw.media.status = 5;
  assert.equal(seasonsAvailable(raw), true);
});

test('the issues parse, with the message when the list carries it (Seerr)', () => {
  const seerr = parseIssues(fixture(`${APPS.seerr}/issues`));
  assert.deepEqual(seerr[0], {
    id: 1,
    tmdbId: 603,
    mediaType: 'movie',
    type: 'subtitles',
    open: true,
    reportedBy: 'bob',
    message: 'Subtitles are out of sync.',
    season: 0,
    episode: 0,
    createdAt: seerr[0].createdAt,
  });
  // Overseerr and Jellyseerr leave the comments out of the list: read later.
  assert.equal(parseIssues(fixture(`${APPS.overseerr}/issues`))[0].message, undefined);
  assert.equal(
    parseIssue(fixture(`${APPS.jellyseerr}/issue-single`)).message,
    'Subtitles are out of sync.',
  );
  assert.equal(parseIssues(fixture('python-overseerr/overseerr-issues')).length, 4);
});

test('the details give a title, a year and a poster path', () => {
  assert.deepEqual(parseDetails(fixture('python-overseerr/movie')), {
    title: 'Greenland 2',
    year: 2026,
    posterPath: '/3X744jehJwD7NTGBT91xdmz2aQj.jpg',
  });
  assert.deepEqual(parseDetails(fixture('python-overseerr/tv')), {
    title: 'Love Alarm',
    year: 2019,
    posterPath: '/uJjJOxWNqP8diFrZmpXrhdciC4f.jpg',
  });
  assert.deepEqual(parseDetails(fixture(`${APPS.seerr}/movie-details-error`)), {
    title: null,
    year: null,
    posterPath: null,
  });
  assert.equal(parseDetails({ title: 'x', posterPath: '/../../etc/passwd' }).posterPath, null);
});
