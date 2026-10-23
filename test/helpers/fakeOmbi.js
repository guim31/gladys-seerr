// -----------------------------------------------------------------------------
// An in-memory Ombi v4 behind the `request` seam of the client, built from the
// answers of a real Ombi 4.53.10 (test/fixtures/ombi/): the ApiKey header,
// the counts it computes, the paged v2 lists, approving and denying (HTTP 200
// with `isError` on failure), a request becoming available, an issue
// reported, the web application answering unknown routes.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const ombiFixture = (name) =>
  JSON.parse(
    readFileSync(new URL(`../fixtures/ombi/ombi-4.53.10/${name}.json`, import.meta.url), 'utf8'),
  );

const json = (status, body) => ({
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify(body),
});

const clone = (value) => structuredClone(value);

export class FakeOmbi {
  constructor({ apiKey = 'ombi-key' } = {}) {
    this.apiKey = apiKey;
    this.online = true;
    this.movies = ombiFixture('movies').collection;
    this.series = ombiFixture('tv').collection;
    this.issueList = ombiFixture('issues');
    this.issueDetail = ombiFixture('issue-1');
    this.applicationName = null;
    this.requests = [];
  }

  /** A new movie request awaiting approval, by `user`. */
  addMovie({ id, tmdbId, title, requestedDate, alias = 'Alice' }) {
    const [template] = this.movies;
    this.movies.unshift({
      ...clone(template),
      id,
      theMovieDbId: tmdbId,
      title,
      approved: false,
      available: false,
      denied: false,
      requestedDate,
      requestedUser: { ...clone(template.requestedUser), alias, userAlias: alias },
    });
  }

  /** A new series request (a child request), id as Ombi sets it: the TMDB id. */
  addSeries({ tmdbId, title, requestedDate, approved = false }) {
    const [template] = this.series;
    const child = clone(template);
    this.series.unshift({
      ...child,
      id: tmdbId,
      approved,
      denied: null,
      available: false,
      requestedDate,
      parentRequest: { ...child.parentRequest, externalProviderId: tmdbId, title },
    });
  }

  /** Episodes of a series request arriving (`count` of them, all by default). */
  arrive(tmdbId, count = Infinity) {
    const child = this.series.find((entry) => entry.parentRequest.externalProviderId === tmdbId);
    let left = count;
    for (const season of child.seasonRequests) {
      for (const episode of season.episodes) {
        if (left > 0) {
          episode.available = true;
          left -= 1;
        }
      }
    }
  }

  counts() {
    const all = [
      ...this.movies,
      ...this.series.map((child) => ({ ...child, denied: child.denied === true })),
    ];
    return {
      pending: all.filter((r) => !r.approved && !r.denied && !r.available).length,
      approved: all.filter((r) => r.approved && !r.available).length,
      available: all.filter((r) => r.available).length,
      denied: all.filter((r) => r.denied).length,
    };
  }

  page(list, count) {
    const sorted = [...list].sort(
      (a, b) => Date.parse(b.requestedDate) - Date.parse(a.requestedDate),
    );
    return { collection: clone(sorted.slice(0, count)), total: list.length };
  }

  decide(kind, body, approve) {
    const list = kind === 'movie' ? this.movies : this.series;
    const request = list.find((entry) => entry.id === body?.id);
    if (!request) {
      return json(200, ombiFixture('approve-missing'));
    }
    request.approved = approve;
    request.denied = !approve;
    return json(200, ombiFixture(approve ? 'approve' : 'deny'));
  }

  handle(url, { method = 'GET', headers = {}, json: body } = {}) {
    const { pathname } = new URL(url);
    this.requests.push({ method, path: pathname, body });
    if (!this.online) {
      const error = new Error('connect ECONNREFUSED');
      error.code = 'ECONNREFUSED';
      throw error;
    }
    if (headers.ApiKey !== this.apiKey) {
      return { status: 401, headers: {}, body: 'Invalid API Key' };
    }
    const html = { status: 200, headers: { 'content-type': 'text/html' }, body: '<!DOCTYPE html>' };
    let match;
    if ((match = /^\/api\/v1\/Request\/(movie|tv)\/(approve|deny)$/.exec(pathname))) {
      const expected = match[2] === 'approve' ? 'POST' : 'PUT';
      return method === expected ? this.decide(match[1], body, match[2] === 'approve') : html;
    }
    if (method !== 'GET') {
      return html;
    }
    if (pathname === '/api/v1/Status/info') {
      return json(200, ombiFixture('status-info'));
    }
    if (pathname === '/api/v1/Settings/customization') {
      return json(200, { ...ombiFixture('customization'), applicationName: this.applicationName });
    }
    if (pathname === '/api/v1/Request/count') {
      return json(200, this.counts());
    }
    if (pathname === '/api/v1/Issues/count') {
      return json(200, {
        pending: this.issueList.filter((issue) => issue.status === 0).length,
        inProgress: this.issueList.filter((issue) => issue.status === 1).length,
        resolved: this.issueList.filter((issue) => issue.status === 2).length,
      });
    }
    if (
      (match = /^\/api\/v2\/Requests\/(movie|tv)\/(\d+)\/0\/requestedDate\/desc$/.exec(pathname))
    ) {
      return json(
        200,
        this.page(match[1] === 'movie' ? this.movies : this.series, Number(match[2])),
      );
    }
    if (pathname === '/api/v1/Issues') {
      return json(200, clone(this.issueList));
    }
    if ((match = /^\/api\/v1\/Issues\/(\d+)$/.exec(pathname))) {
      const issue = this.issueList.find((entry) => entry.id === Number(match[1]));
      return json(
        200,
        issue ? { ...clone(issue), userReported: this.issueDetail.userReported } : null,
      );
    }
    return html;
  }
}
