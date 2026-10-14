# Overseerr / Jellyseerr for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that follows the movie and series requests of
[Overseerr](https://overseerr.dev) (Plex),
[Jellyseerr](https://github.com/fallenbagel/jellyseerr) (Jellyfin, Emby, Plex)
and [Seerr](https://github.com/seerr-team/seerr), their successor, over the
local network: what waits for your approval, what is on its way, what just
arrived, and the problems your users report.

It is the companion of [Sonarr & Radarr](https://github.com/guim31/gladys-arr),
which follows the downloads themselves.

## Features

- **One device per server**, up to two: online, requests awaiting approval,
  approved requests in progress, available, failed, total, open issues, last
  request and its author, version, update available.
- **Scene triggers**: new request (awaiting approval or approved at once),
  requested media available (a movie, or every season a series request asked
  for — to tell the person who asked), new issue reported (video, audio,
  subtitles, other, with the user's message). Each event announced once, also
  across restarts.
- **Scene actions**, off unless allowed in the configuration: approve or
  decline the newest request awaiting approval, movies, series or both.
- **"Media requests" widget**: requests to approve, in progress, open issues,
  the newest requests with their poster (served by the server itself), who
  asked and their state, and — when allowed — Approve / Decline buttons with a
  confirmation.
- Four languages: English, French, German, Spanish.

## Requirements

- Gladys Assistant 5.1.0 or later.
- Overseerr, Jellyseerr or Seerr reachable from Gladys, and its API key
  (Settings → General → API Key).

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-seerr` (or
   install **Overseerr / Jellyseerr** from the catalog once it is listed).
2. In **Configuration**, enter the address of your server
   (`192.168.1.2:5055`, or `https://example.org/overseerr` with a URL base) and
   its API key. Save, then click **Test the connection**.
3. Open the **Discover** tab and add the device.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

The integration reads each server on its own timer (30 seconds to 10 minutes, 1
minute by default) through the API v1 the three applications share, with the
key in the `X-Api-Key` header. A quiet reading is two small requests
(`/request/count`, `/issue/count`); the lists of the newest requests and issues
are read when those counts move, and every 10 minutes anyway (a season arriving
does not move them). States are published only when they change (and every 12
hours otherwise). The devices are published with `should_poll: false`: Gladys
does not poll them.

The request list replaces the webhooks of Overseerr, which would need an
inbound port the Gladys sandbox does not have: the newest request and issue
seen and the requests waiting for their media are kept in `/data`, so each
event is announced once. A series counts as available when every season of the
request is in the library — the rule Seerr applies to close a request, read
from `/request/:id`.

Titles and posters come from the server (`/movie/:id`, `/tv/:id`, and its image
proxy), which fetches them from TMDB once and keeps them: neither the browser
nor the container reach TMDB.

## Checked against real servers

Tested with the official images of Overseerr 1.35.0 (`sctx/overseerr`),
Jellyseerr 2.7.3 (`fallenbagel/jellyseerr`) and Seerr 3.5.0 (`seerr/seerr`):
reading, a wrong key, approving, an issue reported, a media marked available
(`npm run test:real`, see [`scripts/real/`](scripts/real/README.md)). The
fixtures of the tests are their answers. Those servers had no media server
behind them and no access to TMDB: titles and posters come from published
answers. **Developed without a complete installation (Plex or Jellyfin, Sonarr,
Radarr, Gladys): feedback welcome** in the
[issues](https://github.com/guim31/gladys-seerr/issues).

## Limitations

- No instant push: events show within one refresh interval (a season arriving:
  within 10 minutes).
- The 50 newest requests are followed until their media arrives.
- Approving acts as the administrator of the server (the API key). Declining
  deletes nothing, and a declined request can still be approved in Overseerr.
- Titles and posters need the server to reach TMDB; without it, a title reads
  "Movie #550".

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npm run test:real          # skipped without SEERR_URL, see scripts/real/
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests run against fake servers built from real answers
(`test/fixtures/seerr/`) and the fake Gladys of the SDK; they never touch the
network. See [`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- [Overseerr](https://github.com/sct/overseerr),
  [Jellyseerr](https://github.com/fallenbagel/jellyseerr) and
  [Seerr](https://github.com/seerr-team/seerr) (MIT) and their API
  documentation.
- [python-overseerr](https://github.com/joostlek/python-overseerr) (MIT, ©
  Joost Lekkerkerker) and the Home Assistant
  [Overseerr](https://www.home-assistant.io/integrations/overseerr/)
  integration (Apache 2.0), for the choice of sensors and events; the answers
  published with python-overseerr's tests are part of the fixtures
  (`test/fixtures/seerr/python-overseerr/`). No code was copied.
- Built on the official
  [integration template](https://github.com/GladysAssistant/integration-template-js)
  and [SDK](https://github.com/GladysAssistant/integration-sdk-js).

## Disclaimer

Not affiliated with, nor endorsed by, the Overseerr, Jellyseerr or Seerr
projects, Plex, Jellyfin or TMDB. The names are those of their respective
projects.

## License

[Apache-2.0](LICENSE)
