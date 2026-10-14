// -----------------------------------------------------------------------------
// In-memory Overseerr, Jellyseerr and Seerr servers behind the `request` seam
// of the client (src/seerr/http.js). Answers are built from real ones
// (test/fixtures/seerr/), with the behaviors that matter: the API key, the
// counts the server computes, the filters and the sort of the request list,
// approving and declining, a media arriving, an issue reported, TMDB details
// through the server (or TMDB unreachable), the image proxy of each
// application, a server that does not answer.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const APPS = Object.freeze({
  overseerr: 'overseerr-1.35.0',
  jellyseerr: 'jellyseerr-2.7.3',
  seerr: 'seerr-3.5.0',
});

export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/seerr/${name}.json`, import.meta.url), 'utf8'));

export const POSTER = readFileSync(new URL('../fixtures/seerr/poster-w185.jpg', import.meta.url));

const json = (status, body) => ({
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify(body),
});

const clone = (value) => structuredClone(value);

// TMDB titles of the ids the seed uses (and a French one, to see the language).
export const TITLES = {
  'movie:603': { title: 'The Matrix', fr: 'Matrix', date: '1999-03-30' },
  'movie:550': { title: 'Fight Club', date: '1999-10-15' },
  'tv:1399': { title: 'Game of Thrones', fr: 'Le Trône de fer', date: '2011-04-17' },
  'movie:27205': { title: 'Inception', date: '2010-07-15' },
  'movie:157336': { title: 'Interstellar', date: '2014-11-05' },
  'movie:840464': { title: 'Greenland 2', date: '2026-01-07' },
  'tv:89641': { title: 'Love Alarm', date: '2019-08-22' },
};

export class FakeSeerr {
  /**
   * @param {object} [options]
   * @param {'overseerr'|'jellyseerr'|'seerr'} [options.app]
   * @param {string} [options.apiKey]
   * @param {string} [options.urlBase] e.g. '/overseerr'
   */
  constructor({ app = 'jellyseerr', apiKey = 'key-1', urlBase = '' } = {}) {
    const dir = APPS[app];
    this.app = app;
    this.apiKey = apiKey;
    this.urlBase = urlBase;
    this.online = true;
    this.tmdbReachable = true;
    this.statusBody = fixture(`${dir}/status`);
    this.settings = fixture(`${dir}/settings-public`);
    this.requestList = fixture(`${dir}/requests`).results;
    this.issueList = fixture(`${dir}/issues`).results;
    this.templates = {
      movie: this.requestList.find((request) => request.type === 'movie'),
      tv: this.requestList.find((request) => request.type === 'tv'),
      issue: this.issueList[0],
    };
    this.users = {};
    for (const request of this.requestList) {
      for (const user of [request.requestedBy, request.modifiedBy]) {
        if (user) {
          this.users[user.displayName] = user;
        }
      }
    }
    // Seasons of each media, by media id (/request/:id carries them).
    this.mediaSeasons = {};
    this.requests = [];
    this.posters = [];
    this.failNext = null;
  }

  user(name) {
    return clone(this.users[name] ?? this.users.alice);
  }

  /**
   * A new request, built on a real one of the fixtures.
   * @returns {object} the raw request (edit it to move its state)
   */
  addRequest({
    type = 'movie',
    tmdbId = 27205,
    status = 1,
    mediaStatus = 2,
    by = 'alice',
    createdAt = new Date().toISOString(),
    seasons = [],
    is4k = false,
  } = {}) {
    const template = clone(this.templates[type] ?? this.templates.movie);
    const id = Math.max(0, ...this.requestList.map((request) => request.id)) + 1;
    const mediaId = Math.max(0, ...this.requestList.map((request) => request.media.id)) + 1;
    const request = {
      ...template,
      id,
      status,
      type,
      is4k,
      createdAt,
      updatedAt: createdAt,
      requestedBy: this.user(by),
      modifiedBy: status === 1 ? null : this.user('admin'),
      media: {
        ...template.media,
        id: mediaId,
        mediaType: type,
        tmdbId,
        tvdbId: type === 'tv' ? tmdbId * 10 : null,
        status: is4k ? 1 : mediaStatus,
        status4k: is4k ? mediaStatus : 1,
        createdAt,
        updatedAt: createdAt,
        lastSeasonChange: createdAt,
      },
      seasons: seasons.map((seasonNumber, index) => ({
        id: 100 + index,
        seasonNumber,
        status,
        createdAt,
        updatedAt: createdAt,
      })),
      seasonCount: seasons.length,
    };
    this.requestList.push(request);
    return request;
  }

  /** The media of a request changes status (an import, Sonarr…). */
  setMedia(request, status, at = new Date().toISOString()) {
    request.media[request.is4k ? 'status4k' : 'status'] = status;
    request.media.updatedAt = at;
    if (this.app === 'seerr' && status === 5 && request.status === 2 && request.type === 'movie') {
      // Seerr closes the request once its media is available.
      request.status = 5;
    }
  }

  /** Seasons of a series in the library (status per season number). */
  setSeasons(request, statuses, at = new Date().toISOString()) {
    this.mediaSeasons[request.media.id] = Object.entries(statuses).map(([number, status]) => ({
      id: Number(number),
      seasonNumber: Number(number),
      status: request.is4k ? 1 : status,
      status4k: request.is4k ? status : 1,
      createdAt: at,
      updatedAt: at,
    }));
    request.media.lastSeasonChange = at;
    request.media.updatedAt = at;
  }

  addIssue({
    request,
    issueType = 1,
    by = 'bob',
    message = 'No sound after 10 minutes.',
    createdAt = new Date().toISOString(),
    season = 0,
    episode = 0,
  }) {
    const id = Math.max(0, ...this.issueList.map((issue) => issue.id)) + 1;
    const issue = {
      ...clone(this.templates.issue),
      id,
      issueType,
      status: 1,
      problemSeason: season,
      problemEpisode: episode,
      createdAt,
      updatedAt: createdAt,
      createdBy: this.user(by),
      media: clone(request.media),
      comments: [{ id: id * 10, message, createdAt, updatedAt: createdAt, user: this.user(by) }],
    };
    this.issueList.push(issue);
    return issue;
  }

  mediaStatusOf(request) {
    return request.is4k ? request.media.status4k : request.media.status;
  }

  /** /request/count, computed like the three applications do. */
  counts() {
    const list = this.requestList;
    const of = (status) => list.filter((request) => request.status === status);
    const available = (request) => this.mediaStatusOf(request) === 5;
    const counts = {
      total: list.length,
      movie: list.filter((request) => request.type === 'movie').length,
      tv: list.filter((request) => request.type === 'tv').length,
      pending: of(1).length,
      approved: of(2).length,
      declined: of(3).length,
      processing: of(2).filter((request) => !available(request)).length,
      available: of(2).filter(available).length,
    };
    if (this.app === 'seerr') {
      counts.completed = of(5).length;
    }
    return counts;
  }

  /** A request as the list shows it: without the seasons of its media. */
  listed(request) {
    const copy = clone(request);
    delete copy.media.seasons;
    return copy;
  }

  listRequests(searchParams) {
    const take = Number(searchParams.get('take') ?? 10);
    const skip = Number(searchParams.get('skip') ?? 0);
    const filter = searchParams.get('filter') ?? 'all';
    const media = (request) => this.mediaStatusOf(request);
    const keep =
      {
        pending: (request) => request.status === 1,
        failed: (request) => request.status === 4,
        approved: (request) => request.status === 2,
        processing: (request) => request.status === 2 && media(request) !== 5,
        available: (request) => request.status === 5 && media(request) === 5,
      }[filter] ?? (() => true);
    const all = this.requestList.filter(keep).sort((a, b) => b.id - a.id);
    const page = all.slice(skip, skip + take);
    return {
      pageInfo: {
        pages: Math.ceil(all.length / take),
        pageSize: take,
        results: all.length,
        page: Math.floor(skip / take) + 1,
      },
      results: page.map((request) => this.listed(request)),
      ...(this.app === 'seerr' ? { serviceErrors: { radarr: [], sonarr: [] } } : {}),
    };
  }

  listIssues(searchParams) {
    const take = Number(searchParams.get('take') ?? 10);
    const all = [...this.issueList].sort((a, b) => b.id - a.id);
    return {
      pageInfo: {
        pages: Math.ceil(all.length / take),
        pageSize: take,
        results: all.length,
        page: 1,
      },
      // Only Seerr puts the comments in the list.
      results: all.slice(0, take).map((issue) => {
        const copy = clone(issue);
        if (this.app !== 'seerr') {
          delete copy.comments;
        }
        return copy;
      }),
    };
  }

  issueCount() {
    const by = (type) => this.issueList.filter((issue) => issue.issueType === type).length;
    return {
      total: this.issueList.length,
      video: by(1),
      audio: by(2),
      subtitles: by(3),
      others: by(4),
      open: this.issueList.filter((issue) => issue.status === 1).length,
      closed: this.issueList.filter((issue) => issue.status === 2).length,
    };
  }

  details(kind, tmdbId, language) {
    if (!this.tmdbReachable) {
      return json(500, {
        message: kind === 'tv' ? 'Unable to retrieve series.' : 'Unable to retrieve movie.',
      });
    }
    const known = TITLES[`${kind}:${tmdbId}`] ?? { title: `Title ${tmdbId}`, date: '2020-01-01' };
    const title = (language === 'fr' && known.fr) || known.title;
    const base = clone(fixture(`python-overseerr/${kind === 'tv' ? 'tv' : 'movie'}`));
    return json(
      200,
      kind === 'tv'
        ? {
            ...base,
            id: tmdbId,
            name: title,
            firstAirDate: known.date,
            posterPath: `/p${tmdbId}.jpg`,
          }
        : { ...base, id: tmdbId, title, releaseDate: known.date, posterPath: `/p${tmdbId}.jpg` },
    );
  }

  decide(id, approve) {
    const request = this.requestList.find((entry) => entry.id === id);
    if (!request) {
      return json(404, { message: 'Request not found.' });
    }
    if (this.app === 'seerr' && request.status !== 1) {
      return json(409, { message: 'Only pending requests can be approved or declined.' });
    }
    request.status = approve ? 2 : 3;
    request.modifiedBy = this.user('admin');
    return json(200, this.listed(request));
  }

  poster(pathname) {
    const route = this.app === 'overseerr' ? '/imageproxy/t/p/' : '/imageproxy/tmdb/t/p/';
    this.posters.push(pathname);
    if (!pathname.startsWith(`${this.urlBase}${route}`)) {
      // Overseerr asks TMDB for /tmdb/t/p/..., Jellyseerr refuses /t/p/...
      return this.app === 'overseerr'
        ? { status: 500, headers: {}, body: Buffer.alloc(0) }
        : json(400, { message: 'Unsupported image type' });
    }
    return { status: 200, headers: { 'content-type': 'image/jpeg' }, body: POSTER };
  }

  /** The `request` function given to the client. */
  handle(url, { method = 'GET', headers = {} } = {}) {
    const { pathname, searchParams } = new URL(url);
    this.requests.push({ method, path: pathname, query: Object.fromEntries(searchParams) });
    if (!this.online) {
      const error = new Error('connect ECONNREFUSED');
      error.code = 'ECONNREFUSED';
      throw error;
    }
    if (pathname.startsWith(`${this.urlBase}/imageproxy/`)) {
      return this.poster(pathname);
    }
    if (this.failNext) {
      const status = this.failNext;
      this.failNext = null;
      return json(status, { message: 'Something went wrong.' });
    }
    const prefix = `${this.urlBase}/api/v1/`;
    if (!pathname.startsWith(prefix)) {
      return { status: 404, headers: { 'content-type': 'text/html' }, body: 'Not Found' };
    }
    const path = pathname.slice(prefix.length);
    if (path === 'status') {
      return json(200, this.statusBody);
    }
    if (path === 'settings/public') {
      return json(200, this.settings);
    }
    if (!headers['X-Api-Key']) {
      return json(401, fixture(`${APPS[this.app]}/no-key`));
    }
    if (headers['X-Api-Key'] !== this.apiKey) {
      return json(403, fixture(`${APPS[this.app]}/bad-key`));
    }
    let match;
    if (method === 'POST' && (match = /^request\/(\d+)\/(approve|decline)$/.exec(path))) {
      return this.decide(Number(match[1]), match[2] === 'approve');
    }
    if (method !== 'GET') {
      return json(404, { message: 'not found' });
    }
    if (path === 'request/count') {
      return json(200, this.counts());
    }
    if (path === 'issue/count') {
      return json(200, this.issueCount());
    }
    if (path === 'request') {
      return json(200, this.listRequests(searchParams));
    }
    if (path === 'issue') {
      return json(200, this.listIssues(searchParams));
    }
    if ((match = /^request\/(\d+)$/.exec(path))) {
      const request = this.requestList.find((entry) => entry.id === Number(match[1]));
      return request
        ? json(200, {
            ...clone(request),
            media: {
              ...clone(request.media),
              seasons: clone(this.mediaSeasons[request.media.id] ?? []),
            },
          })
        : json(404, { message: 'Request not found.' });
    }
    if ((match = /^issue\/(\d+)$/.exec(path))) {
      const issue = this.issueList.find((entry) => entry.id === Number(match[1]));
      return issue ? json(200, clone(issue)) : json(404, { message: 'Issue not found.' });
    }
    if ((match = /^(movie|tv)\/(\d+)$/.exec(path))) {
      return this.details(match[1], Number(match[2]), searchParams.get('language'));
    }
    return json(404, { message: 'not found', errors: [{ path: pathname, message: 'not found' }] });
  }
}

/**
 * A network of fake servers, by base URL (with the URL base): the `request`
 * seam of the hub. An address without a server does not answer.
 */
export function createNetwork(servers = {}) {
  return {
    servers,
    async request(url, options) {
      const target = new URL(url);
      const server = Object.entries(servers).find(([base]) => {
        const parsed = new URL(base);
        return (
          parsed.origin === target.origin &&
          target.pathname.startsWith(`${parsed.pathname.replace(/\/$/, '')}/`)
        );
      });
      if (!server) {
        const error = new Error('connect EHOSTUNREACH');
        error.code = 'EHOSTUNREACH';
        throw error;
      }
      return server[1].handle(url, options);
    },
  };
}
