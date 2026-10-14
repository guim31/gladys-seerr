# Fixtures

Answers of real servers, used by the fake servers of `test/helpers/fakeSeerr.js`.

- `overseerr-1.35.0/`, `jellyseerr-2.7.3/`, `seerr-3.5.0/`: captured on
  14/10/2026 from the official Docker images (`sctx/overseerr`,
  `fallenbagel/jellyseerr`, `seerr/seerr`), seeded with `scripts/real/seed.mjs`
  (fictional users `admin`, `alice`, `bob`; five requests on real TMDB ids, one
  issue). TMDB was unreachable from the capture machine: the details routes
  answer HTTP 500 (`movie-details-error.json`), which is also what a server
  without Internet access answers. `approve.json` and `decline.json` answer the
  approval of request 5 and the refusal of request 4; `approve-again.json` the
  approval of the declined request 4 (accepted by Overseerr and Jellyseerr,
  refused by Seerr with a 409). `settings-public.json` is cut to the keys read.
- `python-overseerr/`: answers of real Overseerr and Seerr servers published
  with the tests of [python-overseerr](https://github.com/joostlek/python-overseerr)
  (MIT, © Joost Lekkerkerker), the library of the Home Assistant `overseerr`
  integration. Email addresses moved to `example.org`, private addresses to
  `192.0.2.x`; `movie.json` and `tv.json` cut to the keys read.
- `poster-w185.jpg`: a plain 185 × 278 JPEG, the size of the TMDB `w185`
  posters the integration reads through the image proxy of the server.
