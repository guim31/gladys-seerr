// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `requests`.
//
// The use case: on the wall tablet, what the family asked for and where it
// stands. So the widget shows three tiles (awaiting approval, in progress,
// open issues), the newest requests with their poster, who asked and a state
// badge (available ones included), one status row per server, and — only when
// the configuration allows approving from Gladys — two buttons acting on the
// newest request awaiting approval, named in a caption, each with a
// confirmation. That is 8 components, the budget of the core.
//
// Every server by default, or the one chosen in the widget settings. The
// figures are sent as values, not bound to device features, so the widget
// works before the devices are added to Gladys and sums two servers.
//
// Posters: the server keeps the TMDB posters it shows (its image proxy). The
// content declares a key per poster, Gladys asks for its bytes through
// onWidgetGetImage, and the hub reads them from the server: neither the
// browser nor the container ever reach TMDB.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS, validateWidgetImage } from '@gladysassistant/integration-sdk';
import { ERROR_KINDS } from './seerr/client.js';
import { MEDIA_TYPES, STATES } from './seerr/model.js';
import { SHOWN_REQUESTS, WIDGET_KEY } from './hub.js';
import { MEDIA_TEXT, STATE_TEXT, pick } from './texts.js';

// Action keys of the buttons: permanent once published.
export const ACTIONS = Object.freeze({
  APPROVE: 'approve',
  DECLINE: 'decline',
});

const MAX_IMAGE_BYTES = 300 * 1024;
const POSTER_KEY = /^poster-(\d)-(movie|tv)-(\d{1,10})$/;

export const TEXT = {
  pick: {
    en: 'Enter the address and API key of your Overseerr or Jellyseerr in the configuration of the integration.',
    fr: "Saisissez l'adresse et la clé d'API de votre Overseerr ou Jellyseerr dans la configuration de l'intégration.",
    de: 'Gib die Adresse und den API-Schlüssel deines Overseerr oder Jellyseerr in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección y la clave de API de su Overseerr o Jellyseerr en la configuración de la integración.',
  },
  unknown: {
    en: 'This server is no longer in the configuration: choose another one in the widget settings.',
    fr: "Ce serveur n'est plus dans la configuration : choisissez-en un autre dans les réglages du widget.",
    de: 'Dieser Server ist nicht mehr in der Konfiguration: Wähle einen anderen in den Widget-Einstellungen.',
    es: 'Este servidor ya no está en la configuración: elija otro en la configuración del widget.',
  },
  nothing: {
    en: 'No request yet.',
    fr: 'Aucune demande pour le moment.',
    de: 'Noch keine Anfrage.',
    es: 'Todavía no hay solicitudes.',
  },
  pending: { en: 'To approve', fr: 'À approuver', de: 'Freizugeben', es: 'Por aprobar' },
  processing: { en: 'In progress', fr: 'En cours', de: 'In Bearbeitung', es: 'En curso' },
  issues: { en: 'Issues', fr: 'Problèmes', de: 'Probleme', es: 'Problemas' },
  unreachable: {
    en: 'Unreachable',
    fr: 'Injoignable',
    de: 'Nicht erreichbar',
    es: 'Inaccesible',
  },
  error: { en: 'Error', fr: 'Erreur', de: 'Fehler', es: 'Error' },
  waiting: { en: 'Waiting…', fr: 'En attente…', de: 'Warte…', es: 'Esperando…' },
  update: {
    en: 'update available',
    fr: 'mise à jour disponible',
    de: 'Update verfügbar',
    es: 'actualización disponible',
  },
  approve: { en: 'Approve', fr: 'Approuver', de: 'Freigeben', es: 'Aprobar' },
  decline: { en: 'Decline', fr: 'Refuser', de: 'Ablehnen', es: 'Rechazar' },
};

// The caption naming the request the buttons act on (≤ 80 characters).
export const CAPTION_TEXT = {
  en: (title, by) => `To approve: ${title}${by ? ` (${by})` : ''}`,
  fr: (title, by) => `À approuver : ${title}${by ? ` (${by})` : ''}`,
  de: (title, by) => `Freizugeben: ${title}${by ? ` (${by})` : ''}`,
  es: (title, by) => `Por aprobar: ${title}${by ? ` (${by})` : ''}`,
};

// Toasts after a tap (≤ 200 characters).
export const DONE_TEXT = {
  en: { approve: (title) => `${title}: approved.`, decline: (title) => `${title}: declined.` },
  fr: { approve: (title) => `${title} : approuvée.`, decline: (title) => `${title} : refusée.` },
  de: {
    approve: (title) => `${title}: freigegeben.`,
    decline: (title) => `${title}: abgelehnt.`,
  },
  es: { approve: (title) => `${title}: aprobada.`, decline: (title) => `${title}: rechazada.` },
};

const BADGE_COLORS = {
  [STATES.PENDING]: WIDGET_COLORS.WARNING,
  [STATES.PROCESSING]: WIDGET_COLORS.INFO,
  [STATES.PARTIAL]: WIDGET_COLORS.INFO,
  [STATES.AVAILABLE]: WIDGET_COLORS.SUCCESS,
  [STATES.DECLINED]: WIDGET_COLORS.NEUTRAL,
  [STATES.FAILED]: WIDGET_COLORS.DANGER,
  [STATES.COMPLETED]: WIDGET_COLORS.NEUTRAL,
};

const t = (text, language) => pick(text, language);
const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

/** Image key of the poster of a movie or series, on a server. */
export const posterKey = (slot, mediaType, tmdbId) => `poster-${slot}-${mediaType}-${tmdbId}`;

/** One row of the list. */
function item(record, request, language, several) {
  const title = request.year ? `${request.title} (${request.year})` : request.title;
  const subtitle = [request.requestedBy, t(MEDIA_TEXT[request.mediaType], language)]
    .concat(several ? [record.snapshot.appTitle ?? `#${record.instance.slot}`] : [])
    .filter(Boolean)
    .join(' · ');
  return {
    title: fit(title ?? '?', 60),
    subtitle: fit(subtitle, 60),
    ...(request.createdAt ? { date: request.createdAt } : {}),
    ...(request.posterPath
      ? { image: posterKey(record.instance.slot, request.mediaType, request.tmdbId) }
      : {}),
    badge: { text: t(STATE_TEXT[request.state], language), color: BADGE_COLORS[request.state] },
  };
}

/** The status row of one server. */
function serverRow(hub, record, language) {
  const label = fit(hub.nameOf(record), 40);
  if (record.error) {
    const unreachable = record.error.kind === ERROR_KINDS.UNREACHABLE;
    return {
      label,
      icon: 'alert-triangle',
      value: t(unreachable ? TEXT.unreachable : TEXT.error, language),
      color: WIDGET_COLORS.DANGER,
    };
  }
  const { version, updateAvailable } = record.snapshot;
  if (!version) {
    return { label, icon: 'clock', value: t(TEXT.waiting, language), color: WIDGET_COLORS.NEUTRAL };
  }
  return {
    label,
    icon: updateAvailable ? 'download' : 'check-circle',
    value: fit(updateAvailable ? `${version} · ${t(TEXT.update, language)}` : version, 40),
    color: updateAvailable ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
  };
}

/** The newest request awaiting approval among the shown servers. */
function newestPending(records) {
  return records
    .filter((record) => !record.error)
    .flatMap((record) =>
      record.snapshot.requests
        .filter((request) => request.state === STATES.PENDING && request.title)
        .map((request) => ({ record, request })),
    )
    .sort(
      (a, b) =>
        (Date.parse(b.request.createdAt) || 0) - (Date.parse(a.request.createdAt) || 0) ||
        b.request.id - a.request.id,
    )[0];
}

export function buttons(target, language) {
  const params = { slot: target.record.instance.slot, request_id: target.request.id };
  return [
    {
      type: 'button',
      label: t(TEXT.approve, language),
      icon: 'check',
      style: 'secondary',
      action: { key: ACTIONS.APPROVE, params, confirm: true },
    },
    {
      type: 'button',
      label: t(TEXT.decline, language),
      icon: 'x',
      style: 'secondary',
      action: { key: ACTIONS.DECLINE, params, confirm: true },
    },
  ];
}

async function get(hub, { settings, language = 'en' }) {
  if (hub.records.size === 0) {
    return message(TEXT.pick, language);
  }
  const records = hub.view(settings?.device);
  if (records.length === 0) {
    return message(TEXT.unknown, language);
  }
  const answering = records.filter((record) => !record.error && record.snapshot.counts);
  const sum = (key) =>
    answering.reduce((total, record) => total + (record.snapshot.counts[key] ?? 0), 0);
  const components = [];
  if (answering.length > 0) {
    const pending = sum('pending');
    const issues = sum('issuesOpen');
    components.push(
      {
        type: 'value',
        value: pending,
        label: t(TEXT.pending, language),
        icon: 'inbox',
        color: pending ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
      },
      {
        type: 'value',
        value: sum('processing'),
        label: t(TEXT.processing, language),
        icon: 'download',
      },
      {
        type: 'value',
        value: issues,
        label: t(TEXT.issues, language),
        icon: 'alert-circle',
        color: issues ? WIDGET_COLORS.DANGER : WIDGET_COLORS.NEUTRAL,
      },
    );
  }
  const several = records.length > 1;
  const rows = answering
    .flatMap((record) =>
      record.snapshot.requests
        .slice(0, SHOWN_REQUESTS)
        .filter((request) => request.title)
        .map((request) => ({ record, request })),
    )
    .sort(
      (a, b) =>
        (Date.parse(b.request.createdAt) || 0) - (Date.parse(a.request.createdAt) || 0) ||
        b.request.id - a.request.id,
    )
    .slice(0, SHOWN_REQUESTS)
    .map(({ record, request }) => item(record, request, language, several));
  if (rows.length > 0) {
    components.push({ type: 'card-list', display: 'list', items: rows });
  } else if (answering.length > 0) {
    components.push({ type: 'text', variant: 'body', text: t(TEXT.nothing, language) });
  }
  components.push({
    type: 'status',
    items: records.slice(0, 10).map((record) => serverRow(hub, record, language)),
  });
  const target = hub.config.allowApproval ? newestPending(answering) : null;
  if (target) {
    components.push({
      type: 'text',
      variant: 'caption',
      text: fit(pick(CAPTION_TEXT, language)(target.request.title, target.request.requestedBy), 80),
    });
    components.push(...buttons(target, language));
  }
  return { ttl_seconds: 300, components };
}

async function action(hub, { actionKey, params = {} }) {
  if (actionKey !== ACTIONS.APPROVE && actionKey !== ACTIONS.DECLINE) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  const approve = actionKey === ACTIONS.APPROVE;
  const done = await hub.decideShown(params.slot, Number(params.request_id), approve);
  return Object.fromEntries(
    Object.entries(DONE_TEXT).map(([language, text]) => [
      language,
      fit((approve ? text.approve : text.decline)(done.title), 200),
    ]),
  );
}

/**
 * Bytes of a poster, as raw base64 (onWidgetGetImage). Only the keys this
 * widget declares, only from a configured server.
 */
export async function getImage(hub, imageKey) {
  const match = POSTER_KEY.exec(String(imageKey));
  if (!match) {
    throw new Error(`Unknown image ${imageKey}`);
  }
  const record = hub.records.get(Number(match[1]));
  if (!record) {
    throw new Error(`No server for image ${imageKey}`);
  }
  const mediaType = match[2] === 'tv' ? MEDIA_TYPES.TV : MEDIA_TYPES.MOVIE;
  const details = await hub.details(record, mediaType, Number(match[3]));
  if (!details.posterPath) {
    throw new Error(`No poster for ${imageKey}`);
  }
  const body = await record.client.poster(details.posterPath);
  if (!Buffer.isBuffer(body) || body.length === 0 || body.length > MAX_IMAGE_BYTES) {
    throw new Error(`Poster ${imageKey} is empty or too large`);
  }
  const image = body.toString('base64');
  // The checks of the core (format, header, size): refused here, explained in the logs.
  const problems = validateWidgetImage(image);
  if (problems.length > 0) {
    throw new Error(`Poster ${imageKey} refused: ${problems.join('; ')}`);
  }
  return image;
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
