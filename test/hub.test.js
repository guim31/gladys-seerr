// -----------------------------------------------------------------------------
// The hub, end to end: fake servers (real answers) under the SDK's fake
// Gladys. Readings, scene events, persistence across restarts, the reading
// cost, the refresh timer, the commands.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FEATURE_KEYS } from '../src/devices.js';
import { HUB_TIMINGS, TRIGGERS } from '../src/hub.js';
import {
  FakeSeerr,
  ONE,
  SERVER_2_URL,
  SERVER_URL,
  TWO,
  createWorld,
  deviceId,
  featureId,
} from './helpers/world.js';

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const events = (w, key) => w.fake.sceneEvents.filter((event) => event.key === key);
const state = (w, key, slot = 1) => w.fake.lastState(featureId(w.gladys, key, slot));
const later = async (w, ms = 60_000) => {
  w.clock.advance(ms);
  await w.hub.pollAll();
};

test('the first reading publishes the device and its states, and announces nothing', async (t) => {
  const w = await world(t);
  const [device] = w.fake.discoveredDevices;
  assert.equal(device.name, 'Jellyseerr 192.0.2.10:5055');
  assert.equal(device.should_poll, false);
  assert.equal(device.poll_frequency, undefined);
  assert.deepEqual(
    Object.fromEntries(Object.values(FEATURE_KEYS).map((key) => [key, state(w, key)])),
    {
      online: 1,
      pending: 2,
      processing: 1,
      available: 1,
      failed: 0,
      total: 5,
      issues_open: 1,
      last_request: 'Interstellar',
      last_requester: 'alice',
      version: '2.7.3-deprecated',
      update_available: 0,
    },
  );
  assert.deepEqual(w.fake.sceneEvents, []);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  assert.deepEqual(w.fake.transports.at(-1), {
    device_external_id: deviceId(w.gladys),
    transport: 'local',
  });
});

test('the name typed in the configuration wins over the application title', async (t) => {
  const w = await world(t, { config: { ...ONE, server_1_name: 'Requests' } });
  assert.equal(w.fake.discoveredDevices[0].name, 'Requests');
});

test('a new request is announced once, with its title, author and status', async (t) => {
  const w = await world(t);
  w.server.addRequest({ tmdbId: 550, by: 'bob', createdAt: w.clock.iso() });
  w.server.addRequest({
    type: 'tv',
    tmdbId: 1399,
    status: 2,
    mediaStatus: 3,
    seasons: [1, 2],
    is4k: true,
    createdAt: w.clock.iso(),
  });
  await later(w);
  await later(w);
  assert.deepEqual(
    events(w, TRIGGERS.REQUEST_CREATED).map((event) => event.data),
    [
      {
        device: deviceId(w.gladys),
        instance: 'Jellyseerr 192.0.2.10:5055',
        title: 'Fight Club',
        media_type: 'movie',
        media_label: 'Movie',
        requested_by: 'bob',
        status: 'pending',
        seasons: '',
        is_4k: false,
        request_id: 6,
      },
      {
        device: deviceId(w.gladys),
        instance: 'Jellyseerr 192.0.2.10:5055',
        title: 'Game of Thrones',
        media_type: 'tv',
        media_label: 'Series',
        requested_by: 'alice',
        status: 'approved',
        seasons: '1, 2',
        is_4k: true,
        request_id: 7,
      },
    ],
  );
  assert.equal(state(w, FEATURE_KEYS.LAST_REQUEST), 'Game of Thrones');
  assert.equal(state(w, FEATURE_KEYS.TOTAL), 7);
});

test('a movie arriving in the library is announced once, to who asked for it', async (t) => {
  const w = await world(t);
  const fightClub = w.server.requestList.find((request) => request.id === 4);
  fightClub.status = 2;
  await later(w);
  w.server.setMedia(fightClub, 5);
  await later(w);
  await later(w);
  const arrivals = events(w, TRIGGERS.REQUEST_AVAILABLE);
  assert.equal(arrivals.length, 1);
  assert.deepEqual(arrivals[0].data, {
    device: deviceId(w.gladys),
    instance: 'Jellyseerr 192.0.2.10:5055',
    title: 'Fight Club',
    media_type: 'movie',
    media_label: 'Movie',
    requested_by: 'bob',
    is_4k: false,
    request_id: 4,
  });
  assert.equal(state(w, FEATURE_KEYS.AVAILABLE), 2);
});

test('Seerr: a request closed (completed) once its media arrived is announced', async (t) => {
  const server = new FakeSeerr({ app: 'seerr', apiKey: 'key-1' });
  const w = await world(t, { servers: { [SERVER_URL]: server } });
  const request = server.addRequest({ status: 2, mediaStatus: 3, createdAt: w.clock.iso() });
  await later(w);
  server.setMedia(request, 5);
  assert.equal(request.status, 5);
  await later(w);
  assert.equal(events(w, TRIGGERS.REQUEST_AVAILABLE).length, 1);
  assert.equal(state(w, FEATURE_KEYS.AVAILABLE), 2);
});

test('a series is announced when every season it asked for is in the library', async (t) => {
  const w = await world(t, { timings: { listMaxAgeMs: 60_000 } });
  const got = w.server.requestList.find((request) => request.type === 'tv');
  // Season 1 arrives: the series is partly available, the request is not.
  w.server.setMedia(got, 4);
  w.server.setSeasons(got, { 1: 5, 2: 3 });
  await later(w);
  assert.equal(events(w, TRIGGERS.REQUEST_AVAILABLE).length, 0);
  // Nothing moved: /request/:id is not read again.
  const reads = () => w.server.requests.filter((r) => r.path === `/api/v1/request/${got.id}`);
  const before = reads().length;
  await later(w);
  assert.equal(reads().length, before);
  // Season 2 arrives; the media stays partly available (the series has more).
  w.server.setSeasons(got, { 1: 5, 2: 5 }, new Date(w.clock.now()).toISOString());
  await later(w);
  assert.deepEqual(
    events(w, TRIGGERS.REQUEST_AVAILABLE).map((event) => [
      event.data.title,
      event.data.requested_by,
    ]),
    [['Game of Thrones', 'bob']],
  );
});

test('a declined or failed request is followed no more', async (t) => {
  const w = await world(t);
  const fightClub = w.server.requestList.find((request) => request.id === 4);
  fightClub.status = 3;
  await later(w);
  fightClub.status = 2;
  w.server.setMedia(fightClub, 5);
  await later(w);
  assert.deepEqual(events(w, TRIGGERS.REQUEST_AVAILABLE), []);
  await w.hub.store.flush();
  const saved = JSON.parse(await readFile(join(w.dataDir, 'seerr-state.json'), 'utf8'));
  assert.deepEqual(saved.servers[1].watch, [2, 5]);
});

test('a restart announces nothing twice, and nothing it already knew', async (t) => {
  const first = await createWorld();
  first.server.addRequest({ tmdbId: 550, createdAt: first.clock.iso() });
  await later(first);
  assert.equal(events(first, TRIGGERS.REQUEST_CREATED).length, 1);
  await first.app.stop();

  // Same /data, same server; an arrival happened while the container was down.
  const pending = first.server.requestList.find((request) => request.id === 5);
  pending.status = 2;
  first.server.setMedia(pending, 5);
  const second = await world(t, {
    dataDir: first.dataDir,
    servers: { [SERVER_URL]: first.server },
    clock: first.clock,
  });
  assert.deepEqual(events(second, TRIGGERS.REQUEST_CREATED), []);
  assert.deepEqual(
    events(second, TRIGGERS.REQUEST_AVAILABLE).map((event) => event.data.title),
    ['Interstellar'],
  );
});

test('a request made long before the reading is not announced as new', async (t) => {
  const w = await world(t);
  w.server.addRequest({ createdAt: new Date(w.clock.now() - 3 * 60 * 60_000).toISOString() });
  await later(w);
  assert.deepEqual(events(w, TRIGGERS.REQUEST_CREATED), []);
});

test('at most ten events of a kind per reading, the newest ones', async (t) => {
  const w = await world(t);
  for (let i = 0; i < 14; i += 1) {
    w.server.addRequest({ tmdbId: 1000 + i, createdAt: w.clock.iso() });
  }
  await later(w);
  const created = events(w, TRIGGERS.REQUEST_CREATED);
  assert.equal(created.length, HUB_TIMINGS.maxEventsPerRead);
  assert.equal(created.at(-1).data.request_id, 19);
});

test('a new issue is announced with its kind, author and message', async (t) => {
  for (const app of ['jellyseerr', 'seerr', 'overseerr']) {
    const server = new FakeSeerr({ app, apiKey: 'key-1' });
    const w = await world(t, {
      servers: { [SERVER_URL]: server },
      config: { ...ONE, language: 'fr' },
    });
    const got = server.requestList.find((request) => request.type === 'tv');
    server.addIssue({
      request: got,
      issueType: 2,
      season: 1,
      episode: 3,
      createdAt: w.clock.iso(),
    });
    await later(w);
    assert.deepEqual(
      events(w, TRIGGERS.ISSUE_REPORTED).map((event) => event.data),
      [
        {
          device: deviceId(w.gladys),
          instance: `${server.settings.applicationTitle} 192.0.2.10:5055`,
          title: 'Le Trône de fer',
          media_type: 'tv',
          media_label: 'Série',
          issue_type: 'audio',
          issue_label: 'Audio',
          reported_by: 'bob',
          message: 'No sound after 10 minutes.',
          season: 1,
          episode: 3,
          issue_id: 2,
        },
      ],
      app,
    );
    assert.equal(state(w, FEATURE_KEYS.ISSUES_OPEN), 2);
  }
});

test('a quiet reading costs two small requests: the lists wait for a change', async (t) => {
  const w = await world(t);
  const paths = () => w.server.requests.map((request) => request.path);
  w.server.requests.length = 0;
  await later(w);
  assert.deepEqual(paths().sort(), ['/api/v1/issue/count', '/api/v1/request/count']);
  // The counts move: the list is read again.
  w.server.addRequest({ createdAt: w.clock.iso() });
  w.server.requests.length = 0;
  await later(w);
  assert.ok(paths().includes('/api/v1/request'));
  // Nothing moves for 10 minutes: the list is read anyway.
  w.server.requests.length = 0;
  await later(w, HUB_TIMINGS.listMaxAgeMs);
  assert.ok(paths().includes('/api/v1/request') && paths().includes('/api/v1/issue'));
  // The version: hourly.
  assert.ok(!paths().includes('/api/v1/status'));
  w.server.requests.length = 0;
  await later(w, HUB_TIMINGS.statusMs);
  assert.ok(paths().includes('/api/v1/status'));
});

test('the states refresh on the timer of the container, without onPoll', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => t.mock.timers.reset());
  const w = await world(t, { timers: true, config: { ...ONE, poll_interval: '30' } });
  const fromGladys = t.mock.method(w.hub, 'pollDevice');
  w.server.addRequest({ createdAt: w.clock.iso() });
  w.clock.advance(30_000);
  t.mock.timers.tick(30_000);
  // Let the reading started by the timer finish.
  for (let i = 0; i < 100 && state(w, FEATURE_KEYS.TOTAL) !== 6; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(state(w, FEATURE_KEYS.PENDING), 3);
  assert.equal(state(w, FEATURE_KEYS.TOTAL), 6);
  assert.equal(fromGladys.mock.callCount(), 0, 'no poll came from Gladys');
});

test('onPoll is a fallback: skipped when the timer just read the server', async (t) => {
  const w = await world(t);
  const [device] = w.fake.discoveredDevices;
  w.server.requests.length = 0;
  assert.deepEqual(await w.fake.poll(device), { success: true });
  assert.equal(w.server.requests.length, 0);
  w.clock.advance(60_000);
  await w.fake.poll(device);
  assert.ok(w.server.requests.length > 0);
});

test('only the changed values are sent, and every value again after 12 hours', async (t) => {
  // The SDK dates its heartbeat with Date.now(): the clock of this world is Date.
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-14T19:30:00Z') });
  t.after(() => t.mock.timers.reset());
  const clock = {
    now: () => Date.now(),
    iso: () => new Date().toISOString(),
    advance: (ms) => t.mock.timers.tick(ms),
  };
  const w = await world(t, { clock });
  const sent = () => w.fake.states.length;
  const before = sent();
  await later(w);
  assert.equal(sent(), before);
  w.server.addRequest({ createdAt: w.clock.iso() });
  await later(w);
  const changed = w.fake.states.slice(before).map((s) => s.device_feature_external_id);
  assert.deepEqual(changed.sort(), [
    featureId(w.gladys, 'last_request'),
    featureId(w.gladys, 'pending'),
    featureId(w.gladys, 'total'),
  ]);
  const after = sent();
  await later(w, HUB_TIMINGS.heartbeatMs);
  assert.equal(sent() - after, 11, 'every feature once more');
});

test('a device added in Gladys gets every state again, and the widget a refresh', async (t) => {
  const w = await world(t);
  const [device] = w.fake.discoveredDevices;
  const before = w.fake.states.length;
  const refreshes = w.fake.widgetRefreshes.length;
  await w.fake.deviceCreated(device);
  assert.equal(w.fake.states.length - before, 11);
  assert.equal(w.fake.widgetRefreshes.length, refreshes + 1);
});

test('a server down: offline, unreachable, its counts not republished as fresh', async (t) => {
  const w = await world(t);
  w.server.online = false;
  const before = w.fake.states.length;
  await later(w);
  assert.deepEqual(
    w.fake.states.slice(before).map((s) => [s.device_feature_external_id, s.state]),
    [[featureId(w.gladys, 'online'), 0]],
  );
  assert.equal(w.fake.transports.at(-1).transport, 'unreachable');
  assert.deepEqual(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.fr, /ne répond pas/);
  await later(w, HUB_TIMINGS.heartbeatMs);
  assert.equal(w.fake.states.length - before, 1);
  w.server.online = true;
  await later(w);
  assert.equal(state(w, FEATURE_KEYS.ONLINE), 1);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('a wrong key is reported under the integration, in every language', async (t) => {
  const w = await world(t, { config: { ...ONE, server_1_api_key: 'wrong' } });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.deepEqual(w.fake.connectionStatus.message, {
    en: 'Overseerr 192.0.2.10:5055: API key refused',
    fr: "Overseerr 192.0.2.10:5055 : clé d'API refusée",
    de: 'Overseerr 192.0.2.10:5055: API-Schlüssel abgelehnt',
    es: 'Overseerr 192.0.2.10:5055: clave de API rechazada',
  });
});

test('no server configured: the status says what to fill', async (t) => {
  const w = await world(t, { config: {} });
  assert.deepEqual(w.fake.discoveredDevices, []);
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /address and API key/);
});

test('TMDB unreachable from the server: "Movie #id", and the reading goes on', async (t) => {
  const server = new FakeSeerr({ apiKey: 'key-1' });
  server.tmdbReachable = false;
  const w = await world(t, { servers: { [SERVER_URL]: server } });
  assert.equal(state(w, FEATURE_KEYS.LAST_REQUEST), 'Movie #157336');
  assert.equal(state(w, FEATURE_KEYS.PENDING), 2);
  // Tried again later, not at every reading.
  const details = () => server.requests.filter((r) => r.path.startsWith('/api/v1/movie/')).length;
  const before = details();
  server.addRequest({ tmdbId: 840464, createdAt: w.clock.iso() });
  await later(w);
  assert.equal(details(), before + 1, 'only the new movie');
  assert.equal(state(w, FEATURE_KEYS.LAST_REQUEST), 'Movie #840464');
  server.tmdbReachable = true;
  await later(w, HUB_TIMINGS.detailsRetryMs);
  assert.equal(state(w, FEATURE_KEYS.LAST_REQUEST), 'Greenland 2');
});

test('the titles follow the language of the configuration', async (t) => {
  const w = await world(t, { config: { ...ONE, language: 'fr' } });
  assert.equal(w.fake.discoveredDevices[0].features[1].name, "Demandes en attente d'approbation");
  const matrix = w.hub.records.get(1).snapshot.requests.find((r) => r.tmdbId === 603);
  assert.equal(matrix.title, 'Matrix');
  await w.fake.configUpdated({ ...ONE, language: 'en' });
  const again = w.hub.records.get(1).snapshot.requests.find((r) => r.tmdbId === 603);
  assert.equal(again.title, 'The Matrix');
});

test('two servers, one of them behind a reverse proxy', async (t) => {
  const four = new FakeSeerr({ app: 'overseerr', apiKey: 'key-2', urlBase: '/overseerr' });
  const w = await world(t, {
    config: TWO,
    servers: { [SERVER_URL]: new FakeSeerr({ apiKey: 'key-1' }), [SERVER_2_URL]: four },
  });
  assert.deepEqual(
    w.fake.discoveredDevices.map((device) => device.name),
    ['Jellyseerr 192.0.2.10:5055', 'Overseerr 4K'],
  );
  assert.equal(state(w, FEATURE_KEYS.VERSION, 2), '1.35.0');
  four.addRequest({ createdAt: w.clock.iso() });
  await later(w);
  assert.deepEqual(
    events(w, TRIGGERS.REQUEST_CREATED).map((event) => event.data.device),
    [deviceId(w.gladys, 2)],
  );
});

test('Gladys restarted: everything is sent again', async (t) => {
  const w = await world(t);
  const before = w.fake.states.length;
  await w.gladys.disconnect();
  await w.gladys.connect();
  assert.equal(w.fake.states.length - before, 11);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('"Test the connection" reads every server and reports in four languages', async (t) => {
  const w = await world(t);
  const ack = await w.fake.action('test_connection', {});
  assert.equal(ack.success, true);
  assert.equal(
    ack.data.message.en,
    'Jellyseerr 192.0.2.10:5055: Jellyseerr 2.7.3-deprecated, 2 awaiting approval, 1 in progress, 1 open issue(s)',
  );
  assert.deepEqual(Object.keys(ack.data.message), ['en', 'fr', 'de', 'es']);
});

// --- Approving and declining ------------------------------------------------------

test('approving is off by default: the scene action says where to turn it on', async (t) => {
  const w = await world(t, { config: { ...ONE, language: 'fr' } });
  const ack = await w.fake.sceneAction('approve_latest_request', {});
  assert.equal(ack.success, false);
  assert.match(ack.error, /Autoriser l'approbation et le refus/);
  assert.equal(w.server.requestList.find((request) => request.id === 5).status, 1);
});

test('the scene actions approve or decline the newest pending request', async (t) => {
  const w = await world(t, { config: { ...ONE, allow_approval: true } });
  let ack = await w.fake.sceneAction('approve_latest_request', { device: deviceId(w.gladys) });
  assert.deepEqual(ack.data.outputs, {
    done: true,
    title: 'Interstellar',
    requested_by: 'alice',
    media_type: 'Movie',
  });
  assert.equal(w.server.requestList.find((request) => request.id === 5).status, 2);
  ack = await w.fake.sceneAction('decline_latest_request', {});
  assert.equal(ack.data.outputs.title, 'Fight Club');
  assert.equal(w.server.requestList.find((request) => request.id === 4).status, 3);
  // Nothing left: not an error, the output says so.
  ack = await w.fake.sceneAction('approve_latest_request', {});
  assert.deepEqual(ack.data.outputs, { done: false, title: '', requested_by: '', media_type: '' });
  // The counters follow at once, and no scene event comes back (no loop).
  assert.equal(state(w, FEATURE_KEYS.PENDING), 0);
  assert.deepEqual(w.fake.sceneEvents, []);
});

test('the scene actions can target series or movies only', async (t) => {
  const w = await world(t, { config: { ...ONE, allow_approval: true } });
  w.server.addRequest({ type: 'tv', tmdbId: 89641, seasons: [1], createdAt: w.clock.iso() });
  w.server.addRequest({ tmdbId: 840464, createdAt: w.clock.iso() });
  const ack = await w.fake.sceneAction('approve_latest_request', { media_type: 'tv' });
  assert.equal(ack.data.outputs.title, 'Love Alarm');
  assert.equal(ack.data.outputs.media_type, 'Series');
});

test('a scene action on a server that does not answer fails with the reason', async (t) => {
  const w = await world(t, { config: { ...ONE, allow_approval: true } });
  w.server.online = false;
  const ack = await w.fake.sceneAction('approve_latest_request', { device: deviceId(w.gladys) });
  assert.equal(ack.success, false);
  assert.equal(
    ack.error,
    'Overseerr 192.0.2.10:5055: does not answer'.replace('Overseerr', 'Jellyseerr'),
  );
});
