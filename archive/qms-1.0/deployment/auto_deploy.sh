#!/bin/bash
# Auto-deploy script for QMS production server.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DEPLOY_BRANCH="${1:-main}"
ENV_FILE="${PROJECT_ROOT}/.env.production"
ENV_BACKUP="$(mktemp)"
ENV_RESTORE_PENDING=0
COMPOSE_CMD=(docker compose --env-file "$ENV_FILE")
DEPLOY_REMOTE="origin"

cleanup() {
    if [ "${ENV_RESTORE_PENDING:-0}" -eq 1 ] && [ -f "$ENV_BACKUP" ]; then
        cp "$ENV_BACKUP" "$ENV_FILE"
    fi
    rm -f "$ENV_BACKUP"
}

trap cleanup EXIT

resolve_deploy_remote() {
    if [ -n "${DEPLOY_REMOTE_URL:-}" ]; then
        DEPLOY_REMOTE="${DEPLOY_REMOTE_URL}"
        echo "[INFO] Using explicit deploy remote URL"
        return
    fi

    if [ -n "${GITHUB_DEPLOY_TOKEN:-}" ] && [ -n "${GITHUB_REPOSITORY:-}" ]; then
        DEPLOY_REMOTE="https://x-access-token:${GITHUB_DEPLOY_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
        echo "[INFO] Using GitHub Actions token for authenticated fetch"
    fi
}

check_database_auth() {
    echo "[INFO] Validating database credentials before migrations"

    if "${COMPOSE_CMD[@]}" exec -T backend-stable python - <<'PY'
from sqlalchemy import text
from app.core.database import engine
import asyncio

async def main():
    async with engine.begin() as conn:
        await conn.execute(text("SELECT 1"))

asyncio.run(main())
PY
    then
        echo "[INFO] Database credentials are valid"
    else
        echo "[ERROR] Database authentication failed for qms_user"
        echo "[ERROR] The DB_PASSWORD in .env.production does not match the password stored in the existing PostgreSQL volume"
        echo "[ERROR] If this server already has data, update qms_user password inside PostgreSQL to match .env.production and rerun deployment"
        echo "[ERROR] If this is a disposable environment, remove the qms_postgres_data volume and redeploy"
        exit 1
    fi
}

echo "[INFO] Starting auto-deploy for branch: ${DEPLOY_BRANCH}"

if [ ! -f "$ENV_FILE" ]; then
    echo "[ERROR] Missing environment file: $ENV_FILE"
    exit 1
fi

cd "$PROJECT_ROOT"

echo "[INFO] Backing up local .env.production"
cp "$ENV_FILE" "$ENV_BACKUP"
ENV_RESTORE_PENDING=1

resolve_deploy_remote

echo "[INFO] Fetching latest code"
git fetch "$DEPLOY_REMOTE" "$DEPLOY_BRANCH" --prune

echo "[INFO] Updating working tree"
git checkout -- .env.production
if git show-ref --verify --quiet "refs/heads/${DEPLOY_BRANCH}"; then
    git checkout "$DEPLOY_BRANCH"
    git merge --ff-only FETCH_HEAD
else
    git checkout -b "$DEPLOY_BRANCH" FETCH_HEAD
fi

echo "[INFO] Restoring server-specific .env.production"
cp "$ENV_BACKUP" "$ENV_FILE"
ENV_RESTORE_PENDING=0

echo "[INFO] Building and updating containers"
"${COMPOSE_CMD[@]}" up -d --build

check_database_auth

echo "[INFO] Refreshing nginx gateway"
"${COMPOSE_CMD[@]}" restart nginx

echo "[INFO] Running database migrations"
"${COMPOSE_CMD[@]}" exec -T backend-stable alembic upgrade head

echo "[INFO] Verifying deployment"
bash "${PROJECT_ROOT}/deployment/verify_deployment.sh"

echo "[SUCCESS] Auto-deploy completed"
