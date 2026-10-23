// -----------------------------------------------------------------------------
// Optional test against a REAL Ombi v4:
//
//   OMBI_URL=http://localhost:3579 OMBI_API_KEY=... npm run test:real
//
// Skipped when OMBI_URL is not set (the CI has no server). Read-only, unless
// OMBI_WRITE=1 with OMBI_USER and OMBI_PASSWORD, a user of the server without
// auto-approval: it then requests a movie and a series as that user, approves
// one, declines the other, marks the movie available and reports an issue —
// on a test server only (scripts/real/README.md, Ombi).
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

process.env.LOG_LEVEL ??= 'silent';

const {
  OMBI_URL: url,
  OMBI_API_KEY: apiKey,
  OMBI_WRITE: write,
  OMBI_USER: user,
  OMBI_PASSWORD: password,
} = process.env;
const skip = !url || !apiKey ? 'OMBI_URL and OMBI_API_KEY not set' : false;
const skipWrite = skip || (write !== '1' || !user || !password ? 'OMBI_WRITE=1 not set' : false);

async function api(path, { method = 'GET', body, token } = {}) {
  const answer = await fetch(`${url}/api/${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : { ApiKey: apiKey }),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.ok(answer.ok, `${method} /${path}: HTTP ${answer.status}`);
  return answer.json();
}

async function start(t, config = {}) {
  const gladys = createFakeGladys({
    config: { ombi_url: url, ombi_api_key: apiKey, language: 'en', ...config },
  });
  const app = registerHandlers(gladys, {
    store: new Store(mkdtempSync(join(tmpdir(), 'gladys-ombi-real-'))),
    timers: false,
  });
  t.after(() => app.stop());
  await gladys.connect();
  await app.ready;
  return { gladys, hub: app.hub };
}

const ids = (gladys) => gladys.externalIds('ombi', '1');
const state = (gladys, key) => gladys.fake.lastState(ids(gladys).feature(key));
const events = (gladys, key) => gladys.fake.sceneEvents.filter((event) => event.key === key);

test('the integration reads a real Ombi', { skip }, async (t) => {
  const { gladys, hub } = await start(t);
  const record = hub.records.get(3);
  assert.equal(record.error, null, JSON.stringify(record.error));
  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.external_id, ids(gladys).device);
  const counts = await api('v1/Request/count');
  assert.equal(state(gladys, 'pending'), counts.pending);
  assert.equal(state(gladys, 'processing'), counts.approved);
  assert.equal(state(gladys, 'available'), counts.available);
  assert.match(state(gladys, 'version'), /^\d+\.\d+/);
  const widget = await gladys.fake.widgetGet('requests', { settings: {}, language: 'en' });
  assert.equal(widget.success, true, widget.error);
  assert.deepEqual(validateWidgetContent(widget.data.content), []);
});

test('a wrong key is told apart', { skip }, async (t) => {
  const { hub } = await start(t, { ombi_api_key: 'wrong' });
  assert.equal(hub.records.get(3).error.kind, 'auth');
});

test(
  'requests, approval, refusal, arrival and issue on a real Ombi',
  { skip: skipWrite },
  async (t) => {
    const { gladys, hub } = await start(t, { allow_approval: true });
    const { access_token: token } = await api('v1/Token', {
      method: 'POST',
      body: { username: user, password },
    });

    // A movie requested by the user: announced, awaiting approval.
    const movie = await api('v1/Request/movie', {
      method: 'POST',
      token,
      body: { theMovieDbId: 157336, languageCode: 'en' },
    });
    assert.equal(movie.isError, false, movie.errorMessage);
    await hub.pollAll();
    const [created] = events(gladys, 'request_created');
    assert.equal(created?.data.title, 'Interstellar');
    assert.equal(created.data.status, 'pending');
    assert.equal(created.data.requested_by.length > 0, true);

    const approved = await gladys.fake.sceneAction('approve_latest_request', {
      media_type: 'movie',
    });
    assert.equal(approved.success, true, approved.error);
    assert.equal(approved.data.outputs.done, true);
    assert.equal(approved.data.outputs.title, 'Interstellar');

    // A series requested by the user, declined from the widget.
    const series = await api('v2/Requests/tv', {
      method: 'POST',
      token,
      body: { theMovieDbId: 1396, firstSeason: true, languageCode: 'en' },
    });
    assert.equal(series.isError, false, series.errorMessage);
    await hub.pollAll({ force: true });
    assert.deepEqual(
      events(gladys, 'request_created').map((event) => event.data.title),
      ['Interstellar', 'Breaking Bad'],
    );
    const widget = await gladys.fake.widgetGet('requests', { settings: {}, language: 'en' });
    assert.deepEqual(validateWidgetContent(widget.data.content), []);
    const decline = widget.data.content.components.find(
      (c) => c.type === 'button' && c.action.key === 'decline',
    );
    assert.ok(decline, 'a decline button for the series');
    const toast = await gladys.fake.widgetAction('requests', 'decline', decline.action.params);
    assert.equal(toast.success, true, toast.error);
    assert.match(toast.data.message.en, /Breaking Bad: declined/);
    const counts = await api('v1/Request/count');
    assert.equal(state(gladys, 'pending'), counts.pending);

    // The movie arrives.
    const list = await api('v2/Requests/movie/10/0/requestedDate/desc');
    const interstellar = list.collection.find((entry) => entry.theMovieDbId === 157336);
    await api('v1/Request/movie/available', { method: 'POST', body: { id: interstellar.id } });
    await hub.pollAll({ force: true });
    assert.deepEqual(
      events(gladys, 'request_available').map((event) => event.data.title),
      ['Interstellar'],
    );

    // An issue reported by the user.
    await api('v1/Issues', {
      method: 'POST',
      token,
      body: {
        title: 'Interstellar',
        requestType: 1,
        providerId: '157336',
        issueCategoryId: 1,
        subject: 'No sound',
        description: 'The sound drops',
      },
    });
    await hub.pollAll({ force: true });
    const [issue] = events(gladys, 'issue_reported');
    assert.equal(issue?.data.title, 'Interstellar');
    assert.equal(issue.data.message, 'No sound: The sound drops');
    assert.ok(issue.data.reported_by);
  },
);
