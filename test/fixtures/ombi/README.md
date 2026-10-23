# Ombi fixtures

Answers of a real Ombi 4.53.10 (`lscr.io/linuxserver/ombi`), captured on
23/10/2026 after the first-run wizard passed through the API: an administrator,
a fictional user `alice` without auto-approval, two movies and a series
requested by the API key (auto-approved: Ombi names their requester `Api`),
one movie and one series requested by `alice`, then one movie approved, one
denied and approved again, the series of `alice` denied, The Matrix and Game of
Thrones marked available, one issue reported by `alice`.

User objects are cut to their names, user ids replaced, access tokens and
email addresses removed, overviews shortened. `approve.json`, `deny.json` and
`approve-missing.json` are the answers of `POST /Request/movie/approve`,
`PUT /Request/movie/deny` and of the approval of an unknown request (HTTP 200
with `isError`).
