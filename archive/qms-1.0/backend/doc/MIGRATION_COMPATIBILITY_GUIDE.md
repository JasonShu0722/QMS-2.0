# Alembic 迁移脚本兼容性指南

## 概述

本指南说明如何编写符合双轨部署架构的 Alembic 迁移脚本。QMS 系统采用 Preview（预览环境）与 Stable（正式环境）共享同一 PostgreSQL 数据库的架构，因此迁移脚本必须遵循**非破坏性原则**。

## 核心原则

### ✅ 允许的操作

1. **新增表** (CREATE TABLE)
   ```python
   def upgrade():
       op.create_table(
           'new_table',
           sa.Column('id', sa.Integer(), primary_key=True),
           sa.Column('name', sa.String(100), nullable=True)
       )
   ```

2. **新增字段** (ADD COLUMN) - 必须设置为 Nullable 或带有 Default Value
   ```python
   def upgrade():
       # ✅ 方式 1: 设置为 nullable=True
       op.add_column('users', sa.Column('signature_path', sa.String(255), nullable=True))
       
       # ✅ 方式 2: 提供 server_default
       op.add_column('users', sa.Column('status', sa.String(20), server_default='active'))
       
       # ✅ 方式 3: 同时设置
       op.add_column('users', sa.Column('score', sa.Integer(), nullable=True, server_default='0'))
   ```

3. **新增索引** (CREATE INDEX)
   ```python
   def upgrade():
       op.create_index('idx_users_email', 'users', ['email'])
   ```

4. **新增约束** (ADD CONSTRAINT) - 仅限非空约束以外的约束
   ```python
   def upgrade():
       # ✅ 外键约束
       op.create_foreign_key('fk_users_supplier', 'users', 'suppliers', ['supplier_id'], ['id'])
       
       # ✅ 唯一约束
       op.create_unique_constraint('uq_users_username', 'users', ['username'])
       
       # ✅ 检查约束
       op.create_check_constraint('ck_users_status', 'users', "status IN ('active', 'frozen')")
   ```

### ❌ 禁止的操作

1. **删除字段** (DROP COLUMN)
   ```python
   def upgrade():
       # ❌ 禁止！Stable 环境的代码可能仍在引用该字段
       op.drop_column('users', 'old_field')
   ```
   
   **原因**: Stable 环境的代码可能仍在读取或写入该字段，删除会导致运行时错误。
   
   **解决方案**: 等待 Stable 环境代码更新后，在后续迁移中清理废弃字段。

2. **删除表** (DROP TABLE)
   ```python
   def upgrade():
       # ❌ 禁止！Stable 环境的代码可能仍在访问该表
       op.drop_table('old_table')
   ```
   
   **原因**: Stable 环境的代码可能仍在查询该表，删除会导致数据库错误。
   
   **解决方案**: 等待 Stable 环境代码更新后，在后续迁移中清理废弃表。

3. **重命名字段** (RENAME COLUMN)
   ```python
   def upgrade():
       # ❌ 禁止！Stable 环境的代码仍使用旧字段名
       op.alter_column('users', 'old_name', new_column_name='new_name')
   ```
   
   **原因**: Stable 环境的代码仍使用旧字段名，重命名会导致字段不存在错误。
   
   **解决方案**: 采用"新增+废弃"策略：
   1. 新增新字段（nullable=True）
   2. 数据迁移（可选）
   3. 更新 Preview 代码使用新字段
   4. 等待 Stable 代码更新
   5. 在后续迁移中删除旧字段

4. **修改字段类型** (ALTER COLUMN TYPE)
   ```python
   def upgrade():
       # ❌ 禁止！类型变更可能导致数据读取/写入失败
       op.alter_column('users', 'age', type_=sa.String(10))
   ```
   
   **原因**: 类型变更可能导致 Stable 环境的数据读取/写入失败。
   
   **解决方案**: 
   - 如果类型完全兼容（如 VARCHAR(50) -> VARCHAR(100)），可以执行
   - 否则采用"新增字段"策略

5. **新增非空字段** (ADD COLUMN NOT NULL without DEFAULT)
   ```python
   def upgrade():
       # ❌ 禁止！Stable 环境无法为新字段提供值
       op.add_column('users', sa.Column('required_field', sa.String(50), nullable=False))
   ```
   
   **原因**: Stable 环境的代码不知道新字段的存在，无法在插入数据时提供值。
   
   **解决方案**: 必须设置 `nullable=True` 或提供 `server_default`。

## 验证工具

### 1. 手动验证单个迁移脚本

```bash
cd backend
python scripts/validate_migration.py alembic/versions/001_add_signature.py
```

### 2. 验证所有迁移脚本

```bash
cd backend
python scripts/validate_migration.py --all
```

### 3. CI/CD 集成验证

```bash
cd backend
./scripts/ci_validate_migrations.sh
```

### 4. Pre-commit Hook（推荐）

安装 pre-commit hook，在每次 commit 前自动验证：

```bash
# 复制 hook 脚本
cp backend/scripts/pre_commit_migration_check.py .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

## 验证报告示例

### ✅ 验证通过

```
✅ 迁移脚本验证通过

文件: 001_add_signature_field.py
状态: 符合双轨部署兼容性规范
```

### ❌ 验证失败

```
================================================================================
❌ 迁移脚本验证失败
================================================================================

文件: 002_remove_old_field.py
违规数量: 2

详细信息:

🔴 违规 #1 - drop_column
   行号: 15
   代码: op.drop_column('users', 'old_field')
   说明: 禁止删除字段 (DROP COLUMN)。
原因：Stable 环境的代码可能仍在引用该字段，删除会导致运行时错误。
解决方案：等待 Stable 环境代码更新后，再在后续迁移中清理废弃字段。
   ----------------------------------------------------------------------------

🔴 违规 #2 - add_column_not_nullable
   行号: 18
   代码: op.add_column('users', sa.Column('new_field', sa.String(50)))
   说明: 新增字段必须设置为 nullable=True 或提供 server_default 值。
原因：Stable 环境的旧代码可能无法处理新字段，必须允许空值或提供默认值。
   ----------------------------------------------------------------------------

================================================================================
修复建议:
1. 仅使用 op.add_column() 新增字段，且必须设置 nullable=True 或 server_default
2. 仅使用 op.create_table() 新增表
3. 仅使用 op.create_index() 新增索引
4. 禁止删除、重命名、修改类型等破坏性操作
================================================================================
```

## 最佳实践

### 1. 字段重命名的正确方式

**错误方式**:
```python
def upgrade():
    op.alter_column('users', 'old_name', new_column_name='new_name')
```

**正确方式**:
```python
# 迁移 1: 新增新字段
def upgrade():
    op.add_column('users', sa.Column('new_name', sa.String(100), nullable=True))

# 迁移 2: 数据迁移（可选）
def upgrade():
    op.execute("UPDATE users SET new_name = old_name WHERE new_name IS NULL")

# 迁移 3: 等待 Stable 代码更新后，删除旧字段
def upgrade():
    op.drop_column('users', 'old_name')
```

### 2. 字段类型变更的正确方式

**错误方式**:
```python
def upgrade():
    op.alter_column('users', 'age', type_=sa.String(10))
```

**正确方式**:
```python
# 迁移 1: 新增新字段
def upgrade():
    op.add_column('users', sa.Column('age_str', sa.String(10), nullable=True))

# 迁移 2: 数据迁移
def upgrade():
    op.execute("UPDATE users SET age_str = CAST(age AS VARCHAR) WHERE age_str IS NULL")

# 迁移 3: 等待 Stable 代码更新后，删除旧字段
def upgrade():
    op.drop_column('users', 'age')
    op.alter_column('users', 'age_str', new_column_name='age')
```

### 3. 版本感知代码

后端代码需要对新字段进行判空处理：

```python
class User(Base):
    __tablename__ = "users"
    
    # 新增字段
    signature_path = Column(String(255), nullable=True)
    
    def get_signature(self):
        """兼容旧版本数据"""
        if self.signature_path:
            return self.signature_path
        return None  # 返回默认签名或提示用户上传
```

## CI/CD 集成

### GitHub Actions

在 `.github/workflows/validate-migrations.yml` 中配置：

```yaml
name: Validate Alembic Migrations

on:
  pull_request:
    paths:
      - 'backend/alembic/versions/**'

jobs:
  validate-migrations:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-python@v4
        with:
          python-version: '3.10'
      - run: |
          cd backend
          pip install -r requirements.txt
          ./scripts/ci_validate_migrations.sh
```

### GitLab CI

在 `.gitlab-ci.yml` 中配置：

```yaml
validate-migrations:
  stage: test
  script:
    - cd backend
    - pip install -r requirements.txt
    - ./scripts/ci_validate_migrations.sh
  only:
    changes:
      - backend/alembic/versions/**
```

## 常见问题

### Q1: 为什么不能删除字段？

A: 因为 Stable 环境的代码可能仍在引用该字段。删除会导致：
- `AttributeError`: 'User' object has no attribute 'old_field'
- `ProgrammingError`: column "old_field" does not exist

### Q2: 如何处理紧急情况需要删除字段？

A: 
1. 先在 Preview 和 Stable 环境同时部署移除该字段引用的代码
2. 确认两个环境都不再使用该字段
3. 再执行删除字段的迁移

### Q3: 验证工具会阻止部署吗？

A: 是的。在 CI/CD 流程中，如果验证失败，部署会被阻止。这是为了保护 Stable 环境的稳定性。

### Q4: 可以跳过验证吗？

A: 不推荐。如果确实需要，可以：
- Git commit: 使用 `--no-verify` 跳过 pre-commit hook
- CI/CD: 需要修改 workflow 配置（强烈不推荐）

## 总结

遵循本指南的规范，可以确保：
1. Preview 环境的新功能不会破坏 Stable 环境
2. 数据库迁移平滑无感
3. 双轨部署架构稳定运行

**记住核心原则**: 只增不减，先增后减，版本感知。
