// -----------------------------------------------------------------------------
// Overseerr / Jellyseerr / Seerr API v1 client. The three share the API (Jellyseerr
// is a fork of Overseerr, Seerr their merge): the key of Settings → General,
// sent in the X-Api-Key header — never in the URL, never in the logs. A
// request made with the key acts as the first administrator of the server.
//
// Checked against real Overseerr 1.35.0, Jellyseerr 2.7.3 and Seerr 3.5.0
// (test/fixtures/seerr/README.md): a wrong key answers 403, no key 401 (a
// session cookie is then required), an unknown route a JSON 404.
// -----------------------------------------------------------------------------

import { httpRequest } from './http.js';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: down, wrong address, firewall
  TLS: 'tls', // the certificate does not verify (self-signed without the option)
  AUTH: 'auth', // API key refused (401, 403)
  NOT_SEERR: 'not_seerr', // something answers, not an Overseerr/Jellyseerr API
  REDIRECT: 'redirect', // the address redirects (HTTP to HTTPS, a login page)
  HTTP: 'http', // any other HTTP error
});

export class SeerrError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message English, for the logs (never contains a secret)
   * @param {object} [extra] { status }
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'SeerrError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

// The TMDB poster size read for the widget: 185 px wide, 10 to 30 KB.
const POSTER_SIZE = 'w185';

// The image proxy of the server (it caches TMDB images on its disk, the
// browser and the container never reach TMDB): `/imageproxy/tmdb/...` on
// Jellyseerr and Seerr, `/imageproxy/...` on Overseerr.
const POSTER_ROUTES = ['imageproxy/tmdb', 'imageproxy'];

const pathOf = (path) => `/${path.split('?')[0]}`;

export class SeerrClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL, with the URL base if any
   * @param {string} options.apiKey
   * @param {boolean} [options.insecure] accept a self-signed certificate
   * @param {Function} [options.request] HTTP seam (src/seerr/http.js)
   */
  constructor({ url, apiKey, insecure = false, request = httpRequest }) {
    this.url = url;
    this.apiKey = apiKey;
    this.insecure = insecure;
    // Not `this.request`: request(id) is a method.
    this.http = request;
    /** The image proxy route that answered last (index in POSTER_ROUTES). */
    this.posterRoute = 0;
  }

  async send(url, { method = 'GET', binary = false, auth = true } = {}) {
    try {
      return await this.http(url, {
        method,
        binary,
        insecure: this.insecure,
        headers: auth ? { 'X-Api-Key': this.apiKey } : {},
      });
    } catch (err) {
      if (TLS_CODES.has(err.code)) {
        throw new SeerrError(ERROR_KINDS.TLS, `Certificate refused (${err.code})`);
      }
      throw new SeerrError(ERROR_KINDS.UNREACHABLE, err.code ? `${err.code}` : err.message);
    }
  }

  async call(path, { method = 'GET' } = {}) {
    const {
      status,
      headers = {},
      body,
    } = await this.send(`${this.url}/api/v1/${path}`, {
      method,
    });
    if (status === 401 || status === 403) {
      throw new SeerrError(ERROR_KINDS.AUTH, 'API key refused', { status });
    }
    if (status >= 300 && status < 400) {
      throw new SeerrError(ERROR_KINDS.REDIRECT, `Redirected (HTTP ${status})`, { status });
    }
    if (status === 404 && !String(headers['content-type'] ?? '').includes('json')) {
      throw new SeerrError(ERROR_KINDS.NOT_SEERR, `No API v1 at this address (${pathOf(path)})`, {
        status,
      });
    }
    if (status < 200 || status >= 300) {
      throw new SeerrError(ERROR_KINDS.HTTP, `${pathOf(path)} answered HTTP ${status}`, {
        status,
      });
    }
    try {
      return body === '' ? null : JSON.parse(body);
    } catch {
      // A reverse proxy's login page, another web application...
      throw new SeerrError(ERROR_KINDS.NOT_SEERR, `${pathOf(path)} did not answer JSON`);
    }
  }

  /** /status: version and update flag; checked to be this API. */
  async status() {
    const status = await this.call('status');
    if (typeof status?.version !== 'string' || typeof status.commitTag !== 'string') {
      throw new SeerrError(ERROR_KINDS.NOT_SEERR, 'No Overseerr or Jellyseerr status here');
    }
    return status;
  }

  /** /settings/public: the application title (Overseerr, Jellyseerr, Seerr or the user's). */
  publicSettings() {
    return this.call('settings/public');
  }

  requestCount() {
    return this.call('request/count');
  }

  issueCount() {
    return this.call('issue/count');
  }

  /** The newest requests, every status (the list is sorted by id). */
  requests(take) {
    return this.call(`request?take=${Number(take)}&skip=0&sort=added&filter=all`);
  }

  /**
   * The newest requests awaiting approval. Both media types: Overseerr ignores
   * the `mediaType` query of Jellyseerr and Seerr, the caller filters.
   */
  pendingRequests(take) {
    return this.call(`request?take=${Number(take)}&skip=0&sort=added&filter=pending`);
  }

  /** The number of failed requests (/request/count has none). */
  async failedCount() {
    const page = await this.call('request?take=1&skip=0&filter=failed');
    return Number.isInteger(page?.pageInfo?.results) ? page.pageInfo.results : null;
  }

  /** One request, with the seasons of its media (the list leaves them out). */
  request(id) {
    return this.call(`request/${Number(id)}`);
  }

  /** The newest issues, open or resolved. */
  issues(take) {
    return this.call(`issue?take=${Number(take)}&skip=0&sort=added&filter=all`);
  }

  /** One issue, with its comments (Overseerr leaves them out of the list). */
  issue(id) {
    return this.call(`issue/${Number(id)}`);
  }

  /** TMDB details of a movie or series, through the server (title, poster). */
  details(mediaType, tmdbId, language) {
    const kind = mediaType === 'tv' ? 'tv' : 'movie';
    return this.call(`${kind}/${Number(tmdbId)}?language=${encodeURIComponent(language)}`);
  }

  approve(id) {
    return this.call(`request/${Number(id)}/approve`, { method: 'POST' });
  }

  decline(id) {
    return this.call(`request/${Number(id)}/decline`, { method: 'POST' });
  }

  /**
   * A poster, through the image proxy of the server. The route that works is
   * remembered: the other one is only tried when it fails.
   * @param {string} posterPath TMDB path, e.g. `/abc.jpg`
   * @returns {Promise<Buffer>}
   */
  async poster(posterPath) {
    if (!/^\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$/.test(posterPath)) {
      throw new SeerrError(ERROR_KINDS.HTTP, 'Invalid poster path');
    }
    let lastStatus = 0;
    for (let attempt = 0; attempt < POSTER_ROUTES.length; attempt += 1) {
      const index = (this.posterRoute + attempt) % POSTER_ROUTES.length;
      const url = `${this.url}/${POSTER_ROUTES[index]}/t/p/${POSTER_SIZE}${posterPath}`;
      const { status, headers = {}, body } = await this.send(url, { binary: true, auth: false });
      if (status === 200 && String(headers['content-type'] ?? '').startsWith('image/')) {
        this.posterRoute = index;
        return body;
      }
      lastStatus = status;
    }
    throw new SeerrError(ERROR_KINDS.HTTP, `Poster not served (HTTP ${lastStatus})`, {
      status: lastStatus,
    });
  }
}
