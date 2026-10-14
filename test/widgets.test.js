// The "requests" widget: content within the vocabulary and budget of the core,
// the approval buttons only when allowed, the posters through the server.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from '../src/hub.js';
import { posterKey } from '../src/widgets.js';
import {
  FakeSeerr,
  ONE,
  SERVER_2_URL,
  SERVER_URL,
  TWO,
  createWorld,
  deviceId,
} from './helpers/world.js';

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

async function content(w, settings = {}, language = 'en') {
  const ack = await w.fake.widgetGet(WIDGET_KEY, { settings, language });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(validateWidgetContent(ack.data.content), [], 'rendered exactly as sent');
  return ack.data.content.components;
}

const ofType = (components, type) => components.filter((component) => component.type === type);

test('tiles, the newest requests with their state, a status row, no button by default', async (t) => {
  const w = await world(t);
  const components = await content(w);
  assert.deepEqual(
    ofType(components, 'value').map((tile) => [tile.label, tile.value]),
    [
      ['To approve', 2],
      ['In progress', 1],
      ['Issues', 1],
    ],
  );
  const [list] = ofType(components, 'card-list');
  assert.deepEqual(
    list.items.map((item) => [item.title, item.subtitle, item.badge.text]),
    [
      ['Interstellar (2014)', 'alice · Movie', 'Pending'],
      ['Fight Club (1999)', 'bob · Movie', 'Pending'],
      ['Inception (2010)', 'alice · Movie', 'Declined'],
      ['Game of Thrones (2011)', 'bob · Series', 'Approved'],
      ['The Matrix (1999)', 'alice · Movie', 'Available'],
    ],
  );
  assert.equal(list.items[0].image, posterKey(1, 'movie', 157336));
  assert.deepEqual(ofType(components, 'status')[0].items, [
    {
      label: 'Jellyseerr 192.0.2.10:5055',
      icon: 'check-circle',
      value: '2.7.3-deprecated',
      color: 'success',
    },
  ]);
  assert.deepEqual(ofType(components, 'button'), []);
});

test('with approving allowed: a caption names the request, two confirmed buttons', async (t) => {
  const w = await world(t, { config: { ...ONE, allow_approval: true, language: 'fr' } });
  const components = await content(w, {}, 'fr');
  assert.equal(components.length, 8, 'the budget of the core');
  assert.equal(ofType(components, 'text')[0].text, 'À approuver : Interstellar (alice)');
  const buttons = ofType(components, 'button');
  assert.deepEqual(
    buttons.map((button) => [button.label, button.style, button.action]),
    [
      [
        'Approuver',
        'secondary',
        { key: 'approve', params: { slot: 1, request_id: 5 }, confirm: true },
      ],
      [
        'Refuser',
        'secondary',
        { key: 'decline', params: { slot: 1, request_id: 5 }, confirm: true },
      ],
    ],
  );
  // A tap approves the request shown, and says so.
  const ack = await w.fake.widgetAction(WIDGET_KEY, 'approve', buttons[0].action.params, {
    settings: {},
  });
  assert.equal(ack.success, true, ack.error);
  assert.equal(ack.data.message.fr, 'Interstellar : approuvée.');
  assert.equal(w.server.requestList.find((request) => request.id === 5).status, 2);
  // The same tap again (an old card): refused, nothing changes.
  const again = await w.fake.widgetAction(WIDGET_KEY, 'decline', buttons[0].action.params, {
    settings: {},
  });
  assert.equal(again.success, false);
  assert.equal(again.error, "Cette demande n'est plus en attente d'approbation.");
  assert.equal(w.server.requestList.find((request) => request.id === 5).status, 2);
  // The next pending one is now the target.
  assert.equal(
    ofType(await content(w, {}, 'fr'), 'text')[0].text,
    'À approuver : Fight Club (bob)',
  );
});

test('a tap refused when approving was turned off meanwhile', async (t) => {
  const w = await world(t);
  const ack = await w.fake.widgetAction(
    WIDGET_KEY,
    'approve',
    { slot: 1, request_id: 5 },
    { settings: {} },
  );
  assert.equal(ack.success, false);
  assert.match(ack.error, /Allow approving and declining/);
});

test('two servers, or the one chosen in the settings', async (t) => {
  const w = await world(t, {
    config: TWO,
    servers: {
      [SERVER_URL]: new FakeSeerr({ apiKey: 'key-1' }),
      [SERVER_2_URL]: new FakeSeerr({ app: 'overseerr', apiKey: 'key-2', urlBase: '/overseerr' }),
    },
  });
  const both = await content(w);
  assert.equal(ofType(both, 'value')[0].value, 4);
  assert.equal(ofType(both, 'status')[0].items.length, 2);
  assert.match(ofType(both, 'card-list')[0].items[0].subtitle, /· (Jellyseerr|Overseerr)$/);
  const one = await content(w, { device: deviceId(w.gladys, 2) });
  assert.equal(ofType(one, 'value')[0].value, 2);
  assert.deepEqual(
    ofType(one, 'status')[0].items.map((item) => item.label),
    ['Overseerr 4K'],
  );
});

test('a server down shows in its row; nothing configured says what to do', async (t) => {
  const w = await world(t);
  w.server.online = false;
  await w.hub.pollAll();
  const components = await content(w);
  assert.deepEqual(ofType(components, 'value'), []);
  assert.deepEqual(ofType(components, 'status')[0].items[0].value, 'Unreachable');
  const empty = await world(t, { config: {} });
  assert.match(ofType(await content(empty), 'text')[0].text, /address and API key/);
  const gone = await content(w, { device: 'ext:test-integration:seerr:9' });
  assert.match(gone[0].text, /no longer in the configuration/);
});

test('an update available shows in the status row', async (t) => {
  const server = new FakeSeerr({ app: 'overseerr', apiKey: 'key-1' });
  server.statusBody = { ...server.statusBody, updateAvailable: true, commitsBehind: 3 };
  const w = await world(t, { servers: { [SERVER_URL]: server } });
  const [row] = ofType(await content(w), 'status')[0].items;
  assert.deepEqual(row, {
    label: 'Overseerr 192.0.2.10:5055',
    icon: 'download',
    value: '1.35.0 · update available',
    color: 'warning',
  });
});

test('the posters come from the image proxy of each application', async (t) => {
  for (const app of ['overseerr', 'jellyseerr', 'seerr']) {
    const server = new FakeSeerr({ app, apiKey: 'key-1' });
    const w = await world(t, { servers: { [SERVER_URL]: server } });
    const ack = await w.fake.widgetGetImage(posterKey(1, 'movie', 603));
    assert.equal(ack.success, true, `${app}: ${ack.error}`);
    assert.ok(ack.data.image.length > 100);
  }
});

test('only the poster keys of the widget, only from a configured server', async (t) => {
  const w = await world(t);
  for (const key of ['../etc/passwd', 'poster-3-movie-603', 'poster-1-person-5']) {
    const ack = await w.fake.widgetGetImage(key);
    assert.equal(ack.success, false, key);
  }
  w.server.tmdbReachable = false;
  const ack = await w.fake.widgetGetImage(posterKey(1, 'movie', 999));
  assert.equal(ack.success, false);
});
