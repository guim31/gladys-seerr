// -----------------------------------------------------------------------------
// Optional test against a REAL Overseerr, Jellyseerr or Seerr server:
//
//   SEERR_URL=http://localhost:5055 SEERR_API_KEY=... npm run test:real
//
// Skipped when SEERR_URL is not set (the CI has no server). Read-only, unless
// SEERR_WRITE=1: then it also reports an issue, approves the newest pending
// request and marks its media available — on a test server only
// (scripts/real/start.sh seeds one in Docker).
//
// The integration runs as in production (real HTTP, real clock) under the
// SDK's fake Gladys.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { httpRequest } from '../../src/seerr/http.js';

process.env.LOG_LEVEL ??= 'silent';

const { SEERR_URL: url, SEERR_API_KEY: apiKey, SEERR_WRITE: write } = process.env;
const skip = !url || !apiKey ? 'SEERR_URL and SEERR_API_KEY not set' : false;

async function api(path, { method = 'GET', body } = {}) {
  const answer = await fetch(`${url}/api/v1/${path}`, {
    method,
    headers: {
      'X-Api-Key': apiKey,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.ok(answer.ok, `${method} /${path}: HTTP ${answer.status}`);
  return answer.json();
}

async function start(t, config = {}) {
  const gladys = createFakeGladys({
    config: { server_1_url: url, server_1_api_key: apiKey, language: 'en', ...config },
  });
  const app = registerHandlers(gladys, {
    store: new Store(mkdtempSync(join(tmpdir(), 'gladys-seerr-real-'))),
    timers: false,
  });
  t.after(() => app.stop());
  await gladys.connect();
  await app.ready;
  return { gladys, hub: app.hub };
}

const state = (gladys, key) => gladys.fake.lastState(gladys.externalIds('seerr', '1').feature(key));

test('the integration reads a real server', { skip }, async (t) => {
  const { gladys } = await start(t);
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
  const [device] = gladys.fake.discoveredDevices;
  assert.ok(device, 'a device is discovered');
  const counts = await api('request/count');
  const issues = await api('issue/count');
  const status = await api('status');
  assert.equal(state(gladys, 'online'), 1);
  assert.equal(state(gladys, 'pending'), counts.pending);
  assert.equal(state(gladys, 'processing'), counts.processing);
  assert.equal(state(gladys, 'available'), counts.available + (counts.completed ?? 0));
  assert.equal(state(gladys, 'total'), counts.total);
  assert.equal(state(gladys, 'issues_open'), issues.open);
  assert.equal(state(gladys, 'version'), status.version);
  assert.equal(state(gladys, 'update_available'), status.updateAvailable ? 1 : 0);

  const report = await gladys.fake.action('test_connection', {});
  assert.equal(report.success, true, report.error);
  assert.match(report.data.message.en, new RegExp(status.version.replace(/\./g, '\\.')));

  const widget = await gladys.fake.widgetGet('requests', { settings: {}, language: 'en' });
  assert.equal(widget.success, true, widget.error);
  assert.deepEqual(validateWidgetContent(widget.data.content), []);
});

test('a wrong API key is reported, not thrown', { skip }, async (t) => {
  const { gladys } = await start(t, { server_1_api_key: 'not-the-key' });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /API key refused/);
});

test('the image proxy answers (when the server reaches TMDB)', { skip }, async () => {
  const answer = await httpRequest(`${url}/imageproxy/tmdb/t/p/w185/abc.jpg`, { binary: true });
  // 200 with TMDB, 500 without; never a 404 (the route exists).
  assert.notEqual(answer.status, 404);
});

test(
  'events and approval on a test server',
  { skip: skip || (write !== '1' && 'SEERR_WRITE=1 not set (writes to the server)') },
  async (t) => {
    const { gladys, hub } = await start(t, { allow_approval: true });
    const [pending] = (await api('request?take=1&skip=0&sort=added&filter=pending')).results;
    assert.ok(pending, 'the test server has a request awaiting approval');

    // An issue reported on its media.
    await api('issue', {
      method: 'POST',
      body: { issueType: 2, message: 'No sound (real test).', mediaId: pending.media.id },
    });
    await hub.pollAll();
    const issue = gladys.fake.sceneEvents.find((event) => event.key === 'issue_reported');
    assert.ok(issue, 'issue_reported fired');
    assert.equal(issue.data.issue_type, 'audio');
    assert.equal(issue.data.message, 'No sound (real test).');

    // The newest pending request approved by the scene action.
    const before = (await api('request/count')).pending;
    const ack = await gladys.fake.sceneAction('approve_latest_request', {});
    assert.equal(ack.success, true, ack.error);
    assert.equal(ack.data.outputs.done, true);
    assert.equal((await api('request/count')).pending, before - 1);
    assert.equal(state(gladys, 'pending'), before - 1);

    // Its media arrives: announced once.
    await api(`media/${pending.media.id}/available`, { method: 'POST', body: {} });
    await hub.pollAll({ force: true });
    await hub.pollAll({ force: true });
    const arrivals = gladys.fake.sceneEvents.filter((event) => event.key === 'request_available');
    assert.deepEqual(
      arrivals.map((event) => event.data.request_id),
      [pending.id],
    );
  },
);
