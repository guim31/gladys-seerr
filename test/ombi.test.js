// -----------------------------------------------------------------------------
// Ombi, end to end: an in-memory Ombi (real 4.53.10 answers) under the SDK's
// fake Gladys. Its device, its counters, its scene events (its series request
// ids follow neither each other nor time), its commands, its errors.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';
import { FEATURE_KEYS } from '../src/devices.js';
import { TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import { decodeId, encodeId, movieRequest, tvRequest } from '../src/ombi/client.js';
import { ERROR_KINDS } from '../src/seerr/client.js';
import { STATES, parseRequests } from '../src/seerr/model.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { WIDGETS } from '../src/widgets.js';
import { ombiFixture } from './helpers/fakeOmbi.js';
import {
  FakeOmbi,
  FakeSeerr,
  OMBI,
  OMBI_URL,
  ONE,
  SERVER_URL,
  createClock,
  createWorld,
  deviceId,
  ombiDeviceId,
  ombiFeatureId,
} from './helpers/world.js';

// A few minutes after the requests of the capture.
const clock = () => createClock(Date.parse('2026-10-23T13:15:00Z'));

async function world(t, { config = OMBI, servers, ...options } = {}) {
  const w = await createWorld({
    clock: clock(),
    config,
    servers: servers ?? { [OMBI_URL]: new FakeOmbi() },
    ...options,
  });
  t.after(() => w.app.stop());
  return { ...w, ombi: w.network.servers[OMBI_URL] };
}

const events = (w, key) => w.fake.sceneEvents.filter((event) => event.key === key);
const state = (w, key) => w.fake.lastState(ombiFeatureId(w.gladys, key));
const later = async (w, ms = 60_000) => {
  w.clock.advance(ms);
  await w.hub.pollAll();
};

test('the Ombi section makes a third server, an address with its pages trimmed', () => {
  const config = normalizeConfig({
    ...ONE,
    ombi_url: 'https://example.org/ombi/requests-list',
    ombi_api_key: ' k ',
  });
  assert.deepEqual(config.instances[1], {
    slot: 3,
    app: 'ombi',
    url: 'https://example.org/ombi',
    apiKey: 'k',
    name: null,
  });
  assert.deepEqual(normalizeConfig({ ombi_url: 'x:3579' }).invalidSlots, [3]);
});

test('request ids: movies and series never collide', () => {
  assert.deepEqual(decodeId(encodeId('movie', 7)), { mediaType: 'movie', id: 7 });
  assert.deepEqual(decodeId(encodeId('tv', 7)), { mediaType: 'tv', id: 7 });
  assert.notEqual(encodeId('movie', 1399), encodeId('tv', 1399));
});

test('real answers: the states of the movie and series requests', () => {
  const movies = parseRequests(
    { results: ombiFixture('movies').collection.map((raw) => movieRequest(raw)) },
    true,
  );
  assert.deepEqual(
    movies.map((request) => [request.tmdbId, request.state, request.requestedBy]),
    [
      [27205, STATES.PROCESSING, 'Alice'],
      [550, STATES.PROCESSING, 'Alice'],
      [603, STATES.AVAILABLE, 'Api'],
    ],
  );
  const series = parseRequests(
    { results: ombiFixture('tv').collection.map((raw) => tvRequest(raw)) },
    true,
  );
  assert.deepEqual(
    series.map((request) => [request.id, request.tmdbId, request.state, request.seasons]),
    [
      [encodeId('tv', 89641), 89641, STATES.DECLINED, [1]],
      [encodeId('tv', 1399), 1399, STATES.AVAILABLE, [1]],
    ],
  );
});

test('an Ombi device: its own external id, no failed or update features, real counters', async (t) => {
  const w = await world(t);
  const [device] = w.fake.discoveredDevices;
  assert.equal(device.external_id, ombiDeviceId(w.gladys));
  assert.equal(device.name, 'Ombi 192.0.2.40:3579');
  assert.equal(device.should_poll, false);
  const keys = device.features.map((feature) => feature.external_id.split(':').pop());
  assert.ok(!keys.includes(FEATURE_KEYS.FAILED));
  assert.ok(!keys.includes(FEATURE_KEYS.UPDATE_AVAILABLE));
  assert.equal(state(w, FEATURE_KEYS.ONLINE), 1);
  assert.equal(state(w, FEATURE_KEYS.PENDING), 0);
  assert.equal(state(w, FEATURE_KEYS.PROCESSING), 2);
  assert.equal(state(w, FEATURE_KEYS.AVAILABLE), 2);
  assert.equal(state(w, FEATURE_KEYS.TOTAL), 5);
  assert.equal(state(w, FEATURE_KEYS.ISSUES_OPEN), 1);
  assert.equal(state(w, FEATURE_KEYS.VERSION), '4.53.10');
  // The newest request, its title given by Ombi.
  assert.equal(state(w, FEATURE_KEYS.LAST_REQUEST), 'Love Alarm');
  assert.equal(state(w, FEATURE_KEYS.LAST_REQUESTER), 'Alice');
  assert.equal(w.fake.sceneEvents.length, 0, 'the first reading announces nothing');
  // The key travels in the ApiKey header, never in the URL.
  assert.ok(w.ombi.requests.every((request) => !request.path.includes('ombi-key')));
});

test('an Overseerr next to an Ombi keeps its device and its identity', async (t) => {
  const w = await world(t, {
    config: { ...ONE, ...OMBI },
    servers: { [SERVER_URL]: new FakeSeerr(), [OMBI_URL]: new FakeOmbi() },
  });
  assert.deepEqual(
    w.fake.discoveredDevices.map((device) => device.external_id),
    [deviceId(w.gladys, 1), ombiDeviceId(w.gladys)],
  );
  assert.equal(w.fake.discoveredDevices[0].features.length, 11);
});

test('new requests are told by their date, even a series whose id is lower', async (t) => {
  const w = await world(t);
  w.ombi.addMovie({
    id: 4,
    tmdbId: 157336,
    title: 'Interstellar',
    requestedDate: '2026-10-23T13:16:00Z',
  });
  // Ombi gives a series request the TMDB id of the series: lower than 89641.
  w.ombi.addSeries({ tmdbId: 1396, title: 'Breaking Bad', requestedDate: '2026-10-23T13:16:30Z' });
  await later(w);
  assert.deepEqual(
    events(w, TRIGGERS.REQUEST_CREATED).map(({ data }) => [
      data.title,
      data.media_type,
      data.status,
      data.requested_by,
      data.device,
    ]),
    [
      ['Interstellar', 'movie', 'pending', 'Alice', ombiDeviceId(w.gladys)],
      ['Breaking Bad', 'tv', 'pending', 'Alice', ombiDeviceId(w.gladys)],
    ],
  );
  assert.equal(state(w, FEATURE_KEYS.PENDING), 2);
  await later(w, 11 * 60_000);
  assert.equal(events(w, TRIGGERS.REQUEST_CREATED).length, 2, 'announced once');
});

test('a series announced available once all its episodes arrived', async (t) => {
  const w = await world(t);
  w.ombi.addSeries({
    tmdbId: 1396,
    title: 'Breaking Bad',
    requestedDate: '2026-10-23T13:16:30Z',
    approved: true,
  });
  await later(w);
  w.ombi.arrive(1396, 3);
  await later(w, 11 * 60_000);
  assert.equal(events(w, TRIGGERS.REQUEST_AVAILABLE).length, 0, 'partly there');
  w.ombi.arrive(1396);
  await later(w, 11 * 60_000);
  assert.deepEqual(
    events(w, TRIGGERS.REQUEST_AVAILABLE).map(({ data }) => data.title),
    ['Breaking Bad'],
  );
});

test('an issue reported: its reporter, its category, its subject and description', async (t) => {
  const w = await world(t);
  w.ombi.issueList.push({
    ...structuredClone(w.ombi.issueList[0]),
    id: 2,
    title: 'Game of Thrones',
    requestType: 0,
    providerId: '1399',
    createdDate: '2026-10-23T13:16:00Z',
  });
  await later(w);
  const [event] = events(w, TRIGGERS.ISSUE_REPORTED);
  assert.equal(event.data.title, 'Game of Thrones');
  assert.equal(event.data.media_type, 'tv');
  assert.equal(event.data.issue_type, 'audio');
  assert.equal(event.data.reported_by, 'Alice');
  assert.equal(event.data.message, 'No sound: The sound drops after ten minutes');
  assert.equal(state(w, FEATURE_KEYS.ISSUES_OPEN), 2);
});

test('approve and decline: the routes and JSON bodies of Ombi', async (t) => {
  const w = await world(t, { config: { ...OMBI, allow_approval: true } });
  w.ombi.addMovie({
    id: 4,
    tmdbId: 157336,
    title: 'Interstellar',
    requestedDate: '2026-10-23T13:16:00Z',
  });
  w.ombi.addSeries({ tmdbId: 1396, title: 'Breaking Bad', requestedDate: '2026-10-23T13:16:30Z' });
  await later(w);

  const approved = await SCENE_ACTIONS.approve_latest_request(w.hub, {
    fields: { media_type: 'movie' },
  });
  assert.deepEqual(approved, {
    done: true,
    title: 'Interstellar',
    requested_by: 'Alice',
    media_type: 'Movie',
  });
  assert.deepEqual(
    w.ombi.requests.find((r) => r.method === 'POST'),
    { method: 'POST', path: '/api/v1/Request/movie/approve', body: { id: 4, reason: '' } },
  );
  assert.equal(state(w, FEATURE_KEYS.PROCESSING), 3);

  // The widget shows the series, its button carries the encoded id.
  const content = await WIDGETS[WIDGET_KEY].get(w.hub, { language: 'en' });
  const button = content.components.find((c) => c.type === 'button' && c.action.key === 'decline');
  assert.equal(button.action.params.request_id, encodeId('tv', 1396));
  const toast = await WIDGETS[WIDGET_KEY].action(w.hub, {
    actionKey: 'decline',
    params: button.action.params,
  });
  assert.equal(toast.en, 'Breaking Bad: declined.');
  assert.deepEqual(
    w.ombi.requests.find((r) => r.method === 'PUT'),
    {
      method: 'PUT',
      path: '/api/v1/Request/tv/deny',
      body: { id: 1396, reason: '' },
    },
  );
  assert.equal(state(w, FEATURE_KEYS.PENDING), 0);
});

test('a command Ombi refuses (HTTP 200, isError) fails', async (t) => {
  const w = await world(t, { config: { ...OMBI, allow_approval: true } });
  const record = w.hub.records.get(3);
  await assert.rejects(record.client.approve(encodeId('movie', 999)), (err) => {
    assert.equal(err.kind, ERROR_KINDS.HTTP);
    assert.equal(err.status, 404);
    return true;
  });
});

test('wrong key, wrong address: the errors say so', async (t) => {
  const w = await world(t, { config: { ...OMBI, ombi_api_key: 'wrong' } });
  assert.equal(w.hub.records.get(3).error.kind, ERROR_KINDS.AUTH);
  assert.equal(state(w, FEATURE_KEYS.ONLINE), 0);

  const web = new FakeOmbi();
  web.handle = () => ({ status: 200, headers: { 'content-type': 'text/html' }, body: '<html>' });
  const w2 = await world(t, { servers: { [OMBI_URL]: web } });
  assert.equal(w2.hub.records.get(3).error.kind, ERROR_KINDS.NOT_OMBI);
  const report = await w2.hub.testConnection();
  assert.match(report.en, /no Ombi API at this address/);
});

test('the application name of Ombi names its device', async (t) => {
  const w = await world(t);
  w.ombi.applicationName = 'Family requests';
  await later(w, 61 * 60_000);
  assert.equal(w.fake.discoveredDevices.at(-1).name, 'Family requests 192.0.2.40:3579');
});
