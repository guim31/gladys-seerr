// -----------------------------------------------------------------------------
// The hub: one record per configured server, read on a timer of the container
// (the interval chosen in the configuration), its states published to Gladys
// when they change, its scene events fired from what changed since the last
// reading, and the approve / decline commands of the scene actions and the
// widget.
//
// Gladys never polls these devices (should_poll: false): the core does not
// poll external devices reliably (Gladys#3198), the interval goes beyond its
// fixed list, and the scene events must fire even for a server whose device
// was not added. onPoll stays as a fallback.
//
// One reading = /request/count and /issue/count, two small answers. The list
// of the newest requests (and of the issues) is read only when those counts
// moved, and every 10 minutes anyway: each /request call also makes the
// server query every Sonarr and Radarr it knows for their quality profiles.
// The version is read hourly.
//
// No webhook: Overseerr can push them, but the sandbox has no inbound port.
// The ids already seen live in /data (src/store.js), so a request, an
// arrival or an issue is announced once, also across restarts.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { ERROR_KINDS, SeerrClient } from './seerr/client.js';
import {
  MEDIA_TYPES,
  STATES,
  parseCounts,
  parseDetails,
  parseIssue,
  parseIssues,
  parseRequests,
  parseStatus,
  seasonsAvailable,
} from './seerr/model.js';
import {
  FEATURE_KEYS,
  buildDevice,
  deviceIds,
  featureValues,
  instanceName,
  slotOf,
} from './devices.js';
import {
  ACTION_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  ISSUE_TEXT,
  MEDIA_TEXT,
  REPORT_TEXT,
  UNKNOWN_TITLE,
  labelled,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'seerr-hub' });

export const WIDGET_KEY = 'requests';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  REQUEST_CREATED: 'request_created',
  REQUEST_AVAILABLE: 'request_available',
  ISSUE_REPORTED: 'issue_reported',
});

export const HUB_TIMINGS = {
  // The version changes with an update: read it hourly, not at every reading.
  statusMs: 60 * 60_000,
  // The lists are read when the counts move, and at least this often (a
  // season arriving does not move the counts).
  listMaxAgeMs: 10 * 60_000,
  // A request or an issue created longer ago is not announced (a container
  // stopped for a night does not replay it); an arrival always is.
  eventMaxAgeMs: 60 * 60_000,
  // At most this many scene events of each kind per reading.
  maxEventsPerRead: 10,
  // Republish an unchanged value this often (Gladys flags a value older than 48 h).
  heartbeatMs: 12 * 60 * 60_000,
  // A failed TMDB lookup (through the server) is tried again after this.
  detailsRetryMs: 10 * 60_000,
};

// The newest requests followed (state, arrival), and the newest issues.
export const REQUEST_WINDOW = 50;
export const ISSUE_WINDOW = 20;
// Requests whose title the widget shows.
export const SHOWN_REQUESTS = 8;
const MAX_DETAILS = 300;

// The states of a request still waiting for its media.
const WAITING = new Set([STATES.PENDING, STATES.PROCESSING, STATES.PARTIAL]);
// The states after which it never arrives (declined, failed, closed).
const ENDED = new Set([STATES.DECLINED, STATES.FAILED, STATES.COMPLETED]);

const signature = (instance, allowSelfSigned) =>
  JSON.stringify([instance.url, instance.apiKey, allowSelfSigned]);

export class SeerrHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/seerr/http.js)
   * @param {boolean} [options.timers] periodic timer (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.config = null;
    /** @type {Map<number, object>} server records, by slot */
    this.records = new Map();
    this.transports = new Map();
    this.connection = null;
    this.saved = { servers: {} };
    this.pollTimer = null;
    this.lastCycleAt = 0;
    this.stopped = false;
    /** Problems already logged, by key: repeats go to debug. */
    this.warned = new Set();
  }

  // --- Logs ------------------------------------------------------------------

  /** Log a problem once (`level` warn or error), its repeats at debug. */
  problem(key, message, err, level = 'warn') {
    const args = err === undefined ? [message] : [message, err];
    if (this.warned.has(key)) {
      logger.debug(...args);
      return;
    }
    this.warned.add(key);
    logger[level](...args);
  }

  /** The problem `key` is gone: the next occurrence is logged again. */
  resolved(key, message) {
    if (this.warned.delete(key) && message) {
      logger.info(message);
    }
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    this.saved = {
      servers: saved?.servers && typeof saved.servers === 'object' ? saved.servers : {},
    };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates();
    this.transports.clear();
    this.connection = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    const wanted = new Map(config.instances.map((instance) => [instance.slot, instance]));
    for (const [slot, record] of this.records) {
      const instance = wanted.get(slot);
      if (!instance || record.signature !== signature(instance, config.allowSelfSigned)) {
        record.dropped = true;
        this.records.delete(slot);
      }
    }
    for (const instance of config.instances) {
      const record = this.records.get(instance.slot);
      if (record) {
        record.instance = instance; // a new name only
      } else {
        this.records.set(instance.slot, this.newRecord(instance));
      }
    }
    if (previous && previous.language !== config.language) {
      // The titles are read in the language of the configuration.
      for (const record of this.records.values()) {
        record.listAt = 0;
      }
    }
    await this.publishDevices();
    await this.pollAll();
    this.schedulePoll();
  }

  newRecord(instance) {
    return {
      instance,
      signature: signature(instance, this.config.allowSelfSigned),
      client: new SeerrClient({
        url: instance.url,
        apiKey: instance.apiKey,
        insecure: this.config.allowSelfSigned,
        request: this.request,
      }),
      snapshot: {
        reachable: null,
        version: null,
        updateAvailable: null,
        appTitle: null,
        counts: null,
        requests: [],
        issues: [],
        lastRequest: null,
      },
      error: null,
      statusAt: 0,
      listAt: 0,
      issuesAt: 0,
      countsKey: null,
      issueTotal: null,
      readAt: 0,
      polling: null,
      /** TMDB details by `${mediaType}:${tmdbId}:${language}`. */
      details: new Map(),
      /** The media stamp at which a partly available series was last checked, by request id. */
      checked: new Map(),
    };
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    await this.store.flush();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || this.records.size === 0) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollAll();
        this.resolved('poll', 'Reading the servers works again');
      } catch (err) {
        this.problem('poll', 'Reading the servers failed', err, 'error');
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  // --- Devices -----------------------------------------------------------------

  async publishDevices() {
    const devices = [...this.records.values()].map((record) =>
      buildDevice(this.gladys, record.instance, record.snapshot.appTitle, this.config.language),
    );
    this.publishedNames = JSON.stringify(devices.map((device) => device.name));
    // Even an empty list: the Discovery tab then shows no stale server.
    await this.gladys.publishDiscoveredDevices(devices);
  }

  /** "Search" in the Discovery tab: publish the devices again, read the servers. */
  async rediscover() {
    await this.publishDevices();
    await this.pollAll({ force: true });
  }

  /** The user added a device: its states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    const record = this.recordOf(device.external_id);
    if (!record) {
      return;
    }
    // The SDK forgot what it had published for this device: everything again.
    await this.publishStates(record);
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  recordOf(deviceExternalId) {
    const slot = slotOf(this.gladys, deviceExternalId);
    return slot === null ? null : (this.records.get(slot) ?? null);
  }

  // --- Reading the servers -----------------------------------------------------

  async pollAll({ force = false } = {}) {
    this.lastCycleAt = this.now();
    const records = [...this.records.values()];
    const changes = await Promise.all(records.map((record) => this.poll(record, { force })));
    // The application title names the device when the user typed no name.
    const names = JSON.stringify(
      records.map((record) => instanceName(record.instance, record.snapshot.appTitle)),
    );
    if (names !== this.publishedNames) {
      await this.publishDevices();
    }
    await this.afterChanges(changes.some(Boolean));
  }

  /**
   * Gladys asks for a refresh (onPoll, the fallback): read that server, unless
   * the timer of the container just did.
   */
  async pollDevice(device) {
    const record = this.recordOf(device.external_id);
    if (!record || this.now() - record.readAt < this.config.pollIntervalMs * 0.9) {
      return;
    }
    await this.afterChanges(await this.poll(record));
  }

  /**
   * Read one server and apply what changed. Concurrent calls share the read;
   * a forced one (a command, a test) reads the lists again.
   * @returns {Promise<boolean>} whether the widget shows something new
   */
  async poll(record, { force = false } = {}) {
    while (force && record.polling) {
      await record.polling;
    }
    record.polling ??= this.read(record, { force }).finally(() => {
      record.polling = null;
    });
    return record.polling;
  }

  async read(record, { force }) {
    const { client } = record;
    const now = this.now();
    record.readAt = now;
    const statusDue = !record.snapshot.version || now - record.statusAt >= this.timings.statusMs;
    try {
      const [status, settings, requestCount, issueCount] = await Promise.all([
        statusDue ? client.status() : null,
        // The title only names the device: its failure is not the server's.
        statusDue ? client.publicSettings().catch(() => null) : null,
        client.requestCount(),
        client.issueCount(),
      ]);
      const countsKey = JSON.stringify([requestCount, issueCount]);
      const listDue =
        force ||
        !record.listAt ||
        countsKey !== record.countsKey ||
        now - record.listAt >= this.timings.listMaxAgeMs;
      const issueTotal = Number.isInteger(issueCount?.total) ? issueCount.total : null;
      const issuesDue =
        force ||
        !record.issuesAt ||
        issueTotal !== record.issueTotal ||
        now - record.issuesAt >= this.timings.listMaxAgeMs;

      const previous = record.snapshot;
      let { requests, issues } = previous;
      let failed = previous.counts?.failed ?? null;
      if (listDue) {
        const [page, failedCount] = await Promise.all([
          client.requests(REQUEST_WINDOW),
          client.failedCount(),
        ]);
        requests = parseRequests(page);
        failed = failedCount;
      }
      if (issuesDue) {
        issues = parseIssues(await client.issues(ISSUE_WINDOW));
      }
      if (record.dropped) {
        return false;
      }
      if (status) {
        record.statusAt = now;
      }
      record.countsKey = countsKey;
      record.issueTotal = issueTotal;
      if (listDue) {
        record.listAt = now;
      }
      if (issuesDue) {
        record.issuesAt = now;
      }
      const parsedStatus = status ? parseStatus(status) : null;
      const appTitle =
        typeof settings?.applicationTitle === 'string' && settings.applicationTitle.trim()
          ? settings.applicationTitle.trim().slice(0, 40)
          : previous.appTitle;

      let announced = false;
      if (listDue) {
        await this.attachTitles(record, requests.slice(0, SHOWN_REQUESTS));
        announced = (await this.requestEvents(record, requests)) || announced;
      }
      if (issuesDue) {
        announced = (await this.issueEvents(record, issues)) || announced;
      }
      return await this.applySuccess(record, {
        version: parsedStatus ? parsedStatus.version : previous.version,
        updateAvailable: parsedStatus ? parsedStatus.updateAvailable : previous.updateAvailable,
        appTitle,
        counts: parseCounts(requestCount, issueCount, failed),
        requests,
        issues,
        lastRequest: requests[0]
          ? { title: requests[0].title ?? null, requestedBy: requests[0].requestedBy }
          : null,
        announced,
      });
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      return this.applyFailure(record, err);
    }
  }

  label(record) {
    return `Server ${record.instance.slot} (${instanceName(record.instance, record.snapshot.appTitle)})`;
  }

  async applySuccess(record, { announced, ...next }) {
    if (record.dropped) {
      return false;
    }
    const previous = record.snapshot;
    if (record.error) {
      logger.info(`${this.label(record)}: connection restored`);
    } else if (previous.reachable === null) {
      logger.info(
        `${this.label(record)}: connected, ${next.appTitle ?? 'server'} version ${next.version}`,
      );
    }
    if (next.updateAvailable && previous.updateAvailable === false) {
      logger.info(`${this.label(record)}: an update is available`);
    }
    record.error = null;
    record.snapshot = { reachable: true, ...next };
    await this.publishStates(record);
    const shown = (snapshot) =>
      JSON.stringify([
        snapshot.counts,
        snapshot.requests
          .slice(0, SHOWN_REQUESTS)
          .map((request) => [request.id, request.state, request.title]),
        snapshot.updateAvailable,
      ]);
    return announced || previous.reachable !== true || shown(previous) !== shown(record.snapshot);
  }

  async applyFailure(record, err) {
    if (record.dropped) {
      return false;
    }
    const wasError = record.error?.kind;
    record.error = { kind: err.kind, message: err.message };
    record.snapshot = { ...record.snapshot, reachable: false };
    // One warning when the problem starts (or changes), not one per reading.
    if (wasError !== err.kind) {
      logger.warn(`${this.label(record)}: ${err.message}`);
    } else {
      logger.debug(`${this.label(record)}: ${err.message} (again)`);
    }
    await this.publishStates(record);
    return wasError !== err.kind;
  }

  // --- Titles ---------------------------------------------------------------------------

  /**
   * TMDB details of a movie or series (title, year, poster), asked to the
   * server once and kept. A failure (the server cannot reach TMDB) is tried
   * again after a while, and the title falls back to "Movie #id".
   */
  async details(record, mediaType, tmdbId) {
    const language = this.config.language;
    const key = `${mediaType}:${tmdbId}:${language}`;
    const known = record.details.get(key);
    if (known && (!known.failedAt || this.now() - known.failedAt < this.timings.detailsRetryMs)) {
      return known;
    }
    let entry;
    try {
      entry = parseDetails(await record.client.details(mediaType, tmdbId, language));
      this.resolved(`details:${record.instance.slot}`, `${this.label(record)}: titles read again`);
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      this.problem(
        `details:${record.instance.slot}`,
        `${this.label(record)}: no title for ${mediaType} ${tmdbId} (${err.message}): can the server reach TMDB?`,
      );
      entry = { title: null, year: null, posterPath: null, failedAt: this.now() };
    }
    record.details.delete(key);
    record.details.set(key, entry);
    if (record.details.size > MAX_DETAILS) {
      record.details.delete(record.details.keys().next().value);
    }
    return entry;
  }

  /** The title shown for a media: its TMDB title, else "Movie #550". */
  titleOf(details, mediaType, tmdbId) {
    if (details.title) {
      return details.title;
    }
    const language = this.config.language;
    return pick(UNKNOWN_TITLE, language)(pick(MEDIA_TEXT[mediaType], language), tmdbId);
  }

  /** Give requests (or issues) their title, year and poster path. */
  async attachTitles(record, items) {
    for (const item of items) {
      if (item.title) {
        continue;
      }
      const details = await this.details(record, item.mediaType, item.tmdbId);
      item.title = this.titleOf(details, item.mediaType, item.tmdbId);
      item.year = details.year;
      item.posterPath = details.posterPath;
    }
  }

  // --- Scene events ---------------------------------------------------------------------

  /** The persisted cursor of a server; a new address starts again from now. */
  cursor(record) {
    const { slot, url } = record.instance;
    const saved = this.saved.servers[slot];
    if (saved?.url === url) {
      return saved;
    }
    const fresh = { url, lastRequestId: null, lastIssueId: null, watch: [] };
    this.saved.servers[slot] = fresh;
    return fresh;
  }

  recent(createdAt) {
    const time = Date.parse(createdAt);
    return !Number.isFinite(time) || this.now() - time <= this.timings.eventMaxAgeMs;
  }

  /**
   * New requests, and requests whose media arrived, since the last reading.
   * The requests found at the first reading of a server are the starting
   * point, not news.
   * @returns {Promise<boolean>} whether something was announced
   */
  async requestEvents(record, requests) {
    const cursor = this.cursor(record);
    const before = JSON.stringify(cursor);
    const maxId = requests.reduce((max, request) => Math.max(max, request.id), 0);
    if (!Number.isInteger(cursor.lastRequestId)) {
      cursor.lastRequestId = maxId;
      cursor.watch = requests.filter((r) => WAITING.has(r.state)).map((r) => r.id);
      this.store.save(this.saved);
      return false;
    }
    const fresh = requests
      .filter((request) => request.id > cursor.lastRequestId)
      .sort((a, b) => a.id - b.id);
    cursor.lastRequestId = Math.max(cursor.lastRequestId, maxId);

    const watch = new Set(cursor.watch);
    for (const request of fresh) {
      if (WAITING.has(request.state)) {
        watch.add(request.id);
      }
    }
    const arrived = [];
    for (const request of requests) {
      if (!watch.has(request.id)) {
        continue;
      }
      if (request.state === STATES.AVAILABLE) {
        arrived.push(request);
        watch.delete(request.id);
      } else if (ENDED.has(request.state)) {
        watch.delete(request.id);
      } else if (request.state === STATES.PARTIAL && (await this.seriesArrived(record, request))) {
        arrived.push(request);
        watch.delete(request.id);
      }
    }
    // A request out of the followed window, or deleted, is not followed any more.
    const listed = new Set(requests.map((request) => request.id));
    cursor.watch = [...watch].filter((id) => listed.has(id)).sort((a, b) => a - b);
    for (const id of record.checked.keys()) {
      if (!watch.has(id)) {
        record.checked.delete(id);
      }
    }
    if (JSON.stringify(cursor) !== before) {
      this.store.save(this.saved);
    }
    if (record.dropped) {
      return false;
    }

    const created = this.limit(
      record,
      'new requests',
      fresh.filter((request) => this.recent(request.createdAt)),
    );
    const available = this.limit(record, 'arrivals', arrived);
    await this.attachTitles(record, [...created, ...available]);
    for (const request of created) {
      await this.fire(TRIGGERS.REQUEST_CREATED, record, {
        ...this.requestData(request),
        status: request.state === STATES.PENDING ? 'pending' : 'approved',
        seasons: request.seasons.join(', '),
      });
    }
    for (const request of available) {
      await this.fire(TRIGGERS.REQUEST_AVAILABLE, record, this.requestData(request));
    }
    return created.length + available.length > 0;
  }

  /**
   * A partly available series: whether every season of the request is in the
   * library, asked to /request/:id (the list leaves the seasons of the media
   * out) once per change of the media.
   */
  async seriesArrived(record, request) {
    if (
      request.mediaType !== MEDIA_TYPES.TV ||
      record.checked.get(request.id) === request.mediaStamp
    ) {
      return false;
    }
    try {
      const detail = await record.client.request(request.id);
      record.checked.set(request.id, request.mediaStamp);
      return seasonsAvailable(detail);
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      logger.debug(`${this.label(record)}: request ${request.id} not read: ${err.message}`);
      return false;
    }
  }

  /** At most `maxEventsPerRead` events of a kind, the newest ones. */
  limit(record, what, items) {
    const kept = items.slice(-this.timings.maxEventsPerRead);
    if (kept.length < items.length) {
      logger.info(
        `${this.label(record)}: ${items.length} ${what}, only the last ${kept.length} announced`,
      );
    }
    return kept;
  }

  requestData(request) {
    const language = this.config.language;
    return {
      title: request.title,
      media_type: request.mediaType,
      media_label: pick(MEDIA_TEXT[request.mediaType], language),
      requested_by: request.requestedBy ?? '',
      is_4k: request.is4k,
      request_id: request.id,
    };
  }

  /**
   * Issues reported since the last reading.
   * @returns {Promise<boolean>} whether something was announced
   */
  async issueEvents(record, issues) {
    const cursor = this.cursor(record);
    const maxId = issues.reduce((max, issue) => Math.max(max, issue.id), 0);
    if (!Number.isInteger(cursor.lastIssueId)) {
      cursor.lastIssueId = maxId;
      this.store.save(this.saved);
      return false;
    }
    const fresh = issues
      .filter((issue) => issue.id > cursor.lastIssueId)
      .sort((a, b) => a.id - b.id);
    if (fresh.length === 0) {
      return false;
    }
    cursor.lastIssueId = maxId;
    this.store.save(this.saved);
    const reported = this.limit(
      record,
      'new issues',
      fresh.filter((issue) => this.recent(issue.createdAt)),
    );
    const language = this.config.language;
    for (const issue of reported) {
      if (issue.message === undefined) {
        // Overseerr leaves the comments out of the list.
        try {
          issue.message = parseIssue(await record.client.issue(issue.id))?.message ?? null;
        } catch (err) {
          if (!err.kind) {
            throw err;
          }
          issue.message = null;
        }
      }
    }
    await this.attachTitles(record, reported);
    if (record.dropped) {
      return false;
    }
    for (const issue of reported) {
      await this.fire(TRIGGERS.ISSUE_REPORTED, record, {
        title: issue.title,
        media_type: issue.mediaType,
        media_label: pick(MEDIA_TEXT[issue.mediaType], language),
        issue_type: issue.type,
        issue_label: pick(ISSUE_TEXT[issue.type], language),
        reported_by: issue.reportedBy ?? '',
        message: issue.message ?? '',
        season: issue.season,
        episode: issue.episode,
        issue_id: issue.id,
      });
    }
    return reported.length > 0;
  }

  async fire(key, record, data) {
    try {
      await this.gladys.publishSceneEvent(key, {
        device: deviceIds(this.gladys, record.instance.slot).device,
        instance: instanceName(record.instance, record.snapshot.appTitle),
        ...data,
      });
      this.resolved('scene-event');
    } catch (err) {
      this.problem('scene-event', `Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Publishing to Gladys ----------------------------------------------------------

  async publishStates(record) {
    const states = [];
    for (const { key, externalId, value, text } of featureValues(
      this.gladys,
      record.instance.slot,
      record.snapshot,
    )) {
      // While the server is down, its last counts are not republished as fresh.
      if (value === null || (record.snapshot.reachable === false && key !== FEATURE_KEYS.ONLINE)) {
        continue;
      }
      states.push(
        text
          ? { device_feature_external_id: externalId, text: String(value) }
          : { device_feature_external_id: externalId, state: value },
      );
    }
    try {
      // Only the values that changed, and every value once per heartbeat.
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.resolved('states', 'Gladys accepts the states again');
    } catch (err) {
      this.problem('states', `States of ${this.label(record)} refused: ${err.message}`);
    }
  }

  async afterChanges(widgetChanged) {
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  async publishTransports() {
    const entries = [];
    for (const record of this.records.values()) {
      if (record.snapshot.reachable === null) {
        continue;
      }
      const externalId = deviceIds(this.gladys, record.instance.slot).device;
      const transport = record.snapshot.reachable
        ? DEVICE_TRANSPORTS.LOCAL
        : DEVICE_TRANSPORTS.UNREACHABLE;
      if (this.transports.get(externalId) !== transport) {
        entries.push({ external_id: externalId, transport });
      }
    }
    if (entries.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      for (const entry of entries) {
        this.transports.set(entry.external_id, entry.transport);
      }
      this.resolved('transports');
    } catch (err) {
      this.problem('transports', `Transports refused: ${err.message}`);
    }
  }

  nameOf(record) {
    return instanceName(record.instance, record.snapshot.appTitle);
  }

  /** The status under the integration name: connected while one server answers. */
  connectionStatus() {
    const { instances, invalidSlots } = this.config;
    if (instances.length === 0) {
      return {
        connected: false,
        message: invalidSlots.length ? CONNECTION_TEXT.invalid : CONNECTION_TEXT.noInstance,
      };
    }
    const failing = [...this.records.values()].filter((record) => record.error);
    if (failing.length === 0 && invalidSlots.length === 0) {
      return { connected: true };
    }
    const message = {};
    for (const language of Object.keys(CONNECTION_TEXT.noInstance)) {
      const parts = failing.map((record) =>
        labelled(this.nameOf(record), pick(ERROR_TEXT[record.error.kind], language), language),
      );
      if (invalidSlots.length) {
        parts.push(pick(CONNECTION_TEXT.invalid, language));
      }
      message[language] = parts.join(' · ').slice(0, 200);
    }
    return { connected: failing.length < this.records.size, message };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.resolved('connection-status');
    } catch (err) {
      this.problem('connection-status', `Connection status refused: ${err.message}`);
    }
  }

  // --- Commands --------------------------------------------------------------------------

  /** An error shown in Gladys, in the language of the configuration. */
  fail(text) {
    return new Error(pick(text, this.config?.language));
  }

  /**
   * The servers a command targets: one device, or every configured server.
   * @param {string|null|undefined} deviceExternalId
   */
  targets(deviceExternalId) {
    if (this.records.size === 0) {
      throw this.fail(ACTION_TEXT.noInstance);
    }
    if (!deviceExternalId) {
      return [...this.records.values()];
    }
    const record = this.recordOf(deviceExternalId);
    if (!record) {
      throw this.fail(ACTION_TEXT.unknownInstance);
    }
    return [record];
  }

  /** The error of a command refused by a server, for the user. */
  commandError(record, err) {
    const language = this.config.language;
    if (err.kind === ERROR_KINDS.HTTP) {
      return new Error(pick(ACTION_TEXT.failed, language));
    }
    return new Error(labelled(this.nameOf(record), pick(ERROR_TEXT[err.kind], language), language));
  }

  /**
   * The newest request awaiting approval on the targeted servers, of a media
   * type or both, read now.
   * @returns {Promise<{ record: object, request: object }|null>}
   */
  async latestPending(deviceExternalId, mediaType = null) {
    const records = this.targets(deviceExternalId);
    const found = await Promise.all(
      records.map(async (record) => {
        try {
          return parseRequests(await record.client.pendingRequests(REQUEST_WINDOW))
            .filter((request) => request.state === STATES.PENDING)
            .filter((request) => !mediaType || request.mediaType === mediaType)
            .map((request) => ({ record, request }));
        } catch (err) {
          if (!err.kind) {
            throw err;
          }
          if (records.length === 1) {
            throw this.commandError(record, err);
          }
          logger.warn(`${this.label(record)}: pending requests not read: ${err.message}`);
          return [];
        }
      }),
    );
    const candidates = found.flat();
    candidates.sort(
      (a, b) =>
        (Date.parse(b.request.createdAt) || 0) - (Date.parse(a.request.createdAt) || 0) ||
        b.request.id - a.request.id,
    );
    return candidates[0] ?? null;
  }

  /**
   * Approve or decline one request (scene action, widget button). Only when
   * the configuration allows it, only a request still awaiting approval.
   * @returns {Promise<{ title: string, requestedBy: string|null, mediaType: string }>}
   */
  async decide(record, request, approve) {
    if (!this.config.allowApproval) {
      throw this.fail(ACTION_TEXT.approvalOff);
    }
    const verb = approve ? 'approved' : 'declined';
    try {
      await (approve ? record.client.approve(request.id) : record.client.decline(request.id));
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      logger.warn(`${this.label(record)}: request ${request.id} not ${verb}: ${err.message}`);
      throw this.commandError(record, err);
    }
    await this.attachTitles(record, [request]);
    logger.info(`${this.label(record)}: request ${request.id} ${verb} from Gladys`);
    await this.afterChanges(await this.poll(record, { force: true }));
    return { title: request.title, requestedBy: request.requestedBy, mediaType: request.mediaType };
  }

  /** Approve or decline the newest pending request (scene actions). */
  async decideLatest(deviceExternalId, mediaType, approve) {
    if (!this.config.allowApproval) {
      throw this.fail(ACTION_TEXT.approvalOff);
    }
    const latest = await this.latestPending(deviceExternalId, mediaType || null);
    if (!latest) {
      return null;
    }
    return this.decide(latest.record, latest.request, approve);
  }

  /** Approve or decline the request a widget button shows. */
  async decideShown(slot, requestId, approve) {
    if (!this.config.allowApproval) {
      throw this.fail(ACTION_TEXT.approvalOff);
    }
    const record = this.records.get(Number(slot));
    if (!record) {
      throw this.fail(ACTION_TEXT.unknownInstance);
    }
    let request;
    try {
      [request] = parseRequests({ results: [await record.client.request(requestId)] });
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      throw err.status === 404 ? this.fail(ACTION_TEXT.notPending) : this.commandError(record, err);
    }
    if (!request || request.state !== STATES.PENDING) {
      // Approved or declined meanwhile, on the server or by another tap.
      await this.afterChanges(await this.poll(record, { force: true }));
      throw this.fail(ACTION_TEXT.notPending);
    }
    return this.decide(record, request, approve);
  }

  // --- Reports -------------------------------------------------------------------------------

  /** "Test the connection": read every server now, one line each. */
  async testConnection() {
    await this.pollAll({ force: true });
    const message = {};
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      if (this.records.size === 0) {
        message[language] = pick(this.connectionStatus().message, language);
        continue;
      }
      const lines = [...this.records.values()].map((record) => {
        const name = this.nameOf(record);
        if (record.error) {
          return labelled(name, pick(ERROR_TEXT[record.error.kind], language), language);
        }
        const { appTitle, version, counts, updateAvailable } = record.snapshot;
        const parts = [
          text.ok(appTitle ?? 'Overseerr', version),
          text.pending(counts.pending ?? 0),
          text.processing(counts.processing ?? 0),
        ];
        if (counts.issuesOpen) {
          parts.push(text.issues(counts.issuesOpen));
        }
        if (updateAvailable) {
          parts.push(text.update);
        }
        return labelled(name, parts.join(', '), language);
      });
      if (this.config.invalidSlots.length) {
        lines.push(pick(CONNECTION_TEXT.invalid, language));
      }
      message[language] = lines.join('\n');
    }
    return message;
  }

  /** What the widget shows, for one server or all of them. */
  view(deviceExternalId) {
    if (!deviceExternalId) {
      return [...this.records.values()];
    }
    const record = this.recordOf(deviceExternalId);
    return record ? [record] : [];
  }
}

export { ERROR_KINDS };
