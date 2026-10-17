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

# Migration backup checkpoint: local database snapshot only, not an object/off-site disaster-recovery backup.
(
  [[ $(id -u) == 0 ]]
  umask 077
  for directory in /opt/qms2 /opt/qms2/migration-backups-v1 /opt/qms2/migration-backup-keys-v1; do
    [[ ! -L "$directory" ]]
    [[ -d "$directory" ]] || mkdir -m 700 -- "$directory"
    [[ $(realpath -- "$directory") == "$directory" && $(stat -c %u "$directory") == 0 ]]
    if [[ "$directory" == /opt/qms2 ]]; then
      [[ $(stat -c %a "$directory") =~ ^(700|750|755)$ ]]
    else
      [[ $(stat -c %a "$directory") == 700 ]]
    fi
  done
  sha_directory=/opt/qms2/migration-backups-v1/$sha
  [[ ! -L "$sha_directory" ]]
  [[ -d "$sha_directory" ]] || mkdir -m 700 -- "$sha_directory"
  [[ $(realpath -- "$sha_directory") == "$sha_directory" && $(stat -c %u "$sha_directory") == 0 && $(stat -c %a "$sha_directory") == 700 ]]
  backup=$(mktemp -d "$sha_directory/snapshot.XXXXXXXX")
  [[ "$backup" == "$sha_directory"/snapshot.* && $(realpath -- "$backup") == "$backup" ]]
  key=/opt/qms2/migration-backup-keys-v1/$sha.${backup##*/}.key
  # Remove only this attempt's two known plaintext files, including on tool failure or interruption.
  trap 'rm -f -- "$backup/database.dump" "$backup/database.verify.dump"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  set -o noclobber
  openssl rand -base64 48 > "$key"
  chmod 600 -- "$key"
  "${compose[@]}" exec -T postgres sh -c 'exec pg_dump --format=custom --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' \
    > "$backup/database.dump" </dev/null 2>/dev/null
  "${compose[@]}" exec -T postgres pg_restore --list < "$backup/database.dump" >/dev/null 2>&1
  openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 -pass "file:$key" \
    -in "$backup/database.dump" -out "$backup/database.dump.enc"
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$key" \
    -in "$backup/database.dump.enc" -out "$backup/database.verify.dump"
  cmp -- "$backup/database.dump" "$backup/database.verify.dump"
  "${compose[@]}" exec -T postgres pg_restore --list < "$backup/database.verify.dump" >/dev/null 2>&1
  sha256sum "$backup/database.dump" | cut -d ' ' -f 1 > "$backup/database.sha256"
  rm -f -- "$backup/database.dump" "$backup/database.verify.dump"
  echo "Pre-migration encrypted database snapshot verified: $sha"
)
# End migration backup checkpoint

"${compose[@]}" run --rm --no-deps api node node_modules/prisma/build/index.js migrate deploy </dev/null
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
