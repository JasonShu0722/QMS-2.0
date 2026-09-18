#!/bin/bash
# QMS Database Restore Script
# QMS 数据库恢复脚本

set -e  # Exit on error

# ============================================
# Configuration (配置)
# ============================================
BACKUP_DIR="${BACKUP_DIR:-/backups}"
LOG_FILE="${BACKUP_DIR}/restore.log"

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

usage() {
    cat << EOF
用法: $0 <backup_file>

参数:
  backup_file    备份文件名（例如: qms_backup_20260212_030000.sql.gz）
                 或使用 'latest' 恢复最新备份

示例:
  $0 qms_backup_20260212_030000.sql.gz
  $0 latest

EOF
    exit 1
}

list_backups() {
    log "可用的备份文件:"
    find "$BACKUP_DIR" -name "qms_backup_*.sql.gz" -type f -printf '%T+ %p\n' | sort -r | while read -r line; do
        timestamp=$(echo "$line" | cut -d' ' -f1)
        filepath=$(echo "$line" | cut -d' ' -f2-)
        filename=$(basename "$filepath")
        size=$(du -h "$filepath" | cut -f1)
        echo "  - $filename (时间: $timestamp, 大小: $size)"
    done
}

get_backup_file() {
    local input=$1
    
    if [ "$input" = "latest" ]; then
        BACKUP_FILE=$(find "$BACKUP_DIR" -name "qms_backup_*.sql.gz" -type f -printf '%T+ %p\n' | sort -r | head -1 | cut -d' ' -f2-)
        if [ -z "$BACKUP_FILE" ]; then
            log "错误: 没有找到备份文件"
            exit 1
        fi
        log "使用最新备份: $(basename $BACKUP_FILE)"
    else
        BACKUP_FILE="${BACKUP_DIR}/${input}"
        if [ ! -f "$BACKUP_FILE" ]; then
            log "错误: 备份文件不存在: $BACKUP_FILE"
            list_backups
            exit 1
        fi
    fi
}

confirm_restore() {
    log "=========================================="
    log "警告: 恢复操作将覆盖当前数据库!"
    log "数据库: $DB_NAME"
    log "备份文件: $(basename $BACKUP_FILE)"
    log "=========================================="
    
    read -p "确认要继续吗? (输入 'YES' 继续): " confirmation
    
    if [ "$confirmation" != "YES" ]; then
        log "操作已取消"
        exit 0
    fi
}

create_pre_restore_backup() {
    log "创建恢复前备份..."
    
    TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
    PRE_RESTORE_BACKUP="${BACKUP_DIR}/pre_restore_${TIMESTAMP}.sql.gz"
    
    PGPASSWORD="$DB_PASSWORD" pg_dump \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        --format=plain \
        --no-owner \
        --no-acl \
        2>> "$LOG_FILE" | gzip > "$PRE_RESTORE_BACKUP"
    
    if [ $? -eq 0 ]; then
        log "恢复前备份已创建: $(basename $PRE_RESTORE_BACKUP)"
    else
        log "警告: 恢复前备份失败，但将继续恢复操作"
    fi
}

verify_backup_file() {
    log "验证备份文件完整性..."
    
    if ! gzip -t "$BACKUP_FILE" 2>> "$LOG_FILE"; then
        log "错误: 备份文件损坏"
        exit 1
    fi
    
    log "备份文件验证通过"
}

terminate_connections() {
    log "终止现有数据库连接..."
    
    PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres << EOF 2>> "$LOG_FILE"
SELECT pg_terminate_backend(pg_stat_activity.pid)
FROM pg_stat_activity
WHERE pg_stat_activity.datname = '$DB_NAME'
  AND pid <> pg_backend_pid();
EOF
    
    log "数据库连接已终止"
}

drop_and_recreate_database() {
    log "重建数据库..."
    
    PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres << EOF 2>> "$LOG_FILE"
DROP DATABASE IF EXISTS $DB_NAME;
CREATE DATABASE $DB_NAME OWNER $DB_USER;
EOF
    
    if [ $? -eq 0 ]; then
        log "数据库已重建"
    else
        log "错误: 数据库重建失败"
        exit 1
    fi
}

perform_restore() {
    log "开始恢复数据库..."
    
    gunzip -c "$BACKUP_FILE" | PGPASSWORD="$DB_PASSWORD" psql \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        --single-transaction \
        2>> "$LOG_FILE"
    
    if [ $? -eq 0 ]; then
        log "数据库恢复成功"
    else
        log "错误: 数据库恢复失败"
        exit 1
    fi
}

verify_restore() {
    log "验证恢复结果..."
    
    # Check if database is accessible
    if ! PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" &> /dev/null; then
        log "错误: 恢复后数据库无法访问"
        exit 1
    fi
    
    # Count tables
    TABLE_COUNT=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'")
    
    log "恢复验证通过 (表数量: $TABLE_COUNT)"
}

generate_restore_report() {
    log "生成恢复报告..."
    
    cat << EOF | tee -a "$LOG_FILE"

========================================
恢复报告
========================================
恢复时间: $(date '+%Y-%m-%d %H:%M:%S')
备份文件: $(basename $BACKUP_FILE)
数据库: $DB_NAME
状态: 成功
========================================

EOF
}

# ============================================
# Main Execution (主执行流程)
# ============================================

main() {
    # Check arguments
    if [ $# -ne 1 ]; then
        usage
    fi
    
    log "=========================================="
    log "QMS 数据库恢复任务开始"
    log "=========================================="
    
    get_backup_file "$1"
    list_backups
    confirm_restore
    verify_backup_file
    create_pre_restore_backup
    terminate_connections
    drop_and_recreate_database
    perform_restore
    verify_restore
    generate_restore_report
    
    log "=========================================="
    log "QMS 数据库恢复任务完成"
    log "=========================================="
}

# Error handler
trap 'log "错误: 恢复过程中发生异常"; exit 1' ERR

# Run main function
main "$@"

exit 0
