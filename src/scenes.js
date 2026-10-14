// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// Approve or decline the newest request awaiting approval, on one server or
// any, for movies, series or both. Off unless the configuration allows it
// (the action then fails with a message saying where to turn it on). Nothing
// destructive: a declined request can still be approved in Overseerr.
//
// No request awaiting approval is not an error: the outputs say so (`done`
// false), and the scene author gates the next actions on it.
// -----------------------------------------------------------------------------

import { MEDIA_TEXT, pick } from './texts.js';

async function decide(hub, fields, approve) {
  const result = await hub.decideLatest(fields.device || null, fields.media_type || null, approve);
  if (!result) {
    return { done: false, title: '', requested_by: '', media_type: '' };
  }
  return {
    done: true,
    title: result.title,
    requested_by: result.requestedBy ?? '',
    media_type: pick(MEDIA_TEXT[result.mediaType], hub.config.language),
  };
}

export const SCENE_ACTIONS = {
  approve_latest_request(hub, { fields = {} }) {
    return decide(hub, fields, true);
  },

  decline_latest_request(hub, { fields = {} }) {
    return decide(hub, fields, false);
  },
};
