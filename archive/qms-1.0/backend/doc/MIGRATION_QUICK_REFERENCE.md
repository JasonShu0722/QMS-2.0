# Alembic 迁移脚本快速参考

## 快速检查清单

在创建迁移脚本时，请确保：

- [ ] 新增字段设置为 `nullable=True` 或提供 `server_default`
- [ ] 没有使用 `drop_column`
- [ ] 没有使用 `drop_table`
- [ ] 没有使用 `rename_column` 或 `alter_column(..., new_column_name=...)`
- [ ] 没有使用 `alter_column(..., type_=...)`
- [ ] 运行验证脚本: `python scripts/validate_migration.py --all`

## 常用模板

### ✅ 新增字段（Nullable）

```python
def upgrade():
    op.add_column('users', sa.Column('signature_path', sa.String(255), nullable=True))
```

### ✅ 新增字段（带默认值）

```python
def upgrade():
    op.add_column('users', sa.Column('status', sa.String(20), server_default='active'))
```

### ✅ 新增表

```python
def upgrade():
    op.create_table(
        'feature_flags',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('feature_key', sa.String(100), unique=True, nullable=False),
        sa.Column('is_enabled', sa.Boolean(), server_default='false')
    )
```

### ✅ 新增索引

```python
def upgrade():
    op.create_index('idx_users_email', 'users', ['email'])
```

## 常见错误及修复

### ❌ 错误：新增非空字段

```python
# 错误
op.add_column('users', sa.Column('required_field', sa.String(50), nullable=False))
```

```python
# 修复
op.add_column('users', sa.Column('required_field', sa.String(50), nullable=True))
# 或
op.add_column('users', sa.Column('required_field', sa.String(50), server_default='default_value'))
```

### ❌ 错误：删除字段

```python
# 错误
op.drop_column('users', 'old_field')
```

```python
# 修复：分三步
# 步骤 1: 新增替代字段
op.add_column('users', sa.Column('new_field', sa.String(100), nullable=True))

# 步骤 2: 数据迁移（可选）
op.execute("UPDATE users SET new_field = old_field WHERE new_field IS NULL")

# 步骤 3: 等待 Stable 代码更新后，在新的迁移中删除旧字段
# op.drop_column('users', 'old_field')
```

### ❌ 错误：重命名字段

```python
# 错误
op.alter_column('users', 'old_name', new_column_name='new_name')
```

```python
# 修复：使用"新增+废弃"策略（同上）
```

### ❌ 错误：修改字段类型

```python
# 错误
op.alter_column('users', 'age', type_=sa.String(10))
```

```python
# 修复：使用"新增+废弃"策略
# 步骤 1: 新增新类型字段
op.add_column('users', sa.Column('age_str', sa.String(10), nullable=True))

# 步骤 2: 数据迁移
op.execute("UPDATE users SET age_str = CAST(age AS VARCHAR)")

# 步骤 3: 等待 Stable 代码更新后，删除旧字段并重命名
# op.drop_column('users', 'age')
# op.alter_column('users', 'age_str', new_column_name='age')
```

## 验证命令

```bash
# 验证单个迁移脚本
python scripts/validate_migration.py alembic/versions/001_add_field.py

# 验证所有迁移脚本
python scripts/validate_migration.py --all

# CI/CD 验证
./scripts/ci_validate_migrations.sh
```

## 开发流程

```bash
# 1. 创建迁移
alembic revision -m "add signature field"

# 2. 编辑迁移脚本
# 确保符合规范

# 3. 本地验证
python scripts/validate_migration.py alembic/versions/xxx_add_signature.py

# 4. 提交代码
git add alembic/versions/xxx_add_signature.py
git commit -m "feat: add signature field"

# 5. 推送（触发 CI/CD 验证）
git push origin feature/add-signature
```

## 紧急情况处理

如果确实需要执行破坏性操作：

1. 确保 Preview 和 Stable 环境的代码都已更新
2. 确认两个环境都不再使用旧字段/表
3. 在低峰期执行迁移
4. 准备好回滚方案

## 获取帮助

- 详细文档: `backend/docs/MIGRATION_COMPATIBILITY_GUIDE.md`
- 脚本说明: `backend/scripts/README.md`
- 示例代码: `backend/alembic/versions/example_*.py.example`

## 记住核心原则

**只增不减，先增后减，版本感知**

- 优先使用新增操作
- 需要删除时，先新增替代，等 Stable 更新后再删除
- 后端代码需要对新字段进行判空处理
