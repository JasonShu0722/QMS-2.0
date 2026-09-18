# QMS 生产环境部署检查清单
# QMS Production Deployment Checklist

## 部署前检查 (Pre-Deployment Checklist)

### 1. 环境准备 (Environment Preparation)

- [ ] 服务器已准备就绪（CPU: 4+ cores, RAM: 8GB+, Disk: 100GB+）
- [ ] Docker 已安装（版本 20.10+）
- [ ] Docker Compose 已安装（版本 2.0+）
- [ ] Git 已安装（版本 2.30+）
- [ ] 网络配置完成（DMZ 区，双网卡：外网 + 内网）
- [ ] 防火墙规则已配置（开放 80/443 端口）

### 2. 域名与 SSL 证书 (Domain and SSL)

- [ ] 域名已解析：`qms.company.com` → 服务器 IP
- [ ] 域名已解析：`preview.company.com` → 服务器 IP
- [ ] SSL 证书已准备：`qms.company.com.crt` 和 `.key`
- [ ] SSL 证书已准备：`preview.company.com.crt` 和 `.key`
- [ ] 证书文件已放置到 `deployment/nginx/ssl/` 目录

### 3. 环境变量配置 (Environment Variables)

- [ ] 已复制 `.env.example` 到 `.env.production`
- [ ] 已配置 `DB_PASSWORD`（强密码，至少 16 位）
- [ ] 已配置 `REDIS_PASSWORD`（强密码，至少 16 位）
- [ ] 已配置 `SECRET_KEY`（至少 32 位随机字符串）
- [ ] 已配置 `IMS_BASE_URL`（内网 IMS 系统地址）
- [ ] 已配置 `IMS_API_KEY`（IMS 系统 API 密钥）
- [ ] 已配置 `SMTP_SERVER` 和 `SMTP_PASSWORD`（邮件服务器）
- [ ] 已配置 `OPENAI_API_KEY`（AI 诊断功能）

### 4. 代码准备 (Code Preparation)

- [ ] 代码已从 Git 仓库克隆
- [ ] 已切换到正确的分支（main 或 production）
- [ ] 已拉取最新代码（`git pull`）
- [ ] 已检查代码完整性（无缺失文件）

---

## 部署执行 (Deployment Execution)

### 5. 自动化部署 (Automated Deployment)

- [ ] 已赋予部署脚本执行权限：`chmod +x deployment/deploy.sh`
- [ ] 已执行部署脚本：`./deployment/deploy.sh`
- [ ] 部署脚本执行成功（无错误输出）
- [ ] 所有容器已启动（9 个容器）
- [ ] 数据库迁移已完成（Alembic upgrade head）

### 6. 服务验证 (Service Verification)

- [ ] PostgreSQL 容器运行正常（`docker ps | grep qms_postgres`）
- [ ] Redis 容器运行正常（`docker ps | grep qms_redis`）
- [ ] Backend (Stable) 容器运行正常
- [ ] Backend (Preview) 容器运行正常
- [ ] Frontend (Stable) 容器运行正常
- [ ] Frontend (Preview) 容器运行正常
- [ ] Nginx 容器运行正常
- [ ] Celery Worker 容器运行正常
- [ ] Celery Beat 容器运行正常

---

## 功能验证 (Functional Verification)

### 7. 基础功能测试 (Basic Functionality Tests)

- [ ] 正式环境前端可访问：`http://localhost/` 或 `https://qms.company.com/`
- [ ] 预览环境前端可访问：`https://preview.company.com/`
- [ ] 后端 API 健康检查通过：`curl http://localhost:8000/health`
- [ ] API 文档可访问：`http://localhost:8000/docs`
- [ ] 数据库连接正常（执行测试查询）
- [ ] Redis 连接正常（`redis-cli ping` 返回 PONG）

### 8. 用户认证测试 (Authentication Tests)

- [ ] 用户注册功能正常（POST `/api/v1/auth/register`）
- [ ] 用户登录功能正常（POST `/api/v1/auth/login`）
- [ ] JWT Token 生成正常
- [ ] 图形验证码生成正常（GET `/api/v1/auth/captcha`）
- [ ] 获取当前用户信息正常（GET `/api/v1/auth/me`）

### 9. 权限系统测试 (Permission System Tests)

- [ ] 权限矩阵配置功能正常
- [ ] 权限检查中间件工作正常
- [ ] 供应商数据隔离正常（仅能查看自己的数据）
- [ ] 操作日志记录正常

### 10. 通知系统测试 (Notification System Tests)

- [ ] 站内信发送功能正常
- [ ] 邮件发送功能正常（SMTP 配置正确）
- [ ] 未读消息计数正常
- [ ] 消息标记已读功能正常

### 11. 任务队列测试 (Task Queue Tests)

- [ ] Celery Worker 正常处理任务
- [ ] Celery Beat 定时任务正常调度
- [ ] IMS 数据同步任务可手动触发
- [ ] 任务执行日志正常记录

### 12. 双轨环境测试 (Dual-Track Environment Tests)

- [ ] 正式环境和预览环境可独立访问
- [ ] 两个环境共享同一数据库（数据一致）
- [ ] 环境切换按钮功能正常
- [ ] 预览环境标识显示正常

---

## 性能与安全 (Performance and Security)

### 13. 性能检查 (Performance Check)

- [ ] 页面加载时间 < 3 秒
- [ ] API 响应时间 < 500ms
- [ ] 数据库查询性能正常（无慢查询）
- [ ] Redis 缓存命中率 > 80%
- [ ] Nginx 静态文件缓存正常

### 14. 安全检查 (Security Check)

- [ ] 所有默认密码已修改
- [ ] HTTPS 强制跳转已启用
- [ ] HSTS 头已配置
- [ ] CORS 配置正确（仅允许指定域名）
- [ ] SQL 注入防护已启用（ORM 参数化查询）
- [ ] XSS 防护已启用（Content-Security-Policy）
- [ ] 敏感信息已加密存储（密码、API 密钥）

### 15. 备份与恢复 (Backup and Recovery)

- [ ] 数据库备份脚本已测试
- [ ] 数据库恢复脚本已测试
- [ ] 定时备份任务已配置（crontab）
- [ ] 备份文件存储路径已配置
- [ ] 备份保留策略已设置（30 天）

---

## 监控与日志 (Monitoring and Logging)

### 16. 日志配置 (Logging Configuration)

- [ ] 应用日志正常输出
- [ ] Nginx 访问日志正常记录
- [ ] Nginx 错误日志正常记录
- [ ] 数据库日志正常记录
- [ ] Celery 任务日志正常记录

### 17. 监控配置 (Monitoring Configuration)

- [ ] 容器资源使用监控已配置
- [ ] 数据库连接数监控已配置
- [ ] Redis 内存使用监控已配置
- [ ] 磁盘空间监控已配置
- [ ] 告警通知已配置（邮件/企业微信）

---

## 文档与培训 (Documentation and Training)

### 18. 文档准备 (Documentation)

- [ ] 部署文档已更新（DEPLOYMENT_GUIDE.md）
- [ ] API 文档已生成（Swagger/OpenAPI）
- [ ] 用户手册已准备
- [ ] 管理员手册已准备
- [ ] 故障排查手册已准备

### 19. 用户培训 (User Training)

- [ ] 管理员培训已完成
- [ ] 关键用户培训已完成
- [ ] 供应商用户培训已完成
- [ ] 操作手册已分发

---

## 上线准备 (Go-Live Preparation)

### 20. 最终检查 (Final Check)

- [ ] 所有功能测试通过
- [ ] 性能测试通过
- [ ] 安全测试通过
- [ ] 备份恢复测试通过
- [ ] 用户验收测试（UAT）通过

### 21. 上线计划 (Go-Live Plan)

- [ ] 上线时间已确定
- [ ] 上线通知已发送（内部员工 + 供应商）
- [ ] 回滚方案已准备
- [ ] 应急联系人已确定
- [ ] 技术支持团队已就位

---

## 部署后检查 (Post-Deployment Checklist)

### 22. 上线后验证 (Post-Go-Live Verification)

- [ ] 用户可正常登录
- [ ] 核心业务流程可正常执行
- [ ] 数据同步正常（IMS 集成）
- [ ] 邮件通知正常发送
- [ ] 无严重错误日志

### 23. 持续监控 (Continuous Monitoring)

- [ ] 第 1 天：每小时检查一次系统状态
- [ ] 第 2-7 天：每 4 小时检查一次系统状态
- [ ] 第 8-30 天：每天检查一次系统状态
- [ ] 用户反馈收集渠道已建立
- [ ] 问题跟踪系统已启用

---

## 签字确认 (Sign-Off)

| 角色 | 姓名 | 签字 | 日期 |
|------|------|------|------|
| 项目经理 | | | |
| 技术负责人 | | | |
| 运维负责人 | | | |
| 质量负责人 | | | |

---

**备注**: 
- ✅ 表示已完成
- ❌ 表示未完成或不适用
- ⚠️ 表示需要关注

**部署完成后，请将此检查清单归档保存！**
