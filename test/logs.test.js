// -----------------------------------------------------------------------------
// What the integration writes at the default level (info): the lifecycle
// only. A normal reading writes nothing, a failure that repeats is logged
// once, and its end once. Never an API key, never an address with
// credentials.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeSeerr, ONE, SERVER_URL, createWorld } from './helpers/world.js';

/** Capture the lines of the SDK logger at the given level. */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record =
    (stream) =>
    (...args) =>
      lines.push({
        stream,
        text: args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '),
      });
  t.mock.method(console, 'log', record('out'));
  t.mock.method(console, 'error', record('err'));
  t.mock.method(console, 'warn', record('err'));
  return {
    lines,
    clear: () => lines.splice(0),
    texts: () => lines.map((line) => line.text),
  };
}

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const SECRET = 'a-very-secret-api-key-0042';
const config = { ...ONE, server_1_api_key: SECRET, allow_approval: true };
const servers = () => ({ [SERVER_URL]: new FakeSeerr({ apiKey: SECRET }) });

test('a normal reading cycle writes nothing at info, events and arrivals included', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t, { config, servers: servers() });
  assert.ok(
    logs.texts().some((text) => text.includes('connected')),
    'the start is logged',
  );
  logs.clear();
  for (let i = 0; i < 5; i += 1) {
    const request = w.server.addRequest({ tmdbId: 2000 + i, createdAt: w.clock.iso() });
    w.clock.advance(60 * 60_000); // the status is read again too
    await w.hub.pollAll();
    request.status = 2;
    w.server.setMedia(request, 5);
    await w.hub.pollAll();
  }
  assert.ok(w.fake.sceneEvents.length >= 10);
  assert.deepEqual(logs.texts(), []);
});

test('a server that stays down is logged once, and once when it is back', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t, { config, servers: servers() });
  logs.clear();
  w.server.online = false;
  for (let i = 0; i < 6; i += 1) {
    w.clock.advance(60_000);
    await w.hub.pollAll();
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.equal(logs.lines[0].stream, 'err');
  logs.clear();
  w.server.online = true;
  await w.hub.pollAll();
  await w.hub.pollAll();
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /connection restored/);
});

test('a refused API key is logged once, never the key', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t, {
    config: { ...ONE, server_1_api_key: 'wrong-key-42' },
    servers: servers(),
  });
  for (let i = 0; i < 5; i += 1) {
    await w.hub.pollAll();
  }
  const warnings = logs.lines.filter((line) => line.stream === 'err');
  assert.equal(warnings.length, 1, logs.texts().join('\n'));
  assert.match(warnings[0].text, /API key refused/);
  assert.ok(!logs.texts().join('\n').includes('wrong-key-42'), 'never the key');
});

test('TMDB unreachable from the server: one warning, one line when it is back', async (t) => {
  const logs = captureLogs(t);
  const server = new FakeSeerr({ apiKey: SECRET });
  server.tmdbReachable = false;
  const w = await world(t, {
    config,
    servers: { [SERVER_URL]: server },
    timings: { detailsRetryMs: 1 },
  });
  for (let i = 0; i < 3; i += 1) {
    w.server.addRequest({ tmdbId: 3000 + i, createdAt: w.clock.iso() });
    w.clock.advance(60_000);
    await w.hub.pollAll();
  }
  const warnings = logs.lines.filter((line) => line.stream === 'err');
  assert.equal(warnings.length, 1, logs.texts().join('\n'));
  assert.match(warnings[0].text, /can the server reach TMDB/);
  logs.clear();
  server.tmdbReachable = true;
  w.server.addRequest({ tmdbId: 4000, createdAt: w.clock.iso() });
  await w.hub.pollAll();
  assert.deepEqual(logs.texts().filter((text) => /titles read again/.test(text)).length, 1);
});

test('Gladys refusing the states is logged once', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t, { config, servers: servers() });
  logs.clear();
  t.mock.method(w.gladys, 'publishChangedStates', async () => {
    throw new Error('HTTP 500');
  });
  for (let i = 0; i < 4; i += 1) {
    w.server.addRequest({ createdAt: w.clock.iso() });
    await w.hub.pollAll();
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /States of .* refused/);
});

test('one info line per action of the user, never the key', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t, { config, servers: servers() });
  logs.clear();
  await w.fake.sceneAction('approve_latest_request', {});
  assert.deepEqual(logs.texts().length, 1, logs.texts().join('\n'));
  assert.match(logs.texts()[0], /request 5 approved from Gladys/);
});

test('LOG_LEVEL=debug shows each reading problem; never the API key', async (t) => {
  const logs = captureLogs(t, 'debug');
  const w = await world(t, { config, servers: servers() });
  w.server.online = false;
  await w.hub.pollAll();
  await w.hub.pollAll();
  const text = logs.texts().join('\n');
  assert.match(text, /\[DEBUG\].*again/);
  assert.ok(!text.includes(SECRET), 'never the API key');
});
