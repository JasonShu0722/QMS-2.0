#!/usr/bin/env python3
"""
Alembic Migration Compatibility Validator

验证 Alembic 迁移脚本是否符合双轨部署的非破坏性原则。
确保 Preview 环境的数据库变更不会破坏 Stable 环境的运行。

Usage:
    python scripts/validate_migration.py <migration_file_path>
    python scripts/validate_migration.py --all
"""

import re
import sys
import ast
from pathlib import Path
from typing import List, Dict, Tuple
from dataclasses import dataclass
from enum import Enum


class ViolationType(Enum):
    """违规类型"""
    DROP_COLUMN = "drop_column"
    DROP_TABLE = "drop_table"
    RENAME_COLUMN = "rename_column"
    ALTER_COLUMN_TYPE = "alter_column_type"
    ADD_COLUMN_NOT_NULLABLE = "add_column_not_nullable"
    ADD_CONSTRAINT_NOT_NULL = "add_constraint_not_null"


@dataclass
class Violation:
    """违规记录"""
    type: ViolationType
    line_number: int
    code_snippet: str
    message: str
    severity: str  # 'error' or 'warning'


class MigrationValidator:
    """迁移脚本验证器"""
    
    # 禁止的操作模式（正则表达式）
    FORBIDDEN_PATTERNS = {
        ViolationType.DROP_COLUMN: [
            r'op\.drop_column\s*\(',
            r'\.drop_column\s*\(',
        ],
        ViolationType.DROP_TABLE: [
            r'op\.drop_table\s*\(',
            r'\.drop_table\s*\(',
        ],
        ViolationType.RENAME_COLUMN: [
            r'op\.alter_column\s*\([^)]*name\s*=',
            r'\.rename_column\s*\(',
        ],
        ViolationType.ALTER_COLUMN_TYPE: [
            r'op\.alter_column\s*\([^)]*type_\s*=',
        ],
    }
    
    def __init__(self, migration_file: Path):
        self.migration_file = migration_file
        self.violations: List[Violation] = []
        self.content = ""
        
    def validate(self) -> Tuple[bool, List[Violation]]:
        """
        验证迁移脚本
        
        Returns:
            (is_valid, violations): 是否通过验证，违规列表
        """
        if not self.migration_file.exists():
            raise FileNotFoundError(f"Migration file not found: {self.migration_file}")
        
        self.content = self.migration_file.read_text(encoding='utf-8')
        
        # 检查禁止的操作
        self._check_forbidden_operations()
        
        # 检查新增字段的可空性
        self._check_add_column_nullable()
        
        # 生成验证结果
        is_valid = not any(v.severity == 'error' for v in self.violations)
        
        return is_valid, self.violations
    
    def _check_forbidden_operations(self):
        """检查禁止的操作"""
        lines = self.content.split('\n')
        seen_violations = set()  # Track (line_num, violation_type) to avoid duplicates
        
        for violation_type, patterns in self.FORBIDDEN_PATTERNS.items():
            for pattern in patterns:
                for line_num, line in enumerate(lines, start=1):
                    if re.search(pattern, line):
                        # Create unique key to avoid duplicate violations
                        violation_key = (line_num, violation_type)
                        if violation_key not in seen_violations:
                            seen_violations.add(violation_key)
                            self.violations.append(Violation(
                                type=violation_type,
                                line_number=line_num,
                                code_snippet=line.strip(),
                                message=self._get_violation_message(violation_type),
                                severity='error'
                            ))
    
    def _check_add_column_nullable(self):
        """检查新增字段是否设置为 Nullable 或带有 Default Value"""
        lines = self.content.split('\n')
        
        # 匹配 op.add_column() 调用
        add_column_pattern = r'op\.add_column\s*\('
        
        for line_num, line in enumerate(lines, start=1):
            if re.search(add_column_pattern, line):
                # 检查是否包含 nullable=True 或 server_default
                has_nullable = 'nullable=True' in line or 'nullable = True' in line
                has_default = 'server_default' in line or 'default=' in line
                
                # 检查多行情况
                if not (has_nullable or has_default):
                    # 向下查找最多 5 行
                    context_lines = lines[line_num:min(line_num + 5, len(lines))]
                    context = ' '.join(context_lines)
                    
                    has_nullable = 'nullable=True' in context or 'nullable = True' in context
                    has_default = 'server_default' in context or 'default=' in context
                
                if not (has_nullable or has_default):
                    self.violations.append(Violation(
                        type=ViolationType.ADD_COLUMN_NOT_NULLABLE,
                        line_number=line_num,
                        code_snippet=line.strip(),
                        message=(
                            "新增字段必须设置为 nullable=True 或提供 server_default 值。\n"
                            "原因：Stable 环境的旧代码可能无法处理新字段，必须允许空值或提供默认值。"
                        ),
                        severity='error'
                    ))
    
    def _get_violation_message(self, violation_type: ViolationType) -> str:
        """获取违规类型的详细说明"""
        messages = {
            ViolationType.DROP_COLUMN: (
                "禁止删除字段 (DROP COLUMN)。\n"
                "原因：Stable 环境的代码可能仍在引用该字段，删除会导致运行时错误。\n"
                "解决方案：等待 Stable 环境代码更新后，再在后续迁移中清理废弃字段。"
            ),
            ViolationType.DROP_TABLE: (
                "禁止删除表 (DROP TABLE)。\n"
                "原因：Stable 环境的代码可能仍在访问该表，删除会导致数据库错误。\n"
                "解决方案：等待 Stable 环境代码更新后，再在后续迁移中清理废弃表。"
            ),
            ViolationType.RENAME_COLUMN: (
                "禁止重命名字段 (RENAME COLUMN)。\n"
                "原因：Stable 环境的代码仍使用旧字段名，重命名会导致字段不存在错误。\n"
                "解决方案：采用\"新增+废弃\"策略：先新增新字段，数据迁移，待 Stable 更新后删除旧字段。"
            ),
            ViolationType.ALTER_COLUMN_TYPE: (
                "禁止修改字段类型 (ALTER COLUMN TYPE)。\n"
                "原因：类型变更可能导致 Stable 环境的数据读取/写入失败。\n"
                "解决方案：除非类型完全兼容（如 VARCHAR(50) -> VARCHAR(100)），否则采用\"新增字段\"策略。"
            ),
        }
        return messages.get(violation_type, "未知违规类型")
    
    def generate_report(self) -> str:
        """生成验证报告"""
        if not self.violations:
            return f"""
✅ 迁移脚本验证通过

文件: {self.migration_file.name}
状态: 符合双轨部署兼容性规范
"""
        
        report_lines = [
            f"\n{'='*80}",
            f"❌ 迁移脚本验证失败",
            f"{'='*80}",
            f"\n文件: {self.migration_file.name}",
            f"违规数量: {len(self.violations)}",
            f"\n详细信息:\n"
        ]
        
        for idx, violation in enumerate(self.violations, start=1):
            severity_icon = "🔴" if violation.severity == 'error' else "⚠️"
            report_lines.extend([
                f"\n{severity_icon} 违规 #{idx} - {violation.type.value}",
                f"   行号: {violation.line_number}",
                f"   代码: {violation.code_snippet}",
                f"   说明: {violation.message}",
                f"   {'-'*76}"
            ])
        
        report_lines.extend([
            f"\n{'='*80}",
            "修复建议:",
            "1. 仅使用 op.add_column() 新增字段，且必须设置 nullable=True 或 server_default",
            "2. 仅使用 op.create_table() 新增表",
            "3. 仅使用 op.create_index() 新增索引",
            "4. 禁止删除、重命名、修改类型等破坏性操作",
            f"{'='*80}\n"
        ])
        
        return '\n'.join(report_lines)


def validate_single_migration(migration_path: Path) -> bool:
    """验证单个迁移脚本"""
    print(f"\n正在验证: {migration_path.name}")
    
    validator = MigrationValidator(migration_path)
    is_valid, violations = validator.validate()
    
    report = validator.generate_report()
    print(report)
    
    return is_valid


def validate_all_migrations(alembic_versions_dir: Path) -> bool:
    """验证所有迁移脚本"""
    if not alembic_versions_dir.exists():
        print(f"❌ Alembic versions 目录不存在: {alembic_versions_dir}")
        return False
    
    migration_files = sorted(alembic_versions_dir.glob("*.py"))
    migration_files = [f for f in migration_files if f.name != '__init__.py']
    
    if not migration_files:
        print("⚠️  未找到任何迁移脚本")
        return True
    
    print(f"\n找到 {len(migration_files)} 个迁移脚本")
    
    all_valid = True
    for migration_file in migration_files:
        is_valid = validate_single_migration(migration_file)
        if not is_valid:
            all_valid = False
    
    return all_valid


def main():
    """主函数"""
    if len(sys.argv) < 2:
        print("用法:")
        print("  python scripts/validate_migration.py <migration_file_path>")
        print("  python scripts/validate_migration.py --all")
        sys.exit(1)
    
    arg = sys.argv[1]
    
    if arg == '--all':
        # 验证所有迁移脚本
        backend_dir = Path(__file__).parent.parent
        alembic_versions_dir = backend_dir / 'alembic' / 'versions'
        
        is_valid = validate_all_migrations(alembic_versions_dir)
        
        if is_valid:
            print("\n✅ 所有迁移脚本验证通过")
            sys.exit(0)
        else:
            print("\n❌ 部分迁移脚本验证失败，请修复后重试")
            sys.exit(1)
    else:
        # 验证单个迁移脚本
        migration_path = Path(arg)
        
        is_valid = validate_single_migration(migration_path)
        
        if is_valid:
            sys.exit(0)
        else:
            sys.exit(1)


if __name__ == '__main__':
    main()
