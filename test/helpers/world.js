// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, fake servers on a fake
// network, a temporary /data and a manual clock, with the integration wired
// on top through registerHandlers. No timer runs unless `timers: true`: the
// tests read the servers with `world.hub.pollAll()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { FakeSeerr, createNetwork } from './fakeSeerr.js';
import { FakeOmbi } from './fakeOmbi.js';

process.env.LOG_LEVEL ??= 'silent';
process.env.TZ = 'Europe/Paris';

export const SERVER_URL = 'http://192.0.2.10:5055';
export const SERVER_2_URL = 'https://192.0.2.20/overseerr';
export const OMBI_URL = 'http://192.0.2.40:3579';

/** An Ombi alone, in its section of the configuration. */
export const OMBI = {
  ombi_url: OMBI_URL,
  ombi_api_key: 'ombi-key',
  language: 'en',
};

/** A manual clock, a few minutes after the requests of the real captures. */
export function createClock(start = Date.parse('2026-10-14T19:30:00Z')) {
  const clock = {
    time: start,
    now: () => clock.time,
    iso: () => new Date(clock.time).toISOString(),
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

export const ONE = {
  server_1_url: SERVER_URL,
  server_1_api_key: 'key-1',
  language: 'en',
};

export const TWO = {
  ...ONE,
  server_2_url: SERVER_2_URL,
  server_2_api_key: 'key-2',
  server_2_name: 'Overseerr 4K',
};

export const defaultServers = () => ({
  [SERVER_URL]: new FakeSeerr({ app: 'jellyseerr', apiKey: 'key-1' }),
});

/**
 * @param {object} [options]
 * @param {Record<string, FakeSeerr>} [options.servers] by base URL
 * @param {object} [options.config] raw integration config
 */
export async function createWorld({
  clock = createClock(),
  servers,
  config = ONE,
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-seerr-')),
  timings = {},
  timers = false,
} = {}) {
  const network = createNetwork(servers ?? defaultServers());
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: network.request,
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return {
    gladys,
    fake: gladys.fake,
    network,
    server: network.servers[SERVER_URL],
    app,
    hub: app.hub,
    clock,
    dataDir,
  };
}

/** External id of the device of a configuration slot. */
export const deviceId = (gladys, slot = 1) => gladys.externalIds('seerr', String(slot)).device;
export const featureId = (gladys, key, slot = 1) =>
  gladys.externalIds('seerr', String(slot)).feature(key);

/** External id of the Ombi device, and of its features. */
export const ombiDeviceId = (gladys) => gladys.externalIds('ombi', '1').device;
export const ombiFeatureId = (gladys, key) => gladys.externalIds('ombi', '1').feature(key);

export { FakeOmbi, FakeSeerr };
