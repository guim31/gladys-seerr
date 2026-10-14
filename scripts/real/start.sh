#!/bin/sh
# Starts a real Overseerr, Jellyseerr or Seerr in Docker on port 5055, seeded
# by seed.mjs, for `npm run test:real`. See scripts/real/README.md.
#   scripts/real/start.sh <image> <config directory> <api key>
set -eu
IMAGE=$1
CONFIG=$2
KEY=$3
NAME=seerr-real
mkdir -p "$CONFIG"
# Seerr runs as the unprivileged `node` user: it must be able to write there.
chmod a+rwx "$CONFIG"
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -p 5055:5055 -e TZ=Europe/Paris -v "$CONFIG:/app/config" "$IMAGE" >/dev/null
wait_ready() {
  for _ in $(seq 1 60); do
    curl -fs http://localhost:5055/api/v1/status >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "No answer on port 5055" >&2
  docker logs "$NAME" | tail -20 >&2
  exit 1
}
# First start: the application creates its database, then it is seeded.
wait_ready
docker stop "$NAME" >/dev/null
node scripts/real/seed.mjs "$CONFIG" "$KEY"
docker start "$NAME" >/dev/null
wait_ready
echo "Ready: SEERR_URL=http://localhost:5055 SEERR_API_KEY=$KEY npm run test:real"
