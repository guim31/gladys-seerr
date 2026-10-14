// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures (answers of real Overseerr 1.35.0, Jellyseerr 2.7.3 and Seerr 3.5.0
// servers): one or two servers, one that does not answer, one whose server
// cannot reach TMDB, in every feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// (Adapted from guim31/gladys-wled.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FakeSeerr, ONE, SERVER_2_URL, SERVER_URL, TWO, createWorld } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const OFFLINE_URL = 'http://192.0.2.30:5055';

const scenarios = [
  {
    label: 'one Jellyseerr',
    config: ONE,
    servers: () => ({ [SERVER_URL]: new FakeSeerr() }),
    count: 1,
  },
  {
    label: 'one Overseerr',
    config: ONE,
    servers: () => ({ [SERVER_URL]: new FakeSeerr({ app: 'overseerr' }) }),
    count: 1,
  },
  {
    label: 'one Seerr without TMDB',
    config: ONE,
    servers: () => {
      const server = new FakeSeerr({ app: 'seerr' });
      server.tmdbReachable = false;
      return { [SERVER_URL]: server };
    },
    count: 1,
  },
  {
    label: 'two servers',
    config: TWO,
    servers: () => ({
      [SERVER_URL]: new FakeSeerr(),
      [SERVER_2_URL]: new FakeSeerr({ app: 'overseerr', apiKey: 'key-2', urlBase: '/overseerr' }),
    }),
    count: 2,
  },
  ...['fr', 'de', 'es'].map((language) => ({
    label: `${language} names, one server down`,
    config: { ...TWO, server_2_url: OFFLINE_URL, server_2_name: 'Offline', language },
    servers: () => {
      const offline = new FakeSeerr({ app: 'seerr', apiKey: 'key-2' });
      offline.online = false;
      return { [SERVER_URL]: new FakeSeerr({ app: 'seerr' }), [OFFLINE_URL]: offline };
    },
    count: 2,
  })),
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const { gladys, app } = await createWorld({
      config: scenario.config,
      servers: scenario.servers(),
    });
    try {
      const devices = gladys.fake.discoveredDevices;
      assert.ok(devices.length >= 1, 'no device discovered');
      assert.equal(devices.length, scenario.count);

      for (const device of devices) {
        const where = device.name;

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
          }

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);

          // The value read from the fixtures fits the declared bounds (a
          // server that never answered only publishes "online: 0").
          const value = gladys.fake.lastState(feature.external_id);
          if (feature.category === 'text') {
            assert.ok(value === undefined || (typeof value === 'string' && value !== ''));
            continue;
          }
          if (value === undefined && device.name === 'Offline') {
            continue;
          }
          assert.equal(typeof value, 'number', `${at}: no state published`);
          assert.ok(value >= feature.min && value <= feature.max, `${at}: ${value} out of bounds`);
          if (feature.type === 'integer' || feature.type === 'binary') {
            assert.ok(Number.isInteger(value), `${at}: ${value} is not an integer`);
          }
        }
      }
    } finally {
      await app.stop();
    }
  });
}
