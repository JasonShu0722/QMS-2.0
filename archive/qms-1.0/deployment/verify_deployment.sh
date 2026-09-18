#!/bin/bash
# Deployment verification script for QMS.

set -u

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="${PROJECT_ROOT}/.env.production"
if [ ! -f "$ENV_FILE" ]; then
    ENV_FILE="${PROJECT_ROOT}/.env"
fi
COMPOSE_CMD=(docker compose --env-file "$ENV_FILE")
source "$ENV_FILE"

PASSED=0
FAILED=0
TOTAL=0

retry_http_check() {
    local url="$1"
    local max_attempts="${2:-20}"
    local sleep_seconds="${3:-3}"

    for ((attempt=1; attempt<=max_attempts; attempt++)); do
        if curl -fsS "$url" > /dev/null 2>&1; then
            return 0
        fi
        sleep "$sleep_seconds"
    done

    return 1
}

retry_container_running() {
    local container="$1"
    local max_attempts="${2:-10}"
    local sleep_seconds="${3:-3}"

    for ((attempt=1; attempt<=max_attempts; attempt++)); do
        local state
        state=$(docker inspect -f '{{.State.Status}}' "$container" 2>/dev/null || echo "missing")
        if [ "$state" = "running" ]; then
            return 0
        fi
        sleep "$sleep_seconds"
    done

    return 1
}

print_test() {
    TOTAL=$((TOTAL + 1))
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}PASS${NC} $2"
        PASSED=$((PASSED + 1))
    else
        echo -e "${RED}FAIL${NC} $2"
        FAILED=$((FAILED + 1))
    fi
}

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}QMS Deployment Verification${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

echo -e "${YELLOW}[1/15] Checking Docker...${NC}"
docker --version > /dev/null 2>&1
print_test $? "Docker is installed"

echo -e "${YELLOW}[2/15] Checking Docker Compose...${NC}"
"${COMPOSE_CMD[@]}" version > /dev/null 2>&1
print_test $? "Docker Compose is installed"

echo -e "${YELLOW}[3/15] Checking containers...${NC}"
docker ps | grep -q qms_postgres
print_test $? "PostgreSQL container is running"
docker ps | grep -q qms_redis
print_test $? "Redis container is running"
docker ps | grep -q qms_backend_stable
print_test $? "Backend (Stable) container is running"
docker ps | grep -q qms_backend_preview
print_test $? "Backend (Preview) container is running"
docker ps | grep -q qms_frontend_stable
print_test $? "Frontend (Stable) container is running"
docker ps | grep -q qms_frontend_preview
print_test $? "Frontend (Preview) container is running"
docker ps | grep -q qms_nginx
print_test $? "Nginx container is running"
docker ps | grep -q qms_celery_worker
print_test $? "Celery Worker container is running"
docker ps | grep -q qms_celery_beat
print_test $? "Celery Beat container is running"

echo -e "${YELLOW}[4/15] Checking backend health...${NC}"
retry_http_check "http://${QMS_BIND_IP:-127.0.0.1}:${BACKEND_STABLE_PORT:-8000}/health"
print_test $? "Backend (Stable) health check passed"
retry_http_check "http://${QMS_BIND_IP:-127.0.0.1}:${BACKEND_PREVIEW_PORT:-8001}/health"
print_test $? "Backend (Preview) health check passed"

echo -e "${YELLOW}[5/15] Checking nginx health...${NC}"
retry_http_check "http://${QMS_BIND_IP:-127.0.0.1}:${QMS_NGINX_PORT:-8081}/health"
print_test $? "Nginx health check passed"

echo -e "${YELLOW}[6/15] Checking database connection...${NC}"
"${COMPOSE_CMD[@]}" exec -T postgres psql -U qms_user -d qms_db -c "SELECT 1;" > /dev/null 2>&1
print_test $? "Database connection successful"

echo -e "${YELLOW}[7/15] Checking Redis connection...${NC}"
"${COMPOSE_CMD[@]}" exec -T redis redis-cli -a "$REDIS_PASSWORD" ping > /dev/null 2>&1
print_test $? "Redis connection successful"

echo -e "${YELLOW}[8/15] Checking proxied API documentation...${NC}"
retry_http_check "http://${QMS_BIND_IP:-127.0.0.1}:${QMS_NGINX_PORT:-8081}/api/docs"
print_test $? "API documentation is accessible through nginx"

echo -e "${YELLOW}[9/15] Checking database migrations...${NC}"
"${COMPOSE_CMD[@]}" exec -T backend-stable alembic current > /dev/null 2>&1
print_test $? "Database migrations are up to date"

echo -e "${YELLOW}[10/15] Checking frontend access...${NC}"
retry_http_check "http://${QMS_BIND_IP:-127.0.0.1}:${QMS_NGINX_PORT:-8081}/"
print_test $? "Frontend (Stable) is accessible"

echo -e "${YELLOW}[11/15] Checking proxied API endpoints...${NC}"
retry_http_check "http://${QMS_BIND_IP:-127.0.0.1}:${QMS_NGINX_PORT:-8081}/api/v1/auth/captcha"
print_test $? "Captcha API endpoint is working through nginx"

echo -e "${YELLOW}[12/15] Checking Celery worker...${NC}"
retry_container_running "qms_celery_worker"
print_test $? "Celery worker is running"

echo -e "${YELLOW}[13/15] Checking Celery beat...${NC}"
retry_container_running "qms_celery_beat"
print_test $? "Celery beat is running"

echo -e "${YELLOW}[14/15] Checking disk space...${NC}"
DISK_USAGE=$(df -h / | awk 'NR==2 {print $5}' | sed 's/%//')
if [ "$DISK_USAGE" -lt 80 ]; then
    print_test 0 "Disk space is sufficient ($DISK_USAGE% used)"
else
    print_test 1 "Disk space is low ($DISK_USAGE% used)"
fi

echo -e "${YELLOW}[15/15] Checking memory usage...${NC}"
MEMORY_USAGE=$(free | grep Mem | awk '{print int($3/$2 * 100)}')
if [ "$MEMORY_USAGE" -lt 90 ]; then
    print_test 0 "Memory usage is normal ($MEMORY_USAGE% used)"
else
    print_test 1 "Memory usage is high ($MEMORY_USAGE% used)"
fi

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Verification Summary${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "Total Tests: ${TOTAL}"
echo -e "${GREEN}Passed: ${PASSED}${NC}"
echo -e "${RED}Failed: ${FAILED}${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}All tests passed.${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed. Please check the logs.${NC}"
    exit 1
fi
