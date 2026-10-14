// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// Up to two servers (Overseerr, Jellyseerr or Seerr: the same API v1), each in
// its own slot (address, API key, name). The slot number is the device
// identity: changing the address of a slot (an IP for a name, HTTP for HTTPS,
// Overseerr for Seerr after a migration) keeps the device and its history.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

export const SLOTS = [1, 2];

// Refresh intervals offered in the configuration, in seconds.
export const POLL_INTERVALS = ['30', '60', '120', '300', '600'];

export const DEFAULT_CONFIG = {
  server_1_url: '',
  server_1_api_key: '',
  server_1_name: '',
  server_2_url: '',
  server_2_api_key: '',
  server_2_name: '',
  allow_self_signed: false,
  allow_approval: false,
  poll_interval: '60',
  language: 'fr',
};

const MAX_NAME_LENGTH = 40;

// Pages of the web interface: an address copied from the browser keeps its
// URL base (a reverse proxy under /overseerr) and loses the page.
const PAGES =
  /\/(requests?|issues?|discover|movie|tv|collection|person|search|users?|profile|settings|login|setup|blacklist|blocklist|watchlist)(\/.*)?$/i;

/**
 * Parse the address typed by the user into a base URL: a bare host or IP
 * (`192.0.2.10:5055`), or the URL copied from the browser, with the URL base
 * of a server behind a reverse proxy (`https://example.org/overseerr/`).
 * HTTP by default; the query, the fragment and a trailing slash dropped.
 * @param {unknown} raw
 * @returns {string|null} `http(s)://host[:port][/base]`, null when unusable
 */
export function parseServerUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs and the device params.
  if (url.username || url.password) {
    return null;
  }
  const path = url.pathname
    .replace(/\/api\/v1(\/.*)?$/i, '')
    .replace(PAGES, '')
    .replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/** Host part shown to the user (no scheme). */
export const hostOf = (url) => url.replace(/^https?:\/\//, '');

const isTrue = (value) => value === true || value === 'true';

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const pick = (key, list) => {
    const value = source[key] === undefined || source[key] === null ? '' : String(source[key]);
    return list.includes(value) ? value : DEFAULT_CONFIG[key];
  };

  const instances = [];
  const invalidSlots = [];
  for (const slot of SLOTS) {
    const typed = text(`server_${slot}_url`);
    if (!typed) {
      continue;
    }
    const url = parseServerUrl(typed);
    const apiKey = text(`server_${slot}_api_key`);
    if (!url || !apiKey) {
      invalidSlots.push(slot);
      continue;
    }
    instances.push({
      slot,
      url,
      apiKey,
      name: text(`server_${slot}_name`).slice(0, MAX_NAME_LENGTH) || null,
    });
  }

  return {
    instances,
    invalidSlots,
    allowSelfSigned: isTrue(source.allow_self_signed),
    allowApproval: isTrue(source.allow_approval),
    pollIntervalMs: Number(pick('poll_interval', POLL_INTERVALS)) * 1000,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
