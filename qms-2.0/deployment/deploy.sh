#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! $1 =~ ^[0-9a-f]{40}$ ]]; then
  echo 'Usage: deploy.sh <validated main commit SHA>' >&2
  exit 2
fi

sha=$1
repo=/opt/qms2/repo/QMS-2.0
app=$repo/qms-2.0
env_file=/opt/qms2/secrets/qms.env

exec 9>/opt/qms2/deploy.lock
flock -w 600 9 || { echo 'Another deployment holds the lock' >&2; exit 1; }

test -f "$env_file"
test "$(git -C "$repo" branch --show-current)" = main
if [[ -n $(git -C "$repo" status --porcelain --untracked-files=normal) ]]; then
  echo 'Deployment checkout has local changes; reconcile them before enabling CD' >&2
  exit 1
fi

git -C "$repo" fetch --no-tags origin main
tip=$(git -C "$repo" rev-parse refs/remotes/origin/main)
if [[ "$tip" != "$sha" ]]; then
  echo "Skipping superseded CI commit $sha; current origin/main is $tip"
  exit 0
fi

git -C "$repo" merge --ff-only "$sha"
cd "$app"
export QMS_IMAGE_TAG=$sha
compose=(docker compose --env-file "$env_file"
  -f deployment/docker-compose.foundation.yml
  -f deployment/docker-compose.production.yml
  -f deployment/docker-compose.scanning.yml)

"${compose[@]}" config --quiet
"${compose[@]}" build api
"${compose[@]}" build web

# A newer main commit must pass its own CI before it can reach production.
git -C "$repo" fetch --no-tags origin main
tip=$(git -C "$repo" rev-parse refs/remotes/origin/main)
if [[ "$tip" != "$sha" ]]; then
  echo "Skipping superseded build $sha; current origin/main is $tip"
  exit 0
fi

"${compose[@]}" up -d --no-build --wait --wait-timeout 180 postgres rustfs clamav
"${compose[@]}" run --rm --no-deps api node node_modules/prisma/build/index.js migrate deploy
"${compose[@]}" up -d --no-build --wait --wait-timeout 180 api worker web

worker_id=$("${compose[@]}" ps -q worker)
test -n "$worker_id"
worker_ready=false
for attempt in {1..60}; do
  worker_state=$(docker inspect --format '{{.State.Status}}|{{.State.StartedAt}}' "$worker_id")
  if [[ "$worker_state" == running\|* ]]; then
    worker_started_at=${worker_state#*|}
    if worker_logs=$(docker logs --since "$worker_started_at" "$worker_id" 2>&1) &&
       grep -Fxq QMS_WORKER_READY <<< "$worker_logs" &&
       [[ $(docker inspect --format '{{.State.Status}}|{{.State.StartedAt}}' "$worker_id") == "$worker_state" ]]; then
      worker_ready=true
      break
    fi
  fi
  sleep 2
done
if [[ "$worker_ready" != true ]]; then
  echo 'Worker did not report QMS_WORKER_READY within 120 seconds' >&2
  exit 1
fi

for path in /login /api/v1/openapi.json; do
  url="https://qms.bigshuaibee.cn$path"
  status=$(curl --fail --silent --show-error --retry 8 --retry-all-errors \
    --retry-delay 3 --max-time 20 --output /dev/null --write-out '%{http_code}' "$url")
  if [[ "$status" != 200 ]]; then
    echo "$url returned HTTP $status, expected 200" >&2
    exit 1
  fi
done

"${compose[@]}" ps
marker_tmp=$(mktemp /opt/qms2/.deployed-sha.XXXXXXXX)
trap 'rm -f "$marker_tmp"' EXIT
printf '%s\n' "$sha" > "$marker_tmp"
mv -- "$marker_tmp" /opt/qms2/deployed-sha
echo "Deployment successful: $sha"
