# Testing against a real server

`npm run test:real` drives the integration against a real Overseerr,
Jellyseerr or Seerr (`test/real/seerr.real.test.js`). It is skipped when
`SEERR_URL` is not set, so `npm test` and the CI never need a server.

## A seeded server in Docker

Their setup wizard needs a Plex or Jellyfin login and new requests need TMDB.
`start.sh` starts the official image, lets it create its database, stops it,
seeds users, requests and an issue straight into SQLite (`seed.mjs`, Node's
built-in `node:sqlite`), sets a known API key and starts it again:

```bash
scripts/real/start.sh fallenbagel/jellyseerr:latest /tmp/seerr-config test-key
SEERR_URL=http://localhost:5055 SEERR_API_KEY=test-key SEERR_WRITE=1 npm run test:real
docker rm -f seerr-real
```

Images checked on 14/10/2026: `sctx/overseerr` (1.35.0),
`fallenbagel/jellyseerr` (2.7.3) and `seerr/seerr` (3.5.0). Start from an empty
configuration directory each time: the test approves a request and marks a
media available.

## Your own server

Read-only, nothing is changed on the server:

```bash
SEERR_URL=http://192.168.1.2:5055 SEERR_API_KEY=... npm run test:real
```

`SEERR_WRITE=1` reports an issue, approves the newest pending request and marks
its media available: never on a server your family uses.

`scripts/probe.mjs` prints what the integration reads from a server (counts,
newest requests with their titles, issues), without the key nor the users'
email addresses.
