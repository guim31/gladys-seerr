// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the "Test the connection" report, the scene
// action errors, and the words put in the scene event variables. Four
// languages, the four of the Gladys interface; German says "du", Spanish
// "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './seerr/client.js';
import { ISSUE_TYPES, MEDIA_TYPES, STATES } from './seerr/model.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noInstance: {
    en: 'Enter the address and API key of your Overseerr, Jellyseerr or Ombi in the configuration.',
    fr: "Saisissez l'adresse et la clé d'API de votre Overseerr, Jellyseerr ou Ombi dans la configuration.",
    de: 'Gib die Adresse und den API-Schlüssel deines Overseerr, Jellyseerr oder Ombi in der Konfiguration ein.',
    es: 'Introduzca la dirección y la clave de API de su Overseerr, Jellyseerr u Ombi en la configuración.',
  },
  invalid: {
    en: 'A server is incomplete: address (e.g. http://192.168.1.2:5055) and API key.',
    fr: 'Un serveur est incomplet : adresse (ex. http://192.168.1.2:5055) et clé d’API.',
    de: 'Ein Server ist unvollständig: Adresse (z. B. http://192.168.1.2:5055) und API-Schlüssel.',
    es: 'Un servidor está incompleto: dirección (p. ej. http://192.168.1.2:5055) y clave de API.',
  },
};

// One short explanation per error kind (src/seerr/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'does not answer',
    fr: 'ne répond pas',
    de: 'antwortet nicht',
    es: 'no responde',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: tick "Accept self-signed certificates"',
    fr: 'certificat refusé : cochez « Accepter les certificats auto-signés »',
    de: 'Zertifikat abgelehnt: Aktiviere „Selbstsignierte Zertifikate akzeptieren“',
    es: 'certificado rechazado: marque «Aceptar certificados autofirmados»',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'API key refused',
    fr: "clé d'API refusée",
    de: 'API-Schlüssel abgelehnt',
    es: 'clave de API rechazada',
  },
  [ERROR_KINDS.NOT_SEERR]: {
    en: 'no Overseerr or Jellyseerr API at this address',
    fr: 'aucune API Overseerr ou Jellyseerr à cette adresse',
    de: 'keine Overseerr- oder Jellyseerr-API unter dieser Adresse',
    es: 'no hay ninguna API de Overseerr o Jellyseerr en esta dirección',
  },
  [ERROR_KINDS.NOT_OMBI]: {
    en: 'no Ombi API at this address',
    fr: 'aucune API Ombi à cette adresse',
    de: 'keine Ombi-API unter dieser Adresse',
    es: 'no hay ninguna API de Ombi en esta dirección',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'the address redirects: enter the final address, with its URL base',
    fr: "l'adresse redirige : saisissez l'adresse finale, avec sa base d'URL",
    de: 'die Adresse leitet um: Gib die endgültige Adresse mit ihrer URL-Basis ein',
    es: 'la dirección redirige: introduzca la dirección final, con su base de URL',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
};

// The "Test the connection" report, one line per server.
export const REPORT_TEXT = {
  en: {
    ok: (app, version) => `${app} ${version}`,
    pending: (count) => `${count} awaiting approval`,
    processing: (count) => `${count} in progress`,
    issues: (count) => `${count} open issue(s)`,
    update: 'update available',
  },
  fr: {
    ok: (app, version) => `${app} ${version}`,
    pending: (count) => `${count} en attente d'approbation`,
    processing: (count) => `${count} en cours`,
    issues: (count) => `${count} problème(s) ouvert(s)`,
    update: 'mise à jour disponible',
  },
  de: {
    ok: (app, version) => `${app} ${version}`,
    pending: (count) => `${count} warten auf Freigabe`,
    processing: (count) => `${count} in Bearbeitung`,
    issues: (count) => `${count} offene(s) Problem(e)`,
    update: 'Update verfügbar',
  },
  es: {
    ok: (app, version) => `${app} ${version}`,
    pending: (count) => `${count} pendiente(s) de aprobación`,
    processing: (count) => `${count} en curso`,
    issues: (count) => `${count} problema(s) abierto(s)`,
    update: 'actualización disponible',
  },
};

// Errors of the scene actions and widget buttons (shown in Gladys).
export const ACTION_TEXT = {
  noInstance: {
    en: 'No Overseerr, Jellyseerr or Ombi is configured.',
    fr: "Aucun Overseerr, Jellyseerr ni Ombi n'est configuré.",
    de: 'Kein Overseerr, Jellyseerr oder Ombi ist konfiguriert.',
    es: 'No hay ningún Overseerr, Jellyseerr ni Ombi configurado.',
  },
  unknownInstance: {
    en: 'This server is no longer in the configuration.',
    fr: "Ce serveur n'est plus dans la configuration.",
    de: 'Dieser Server ist nicht mehr in der Konfiguration.',
    es: 'Este servidor ya no está en la configuración.',
  },
  approvalOff: {
    en: 'Approving from Gladys is off: tick "Allow approving and declining" in the configuration.',
    fr: "L'approbation depuis Gladys est désactivée : cochez « Autoriser l'approbation et le refus » dans la configuration.",
    de: 'Freigeben aus Gladys ist aus: Aktiviere „Freigeben und Ablehnen erlauben“ in der Konfiguration.',
    es: 'La aprobación desde Gladys está desactivada: marque «Permitir aprobar y rechazar» en la configuración.',
  },
  notPending: {
    en: 'This request is no longer awaiting approval.',
    fr: "Cette demande n'est plus en attente d'approbation.",
    de: 'Diese Anfrage wartet nicht mehr auf Freigabe.',
    es: 'Esta solicitud ya no está pendiente de aprobación.',
  },
  failed: {
    en: 'The server refused the command, see the logs.',
    fr: 'Le serveur a refusé la commande, voir les logs.',
    de: 'Der Server hat den Befehl abgelehnt, sieh in den Protokollen nach.',
    es: 'El servidor ha rechazado la orden, consulte los registros.',
  },
};

// Words of the scene event variables and of the widget, in the language of
// the configuration (a scene action does not receive the user's language).
export const MEDIA_TEXT = {
  [MEDIA_TYPES.MOVIE]: { en: 'Movie', fr: 'Film', de: 'Film', es: 'Película' },
  [MEDIA_TYPES.TV]: { en: 'Series', fr: 'Série', de: 'Serie', es: 'Serie' },
};

export const ISSUE_TEXT = {
  [ISSUE_TYPES[1]]: { en: 'Video', fr: 'Vidéo', de: 'Video', es: 'Vídeo' },
  [ISSUE_TYPES[2]]: { en: 'Audio', fr: 'Audio', de: 'Audio', es: 'Audio' },
  [ISSUE_TYPES[3]]: { en: 'Subtitles', fr: 'Sous-titres', de: 'Untertitel', es: 'Subtítulos' },
  [ISSUE_TYPES[4]]: { en: 'Other', fr: 'Autre', de: 'Sonstiges', es: 'Otro' },
};

// Badges of the widget (≤ 16 characters).
export const STATE_TEXT = {
  [STATES.PENDING]: { en: 'Pending', fr: 'En attente', de: 'Wartet', es: 'Pendiente' },
  [STATES.PROCESSING]: { en: 'Approved', fr: 'Approuvée', de: 'Freigegeben', es: 'Aprobada' },
  [STATES.PARTIAL]: { en: 'Partial', fr: 'En partie', de: 'Teilweise', es: 'Parcial' },
  [STATES.AVAILABLE]: { en: 'Available', fr: 'Disponible', de: 'Verfügbar', es: 'Disponible' },
  [STATES.DECLINED]: { en: 'Declined', fr: 'Refusée', de: 'Abgelehnt', es: 'Rechazada' },
  [STATES.FAILED]: { en: 'Failed', fr: 'En échec', de: 'Fehlgeschlagen', es: 'Fallida' },
  [STATES.COMPLETED]: { en: 'Completed', fr: 'Terminée', de: 'Abgeschlossen', es: 'Completada' },
};

// The title of a movie or series whose details the server could not give
// (TMDB unreachable from the server).
export const UNKNOWN_TITLE = {
  en: (media, id) => `${media} #${id}`,
  fr: (media, id) => `${media} n° ${id}`,
  de: (media, id) => `${media} Nr. ${id}`,
  es: (media, id) => `${media} n.º ${id}`,
};

export const LANGUAGE_FALLBACK = 'en';

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;
export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];
