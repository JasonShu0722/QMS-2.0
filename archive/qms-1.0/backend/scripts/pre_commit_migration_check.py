#!/usr/bin/env python3
"""
Pre-commit Hook for Migration Validation

在 Git commit 前自动验证新增或修改的 Alembic 迁移脚本。
仅验证本次提交涉及的迁移文件，提高验证效率。

Installation:
    1. 将此脚本复制到 .git/hooks/pre-commit
    2. 或使用 pre-commit 框架配置
"""

import subprocess
import sys
from pathlib import Path


def get_staged_migration_files():
    """获取暂存区中的迁移脚本文件"""
    try:
        # 获取暂存区文件列表
        result = subprocess.run(
            ['git', 'diff', '--cached', '--name-only', '--diff-filter=ACM'],
            capture_output=True,
            text=True,
            check=True
        )
        
        staged_files = result.stdout.strip().split('\n')
        
        # 筛选出 alembic/versions 目录下的 Python 文件
        migration_files = [
            f for f in staged_files
            if 'alembic/versions' in f and f.endswith('.py') and '__init__' not in f
        ]
        
        return migration_files
    
    except subprocess.CalledProcessError as e:
        print(f"❌ 获取暂存文件失败: {e}")
        return []


def validate_migrations(migration_files):
    """验证迁移脚本"""
    if not migration_files:
        return True
    
    print("\n" + "="*80)
    print("Pre-commit: 验证 Alembic 迁移脚本")
    print("="*80)
    print(f"\n发现 {len(migration_files)} 个迁移脚本需要验证:\n")
    
    for f in migration_files:
        print(f"  - {f}")
    
    print()
    
    # 获取验证脚本路径
    script_dir = Path(__file__).parent
    validator_script = script_dir / 'validate_migration.py'
    
    if not validator_script.exists():
        print(f"⚠️  验证脚本不存在: {validator_script}")
        print("跳过验证...")
        return True
    
    # 验证每个迁移文件
    all_valid = True
    for migration_file in migration_files:
        try:
            result = subprocess.run(
                ['python', str(validator_script), migration_file],
                capture_output=True,
                text=True
            )
            
            print(result.stdout)
            
            if result.returncode != 0:
                all_valid = False
                print(result.stderr)
        
        except Exception as e:
            print(f"❌ 验证失败: {e}")
            all_valid = False
    
    return all_valid


def main():
    """主函数"""
    migration_files = get_staged_migration_files()
    
    if not migration_files:
        # 没有迁移文件需要验证，直接通过
        sys.exit(0)
    
    is_valid = validate_migrations(migration_files)
    
    if is_valid:
        print("\n✅ 迁移脚本验证通过，允许提交")
        sys.exit(0)
    else:
        print("\n❌ 迁移脚本验证失败，阻止提交")
        print("\n请修复违规项后重新提交，或使用 --no-verify 跳过验证（不推荐）")
        sys.exit(1)


if __name__ == '__main__':
    main()
