#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C
shopt -s dotglob nullglob

qms_root=/opt/qms2
lock_file=$qms_root/deploy.lock
sha_pattern='[0-9a-f]{40}'
id_pattern='sha256:[0-9a-f]{64}'
snapshot_pattern='snapshot\.[a-zA-Z0-9]{8}'
dry_run=${DRY_RUN:-1}

warn() { printf 'Warning: %s\n' "$*" >&2; }
usage() {
  echo 'Usage: DRY_RUN=1 bash deploy-cleanup.sh | bash deploy-cleanup.sh --apply | bash deploy-cleanup.sh --lock-held' >&2
  exit 2
}

case "${1:-}" in
  --lock-held) [[ $# -eq 1 ]] || usage ;;
  --apply)
    [[ $# -eq 1 ]] || usage
    dry_run=${DRY_RUN:-0}
    ;;
  '') [[ $# -eq 0 && ${DRY_RUN:-} == 1 ]] || usage ;;
  *) usage ;;
esac
[[ "$dry_run" == 0 || "$dry_run" == 1 ]] || usage

safe_directory() {
  [[ -d "$1" && ! -L "$1" && $(realpath -- "$1" 2>/dev/null) == "$1" &&
     $(stat -c %u -- "$1" 2>/dev/null) == 0 && $(stat -c %a -- "$1" 2>/dev/null) =~ ^($2)$ ]]
}

if [[ $(id -u) != 0 ]] || ! safe_directory "$qms_root" '700|750|755'; then
  warn 'Cleanup requires root and a trusted QMS directory'
  exit 1
fi
if [[ -L "$lock_file" || ( -e "$lock_file" && ( ! -f "$lock_file" || $(stat -c %u -- "$lock_file") != 0 ) ) ]]; then
  warn 'Unsafe deployment lock'
  exit 1
fi
if [[ ${1:-} == --lock-held ]]; then
  if [[ ! /dev/fd/9 -ef "$lock_file" ]] || ! flock -n 9; then
    warn 'Cleanup requires the inherited deployment lock on descriptor 9'
    exit 1
  fi
else
  exec 9<>"$lock_file"
  flock -w 600 9 || { warn 'Another deployment holds the lock'; exit 1; }
fi

cleanup_images() {
  local container_list inspected inventory repo sha image_id created ref reason deployed_sha=
  local marker=$qms_root/deployed-sha ranked kept=0 failed=0
  local -a containers=() refs=() pairs=()
  local -A used_ids=() runtime_shas=() image_ids=() api_created=() web_created=() recent=()

  if [[ -e "$marker" || -L "$marker" ]]; then
    if [[ ! -f "$marker" || -L "$marker" ]] || ! deployed_sha=$(cat -- "$marker" 2>/dev/null) ||
       [[ ! "$deployed_sha" =~ ^$sha_pattern$ ]]; then
      warn 'Skipping image cleanup because the deployed SHA marker is invalid'
      return 1
    fi
    runtime_shas[$deployed_sha]=1
  fi

  if ! container_list=$(docker container ls --all --quiet --no-trunc 2>/dev/null); then
    warn 'Could not list all containers; skipping image cleanup'
    return 1
  fi
  if [[ -n "$container_list" ]]; then
    mapfile -t containers <<< "$container_list"
    if ! inspected=$(docker container inspect --format '{{.Image}}|{{.Config.Image}}' "${containers[@]}" 2>/dev/null); then
      warn 'Could not inspect all containers; skipping image cleanup'
      return 1
    fi
    local inspected_count=0
    while IFS='|' read -r image_id ref; do
      if [[ ! "$image_id" =~ ^$id_pattern$ || -z "$ref" ]]; then
        warn 'Invalid container image inspection; skipping image cleanup'
        return 1
      fi
      used_ids[$image_id]=1
      ((inspected_count+=1))
      if [[ "$ref" =~ ^((docker\.io/)?library/)?qms2-foundation-(api|web):($sha_pattern)$ ]]; then
        runtime_shas[${BASH_REMATCH[4]}]=1
      fi
    done <<< "$inspected"
    if (( inspected_count != ${#containers[@]} )); then
      warn 'Incomplete container image inspection; skipping image cleanup'
      return 1
    fi
  fi

  if ! inventory=$(TZ=UTC docker image ls --no-trunc --format '{{.Repository}}|{{.Tag}}|{{.ID}}|{{.CreatedAt}}' 2>/dev/null); then
    warn 'Could not list images; skipping image cleanup'
    return 1
  fi
  while IFS='|' read -r repo sha image_id created; do
    [[ "$repo" == qms2-foundation-api || "$repo" == qms2-foundation-web ]] || continue
    [[ "$sha" =~ ^$sha_pattern$ ]] || continue
    ref=$repo:$sha
    if [[ ! "$image_id" =~ ^$id_pattern$ || ! "$created" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}:[0-9]{2}\ \+0000\ UTC$ ||
          -v image_ids[$ref] ]]; then
      warn 'Invalid QMS image inventory; skipping image cleanup'
      return 1
    fi
    refs+=("$ref")
    image_ids[$ref]=$image_id
    if [[ "$repo" == qms2-foundation-api ]]; then
      api_created[$sha]=$created
    else
      web_created[$sha]=$created
    fi
  done <<< "$inventory"

  for sha in "${!api_created[@]}"; do
    [[ -v web_created[$sha] && ! -v runtime_shas[$sha] ]] || continue
    created=${api_created[$sha]}
    if [[ ${web_created[$sha]} > "$created" ]]; then created=${web_created[$sha]}; fi
    pairs+=("$created|$sha")
  done
  if ((${#pairs[@]})); then
    ranked=$(printf '%s\n' "${pairs[@]}" | sort -t '|' -k1,1r -k2,2) || return 1
    while IFS='|' read -r created sha; do
      recent[$sha]=1
      ((kept+=1))
      if (( kept == 3 )); then break; fi
    done <<< "$ranked"
  fi

  for ref in "${refs[@]}"; do
    sha=${ref#*:}
    image_id=${image_ids[$ref]}
    reason=
    if [[ -v used_ids[$image_id] ]]; then
      reason='container image ID'
    elif [[ -v runtime_shas[$sha] ]]; then
      reason='runtime SHA'
    elif [[ -v recent[$sha] ]]; then
      reason='recent complete history'
    fi
    if [[ -n "$reason" ]]; then
      printf 'Skip image %s (%s)\n' "$ref" "$reason"
    else
      printf 'Candidate image %s\n' "$ref"
      if [[ "$dry_run" == 0 ]]; then
        if docker image rm --no-prune "$ref" >/dev/null 2>&1; then
          printf 'Removed image tag %s\n' "$ref"
        else
          warn "Could not remove image tag $ref"
          failed=1
        fi
      fi
    fi
  done
  return "$failed"
}

safe_backup_file() {
  [[ -f "$1" && ! -L "$1" && $(stat -c %u -- "$1" 2>/dev/null) == 0 &&
     $(stat -c %a -- "$1" 2>/dev/null) == 600 && $(stat -c %h -- "$1" 2>/dev/null) == 1 ]]
}

valid_snapshot() {
  local directory=$1 key=$2 size
  local -a contents=("$directory"/*)
  (( ${#contents[@]} == 2 )) && safe_backup_file "$directory/database.dump.enc" &&
    safe_backup_file "$directory/database.sha256" && safe_backup_file "$key" &&
    size=$(stat -c %s -- "$directory/database.dump.enc" 2>/dev/null) &&
    (( size >= 32 && (size - 16) % 16 == 0 )) &&
    head -c 8 -- "$directory/database.dump.enc" 2>/dev/null | cmp -s - <(printf Salted__) &&
    [[ $(stat -c %s -- "$directory/database.sha256" 2>/dev/null) == 65 &&
       $(stat -c %s -- "$key" 2>/dev/null) == 65 ]] &&
    grep -qxE '[0-9a-f]{64}' "$directory/database.sha256" 2>/dev/null &&
    grep -qxE '[A-Za-z0-9+/]{64}' "$key" 2>/dev/null
}

cleanup_backups() {
  local backups=$qms_root/migration-backups-v1 keys=$qms_root/migration-backup-keys-v1
  local parent directory sha name key label modified newest= latest=-1 now cutoff failed=0
  local -a contents=()
  local -A valid=()
  if [[ ! -e "$backups" && ! -L "$backups" && ! -e "$keys" && ! -L "$keys" ]]; then
    echo 'Skip backups (no migration backup directories)'
    return 0
  fi
  if ! safe_directory "$backups" 700 || ! safe_directory "$keys" 700; then
    warn 'Missing or unsafe migration backup directories; skipping backup cleanup'
    return 1
  fi
  now=$(date +%s) || return 1
  cutoff=$((now - 14 * 86400))
  for parent in "$backups"/*; do
    sha=${parent##*/}
    if [[ ! "$sha" =~ ^$sha_pattern$ ]] || ! safe_directory "$parent" 700; then
      warn 'Skipping unexpected entry in migration backup root'
      continue
    fi
    contents=("$parent"/*)
    if (( ${#contents[@]} == 0 )); then warn "No snapshots in migration backup directory $sha"; fi
    for directory in "${contents[@]}"; do
      name=${directory##*/}
      if [[ ! "$name" =~ ^$snapshot_pattern$ ]]; then
        warn "Skipping unexpected snapshot entry for $sha"
        continue
      fi
      label=$sha/$name
      key=$keys/$sha.$name.key
      if ! safe_directory "$directory" 700 || ! valid_snapshot "$directory" "$key" ||
         ! modified=$(stat -c %Y -- "$directory/database.dump.enc" 2>/dev/null); then
        warn "Skipping partial or unsafe snapshot $label"
        continue
      fi
      valid[$label]=1
      if (( modified > latest )) || { (( modified == latest )) && [[ "$label" < "$newest" ]]; }; then
        newest=$label
        latest=$modified
      fi
    done
  done

  for key in "$keys"/*; do
    name=${key##*/}
    if [[ "$name" =~ ^($sha_pattern)\.($snapshot_pattern)\.key$ ]]; then
      label=${BASH_REMATCH[1]}/${BASH_REMATCH[2]}
      if [[ ! -v valid[$label] ]]; then warn "Orphan or invalid snapshot key for $label"; fi
    else
      warn 'Skipping unexpected entry in migration backup key directory'
    fi
  done

  for label in "${!valid[@]}"; do
    directory=$backups/$label
    parent=${directory%/*}
    key=$keys/${label/\//.}.key
    if [[ "$label" == "$newest" ]]; then
      printf 'Skip snapshot %s (latest valid snapshot)\n' "$label"
      continue
    fi
    if ! safe_directory "$parent" 700 || ! safe_directory "$directory" 700 || ! valid_snapshot "$directory" "$key" ||
       ! modified=$(stat -c %Y -- "$directory" "$directory/database.dump.enc" "$directory/database.sha256" "$key" 2>/dev/null); then
      warn "Could not recheck snapshot $label"
      failed=1
      continue
    fi
    local timestamp expired=1
    for timestamp in $modified; do
      if (( timestamp >= cutoff )); then expired=0; fi
    done
    if (( expired == 0 )); then
      printf 'Skip snapshot %s (within 14 days)\n' "$label"
      continue
    fi
    printf 'Candidate snapshot %s and matching key\n' "$label"
    if [[ "$dry_run" == 0 ]]; then
      if rm -- "$directory/database.dump.enc" "$directory/database.sha256" 2>/dev/null &&
         rmdir -- "$directory" 2>/dev/null && rm -- "$key" 2>/dev/null; then
        printf 'Removed snapshot %s and matching key\n' "$label"
        contents=("$parent"/*)
        if (( ${#contents[@]} == 0 )) && ! rmdir -- "$parent" 2>/dev/null; then
          warn "Could not remove empty snapshot directory for ${label%/*}"
          failed=1
        fi
      else
        warn "Could not remove snapshot pair $label"
        failed=1
      fi
    fi
  done
  return "$failed"
}

confirmed_builder() {
  [[ "$1" == default &&
     $(docker context inspect default --format '{{.Endpoints.docker.Host}}' 2>/dev/null) == unix:///var/run/docker.sock ]] || return 1
  local details
  details=$(docker buildx inspect default 2>/dev/null) || return 1
  awk '
    /^Name:/ { names++; if (NF != 2 || $2 != "default") invalid = 1 }
    /^Driver:/ { drivers++; if (NF != 2 || $2 != "docker") invalid = 1 }
    /^Endpoint:/ { endpoints++; if (NF != 2 || $2 != "default") invalid = 1 }
    /^Status:/ { running++; if (NF != 2 || $2 != "running") invalid = 1 }
    END { exit !(names == 2 && drivers == 1 && endpoints == 1 && running == 1 && !invalid) }
  ' <<< "$details"
}

cleanup_builder() {
  local context scope='existing dangling cache scope on the context builder'
  if [[ -n ${DOCKER_HOST:-} && -z ${DOCKER_CONTEXT:-} ]] ||
     ! context=$(docker context show 2>/dev/null) || [[ ! "$context" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]]; then
    warn 'Could not identify the Docker context builder; skipping builder cache cleanup'
    return 1
  fi
  local -a prune=(docker --context "$context" builder prune --builder "$context" --force)
  if [[ ${QMS_DEDICATED_BUILDER:-0} == 1 ]]; then
    if confirmed_builder "$context"; then
      prune=(docker --context default buildx prune --builder default --all --force)
      scope='all unused cache on the confirmed default local builder'
    else
      warn 'Dedicated builder scope could not be confirmed; using existing builder prune scope'
    fi
  fi
  printf 'Candidate builder cache (%s)\n' "$scope"
  if [[ "$dry_run" == 0 ]] && ! "${prune[@]}" 2>/dev/null; then
    warn 'Builder cache cleanup failed'
    return 1
  fi
}

docker_root=$(docker info --format '{{.DockerRootDir}}' 2>/dev/null) || { warn 'Could not identify Docker data directory'; exit 1; }
[[ "$docker_root" == /* && -d "$docker_root" ]] || { warn 'Docker data directory is not accessible locally'; exit 1; }
echo 'Disk usage before cleanup (KiB)'
df -k --output=size,used,avail,pcent,target -- "$qms_root" "$docker_root" || exit 1
status=0
cleanup_images || status=1
cleanup_backups || status=1
cleanup_builder || status=1
echo 'Disk usage after cleanup (KiB)'
df -k --output=size,used,avail,pcent,target -- "$qms_root" "$docker_root" || status=1
exit "$status"
