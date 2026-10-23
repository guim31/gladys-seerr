# Overseerr / Jellyseerr / Ombi

Follow the movie and series requests of your household in Gladys: what is
waiting for your approval, what is being downloaded, what just arrived in the
library, and the problems your users report. Works with **Overseerr** (Plex),
**Jellyseerr** (Jellyfin, Emby, Plex) and **Seerr** (their successor): the three
share the same API.

It is the companion of the "Sonarr & Radarr" integration, which follows the
downloads themselves; this one follows the requests of your users.

> Tested against real Overseerr 1.35.0, Jellyseerr 2.7.3 and Seerr 3.5.0
> servers, but not yet on a complete installation (Plex or Jellyfin, Sonarr,
> Radarr and Gladys together): feedback welcome on
> [GitHub](https://github.com/guim31/gladys-seerr/issues).

**Ombi** (v4) is supported too, with its own API: one Ombi next to up to two Overseerr, Jellyseerr or Seerr servers. Tested against a real Ombi 4.53.10.

## Requirements

- Gladys Assistant 5.1.0 or later.
- An Overseerr, Jellyseerr or Seerr server that Gladys can reach on your network
  (for example `http://192.168.1.2:5055`).
- Its API key: in the web interface, **Settings → General → API Key**. The key
  acts as the administrator of the server: keep it to yourself.

- For **Ombi**: Ombi v4, its address (port 3579 by default) and its API key, in **Settings → Ombi → API Key**. It also acts as an administrator.

## Configuration

Integrations → Overseerr / Jellyseerr / Ombi → Configuration:

- **Address**: the IP address or name of the server with its port, and its URL
  base if it is behind a reverse proxy (`https://example.org/overseerr`). An
  address copied from the browser works too.
- **API key**: see above.
- **Name**: the name of the device in Gladys. Empty: the name of the
  application followed by the address.
- A **second server** is optional: a 4K instance, or a Jellyseerr next to an
  Overseerr.
- **Allow approving and declining**: off by default. When ticked, the scene
  actions and the widget buttons can approve or decline the newest request
  awaiting approval. Off, Gladys only reads.
- **Accept self-signed certificates**: for an `https://` address served with
  your own certificate.
- **Refresh interval**: from 30 seconds to 10 minutes (1 minute by default).
- **Language of the texts**: the names of the features (given when the device
  is added, then frozen by Gladys), the titles of the movies and series, and
  the words sent to the scenes. French by default.

**Test the connection** reads every server now and reports what it finds.

Then, in the **Discover** tab, add the device of each server to Gladys.

The **Ombi (optional)** section has the same three fields (address, API key, name) for an Ombi v4.

## Device

One device per server, read-only:

| Feature                       | What it says                                                      |
| ----------------------------- | ----------------------------------------------------------------- |
| Online                        | 1 while the server answers                                        |
| Requests awaiting approval    | Requests nobody approved or declined yet                          |
| Approved requests in progress | Approved, not in the library yet                                  |
| Available requests            | Approved and in the library                                       |
| Failed requests               | Sonarr or Radarr refused them                                     |
| Total requests                | Every request, whatever its state                                 |
| Open issues                   | Problems reported by the users, not resolved yet                  |
| Last request                  | Title of the newest request                                       |
| Last requested by             | Who made it                                                       |
| Version                       | Version of the server                                             |
| Update available              | 1 when the server announces a new version (Overseerr, Jellyseerr) |

The counters keep their history: a chart of the requests awaiting approval
shows how long your family waits.

The **Ombi** device has the same features, except **Failed requests** and **Update available**: Ombi has no failed state and does not announce its updates. Its total is the sum of what Ombi counts (awaiting, approved, available, declined).

## Scene triggers

- **New request**: someone requested a movie or a series. Filters: server,
  movies or series, status (awaiting approval, or approved at once for the
  users allowed to), requester. Information passed on to the scene: title,
  movie or series, requester, status, seasons, 4K request, request number.
- **Requested media available**: a requested movie, or every season a series
  request asked for, is now in the library. Filters: server, movies or series,
  requester. Information: title, movie or series, requester, 4K request.
- **New issue reported**: a user reported a problem on a movie or an episode.
  Filters: server, movies or series, kind (video, audio, subtitles, other).
  Information: title, kind, who reported it, their message, season and episode.

Each event is announced once, also across a restart of the integration: what
it already knew is not announced again. A request or an issue created more than
an hour before it is read (the integration was stopped) is not announced as
new; an arrival always is.

Ombi sends the same three events, with the same information. Its issue kinds are the categories its administrator created: a category named after the video, the audio or the subtitles is recognised, any other one is passed on as "other".

## Scene actions

They need **Allow approving and declining**; otherwise they fail with a
message saying where to turn it on.

- **Approve the latest request**: approves the newest request awaiting
  approval, on one server or any, movies, series or both. The server then sends
  it to Sonarr or Radarr, as when you approve it in its interface.
- **Decline the latest request**: declines it. A declined request can still be
  approved later in the interface of Overseerr or Jellyseerr.

Results passed on to the next actions: whether a request was found (none
awaiting is not an error), its title, its requester, movie or series.

On Ombi, the actions approve or deny the request through its API, as its interface does; a denied request can be approved later.

## Widget

**Media requests**: three tiles (to approve, in progress, open issues), the
eight newest requests with their poster, requester and state (pending,
approved, partial, available, declined, failed), and one row per server with
its version. Every server, or the one chosen in the widget settings.

With **Allow approving and declining**, a caption names the newest request
awaiting approval and two buttons act on it: **Approve** and **Decline**, each
asking for a confirmation first.

The posters come from the server itself (its image cache): neither your
browser nor the integration contact TMDB.

Ombi does not keep the posters (its interface loads them from TMDB): the requests of an Ombi show without poster.

## Scene examples

- **Tell the requester**: trigger "Requested media available", requester
  `alice`; action "Send a message" to Alice, with the title picked from the
  scene information: "… is available, enjoy!".
- **Approve the children's requests during the day**: trigger "New request",
  status awaiting approval, requester `leo`; condition: between 9:00 and 20:00;
  action "Approve the latest request".
- **A subtitles problem**: trigger "New issue reported", kind Subtitles; action
  "Send a message" to the administrator with the title and the message.
- **Morning summary**: every day at 8:00, send the value of "Requests awaiting
  approval" when it is above 0.

The examples work the same with an Ombi: choose its device in the "Server" filter.

## API usage

- Everything stays on your network: the integration talks to the local API of
  your server only, with the API key in the `X-Api-Key` header (never in an
  address, never in the logs).
- One reading = two small requests (`/request/count`, `/issue/count`). The list
  of the 50 newest requests and of the 20 newest issues is read only when those
  counts move, and every 10 minutes anyway; the version once an hour. Each read
  of the list makes the server ask Sonarr and Radarr for their quality
  profiles: keep the refresh interval reasonable.
- The titles and posters are asked to the server (which asks TMDB once and
  keeps them), for the newest requests and the events only.
- The integration keeps in `/data/seerr-state.json` the last request and issue
  numbers it saw and the requests waiting for their media. No password, no key.

Ombi: the key travels in the `ApiKey` header. One reading = `/Request/count` and `/Issues/count`; when they move, and every 10 minutes, the 50 newest movie requests and the 50 newest series requests, and the issues. The titles come with the requests: Ombi is not asked for anything else.

## Troubleshooting

- **"API key refused"**: copy the key again from Settings → General. A new key
  generated on the server invalidates the old one.
- **"does not answer"**: check the address and the port (5055 by default), and
  that Gladys can reach the server (same network, firewall, Docker network).
- **"certificate refused"**: tick **Accept self-signed certificates**, or use
  the `http://` address of your network.
- **"the address redirects"**: enter the final address, with its URL base.
- **Titles shown as "Movie #550"**: the server could not reach TMDB at the time;
  the titles come back on their own a few minutes later.
- **No event**: the events concern what happens after the integration started;
  run **Test the connection** to see what the server answers. For more detail,
  set `LOG_LEVEL=debug` on the integration and read its logs.

- **"no Ombi API at this address"** (Ombi): the address answers, but not with the Ombi API: check the port (3579 by default) and the URL base set in Ombi.

## Limits

- Only the 50 newest requests are followed for their arrival: in an
  installation with more requests waiting at once, the oldest ones are not
  announced when they arrive.
- A series is announced as available when every season of the request is in
  the library; a request for a season of a series already partly there is
  announced the same way.
- No webhook: Overseerr can push notifications, but Gladys runs the integration
  without an inbound port. An event therefore shows within one refresh interval
  (a season arriving: within 10 minutes).
- Approving acts as the administrator of the server (the API key); declining
  never deletes anything. No other change is made to the server.
- The requester filter compares the name exactly as Overseerr shows it.
- Not affiliated with the Overseerr, Jellyseerr or Seerr projects.

- Ombi: the 4K part of a movie request is not followed (only the regular request), no poster, no failed state, no update flag. Ombi answers "Request successfully deleted" when it denies a request: the request stays, denied.
- Not affiliated with the Ombi project.
