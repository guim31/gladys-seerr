# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.1.0] - 2026-10-23

### Added

- Ombi v4, in a section of its own in the configuration: one device with the
  requests awaiting approval, approved, available, the total, the open issues,
  the last request and its author and the version; the same scene triggers
  (new request, requested media available, new issue reported), the same scene
  actions (approve or decline the latest request) and the same widget, its
  requests shown without poster. Ombi has no failed state and no update flag:
  its device has neither feature.

## [1.0.1] - 2026-10-14

### Added

- Overseerr, Jellyseerr and Seerr servers in Gladys, up to two: one device per
  server with the requests awaiting approval, in progress, available and
  failed, the total, the open issues, the last request and its author, the
  version and whether an update is available.
- Scene triggers: new request, requested media available (a movie, or every
  season a series request asked for), new issue reported. Each event is
  announced once, also across restarts.
- Scene actions to approve or decline the newest request awaiting approval,
  off unless "Allow approving and declining" is ticked.
- "Media requests" dashboard widget: requests to approve, in progress, open
  issues, the newest requests with their poster and state, and Approve /
  Decline buttons when allowed.
- "Test the connection" action, self-signed certificates on option, a refresh
  interval from 30 seconds to 10 minutes.
- English, French, German and Spanish texts and documentation.

[Unreleased]: https://github.com/guim31/gladys-seerr/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/guim31/gladys-seerr/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/guim31/gladys-seerr/releases/tag/v1.0.1
