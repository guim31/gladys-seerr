// -----------------------------------------------------------------------------
// One Gladys device per configured server (Overseerr, Jellyseerr or Seerr).
//
// Identity: the configuration slot (1, 2), not the address: moving a server to
// another host, behind a reverse proxy, or migrating Overseerr to Seerr keeps
// the device and its history.
//
// Features (category/type couples of the core table, see
// test/gladys-rules.test.js), all read-only:
//   - online: input/binary, 1 while the server answers;
//   - pending, processing, available, failed, total: requests awaiting
//     approval, approved and not in the library yet, available, failed (Sonarr
//     or Radarr refused them), all of them;
//   - issues_open: problems reported by the users, not resolved yet;
//   - last_request, last_requester: title and author of the newest request;
//   - version: text/text; update_available: input/binary.
//
// should_poll: false: the integration reads the servers on its own timer
// (src/hub.js), at the interval chosen in the configuration.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';
import { SLOTS, hostOf } from './config.js';

export const DEVICE_TYPE = 'seerr';
export const URL_PARAM = 'SEERR_URL';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  ONLINE: 'online',
  PENDING: 'pending',
  PROCESSING: 'processing',
  AVAILABLE: 'available',
  FAILED: 'failed',
  TOTAL: 'total',
  ISSUES_OPEN: 'issues_open',
  LAST_REQUEST: 'last_request',
  LAST_REQUESTER: 'last_requester',
  VERSION: 'version',
  UPDATE_AVAILABLE: 'update_available',
});

const K = FEATURE_KEYS;

// Feature names, per language (Gladys does not tell a device integration the
// user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [K.ONLINE]: 'Online',
    [K.PENDING]: 'Requests awaiting approval',
    [K.PROCESSING]: 'Approved requests in progress',
    [K.AVAILABLE]: 'Available requests',
    [K.FAILED]: 'Failed requests',
    [K.TOTAL]: 'Total requests',
    [K.ISSUES_OPEN]: 'Open issues',
    [K.LAST_REQUEST]: 'Last request',
    [K.LAST_REQUESTER]: 'Last requested by',
    [K.VERSION]: 'Version',
    [K.UPDATE_AVAILABLE]: 'Update available',
  },
  fr: {
    [K.ONLINE]: 'En ligne',
    [K.PENDING]: "Demandes en attente d'approbation",
    [K.PROCESSING]: 'Demandes approuvées en cours',
    [K.AVAILABLE]: 'Demandes disponibles',
    [K.FAILED]: 'Demandes en échec',
    [K.TOTAL]: 'Total des demandes',
    [K.ISSUES_OPEN]: 'Problèmes ouverts',
    [K.LAST_REQUEST]: 'Dernière demande',
    [K.LAST_REQUESTER]: 'Dernier demandeur',
    [K.VERSION]: 'Version',
    [K.UPDATE_AVAILABLE]: 'Mise à jour disponible',
  },
  de: {
    [K.ONLINE]: 'Online',
    [K.PENDING]: 'Anfragen, die auf Freigabe warten',
    [K.PROCESSING]: 'Freigegebene Anfragen in Bearbeitung',
    [K.AVAILABLE]: 'Verfügbare Anfragen',
    [K.FAILED]: 'Fehlgeschlagene Anfragen',
    [K.TOTAL]: 'Anfragen insgesamt',
    [K.ISSUES_OPEN]: 'Offene Probleme',
    [K.LAST_REQUEST]: 'Letzte Anfrage',
    [K.LAST_REQUESTER]: 'Zuletzt angefragt von',
    [K.VERSION]: 'Version',
    [K.UPDATE_AVAILABLE]: 'Update verfügbar',
  },
  es: {
    [K.ONLINE]: 'En línea',
    [K.PENDING]: 'Solicitudes pendientes de aprobación',
    [K.PROCESSING]: 'Solicitudes aprobadas en curso',
    [K.AVAILABLE]: 'Solicitudes disponibles',
    [K.FAILED]: 'Solicitudes fallidas',
    [K.TOTAL]: 'Total de solicitudes',
    [K.ISSUES_OPEN]: 'Problemas abiertos',
    [K.LAST_REQUEST]: 'Última solicitud',
    [K.LAST_REQUESTER]: 'Solicitada por',
    [K.VERSION]: 'Versión',
    [K.UPDATE_AVAILABLE]: 'Actualización disponible',
  },
};

// Display bounds (the core never applies them on write).
const COUNTER_MAX = 100_000;
const TEXT_MAX_LENGTH = 100;

const counter = (key, value) => ({
  key,
  definition: {
    category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
    read_only: true,
    has_feedback: false,
    keep_history: true,
    min: 0,
    max: COUNTER_MAX,
  },
  value,
});

const binary = (key, value) => ({
  key,
  definition: {
    category: DEVICE_FEATURE_CATEGORIES.INPUT,
    type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
    read_only: true,
    has_feedback: false,
    keep_history: true,
    min: 0,
    max: 1,
  },
  value,
});

// A text state is ignored by Gladys when empty: null (nothing published) instead.
const text = (key, value) => ({
  key,
  text: true,
  definition: {
    category: DEVICE_FEATURE_CATEGORIES.TEXT,
    type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
    read_only: true,
    has_feedback: false,
    keep_history: false,
    min: 0,
    max: 0,
  },
  value: (snapshot) => {
    const result = value(snapshot);
    return typeof result === 'string' && result.trim()
      ? result.trim().slice(0, TEXT_MAX_LENGTH)
      : null;
  },
});

const bit = (value) => (value === true ? 1 : value === false ? 0 : null);

// Order = display order in Gladys.
const FEATURES = [
  binary(K.ONLINE, (snapshot) => bit(snapshot.reachable)),
  counter(K.PENDING, (snapshot) => snapshot.counts?.pending ?? null),
  counter(K.PROCESSING, (snapshot) => snapshot.counts?.processing ?? null),
  counter(K.AVAILABLE, (snapshot) => snapshot.counts?.available ?? null),
  counter(K.FAILED, (snapshot) => snapshot.counts?.failed ?? null),
  counter(K.TOTAL, (snapshot) => snapshot.counts?.total ?? null),
  counter(K.ISSUES_OPEN, (snapshot) => snapshot.counts?.issuesOpen ?? null),
  text(K.LAST_REQUEST, (snapshot) => snapshot.lastRequest?.title),
  text(K.LAST_REQUESTER, (snapshot) => snapshot.lastRequest?.requestedBy),
  text(K.VERSION, (snapshot) => snapshot.version),
  binary(K.UPDATE_AVAILABLE, (snapshot) => bit(snapshot.updateAvailable)),
];

/** External ids of a server's device and features. */
export const deviceIds = (gladys, slot) => gladys.externalIds(DEVICE_TYPE, String(slot));

/** The slot of a device external id, null when it is not one of ours. */
export function slotOf(gladys, externalId) {
  return SLOTS.find((slot) => deviceIds(gladys, slot).device === externalId) ?? null;
}

/**
 * The name shown for a server: the one typed in the configuration, else the
 * application title it announces (Overseerr, Jellyseerr, Seerr or the title
 * its administrator chose) and its host.
 * @param {{ url: string, name: string|null }} instance
 * @param {string|null} [appTitle]
 */
export const instanceName = (instance, appTitle = null) =>
  instance.name ?? `${appTitle ?? 'Overseerr'} ${hostOf(instance.url)}`.slice(0, 60);

/**
 * The discovery payload of a server.
 * @param {object} gladys SDK client
 * @param {{ slot: number, url: string, name: string|null }} instance
 * @param {string|null} appTitle
 * @param {string} language feature names language
 */
export function buildDevice(gladys, instance, appTitle, language = 'en') {
  const ids = deviceIds(gladys, instance.slot);
  const names = NAMES[language] ?? NAMES.en;
  return {
    name: instanceName(instance, appTitle),
    external_id: ids.device,
    should_poll: false,
    params: [{ name: URL_PARAM, value: instance.url }],
    features: FEATURES.map(({ key, definition }) => ({
      ...definition,
      name: names[key],
      external_id: ids.feature(key),
    })),
  };
}

/**
 * The value of every feature for a server snapshot (null: nothing to publish).
 * @returns {Array<{ key: string, externalId: string, value: number|string|null, text: boolean }>}
 */
export function featureValues(gladys, slot, snapshot) {
  const ids = deviceIds(gladys, slot);
  return FEATURES.map(({ key, value, text: isText = false }) => ({
    key,
    externalId: ids.feature(key),
    value: value(snapshot),
    text: isText,
  }));
}
