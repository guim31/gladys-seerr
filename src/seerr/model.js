// -----------------------------------------------------------------------------
// Pure parsers of the Overseerr / Jellyseerr / Seerr answers: counts,
// requests, issues, TMDB details. No network, no Gladys: tested on real
// answers (test/fixtures/seerr/).
//
// The status codes are the same in the three applications (their
// constants/media.ts):
//   request: 1 pending approval, 2 approved, 3 declined, 4 failed,
//            5 completed (Seerr only: set once the media is available);
//   media:   1 unknown, 2 pending, 3 processing, 4 partially available,
//            5 available, then deleted (6 on Overseerr, 7 elsewhere).
// A 4K request follows `status4k` of its media instead of `status`.
// -----------------------------------------------------------------------------

export const REQUEST_STATUS = Object.freeze({
  PENDING: 1,
  APPROVED: 2,
  DECLINED: 3,
  FAILED: 4,
  COMPLETED: 5,
});

export const MEDIA_STATUS = Object.freeze({
  PARTIALLY_AVAILABLE: 4,
  AVAILABLE: 5,
});

/** What a request shows to the user (widget badge, trigger variable). */
export const STATES = Object.freeze({
  PENDING: 'pending', // awaiting approval
  PROCESSING: 'processing', // approved, not in the library yet
  PARTIAL: 'partial', // approved, some of it in the library (series)
  AVAILABLE: 'available', // in the library
  DECLINED: 'declined',
  FAILED: 'failed', // Sonarr or Radarr refused it
  COMPLETED: 'completed', // Seerr closed it, the media is gone since
});

export const MEDIA_TYPES = Object.freeze({ MOVIE: 'movie', TV: 'tv' });

export const ISSUE_TYPES = Object.freeze({
  1: 'video',
  2: 'audio',
  3: 'subtitles',
  4: 'other',
});

const integer = (value) => (Number.isSafeInteger(value) ? value : null);
const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);

/** /status: { version, updateAvailable } */
export function parseStatus(status) {
  return {
    version: typeof status?.version === 'string' ? status.version.slice(0, 40) : null,
    updateAvailable: status?.updateAvailable === true,
  };
}

/**
 * /request/count + /issue/count (+ the failed count) → the counters of the
 * device. `available`: Overseerr and Jellyseerr count the approved requests
 * whose media is available; Seerr moves them to `completed` instead.
 */
export function parseCounts(requestCount, issueCount, failed = null) {
  const r = requestCount && typeof requestCount === 'object' ? requestCount : {};
  const available = count(r.available);
  const completed = count(r.completed);
  return {
    total: count(r.total),
    pending: count(r.pending),
    processing: count(r.processing),
    available: available === null ? null : available + (completed ?? 0),
    declined: count(r.declined),
    failed: count(failed),
    issuesOpen: count(issueCount?.open),
  };
}

/**
 * The name shown for a user: the display name of the server, never an email
 * address (Overseerr falls back to it for a user without a name).
 */
export function userName(user) {
  if (!user || typeof user !== 'object') {
    return null;
  }
  const candidates = [
    user.displayName,
    user.username,
    user.plexUsername,
    user.jellyfinUsername,
    user.email,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim().split('@')[0].slice(0, 60);
    }
  }
  return null;
}

/** The status of the media that a request follows (4K or not). */
const mediaStatusOf = (raw) => integer(raw?.is4k ? raw?.media?.status4k : raw?.media?.status);

/** The state of a request, from its status and its media's. */
export function requestState(status, mediaStatus) {
  switch (status) {
    case REQUEST_STATUS.PENDING:
      return STATES.PENDING;
    case REQUEST_STATUS.DECLINED:
      return STATES.DECLINED;
    case REQUEST_STATUS.FAILED:
      return STATES.FAILED;
    case REQUEST_STATUS.COMPLETED:
      return mediaStatus === MEDIA_STATUS.AVAILABLE ||
        mediaStatus === MEDIA_STATUS.PARTIALLY_AVAILABLE
        ? STATES.AVAILABLE
        : STATES.COMPLETED;
    default:
      if (mediaStatus === MEDIA_STATUS.AVAILABLE) {
        return STATES.AVAILABLE;
      }
      return mediaStatus === MEDIA_STATUS.PARTIALLY_AVAILABLE ? STATES.PARTIAL : STATES.PROCESSING;
  }
}

/**
 * One request of /request (or /request/:id).
 * @returns {object|null} null when unusable (no id, no media)
 */
export function parseRequest(raw) {
  const id = integer(raw?.id);
  const tmdbId = integer(raw?.media?.tmdbId);
  if (id === null || tmdbId === null) {
    return null;
  }
  const mediaType = raw.type === MEDIA_TYPES.TV || raw.media.mediaType === MEDIA_TYPES.TV;
  const status = integer(raw.status);
  const mediaStatus = mediaStatusOf(raw);
  const created = Date.parse(raw.createdAt);
  return {
    id,
    tmdbId,
    mediaType: mediaType ? MEDIA_TYPES.TV : MEDIA_TYPES.MOVIE,
    status,
    mediaStatus,
    state: requestState(status, mediaStatus),
    is4k: raw.is4k === true,
    requestedBy: userName(raw.requestedBy),
    createdAt: Number.isFinite(created) ? new Date(created).toISOString() : null,
    // A change of the media: a season arrived, the status moved.
    mediaStamp: `${raw.media.updatedAt ?? ''}|${raw.media.lastSeasonChange ?? ''}|${mediaStatus}`,
    seasons: Array.isArray(raw.seasons)
      ? raw.seasons
          .map((season) => integer(season?.seasonNumber))
          .filter((number) => number !== null)
          .sort((a, b) => a - b)
      : [],
  };
}

/**
 * A page of /request → the parsed requests, newest first: by id, or by date
 * when the ids do not follow time (Ombi, src/ombi/client.js).
 */
export function parseRequests(page, byDate = false) {
  const results = Array.isArray(page?.results) ? page.results : [];
  const time = (request) => Date.parse(request.createdAt) || 0;
  return results
    .map(parseRequest)
    .filter(Boolean)
    .sort((a, b) => (byDate ? time(b) - time(a) : 0) || b.id - a.id);
}

/**
 * Whether every season a series request asked for is in the library, from
 * /request/:id (whose media carries its seasons, unlike the list): the rule
 * Seerr applies to close a request, which Overseerr and Jellyseerr only
 * apply to their notifications.
 */
export function seasonsAvailable(raw) {
  const request = parseRequest(raw);
  if (!request) {
    return false;
  }
  if (request.mediaStatus === MEDIA_STATUS.AVAILABLE) {
    return true;
  }
  const seasons = Array.isArray(raw.media?.seasons) ? raw.media.seasons : [];
  if (request.seasons.length === 0 || seasons.length === 0) {
    return false;
  }
  const key = request.is4k ? 'status4k' : 'status';
  return request.seasons.every((number) =>
    seasons.some(
      (season) => season?.seasonNumber === number && season[key] === MEDIA_STATUS.AVAILABLE,
    ),
  );
}

/** The first comment of an issue: what the user wrote when reporting it. */
function firstComment(raw) {
  const comments = Array.isArray(raw?.comments) ? [...raw.comments] : [];
  comments.sort((a, b) => (integer(a?.id) ?? 0) - (integer(b?.id) ?? 0));
  const message = comments.find((comment) => typeof comment?.message === 'string')?.message;
  return message ? message.trim().slice(0, 500) : null;
}

/** One issue of /issue (or /issue/:id). */
export function parseIssue(raw) {
  const id = integer(raw?.id);
  const tmdbId = integer(raw?.media?.tmdbId);
  if (id === null || tmdbId === null) {
    return null;
  }
  const created = Date.parse(raw.createdAt);
  return {
    id,
    tmdbId,
    mediaType: raw.media.mediaType === MEDIA_TYPES.TV ? MEDIA_TYPES.TV : MEDIA_TYPES.MOVIE,
    type: ISSUE_TYPES[raw.issueType] ?? ISSUE_TYPES[4],
    open: raw.status === 1,
    reportedBy: userName(raw.createdBy),
    message: Array.isArray(raw.comments) ? firstComment(raw) : undefined,
    season: integer(raw.problemSeason) ?? 0,
    episode: integer(raw.problemEpisode) ?? 0,
    createdAt: Number.isFinite(created) ? new Date(created).toISOString() : null,
  };
}

/** A page of /issue → the parsed issues, newest first. */
export function parseIssues(page) {
  const results = Array.isArray(page?.results) ? page.results : [];
  return results
    .map(parseIssue)
    .filter(Boolean)
    .sort((a, b) => b.id - a.id);
}

/** /movie/:id or /tv/:id → { title, year, posterPath } */
export function parseDetails(raw) {
  const title = [raw?.title, raw?.name, raw?.originalTitle, raw?.originalName].find(
    (value) => typeof value === 'string' && value.trim(),
  );
  const date = [raw?.releaseDate, raw?.firstAirDate].find(
    (value) => typeof value === 'string' && /^\d{4}/.test(value),
  );
  const posterPath =
    typeof raw?.posterPath === 'string' &&
    /^\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$/.test(raw.posterPath)
      ? raw.posterPath
      : null;
  return {
    title: title ? title.trim().slice(0, 200) : null,
    year: date ? Number(date.slice(0, 4)) : null,
    posterPath,
  };
}
