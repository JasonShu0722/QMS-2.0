# 数据模型验证清单

## Task 2.1 - 设计用户与权限数据模型

### ✅ User Model (backend/app/models/user.py)

#### 基础字段
- ✅ id (主键)
- ✅ username (唯一索引)
- ✅ password_hash
- ✅ email
- ✅ phone
- ✅ full_name

#### 用户类型
- ✅ user_type (internal/supplier) - 使用枚举 UserType

#### 内部员工字段
- ✅ department
- ✅ position

#### 供应商字段
- ✅ supplier_id (外键关联 suppliers 表)

#### 账号状态
- ✅ status (pending/active/frozen/rejected) - 使用枚举 UserStatus

#### 电子签名
- ✅ digital_signature (图片路径)

#### 安全字段
- ✅ failed_login_attempts
- ✅ locked_until
- ✅ password_changed_at
- ✅ last_login_at (额外添加)

#### 审计字段
- ✅ created_at
- ✅ updated_at
- ✅ created_by
- ✅ updated_by

#### 辅助方法
- ✅ is_account_locked() - 检查账号是否被锁定
- ✅ is_password_expired() - 检查密码是否过期
- ✅ to_dict() - 转换为字典格式

---

### ✅ Permission Model (backend/app/models/permission.py)

#### 基础字段
- ✅ id (主键)
- ✅ user_id (外键关联 users 表，级联删除)
- ✅ module_path (功能模块路径，支持多级)
- ✅ operation_type (操作类型枚举)
- ✅ is_granted (权限授予状态)

#### 操作类型枚举
- ✅ create (录入/新建)
- ✅ read (查阅)
- ✅ update (修改/编辑)
- ✅ delete (删除)
- ✅ export (导出)

#### 唯一约束
- ✅ (user_id, module_path, operation_type) 唯一约束

#### 审计字段
- ✅ created_at
- ✅ updated_at
- ✅ created_by

#### 辅助方法
- ✅ build_permission_key() - 静态方法，构建权限键
- ✅ permission_key - 属性，获取当前权限的权限键
- ✅ to_dict() - 转换为字典格式

---

### ✅ Supplier Model (backend/app/models/supplier.py)

#### 基础字段
- ✅ id (主键)
- ✅ name (供应商名称)
- ✅ code (供应商代码，唯一索引)

#### 联系信息
- ✅ contact_person
- ✅ contact_email
- ✅ contact_phone

#### 资质字段
- ✅ iso9001_cert (证书路径)
- ✅ iso9001_expiry (到期日期)
- ✅ iatf16949_cert (证书路径)
- ✅ iatf16949_expiry (到期日期)

#### 状态
- ✅ status (pending/active/suspended) - 使用枚举 SupplierStatus

#### 审计字段
- ✅ created_at
- ✅ updated_at
- ✅ created_by
- ✅ updated_by

#### 辅助方法
- ✅ to_dict() - 转换为字典格式

---

## 技术实现要点

### 数据库兼容性 (双轨环境)
- ✅ 所有可选字段使用 `Optional[Type]` 和 `nullable=True`
- ✅ 所有枚举使用 `native_enum=False` 以兼容不同数据库
- ✅ 外键使用 `ondelete="SET NULL"` 或 `ondelete="CASCADE"` 确保数据完整性

### 索引优化
- ✅ username 添加唯一索引
- ✅ user_type, status 添加索引（高频查询字段）
- ✅ supplier_id 添加索引（外键）
- ✅ supplier.code 添加唯一索引
- ✅ permission 表的 user_id, module_path, operation_type 添加索引

### 安全性
- ✅ 密码使用 password_hash 存储，不存储明文
- ✅ to_dict() 方法不包含敏感信息（password_hash）
- ✅ 账号锁定机制支持
- ✅ 密码过期检查支持

### 审计追踪
- ✅ 所有表包含 created_at, updated_at
- ✅ 所有表包含 created_by, updated_by（用于追踪操作人）

---

## Requirements 映射

- ✅ Requirements 2.1.1 - 细粒度权限控制体系
- ✅ Requirements 2.1.3 - 用户注册与供应商关联
- ✅ Requirements 2.1.4 - 操作日志审计（审计字段）

---

## 下一步

模型设计已完成，可以进行：
1. 创建 Alembic 数据库迁移脚本
2. 实现 Pydantic Schemas 用于数据校验
3. 实现 Repository 层用于数据访问
4. 实现认证和权限服务
