// -----------------------------------------------------------------------------
// Ombi v4 API client, seen by the hub as one more Overseerr: the same methods
// as SeerrClient, answering the same shapes (`/request`, `/request/count`,
// `/issue`, ...), so the hub, the device, the widget and the scenes stay the
// same for the three applications. The key of Settings → Ombi, sent in the
// ApiKey header; it acts as an administrator.
//
// Checked against a real Ombi 4.53.10 (test/fixtures/ombi/README.md):
//   - a wrong key answers 401, an unknown route the web application (HTML,
//     HTTP 200): "not Ombi" is told by the JSON;
//   - the commands answer HTTP 200 even when they fail, with `isError`;
//   - movie and series requests are two tables: a series request (a "child"
//     request) has its own id, which Ombi 4.53 sets to the TMDB id of the
//     series, so the ids follow neither each other nor time. The hub tells the
//     new requests by their date instead (`idsInOrder`), and the ids it sees
//     are encoded: movie n → 2n, series n → 2n + 1;
//   - no failed state, no update flag, no image proxy (the posters are TMDB
//     paths the browser fetches from TMDB): none is published, and the widget
//     shows no poster for Ombi.
// -----------------------------------------------------------------------------

import { ERROR_KINDS, SeerrClient, SeerrError } from '../seerr/client.js';
import { MEDIA_TYPES, REQUEST_STATUS } from '../seerr/model.js';

// The status codes of the media, as Overseerr numbers them (src/seerr/model.js).
const MEDIA = Object.freeze({ PENDING: 2, PROCESSING: 3, PARTIAL: 4, AVAILABLE: 5 });

// Ombi's RequestType: 0 series, 1 movie (issues).
const OMBI_MOVIE = 1;

// Requests read per media type for one list (the newest ones).
const LIST_TAKE = 50;
// TMDB details kept from the lists (title, year, poster path).
const MAX_DETAILS = 600;

/** Request id seen by the hub ↔ Ombi request id and media type. */
export const encodeId = (mediaType, id) => (mediaType === MEDIA_TYPES.TV ? id * 2 + 1 : id * 2);
export const decodeId = (id) => ({
  mediaType: id % 2 === 1 ? MEDIA_TYPES.TV : MEDIA_TYPES.MOVIE,
  id: Math.floor(id / 2),
});

const integer = (value) => {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return Number.isSafeInteger(number) ? number : null;
};

/** An Ombi user as Overseerr shows one: its alias, else its login. */
function user(raw, alias = null) {
  const name = [alias, raw?.alias, raw?.userAlias, raw?.userName].find(
    (value) => typeof value === 'string' && value.trim(),
  );
  return name ? { displayName: name } : null;
}

const requestStatus = (raw) =>
  raw?.denied === true
    ? REQUEST_STATUS.DECLINED
    : raw?.approved === true
      ? REQUEST_STATUS.APPROVED
      : REQUEST_STATUS.PENDING;

/** One movie request of Ombi → an Overseerr request. */
export function movieRequest(raw) {
  const id = integer(raw?.id);
  const tmdbId = integer(raw?.theMovieDbId);
  if (id === null || tmdbId === null) {
    return null;
  }
  const status = requestStatus(raw);
  const mediaStatus =
    raw.available === true
      ? MEDIA.AVAILABLE
      : status === REQUEST_STATUS.APPROVED
        ? MEDIA.PROCESSING
        : MEDIA.PENDING;
  return {
    id: encodeId(MEDIA_TYPES.MOVIE, id),
    type: MEDIA_TYPES.MOVIE,
    status,
    is4k: false,
    createdAt: raw.requestedDate,
    requestedBy: user(raw.requestedUser, raw.requestedByAlias),
    media: { tmdbId, mediaType: MEDIA_TYPES.MOVIE, status: mediaStatus, updatedAt: mediaStatus },
    seasons: [],
  };
}

/**
 * One series request of Ombi (a child request of /api/v2/Requests/tv, with
 * its parent) → an Overseerr request, the seasons of its media included (what
 * Overseerr only gives on /request/:id): a season is available when all of
 * its requested episodes are.
 */
export function tvRequest(raw) {
  const id = integer(raw?.id);
  const tmdbId = integer(raw?.parentRequest?.externalProviderId);
  if (id === null || tmdbId === null) {
    return null;
  }
  const status = requestStatus(raw);
  const seasons = (Array.isArray(raw.seasonRequests) ? raw.seasonRequests : [])
    .map((season) => {
      const episodes = Array.isArray(season?.episodes) ? season.episodes : [];
      const arrived = episodes.filter((episode) => episode?.available === true).length;
      return {
        seasonNumber: integer(season?.seasonNumber),
        arrived,
        complete:
          season?.seasonAvailable === true || (episodes.length > 0 && arrived === episodes.length),
      };
    })
    .filter((season) => season.seasonNumber !== null);
  const arrived = seasons.reduce((total, season) => total + season.arrived, 0);
  let mediaStatus;
  if (raw.available === true || (seasons.length > 0 && seasons.every((s) => s.complete))) {
    mediaStatus = MEDIA.AVAILABLE;
  } else if (arrived > 0) {
    mediaStatus = MEDIA.PARTIAL;
  } else {
    mediaStatus = status === REQUEST_STATUS.APPROVED ? MEDIA.PROCESSING : MEDIA.PENDING;
  }
  return {
    id: encodeId(MEDIA_TYPES.TV, id),
    type: MEDIA_TYPES.TV,
    status,
    is4k: false,
    createdAt: raw.requestedDate,
    requestedBy: user(raw.requestedUser, raw.requestedByAlias),
    media: {
      tmdbId,
      mediaType: MEDIA_TYPES.TV,
      status: mediaStatus,
      // An episode arriving changes the stamp: the hub checks the seasons again.
      updatedAt: `${mediaStatus}:${arrived}`,
      seasons: seasons.map((season) => ({
        seasonNumber: season.seasonNumber,
        status: season.complete ? MEDIA.AVAILABLE : MEDIA.PROCESSING,
      })),
    },
    seasons: seasons.map((season) => ({ seasonNumber: season.seasonNumber })),
  };
}

/** /api/v1/Request/count → the counts of Overseerr's /request/count. */
export function requestCount(raw) {
  const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);
  const pending = count(raw?.pending);
  const approved = count(raw?.approved);
  const available = count(raw?.available);
  const denied = count(raw?.denied);
  const parts = [pending, approved, available, denied];
  return {
    // Ombi counts each request once: the four make the total.
    total: parts.every((part) => part !== null) ? parts.reduce((a, b) => a + b, 0) : null,
    pending,
    processing: approved,
    available,
    declined: denied,
  };
}

/** /api/v1/Issues/count (pending, in progress, resolved) → open and total. */
export function issueCount(raw) {
  const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : 0);
  const open = count(raw?.pending) + count(raw?.inProgress);
  return { open, total: open + count(raw?.resolved) };
}

// The issue categories of Ombi are named by its administrator.
const ISSUE_CATEGORY = [
  [/video|image|picture|vid[ée]o|bild|imagen/i, 1],
  [/audio|sound|son\b|ton\b|sonido/i, 2],
  [/subtit|sous-titre|untertitel|subt[íi]tulo/i, 3],
];

/**
 * One issue of Ombi → an Overseerr issue. `withMessage`: /api/v1/Issues/:id,
 * whose reporter the list leaves out (as Overseerr does with the comments).
 */
export function issue(raw, withMessage = false) {
  const id = integer(raw?.id);
  const tmdbId = integer(raw?.providerId);
  if (id === null || tmdbId === null) {
    return null;
  }
  const category = typeof raw.issueCategory?.value === 'string' ? raw.issueCategory.value : '';
  const message = [raw.subject, raw.description]
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim())
    .join(': ');
  return {
    id,
    issueType: ISSUE_CATEGORY.find(([pattern]) => pattern.test(category))?.[1] ?? 4,
    // Ombi: 0 pending, 1 in progress, 2 resolved. Overseerr: 1 open.
    status: raw.status === 2 ? 2 : 1,
    createdAt: raw.createdDate,
    createdBy: user(raw.userReported),
    media: {
      tmdbId,
      mediaType: raw.requestType === OMBI_MOVIE ? MEDIA_TYPES.MOVIE : MEDIA_TYPES.TV,
    },
    ...(withMessage ? { comments: message ? [{ id: 1, message }] : [] } : {}),
  };
}

/** The TMDB details Ombi gives with a request (title, release date, poster). */
function detailsOf(raw, mediaType) {
  const parent = mediaType === MEDIA_TYPES.TV ? raw?.parentRequest : raw;
  return {
    title: parent?.title ?? raw?.title,
    releaseDate: parent?.releaseDate,
  };
}

const newestFirst = (a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0);

export class OmbiClient extends SeerrClient {
  constructor(options) {
    super(options);
    this.keyHeader = 'ApiKey';
    /** The ids do not follow time: the hub orders the requests by date. */
    this.idsInOrder = false;
    /** TMDB details read with the lists, by `${mediaType}:${tmdbId}`. */
    this.known = new Map();
  }

  async call(path, options) {
    let answer;
    try {
      answer = await super.call(path, options);
    } catch (err) {
      if (err.kind === ERROR_KINDS.NOT_SEERR) {
        err.kind = ERROR_KINDS.NOT_OMBI;
        err.message = err.message.replace('API v1', 'Ombi API');
      }
      throw err;
    }
    return answer;
  }

  /** A command of Ombi: HTTP 200 even when it fails, `isError` then. */
  async command(path, method, id) {
    const answer = await this.call(path, { method, json: { id, reason: '' } });
    if (answer?.isError === true || answer?.result === false) {
      const reason = typeof answer.errorMessage === 'string' ? answer.errorMessage : 'refused';
      throw new SeerrError(ERROR_KINDS.HTTP, `${path} refused: ${reason.slice(0, 100)}`, {
        status: /not exist/i.test(reason) ? 404 : 409,
      });
    }
    return answer;
  }

  remember(mediaType, tmdbId, details) {
    const key = `${mediaType}:${tmdbId}`;
    this.known.delete(key);
    this.known.set(key, details);
    if (this.known.size > MAX_DETAILS) {
      this.known.delete(this.known.keys().next().value);
    }
  }

  /** /api/v1/Status/info: the version, as a JSON string. */
  async status() {
    const version = await this.call('Status/info');
    if (typeof version !== 'string' || !/^\d+\.\d+/.test(version)) {
      throw new SeerrError(ERROR_KINDS.NOT_OMBI, 'No Ombi version here');
    }
    return { version, commitTag: '', updateAvailable: null };
  }

  /** The application name of Settings → Customization, "Ombi" when unset. */
  async publicSettings() {
    const settings = await this.call('Settings/customization');
    const name = settings?.applicationName;
    return { applicationTitle: typeof name === 'string' && name.trim() ? name : 'Ombi' };
  }

  async requestCount() {
    return requestCount(await this.call('Request/count'));
  }

  async issueCount() {
    return issueCount(await this.call('Issues/count'));
  }

  /** The newest movie and series requests, merged, newest first. */
  async requests(take) {
    const count = Math.min(Number(take), LIST_TAKE);
    const [movies, series] = await Promise.all([
      this.call(`v2/Requests/movie/${count}/0/requestedDate/desc`),
      this.call(`v2/Requests/tv/${count}/0/requestedDate/desc`),
    ]);
    const results = [];
    for (const [page, mediaType, map] of [
      [movies, MEDIA_TYPES.MOVIE, movieRequest],
      [series, MEDIA_TYPES.TV, tvRequest],
    ]) {
      for (const raw of Array.isArray(page?.collection) ? page.collection : []) {
        const request = map(raw);
        if (request) {
          this.remember(mediaType, request.media.tmdbId, detailsOf(raw, mediaType));
          results.push(request);
        }
      }
    }
    results.sort(newestFirst);
    const total = [movies, series].reduce(
      (sum, page) => sum + (Number.isSafeInteger(page?.total) ? page.total : 0),
      0,
    );
    return { pageInfo: { results: total }, results: results.slice(0, count) };
  }

  /** The caller keeps the requests awaiting approval. */
  pendingRequests(take) {
    return this.requests(take);
  }

  /** Ombi has no failed state. */
  async failedCount() {
    return null;
  }

  /** One request, found among the newest ones (Ombi has no route for one). */
  async request(id) {
    const { results } = await this.requests(LIST_TAKE);
    const found = results.find((request) => request.id === Number(id));
    if (!found) {
      throw new SeerrError(ERROR_KINDS.HTTP, 'Request not found', { status: 404 });
    }
    return found;
  }

  /** The newest issues, open or resolved (Ombi answers them all). */
  async issues(take) {
    const list = await this.call('Issues');
    const results = (Array.isArray(list) ? list : [])
      .map((raw) => {
        const parsed = issue(raw);
        if (parsed && typeof raw.title === 'string') {
          const key = `${parsed.media.mediaType}:${parsed.media.tmdbId}`;
          if (!this.known.has(key)) {
            this.remember(parsed.media.mediaType, parsed.media.tmdbId, { title: raw.title });
          }
        }
        return parsed;
      })
      .filter(Boolean)
      .sort((a, b) => b.id - a.id)
      .slice(0, Number(take));
    return { results };
  }

  async issue(id) {
    return issue(await this.call(`Issues/${Number(id)}`), true);
  }

  /** The details Ombi gave with the requests and issues. */
  async details(mediaType, tmdbId) {
    const known = this.known.get(`${mediaType}:${Number(tmdbId)}`);
    if (!known?.title) {
      throw new SeerrError(ERROR_KINDS.HTTP, 'Not in the recent requests');
    }
    return known;
  }

  approve(id) {
    const { mediaType, id: ombiId } = decodeId(Number(id));
    return this.command(`Request/${mediaType}/approve`, 'POST', ombiId);
  }

  decline(id) {
    const { mediaType, id: ombiId } = decodeId(Number(id));
    return this.command(`Request/${mediaType}/deny`, 'PUT', ombiId);
  }

  async poster() {
    throw new SeerrError(ERROR_KINDS.HTTP, 'Ombi serves no poster');
  }
}
