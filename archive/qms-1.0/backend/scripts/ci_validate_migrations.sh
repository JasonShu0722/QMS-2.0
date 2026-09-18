#!/bin/bash
# CI/CD 迁移脚本验证集成
# 在 Preview 环境部署前自动验证所有 Alembic 迁移脚本

set -e

echo "=========================================="
echo "Alembic 迁移脚本兼容性验证"
echo "=========================================="

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"

# 激活虚拟环境（如果存在）
if [ -d "$BACKEND_DIR/venv" ]; then
    echo "激活虚拟环境..."
    source "$BACKEND_DIR/venv/bin/activate"
fi

# 运行验证脚本
echo ""
echo "开始验证迁移脚本..."
python "$SCRIPT_DIR/validate_migration.py" --all

VALIDATION_RESULT=$?

if [ $VALIDATION_RESULT -eq 0 ]; then
    echo ""
    echo "✅ 迁移脚本验证通过，允许部署"
    exit 0
else
    echo ""
    echo "❌ 迁移脚本验证失败，阻止部署"
    echo ""
    echo "请修复以下问题后重试："
    echo "1. 确保新增字段设置为 nullable=True 或提供 server_default"
    echo "2. 移除所有 drop_column、drop_table、rename_column 操作"
    echo "3. 移除所有 alter_column type_ 修改操作"
    echo ""
    exit 1
fi
