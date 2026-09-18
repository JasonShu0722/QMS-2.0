"""
Tests for Migration Validator

测试迁移脚本验证工具的各种场景
"""

import pytest
from pathlib import Path
import tempfile
import sys

# Add scripts directory to path
sys.path.insert(0, str(Path(__file__).parent.parent / 'scripts'))

from validate_migration import MigrationValidator, ViolationType


class TestMigrationValidator:
    """迁移验证器测试"""
    
    def create_temp_migration(self, content: str) -> Path:
        """创建临时迁移文件"""
        temp_file = tempfile.NamedTemporaryFile(
            mode='w',
            suffix='.py',
            delete=False,
            encoding='utf-8'
        )
        temp_file.write(content)
        temp_file.close()
        return Path(temp_file.name)
    
    def test_valid_add_column_with_nullable(self):
        """测试：新增字段设置为 nullable=True（应通过）"""
        content = """
def upgrade():
    op.add_column('users', sa.Column('signature_path', sa.String(255), nullable=True))
"""
        migration_file = self.create_temp_migration(content)
        
        try:
            validator = MigrationValidator(migration_file)
            is_valid, violations = validator.validate()
            
            assert is_valid is True
            assert len(violations) == 0
        finally:
            migration_file.unlink()
    
    def test_valid_add_column_with_default(self):
        """测试：新增字段提供 server_default（应通过）"""
        content = """
def upgrade():
    op.add_column('users', sa.Column('status', sa.String(20), server_default='active'))
"""
        migration_file = self.create_temp_migration(content)
        
        try:
            validator = MigrationValidator(migration_file)
            is_valid, violations = validator.validate()
            
            assert is_valid is True
            assert len(violations) == 0
        finally:
            migration_file.unlink()
    
    def test_invalid_add_column_not_nullable(self):
        """测试：新增字段未设置 nullable 或 default（应失败）"""
        content = """
def upgrade():
    op.add_column('users', sa.Column('required_field', sa.String(50)))
"""
        migration_file = self.create_temp_migration(content)
        
        try:
            validator = MigrationValidator(migration_file)
            is_valid, violations = validator.validate()
            
            assert is_valid is False
            assert len(violations) == 1
            assert violations[0].type == ViolationType.ADD_COLUMN_NOT_NULLABLE
        finally:
            migration_file.unlink()
    
    def test_invalid_drop_column(self):
        """测试：删除字段（应失败）"""
        content = """
def upgrade():
    op.drop_column('users', 'old_field')
"""
        migration_file = self.create_temp_migration(content)
        
        try:
            validator = MigrationValidator(migration_file)
            is_valid, violations = validator.validate()
            
            assert is_valid is False
            assert len(violations) == 1
            assert violations[0].type == ViolationType.DROP_COLUMN
        finally:
            migration_file.unlink()
    
    def test_invalid_drop_table(self):
        """测试：删除表（应失败）"""
        content = """
def upgrade():
    op.drop_table('old_table')
"""
        migration_file = self.create_temp_migration(content)
        
        try:
            validator = MigrationValidator(migration_file)
            is_valid, violations = validator.validate()
            
            assert is_valid is False
            assert len(violations) == 1
            assert violations[0].type == ViolationType.DROP_TABLE
        finally:
            migration_file.unlink()
    
    def test_invalid_rename_column(self):
        """测试：重命名字段（应失败）"""
        content = """
def upgrade():
    op.alter_column('users', 'old_name', new_column_name='new_name')
"""
        migration_file = self.create_temp_migration(content)
        
        try:
            validator = MigrationValidator(migration_file)
            is_valid, violations = validator.validate()
            
            assert is_valid is False
            assert len(violations) == 1
            assert violations[0].type == ViolationType.RENAME_COLUMN
        finally:
            migration_file.unlink()
    
    def test_invalid_alter_column_type(self):
        """测试：修改字段类型（应失败）"""
        content = """
def upgrade():
    op.alter_column('users', 'age', type_=sa.String(10))
"""
        migration_file = self.create_temp_migration(content)
        
        try:
            validator = MigrationValidator(migration_file)
            is_valid, violations = validator.validate()
            
            assert is_valid is False
            assert len(violations) == 1
            assert violations[0].type == ViolationType.ALTER_COLUMN_TYPE
        finally:
            migration_file.unlink()
    
    def test_multiple_violations(self):
        """测试：多个违规项（应失败）"""
        content = """
def upgrade():
    op.drop_column('users', 'old_field')
    op.add_column('users', sa.Column('new_field', sa.String(50)))
    op.drop_table('old_table')
"""
        migration_file = self.create_temp_migration(content)
        
        try:
            validator = MigrationValidator(migration_file)
            is_valid, violations = validator.validate()
            
            assert is_valid is False
            assert len(violations) == 3
            
            violation_types = [v.type for v in violations]
            assert ViolationType.DROP_COLUMN in violation_types
            assert ViolationType.ADD_COLUMN_NOT_NULLABLE in violation_types
            assert ViolationType.DROP_TABLE in violation_types
        finally:
            migration_file.unlink()
    
    def test_valid_create_table(self):
        """测试：创建新表（应通过）"""
        content = """
def upgrade():
    op.create_table(
        'new_table',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('name', sa.String(100), nullable=True)
    )
"""
        migration_file = self.create_temp_migration(content)
        
        try:
            validator = MigrationValidator(migration_file)
            is_valid, violations = validator.validate()
            
            assert is_valid is True
            assert len(violations) == 0
        finally:
            migration_file.unlink()
    
    def test_valid_create_index(self):
        """测试：创建索引（应通过）"""
        content = """
def upgrade():
    op.create_index('idx_users_email', 'users', ['email'])
"""
        migration_file = self.create_temp_migration(content)
        
        try:
            validator = MigrationValidator(migration_file)
            is_valid, violations = validator.validate()
            
            assert is_valid is True
            assert len(violations) == 0
        finally:
            migration_file.unlink()
    
    def test_multiline_add_column_with_nullable(self):
        """测试：多行格式的新增字段（应通过）"""
        content = """
def upgrade():
    op.add_column(
        'users',
        sa.Column(
            'signature_path',
            sa.String(255),
            nullable=True
        )
    )
"""
        migration_file = self.create_temp_migration(content)
        
        try:
            validator = MigrationValidator(migration_file)
            is_valid, violations = validator.validate()
            
            assert is_valid is True
            assert len(violations) == 0
        finally:
            migration_file.unlink()
    
    def test_generate_report(self):
        """测试：生成验证报告"""
        content = """
def upgrade():
    op.drop_column('users', 'old_field')
"""
        migration_file = self.create_temp_migration(content)
        
        try:
            validator = MigrationValidator(migration_file)
            validator.validate()
            
            report = validator.generate_report()
            
            assert '❌ 迁移脚本验证失败' in report
            assert 'drop_column' in report
            assert '违规数量: 1' in report
        finally:
            migration_file.unlink()


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
