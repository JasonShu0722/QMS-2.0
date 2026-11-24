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

previous_sha=
if [[ -f /opt/qms2/deployed-sha ]]; then
  read -r previous_sha </opt/qms2/deployed-sha
  [[ "$previous_sha" =~ ^[0-9a-f]{40}$ ]]
fi
deployment_phase=pre-migration
work_directory=$(mktemp -d /opt/qms2/.deploy.XXXXXXXX)
compose_files=(deployment/docker-compose.foundation.yml deployment/docker-compose.production.yml deployment/docker-compose.scanning.yml)
compose=(docker compose --project-name qms2-foundation --env-file "$env_file")
for compose_file in "${compose_files[@]}"; do
  compose+=(-f "$app/$compose_file")
done
export QMS_IMAGE_TAG=$sha

verify_application() {
  local worker_id worker_ready=false attempt worker_state worker_started_at worker_logs path url status
  worker_id=$("$@" ps -q worker) || return 1
  test -n "$worker_id" || return 1
  for attempt in {1..60}; do
    worker_state=$(docker inspect --format '{{.State.Status}}|{{.State.StartedAt}}' "$worker_id") || return 1
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
    return 1
  fi

  for path in /login /api/v1/openapi.json; do
    url="https://qms.bigshuaibee.cn$path"
    status=$(curl --fail --silent --show-error --retry 8 --retry-all-errors \
      --retry-delay 3 --max-time 20 --output /dev/null --write-out '%{http_code}' "$url") || return 1
    if [[ "$status" != 200 ]]; then
      echo "$url returned HTTP $status, expected 200" >&2
      return 1
    fi
  done
}

previous_application_running() {
  local service repository container actual expected
  for service in api worker web; do
    repository=qms2-foundation-api
    if [[ "$service" == web ]]; then repository=qms2-foundation-web; fi
    container=$("$@" ps -q "$service") && [[ -n "$container" ]] || return 1
    expected=$(docker image inspect --format '{{.Id}}' "$repository:$previous_sha") || return 1
    actual=$(docker inspect --format '{{.Image}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container") || return 1
    if [[ "$service" == api ]]; then
      [[ "$actual" == "$expected|running|healthy" ]] || return 1
    else
      [[ "$actual" == "$expected|running|" || "$actual" == "$expected|running|healthy" ]] || return 1
    fi
  done
}

recover_previous_application() (
  if [[ -z "$previous_sha" ]]; then
    echo 'No last successful SHA is recorded; inspect services before retrying' >&2
    return 1
  fi
  if previous_application_running "${compose[@]}" && verify_application "${compose[@]}"; then
    echo "Previous deployment is still healthy: $previous_sha"
    return 0
  fi

  export QMS_IMAGE_TAG=$previous_sha
  docker image inspect "qms2-foundation-api:$previous_sha" "qms2-foundation-web:$previous_sha" >/dev/null || return 1
  local compose_file
  local rollback=(docker compose --project-name qms2-foundation --project-directory "$app" --env-file "$env_file")
  for compose_file in "${compose_files[@]}"; do
    git -C "$repo" show "$previous_sha:qms-2.0/$compose_file" > "$work_directory/${compose_file##*/}" || return 1
    rollback+=(-f "$work_directory/${compose_file##*/}")
  done
  "${rollback[@]}" up -d --no-deps --no-build --pull never --wait --wait-timeout 180 api worker web || return 1
  previous_application_running "${rollback[@]}" && verify_application "${rollback[@]}" || return 1
  echo "Previous deployment restored and verified: $previous_sha"
)

finish_deployment() {
  local result=$1
  if (( result != 0 )); then
    echo "Deployment failed: target=$sha phase=$deployment_phase last_successful=${previous_sha:-unknown} exit=$result" >&2
    if [[ -e /opt/qms2/migration-started-sha ]]; then
      local migration_sha
      read -r migration_sha </opt/qms2/migration-started-sha || migration_sha=unknown
      if [[ ! "$migration_sha" =~ ^[0-9a-f]{40}$ ]]; then migration_sha=unknown; fi
      echo "Automatic rollback disabled: migration $migration_sha started and its effects must be verified" >&2
    elif [[ "$deployment_phase" == pre-migration ]]; then
      recover_previous_application || echo 'Previous application could not be verified or restored; manual recovery required' >&2
    fi
    "${compose[@]}" ps --all postgres rustfs clamav api worker web >&2 || :
  fi
  rm -f -- "$work_directory/marker" "$work_directory/migration" \
    "$work_directory/docker-compose.foundation.yml" "$work_directory/docker-compose.production.yml" "$work_directory/docker-compose.scanning.yml"
  rmdir -- "$work_directory" || :
  exit "$result"
}
trap 'finish_deployment $?' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

git -C "$repo" merge --ff-only "$sha"
cd "$app"

"${compose[@]}" config --quiet
docker_root=$(docker info --format '{{.DockerRootDir}}')
minimum_free_bytes=8589934592
for storage in "$docker_root" /opt/qms2; do
  available=$(df -B1 --output=avail -- "$storage" | tail -n 1 | tr -d '[:space:]')
  if [[ ! "$available" =~ ^[0-9]+$ ]] || (( available < minimum_free_bytes )); then
    echo "Insufficient deployment disk space: $storage available=${available:-unknown} required=$minimum_free_bytes bytes" >&2
    DRY_RUN=1 bash deployment/deploy-cleanup.sh --lock-held </dev/null || :
    exit 1
  fi
done
if [[ "$sha" == "$previous_sha" ]]; then
  docker image inspect "qms2-foundation-api:$sha" "qms2-foundation-web:$sha" >/dev/null
else
  "${compose[@]}" build api
  "${compose[@]}" build web
fi

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

deployment_phase=migration
printf '%s\n' "$sha" > "$work_directory/migration"
mv -- "$work_directory/migration" /opt/qms2/migration-started-sha
"${compose[@]}" run --rm --no-deps api node node_modules/prisma/build/index.js migrate deploy </dev/null
deployment_phase=application
"${compose[@]}" up -d --no-build --wait --wait-timeout 180 api worker web
verify_application "${compose[@]}"
"${compose[@]}" ps
printf '%s\n' "$sha" > "$work_directory/marker"
mv -- "$work_directory/marker" /opt/qms2/deployed-sha
rm -f -- /opt/qms2/migration-started-sha
if ! bash deployment/deploy-cleanup.sh --lock-held </dev/null; then
  echo "Deployment healthy: $sha; storage cleanup failed; deployed SHA retained" >&2
fi
echo "Deployment successful: $sha"
