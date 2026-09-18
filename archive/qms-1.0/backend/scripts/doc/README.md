# Backend Scripts

本目录包含用于数据库迁移验证、部署检查等实用脚本。

## 迁移脚本验证工具

### 概述

为确保双轨部署架构（Preview & Stable 共享数据库）的稳定性，我们提供了一套完整的 Alembic 迁移脚本验证工具。

### 工具列表

#### 1. `validate_migration.py`

核心验证脚本，检查迁移脚本是否符合非破坏性原则。

**用法**:

```bash
# 验证单个迁移脚本
python scripts/validate_migration.py alembic/versions/001_add_field.py

# 验证所有迁移脚本
python scripts/validate_migration.py --all
```

**检查项**:
- ❌ 禁止 `drop_column` (删除字段)
- ❌ 禁止 `drop_table` (删除表)
- ❌ 禁止 `rename_column` (重命名字段)
- ❌ 禁止 `alter_column type_` (修改字段类型)
- ❌ 禁止新增非空字段且无默认值
- ✅ 允许 `add_column` (新增字段，必须 nullable=True 或有 server_default)
- ✅ 允许 `create_table` (新增表)
- ✅ 允许 `create_index` (新增索引)

#### 2. `ci_validate_migrations.sh`

CI/CD 集成脚本，在部署前自动验证所有迁移脚本。

**用法**:

```bash
# 在 CI/CD 流程中执行
./scripts/ci_validate_migrations.sh
```

**返回值**:
- `0`: 验证通过，允许部署
- `1`: 验证失败，阻止部署

#### 3. `pre_commit_migration_check.py`

Git pre-commit hook，在提交前自动验证迁移脚本。

**安装**:

```bash
# 方式 1: 直接复制
cp scripts/pre_commit_migration_check.py .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit

# 方式 2: 使用 pre-commit 框架（推荐）
# 在 .pre-commit-config.yaml 中配置
```

**效果**:
- 自动检测暂存区中的迁移脚本
- 验证失败时阻止 commit
- 可使用 `git commit --no-verify` 跳过（不推荐）

### 验证报告示例

#### ✅ 验证通过

```
✅ 迁移脚本验证通过

文件: 001_add_signature_field.py
状态: 符合双轨部署兼容性规范
```

#### ❌ 验证失败

```
================================================================================
❌ 迁移脚本验证失败
================================================================================

文件: 002_remove_old_field.py
违规数量: 1

详细信息:

🔴 违规 #1 - drop_column
   行号: 15
   代码: op.drop_column('users', 'old_field')
   说明: 禁止删除字段 (DROP COLUMN)。
原因：Stable 环境的代码可能仍在引用该字段，删除会导致运行时错误。
解决方案：等待 Stable 环境代码更新后，再在后续迁移中清理废弃字段。
   ----------------------------------------------------------------------------

================================================================================
修复建议:
1. 仅使用 op.add_column() 新增字段，且必须设置 nullable=True 或 server_default
2. 仅使用 op.create_table() 新增表
3. 仅使用 op.create_index() 新增索引
4. 禁止删除、重命名、修改类型等破坏性操作
================================================================================
```

## CI/CD 集成

### GitHub Actions

在 `.github/workflows/validate-migrations.yml` 中已配置自动验证。

**触发条件**:
- Pull Request 修改了 `backend/alembic/versions/**`
- Push 到 `preview` 或 `main` 分支

**验证失败时**:
- 自动在 PR 中添加评论
- 阻止合并

### GitLab CI

在 `.gitlab-ci.yml` 中添加：

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

## 最佳实践

### 1. 开发流程

```bash
# 1. 创建迁移脚本
alembic revision -m "add signature field"

# 2. 编辑迁移脚本，确保符合规范
# 新增字段必须设置 nullable=True 或 server_default

# 3. 本地验证
python scripts/validate_migration.py alembic/versions/xxx_add_signature_field.py

# 4. 提交代码（自动触发 pre-commit hook）
git add alembic/versions/xxx_add_signature_field.py
git commit -m "feat: add signature field to users"

# 5. 推送到远程（自动触发 CI/CD 验证）
git push origin feature/add-signature
```

### 2. 字段重命名的正确方式

**错误方式**:
```python
op.alter_column('users', 'old_name', new_column_name='new_name')
```

**正确方式**（分三步）:

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

### 3. 字段类型变更的正确方式

**错误方式**:
```python
op.alter_column('users', 'age', type_=sa.String(10))
```

**正确方式**（分三步）:

```python
# 迁移 1: 新增新字段
def upgrade():
    op.add_column('users', sa.Column('age_str', sa.String(10), nullable=True))

# 迁移 2: 数据迁移
def upgrade():
    op.execute("UPDATE users SET age_str = CAST(age AS VARCHAR)")

# 迁移 3: 等待 Stable 代码更新后，删除旧字段并重命名
def upgrade():
    op.drop_column('users', 'age')
    op.alter_column('users', 'age_str', new_column_name='age')
```

## 常见问题

### Q: 为什么不能删除字段？

A: 因为 Stable 环境的代码可能仍在引用该字段。删除会导致运行时错误。

### Q: 如何处理紧急情况需要删除字段？

A: 
1. 先在 Preview 和 Stable 环境同时部署移除该字段引用的代码
2. 确认两个环境都不再使用该字段
3. 再执行删除字段的迁移

### Q: 验证工具会阻止部署吗？

A: 是的。在 CI/CD 流程中，如果验证失败，部署会被阻止。

### Q: 可以跳过验证吗？

A: 不推荐。如果确实需要：
- Git commit: 使用 `--no-verify`
- CI/CD: 需要修改 workflow 配置（强烈不推荐）

## 相关文档

- [迁移兼容性指南](../docs/MIGRATION_COMPATIBILITY_GUIDE.md)
- [示例：正确的迁移脚本](../alembic/versions/example_good_migration.py.example)
- [示例：错误的迁移脚本](../alembic/versions/example_bad_migration.py.example)

## 技术支持

如有问题，请联系：
- 技术负责人：[Your Name]
- 邮箱：[your.email@company.com]
