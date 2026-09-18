"""
Standalone Tests for Migration Validator

独立测试，不依赖数据库和应用配置
"""

import tempfile
from pathlib import Path


def test_validator_import():
    """测试验证器可以正常导入"""
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent / 'scripts'))
    
    from validate_migration import MigrationValidator, ViolationType
    
    assert MigrationValidator is not None
    assert ViolationType is not None
    print("✅ 验证器导入成功")


def test_valid_migration():
    """测试：有效的迁移脚本"""
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent / 'scripts'))
    
    from validate_migration import MigrationValidator
    
    content = """
def upgrade():
    op.add_column('users', sa.Column('signature_path', sa.String(255), nullable=True))
"""
    
    with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, encoding='utf-8') as f:
        f.write(content)
        temp_path = Path(f.name)
    
    try:
        validator = MigrationValidator(temp_path)
        is_valid, violations = validator.validate()
        
        assert is_valid is True, "应该验证通过"
        assert len(violations) == 0, "不应该有违规项"
        print("✅ 有效迁移脚本测试通过")
    finally:
        temp_path.unlink()


def test_invalid_drop_column():
    """测试：无效的删除字段操作"""
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent / 'scripts'))
    
    from validate_migration import MigrationValidator, ViolationType
    
    content = """
def upgrade():
    op.drop_column('users', 'old_field')
"""
    
    with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, encoding='utf-8') as f:
        f.write(content)
        temp_path = Path(f.name)
    
    try:
        validator = MigrationValidator(temp_path)
        is_valid, violations = validator.validate()
        
        print(f"Debug: is_valid={is_valid}, violations count={len(violations)}")
        for v in violations:
            print(f"  - {v.type}: {v.code_snippet}")
        
        assert is_valid is False, "应该验证失败"
        assert len(violations) >= 1, f"应该至少有1个违规项，实际有 {len(violations)} 个"
        
        # Check if DROP_COLUMN violation exists
        has_drop_column = any(v.type == ViolationType.DROP_COLUMN for v in violations)
        assert has_drop_column, "应该包含 DROP_COLUMN 违规"
        print("✅ 无效删除字段测试通过")
    finally:
        temp_path.unlink()


def test_invalid_add_column_not_nullable():
    """测试：无效的新增非空字段"""
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent / 'scripts'))
    
    from validate_migration import MigrationValidator, ViolationType
    
    content = """
def upgrade():
    op.add_column('users', sa.Column('required_field', sa.String(50)))
"""
    
    with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, encoding='utf-8') as f:
        f.write(content)
        temp_path = Path(f.name)
    
    try:
        validator = MigrationValidator(temp_path)
        is_valid, violations = validator.validate()
        
        assert is_valid is False, "应该验证失败"
        assert len(violations) == 1, "应该有1个违规项"
        assert violations[0].type == ViolationType.ADD_COLUMN_NOT_NULLABLE, "应该是 ADD_COLUMN_NOT_NULLABLE 违规"
        print("✅ 无效新增非空字段测试通过")
    finally:
        temp_path.unlink()


def test_multiple_violations():
    """测试：多个违规项"""
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent / 'scripts'))
    
    from validate_migration import MigrationValidator
    
    content = """
def upgrade():
    op.drop_column('users', 'old_field')
    op.add_column('users', sa.Column('new_field', sa.String(50)))
    op.drop_table('old_table')
"""
    
    with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, encoding='utf-8') as f:
        f.write(content)
        temp_path = Path(f.name)
    
    try:
        validator = MigrationValidator(temp_path)
        is_valid, violations = validator.validate()
        
        assert is_valid is False, "应该验证失败"
        assert len(violations) == 3, f"应该有3个违规项，实际有 {len(violations)} 个"
        print("✅ 多个违规项测试通过")
    finally:
        temp_path.unlink()


def test_generate_report():
    """测试：生成验证报告"""
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent / 'scripts'))
    
    from validate_migration import MigrationValidator
    
    content = """
def upgrade():
    op.drop_column('users', 'old_field')
"""
    
    with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, encoding='utf-8') as f:
        f.write(content)
        temp_path = Path(f.name)
    
    try:
        validator = MigrationValidator(temp_path)
        validator.validate()
        
        report = validator.generate_report()
        
        assert '❌ 迁移脚本验证失败' in report, "报告应包含失败标识"
        assert 'drop_column' in report, "报告应包含违规类型"
        assert '违规数量: 1' in report, "报告应包含违规数量"
        print("✅ 生成验证报告测试通过")
    finally:
        temp_path.unlink()


if __name__ == '__main__':
    print("\n" + "="*80)
    print("运行迁移验证器独立测试")
    print("="*80 + "\n")
    
    test_validator_import()
    test_valid_migration()
    test_invalid_drop_column()
    test_invalid_add_column_not_nullable()
    test_multiple_violations()
    test_generate_report()
    
    print("\n" + "="*80)
    print("✅ 所有测试通过")
    print("="*80 + "\n")
