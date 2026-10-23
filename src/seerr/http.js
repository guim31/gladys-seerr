// -----------------------------------------------------------------------------
// The one function that talks to the network: an HTTP(S) request on node:http
// / node:https, answering the body as text (JSON API) or as bytes (posters).
// Bounded in time and size. Not on fetch: fetch cannot accept the self-signed
// certificate of one server only, node:https can, per request.
//
// The client takes this function as a parameter: the tests replace it with
// in-memory servers (test/helpers/fakeSeerr.js).
// -----------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';

// A page of 50 requests weighs about 150 KB; a movie's details up to 100 KB.
const MAX_BODY_BYTES = 4 * 1024 * 1024;

/**
 * @param {string} url absolute URL
 * @param {object} [options]
 * @param {string} [options.method]
 * @param {Record<string, string>} [options.headers]
 * @param {object} [options.json] a JSON body (the commands of Ombi)
 * @param {boolean} [options.binary] answer the body as a Buffer
 * @param {boolean} [options.insecure] accept a certificate that does not verify (HTTPS only)
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ status: number, headers: Record<string, string>, body: string|Buffer }>}
 */
export function httpRequest(
  url,
  {
    method = 'GET',
    headers = {},
    binary = false,
    insecure = false,
    timeoutMs = 15_000,
    json = undefined,
  } = {},
) {
  const target = new URL(url);
  const isHttps = target.protocol === 'https:';
  const payload = json === undefined ? null : Buffer.from(JSON.stringify(json));
  const requestHeaders = {
    accept: binary ? 'image/*' : 'application/json',
    ...headers,
    // The approve and decline routes of Overseerr take no body, Ombi's a JSON one.
    ...(payload
      ? { 'content-type': 'application/json', 'content-length': payload.length }
      : method === 'POST'
        ? { 'content-length': 0 }
        : {}),
  };

  return new Promise((resolve, reject) => {
    const request = (isHttps ? https : http).request(
      target,
      {
        method,
        headers: requestHeaders,
        timeout: timeoutMs,
        ...(isHttps ? { rejectUnauthorized: !insecure } : {}),
      },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            request.destroy(new Error('Response too large'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          const body = Buffer.concat(chunks);
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: binary ? body : body.toString('utf8'),
          });
        });
        response.on('error', reject);
      },
    );
    request.on('timeout', () => {
      const error = new Error(`Timed out after ${timeoutMs} ms`);
      error.code = 'ETIMEDOUT';
      request.destroy(error);
    });
    request.on('error', reject);
    request.end(payload ?? undefined);
  });
}
