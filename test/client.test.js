// The client against the real error answers of the three applications.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_KINDS, SeerrClient } from '../src/seerr/client.js';
import { APPS, FakeSeerr, POSTER, fixture } from './helpers/fakeSeerr.js';

const URL = 'http://192.0.2.10:5055';

function client(answer, extra = {}) {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, options });
    if (answer instanceof Error) {
      throw answer;
    }
    return typeof answer === 'function' ? answer(url, options) : answer;
  };
  return { calls, client: new SeerrClient({ url: URL, apiKey: 'secret-key', request, ...extra }) };
}

const json = (status, body, type = 'application/json; charset=utf-8') => ({
  status,
  headers: { 'content-type': type },
  body: JSON.stringify(body),
});

async function kindOf(promise) {
  try {
    await promise;
  } catch (err) {
    return err.kind;
  }
  return 'resolved';
}

test('the API key travels in the X-Api-Key header, never in the URL', async () => {
  const { calls, client: c } = client(json(200, fixture(`${APPS.jellyseerr}/request-count`)));
  await c.requestCount();
  assert.equal(calls[0].url, `${URL}/api/v1/request/count`);
  assert.equal(calls[0].options.headers['X-Api-Key'], 'secret-key');
  assert.ok(!calls[0].url.includes('secret-key'));
});

test('the real error answers map to error kinds', async () => {
  for (const dir of Object.values(APPS)) {
    assert.equal(
      await kindOf(client(json(403, fixture(`${dir}/bad-key`))).client.requestCount()),
      ERROR_KINDS.AUTH,
    );
    assert.equal(
      await kindOf(client(json(401, fixture(`${dir}/no-key`))).client.requestCount()),
      ERROR_KINDS.AUTH,
    );
    assert.equal(
      await kindOf(
        client(json(500, fixture(`${dir}/movie-details-error`))).client.details('movie', 550, 'fr'),
      ),
      ERROR_KINDS.HTTP,
    );
    // An unknown route answers a JSON 404: an API, not this one's route.
    assert.equal(
      await kindOf(client(json(404, fixture(`${dir}/not-found`))).client.requestCount()),
      ERROR_KINDS.HTTP,
    );
  }
  const html = { status: 404, headers: { 'content-type': 'text/html' }, body: '<html>' };
  assert.equal(await kindOf(client(html).client.requestCount()), ERROR_KINDS.NOT_SEERR);
  const login = {
    status: 200,
    headers: { 'content-type': 'text/html' },
    body: '<html>login</html>',
  };
  assert.equal(await kindOf(client(login).client.requestCount()), ERROR_KINDS.NOT_SEERR);
  assert.equal(
    await kindOf(client({ status: 307, headers: {}, body: '' }).client.requestCount()),
    ERROR_KINDS.REDIRECT,
  );
  const refused = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
  assert.equal(await kindOf(client(refused).client.requestCount()), ERROR_KINDS.UNREACHABLE);
  const selfSigned = Object.assign(new Error('self-signed'), {
    code: 'DEPTH_ZERO_SELF_SIGNED_CERT',
  });
  assert.equal(await kindOf(client(selfSigned).client.requestCount()), ERROR_KINDS.TLS);
});

test('a status without version is not this API', async () => {
  assert.equal(
    await kindOf(client(json(200, { ok: true })).client.status()),
    ERROR_KINDS.NOT_SEERR,
  );
  for (const dir of Object.values(APPS)) {
    const status = await client(json(200, fixture(`${dir}/status`))).client.status();
    assert.equal(typeof status.version, 'string');
  }
});

test('the self-signed option reaches the request', async () => {
  const { calls, client: c } = client(json(200, {}), { insecure: true });
  await c.issueCount();
  assert.equal(calls[0].options.insecure, true);
});

test('the poster is read through the image proxy of each application', async () => {
  for (const app of Object.keys(APPS)) {
    const server = new FakeSeerr({ app });
    const c = new SeerrClient({
      url: URL,
      apiKey: 'key-1',
      request: (url, o) => server.handle(url, o),
    });
    assert.deepEqual(await c.poster('/abc.jpg'), POSTER, app);
    // The route that worked is remembered: one request the second time.
    server.posters.length = 0;
    await c.poster('/def.jpg');
    assert.equal(server.posters.length, 1, app);
  }
  const { client: c } = client(json(200, {}));
  assert.equal(await kindOf(c.poster('/../secret.jpg')), ERROR_KINDS.HTTP);
});

test('approve and decline are POST requests on the request', async () => {
  const { calls, client: c } = client(json(200, fixture(`${APPS.overseerr}/approve`)));
  await c.approve(5);
  await c.decline(4);
  assert.deepEqual(
    calls.map((call) => [call.options.method, call.url]),
    [
      ['POST', `${URL}/api/v1/request/5/approve`],
      ['POST', `${URL}/api/v1/request/4/decline`],
    ],
  );
});
