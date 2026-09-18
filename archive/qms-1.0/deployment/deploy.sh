#!/bin/bash
# Production deployment script for QMS.

set -e
set -u

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="${PROJECT_ROOT}/.env.production"
BACKUP_DIR="${PROJECT_ROOT}/deployment/backup"
LOG_FILE="${PROJECT_ROOT}/deployment/deploy_$(date +%Y%m%d_%H%M%S).log"
COMPOSE_CMD=(docker compose --env-file "$ENV_FILE")

print_info() {
    echo -e "${BLUE}[INFO]${NC} $1" | tee -a "$LOG_FILE"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1" | tee -a "$LOG_FILE"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1" | tee -a "$LOG_FILE"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$LOG_FILE"
}

check_prerequisites() {
    print_info "Checking prerequisites..."

    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed."
        exit 1
    fi
    print_success "Docker is installed: $(docker --version)"

    if ! command -v docker compose &> /dev/null; then
        print_error "Docker Compose is not installed."
        exit 1
    fi
    print_success "Docker Compose is installed: $(docker compose version)"

    if [ ! -f "$ENV_FILE" ]; then
        print_error "Environment file not found: $ENV_FILE"
        exit 1
    fi
    print_success "Environment file found: $ENV_FILE"

    source "$ENV_FILE"
    if [ -z "${DB_PASSWORD:-}" ] || [ "${DB_PASSWORD}" = "CHANGE_ME_STRONG_PASSWORD_HERE" ]; then
        print_error "DB_PASSWORD is not configured in $ENV_FILE"
        exit 1
    fi
    if [ -z "${SECRET_KEY:-}" ] || [ "${SECRET_KEY}" = "CHANGE_ME_GENERATE_STRONG_SECRET_KEY_HERE" ]; then
        print_error "SECRET_KEY is not configured in $ENV_FILE"
        exit 1
    fi

    print_success "Required environment variables are configured"
}

backup_database() {
    print_info "Creating database backup..."

    mkdir -p "$BACKUP_DIR"
    BACKUP_FILE="${BACKUP_DIR}/qms_db_backup_$(date +%Y%m%d_%H%M%S).sql"

    if docker ps | grep -q qms_postgres; then
        docker exec qms_postgres pg_dump -U qms_user qms_db > "$BACKUP_FILE"
        print_success "Database backup created: $BACKUP_FILE"
    else
        print_warning "PostgreSQL container not running, skipping backup"
    fi
}

stop_services() {
    print_info "Stopping existing services..."
    cd "$PROJECT_ROOT"
    "${COMPOSE_CMD[@]}" down
    print_success "Services stopped"
}

start_services() {
    print_info "Building and starting services..."
    cd "$PROJECT_ROOT"

    print_info "Building Docker images..."
    "${COMPOSE_CMD[@]}" build --no-cache

    print_info "Starting services..."
    "${COMPOSE_CMD[@]}" up -d

    print_success "Services started"
}

check_database_auth() {
    print_info "Validating database credentials before migrations..."
    cd "$PROJECT_ROOT"

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
        print_success "Database credentials are valid"
    else
        print_error "Database authentication failed for qms_user."
        print_error "The DB_PASSWORD in $ENV_FILE does not match the password stored in the existing PostgreSQL volume."
        print_error "If this server already has data, update qms_user password inside PostgreSQL to match .env.production and rerun deployment."
        print_error "If this is a disposable environment, remove the qms_postgres_data volume and redeploy."
        exit 1
    fi
}

run_migrations() {
    print_info "Running database migrations..."
    print_info "Waiting for database to be ready..."
    sleep 10

    "${COMPOSE_CMD[@]}" exec -T backend-stable alembic upgrade head
    print_success "Database migrations completed successfully"
}

verify_services() {
    print_info "Verifying services..."

    EXPECTED_CONTAINERS=(
        "qms_postgres"
        "qms_redis"
        "qms_backend_stable"
        "qms_backend_preview"
        "qms_frontend_stable"
        "qms_frontend_preview"
        "qms_nginx"
        "qms_celery_worker"
        "qms_celery_beat"
    )

    for container in "${EXPECTED_CONTAINERS[@]}"; do
        if docker ps | grep -q "$container"; then
            print_success "Container running: $container"
        else
            print_error "Container not running: $container"
            docker logs "$container" | tail -20 || true
            exit 1
        fi
    done

    sleep 5

    curl -f http://localhost:8000/health > /dev/null
    print_success "Backend (Stable) is healthy"

    curl -f http://localhost:8001/health > /dev/null
    print_success "Backend (Preview) is healthy"

    curl -f http://localhost/health > /dev/null
    print_success "Nginx is healthy"
}

run_functional_tests() {
    print_info "Running functional verification tests..."

    print_info "Testing database connection..."
    "${COMPOSE_CMD[@]}" exec -T backend-stable python -c "
from sqlalchemy import text
from app.core.database import engine
import asyncio
async def test_db():
    async with engine.begin() as conn:
        await conn.execute(text('SELECT 1'))
        print('Database connection successful')
asyncio.run(test_db())
"

    source "$ENV_FILE"
    print_info "Testing Redis connection..."
    "${COMPOSE_CMD[@]}" exec -T redis redis-cli -a "$REDIS_PASSWORD" ping | grep -q PONG
    print_success "Redis connection successful"
}

display_summary() {
    source "$ENV_FILE"
    print_info "=========================================="
    print_info "QMS Deployment Summary"
    print_info "=========================================="
    print_info "Deployment Time: $(date)"
    print_info "Environment file: $ENV_FILE"
    print_info ""
    print_info "Service URLs:"
    print_info "  - Stable Environment Domain: http://${PRIMARY_DOMAIN}"
    print_info "  - Preview Environment Domain: http://${PREVIEW_DOMAIN}"
    print_info "  - Nginx Proxy Target: http://${QMS_BIND_IP:-127.0.0.1}:${QMS_NGINX_PORT:-8081}"
    print_info "  - Backend API (Stable): http://${QMS_BIND_IP:-127.0.0.1}:${BACKEND_STABLE_PORT:-8000}"
    print_info "  - Backend API (Preview): http://${QMS_BIND_IP:-127.0.0.1}:${BACKEND_PREVIEW_PORT:-8001}"
    print_info "  - API Documentation: http://${QMS_BIND_IP:-127.0.0.1}:${BACKEND_STABLE_PORT:-8000}/api/docs"
    print_info "  - Nginx Proxy Manager should forward ${PRIMARY_DOMAIN} and ${PREVIEW_DOMAIN} to ${QMS_BIND_IP:-127.0.0.1}:${QMS_NGINX_PORT:-8081}"
    print_info ""
    print_info "Container Status:"
    "${COMPOSE_CMD[@]}" ps
    print_info ""
    print_info "Logs Location: $LOG_FILE"
    print_info "=========================================="
}

main() {
    print_info "Starting QMS deployment..."
    print_info "Log file: $LOG_FILE"

    check_prerequisites
    backup_database
    stop_services
    start_services
    check_database_auth
    run_migrations
    verify_services
    run_functional_tests
    display_summary

    print_success "QMS deployment completed successfully."
}

main "$@"
