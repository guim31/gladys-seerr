import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, parseServerUrl } from '../src/config.js';

test('the address accepts a bare host, a URL copied from the browser, a URL base', () => {
  assert.equal(parseServerUrl('192.0.2.10:5055'), 'http://192.0.2.10:5055');
  assert.equal(parseServerUrl(' http://192.0.2.10:5055/ '), 'http://192.0.2.10:5055');
  assert.equal(
    parseServerUrl('https://example.org/overseerr/requests?filter=all'),
    'https://example.org/overseerr',
  );
  assert.equal(parseServerUrl('http://192.0.2.10:5055/settings/main'), 'http://192.0.2.10:5055');
  assert.equal(parseServerUrl('http://192.0.2.10:5055/movie/603'), 'http://192.0.2.10:5055');
  assert.equal(parseServerUrl('http://192.0.2.10:5055/api/v1/status'), 'http://192.0.2.10:5055');
  assert.equal(parseServerUrl('jellyseerr.lan'), 'http://jellyseerr.lan');
});

test('an unusable address is refused, and never one with credentials', () => {
  for (const value of [
    '',
    '   ',
    'ftp://192.0.2.10',
    'http://',
    'http://user:secret@192.0.2.10',
    42,
    null,
  ]) {
    assert.equal(parseServerUrl(value), null, String(value));
  }
});

test('the defaults give no server, French texts, one minute, approving off', () => {
  const config = normalizeConfig(DEFAULT_CONFIG);
  assert.deepEqual(config, {
    instances: [],
    invalidSlots: [],
    allowSelfSigned: false,
    allowApproval: false,
    pollIntervalMs: 60_000,
    language: 'fr',
  });
  assert.deepEqual(normalizeConfig(undefined).instances, []);
});

test('a server needs an address and a key; a half-filled slot is reported', () => {
  const config = normalizeConfig({
    server_1_url: '192.0.2.10:5055',
    server_1_api_key: ' key-1 ',
    server_1_name: '  Jellyseerr du salon  ',
    server_2_url: '192.0.2.20:5055',
    allow_approval: 'true',
    allow_self_signed: true,
    poll_interval: 300,
    language: 'de',
  });
  assert.deepEqual(config.instances, [
    { slot: 1, url: 'http://192.0.2.10:5055', apiKey: 'key-1', name: 'Jellyseerr du salon' },
  ]);
  assert.deepEqual(config.invalidSlots, [2]);
  assert.equal(config.allowApproval, true);
  assert.equal(config.allowSelfSigned, true);
  assert.equal(config.pollIntervalMs, 300_000);
  assert.equal(config.language, 'de');
});

test('an unknown interval or language falls back to the defaults', () => {
  const config = normalizeConfig({ poll_interval: '5', language: 'it' });
  assert.equal(config.pollIntervalMs, 60_000);
  assert.equal(config.language, 'fr');
});
