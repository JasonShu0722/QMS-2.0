#!/bin/bash
# QMS Database Backup Script
# QMS 数据库备份脚本

set -e  # Exit on error

# ============================================
# Configuration (配置)
# ============================================
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="qms_backup_${TIMESTAMP}.sql.gz"
LOG_FILE="${BACKUP_DIR}/backup.log"

# Database credentials from environment
DB_HOST="${DB_HOST:-postgres}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-qms_db}"
DB_USER="${DB_USER:-qms_user}"
DB_PASSWORD="${DB_PASSWORD}"

# ============================================
# Functions (函数)
# ============================================

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

check_prerequisites() {
    log "检查备份前置条件..."
    
    # Check if backup directory exists
    if [ ! -d "$BACKUP_DIR" ]; then
        log "创建备份目录: $BACKUP_DIR"
        mkdir -p "$BACKUP_DIR"
    fi
    
    # Check if pg_dump is available
    if ! command -v pg_dump &> /dev/null; then
        log "错误: pg_dump 命令不存在，请安装 postgresql-client"
        exit 1
    fi
    
    # Check database connection
    if ! PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" &> /dev/null; then
        log "错误: 无法连接到数据库"
        exit 1
    fi
    
    log "前置条件检查通过"
}

perform_backup() {
    log "开始备份数据库: $DB_NAME"
    
    # Perform backup with compression
    PGPASSWORD="$DB_PASSWORD" pg_dump \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        --format=plain \
        --no-owner \
        --no-acl \
        --verbose \
        2>> "$LOG_FILE" | gzip > "${BACKUP_DIR}/${BACKUP_FILE}"
    
    if [ $? -eq 0 ]; then
        BACKUP_SIZE=$(du -h "${BACKUP_DIR}/${BACKUP_FILE}" | cut -f1)
        log "备份成功: ${BACKUP_FILE} (大小: ${BACKUP_SIZE})"
    else
        log "错误: 备份失败"
        exit 1
    fi
}

verify_backup() {
    log "验证备份文件完整性..."
    
    # Check if file exists and is not empty
    if [ ! -s "${BACKUP_DIR}/${BACKUP_FILE}" ]; then
        log "错误: 备份文件为空或不存在"
        exit 1
    fi
    
    # Test gzip integrity
    if ! gzip -t "${BACKUP_DIR}/${BACKUP_FILE}" 2>> "$LOG_FILE"; then
        log "错误: 备份文件损坏"
        exit 1
    fi
    
    log "备份文件验证通过"
}

cleanup_old_backups() {
    log "清理 ${RETENTION_DAYS} 天前的旧备份..."
    
    # Find and delete old backups
    DELETED_COUNT=$(find "$BACKUP_DIR" -name "qms_backup_*.sql.gz" -type f -mtime +${RETENTION_DAYS} -delete -print | wc -l)
    
    if [ "$DELETED_COUNT" -gt 0 ]; then
        log "已删除 ${DELETED_COUNT} 个旧备份文件"
    else
        log "没有需要清理的旧备份"
    fi
}

generate_backup_report() {
    log "生成备份报告..."
    
    TOTAL_BACKUPS=$(find "$BACKUP_DIR" -name "qms_backup_*.sql.gz" -type f | wc -l)
    TOTAL_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
    OLDEST_BACKUP=$(find "$BACKUP_DIR" -name "qms_backup_*.sql.gz" -type f -printf '%T+ %p\n' | sort | head -1 | cut -d' ' -f2- | xargs basename)
    NEWEST_BACKUP=$(find "$BACKUP_DIR" -name "qms_backup_*.sql.gz" -type f -printf '%T+ %p\n' | sort | tail -1 | cut -d' ' -f2- | xargs basename)
    
    cat << EOF | tee -a "$LOG_FILE"

========================================
备份报告
========================================
备份时间: $(date '+%Y-%m-%d %H:%M:%S')
备份文件: ${BACKUP_FILE}
备份大小: ${BACKUP_SIZE}
总备份数: ${TOTAL_BACKUPS}
总占用空间: ${TOTAL_SIZE}
最旧备份: ${OLDEST_BACKUP}
最新备份: ${NEWEST_BACKUP}
保留策略: ${RETENTION_DAYS} 天
========================================

EOF
}

send_notification() {
    local status=$1
    local message=$2
    
    # Send email notification (if configured)
    if [ -n "$SMTP_SERVER" ] && [ -n "$SMTP_FROM_EMAIL" ]; then
        log "发送邮件通知..."
        # Email sending logic here (requires mail command or similar)
    fi
    
    # Send WeChat Work notification (if configured)
    if [ -n "$WECHAT_WEBHOOK_URL" ]; then
        log "发送企业微信通知..."
        curl -s -X POST "$WECHAT_WEBHOOK_URL" \
            -H 'Content-Type: application/json' \
            -d "{
                \"msgtype\": \"text\",
                \"text\": {
                    \"content\": \"QMS数据库备份${status}\n${message}\"
                }
            }" &> /dev/null
    fi
}

# ============================================
# Main Execution (主执行流程)
# ============================================

main() {
    log "=========================================="
    log "QMS 数据库备份任务开始"
    log "=========================================="
    
    check_prerequisites
    perform_backup
    verify_backup
    cleanup_old_backups
    generate_backup_report
    
    log "=========================================="
    log "QMS 数据库备份任务完成"
    log "=========================================="
    
    send_notification "成功" "备份文件: ${BACKUP_FILE}"
}

# Error handler
trap 'log "错误: 备份过程中发生异常"; send_notification "失败" "请检查日志: ${LOG_FILE}"; exit 1' ERR

# Run main function
main

exit 0
