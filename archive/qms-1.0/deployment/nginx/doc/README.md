# Nginx 双轨路由配置说明

## 概述

本配置实现了 QMS 质量管理系统的双轨发布架构，支持 Preview（预览环境）与 Stable（正式环境）并行运行，共享同一 PostgreSQL 数据库底座。

## 架构特点

- **正式环境 (Stable)**: `qms.company.com` → 面向全体用户的生产环境
- **预览环境 (Preview)**: `preview.company.com` → 用于新功能验证的隔离环境
- **共享数据库**: 两个环境连接同一个 PostgreSQL 数据库，确保数据实时互通
- **独立代码版本**: 预览环境运行最新功能，正式环境运行稳定版本

## 路由规则

### 正式环境 (qms.company.com)
- 前端: `https://qms.company.com/` → `frontend-stable:80`
- 后端 API: `https://qms.company.com/api` → `backend-stable:8000`

### 预览环境 (preview.company.com)
- 前端: `https://preview.company.com/` → `frontend-preview:80`
- 后端 API: `https://preview.company.com/api` → `backend-preview:8000`

## SSL 证书配置

### 生产环境部署前准备

1. **申请 SSL 证书**
   ```bash
   # 为两个域名分别申请证书
   # - qms.company.com
   # - preview.company.com
   ```

2. **创建 SSL 证书目录**
   ```bash
   mkdir -p deployment/nginx/ssl
   ```

3. **放置证书文件**
   ```bash
   # 正式环境证书
   deployment/nginx/ssl/qms.company.com.crt
   deployment/nginx/ssl/qms.company.com.key

   # 预览环境证书
   deployment/nginx/ssl/preview.company.com.crt
   deployment/nginx/ssl/preview.company.com.key
   ```

4. **设置证书文件权限**
   ```bash
   chmod 644 deployment/nginx/ssl/*.crt
   chmod 600 deployment/nginx/ssl/*.key
   ```

### 开发环境（使用自签名证书）

如果在开发环境需要测试 HTTPS，可以生成自签名证书：

```bash
# 生成正式环境自签名证书
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout deployment/nginx/ssl/qms.company.com.key \
  -out deployment/nginx/ssl/qms.company.com.crt \
  -subj "/CN=qms.company.com"

# 生成预览环境自签名证书
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout deployment/nginx/ssl/preview.company.com.key \
  -out deployment/nginx/ssl/preview.company.com.crt \
  -subj "/CN=preview.company.com"
```

**注意**: 自签名证书仅用于开发测试，生产环境必须使用正规 CA 签发的证书。

## 配置特性

### 1. 文件上传限制
- **大小限制**: 50MB (`client_max_body_size 50M`)
- **适用场景**: 支持 8D 报告附件、PPAP 文件包、审核照片等大文件上传

### 2. 静态文件缓存策略

#### 正式环境
- **静态资源** (JS/CSS/图片/字体): 缓存 7 天
- **HTML 文件**: 不缓存，确保用户始终获取最新版本

#### 预览环境
- **静态资源**: 缓存 1 天（便于快速验证新功能）
- **HTML 文件**: 不缓存

### 3. 超时配置
- **连接超时**: 300 秒
- **发送超时**: 300 秒
- **读取超时**: 300 秒
- **适用场景**: 支持长时间运行的任务（如 AI 诊断、大数据导出）

### 4. WebSocket 支持
- 支持实时通知推送
- 支持站内信实时更新

### 5. 安全头配置
- `X-Frame-Options`: 防止点击劫持
- `X-Content-Type-Options`: 防止 MIME 类型嗅探
- `X-XSS-Protection`: XSS 防护
- `Strict-Transport-Security`: 强制 HTTPS（仅正式环境）

## Docker Compose 集成

在 `docker-compose.yml` 中配置 Nginx 服务：

```yaml
services:
  nginx:
    image: nginx:alpine
    container_name: qms-nginx
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./deployment/nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./deployment/nginx/ssl:/etc/nginx/ssl:ro
    depends_on:
      - backend-stable
      - backend-preview
      - frontend-stable
      - frontend-preview
    networks:
      - qms_network
    restart: unless-stopped
```

## 本地开发配置

### 修改 hosts 文件

为了在本地测试双轨路由，需要修改 hosts 文件：

**Windows**: `C:\Windows\System32\drivers\etc\hosts`
**Linux/Mac**: `/etc/hosts`

添加以下内容：
```
127.0.0.1 qms.company.com
127.0.0.1 preview.company.com
```

### 启动服务

```bash
# 启动所有服务
docker-compose up -d

# 查看 Nginx 日志
docker-compose logs -f nginx

# 重新加载 Nginx 配置（无需重启）
docker-compose exec nginx nginx -s reload
```

### 访问地址

- **正式环境**: http://qms.company.com (开发) / https://qms.company.com (生产)
- **预览环境**: http://preview.company.com (开发) / https://preview.company.com (生产)
- **健康检查**: 
  - https://qms.company.com/health
  - https://preview.company.com/health

## 配置验证

### 1. 检查配置语法
```bash
docker-compose exec nginx nginx -t
```

### 2. 查看上游服务器状态
```bash
# 检查后端服务
curl http://localhost/api/health

# 检查前端服务
curl http://localhost/
```

### 3. 测试路由分发
```bash
# 测试正式环境 API
curl -H "Host: qms.company.com" http://localhost/api/health

# 测试预览环境 API
curl -H "Host: preview.company.com" http://localhost/api/health
```

## 故障排查

### 问题 1: 502 Bad Gateway
**原因**: 后端服务未启动或无法连接
**解决**:
```bash
# 检查后端容器状态
docker-compose ps

# 查看后端日志
docker-compose logs backend-stable
docker-compose logs backend-preview
```

### 问题 2: 413 Request Entity Too Large
**原因**: 上传文件超过 50MB 限制
**解决**: 修改 `nginx.conf` 中的 `client_max_body_size` 值

### 问题 3: SSL 证书错误
**原因**: 证书文件路径错误或权限不足
**解决**:
```bash
# 检查证书文件是否存在
ls -la deployment/nginx/ssl/

# 验证证书有效性
openssl x509 -in deployment/nginx/ssl/qms.company.com.crt -text -noout
```

## 性能优化建议

1. **启用 HTTP/2**: 已在配置中启用 (`listen 443 ssl http2`)
2. **Gzip 压缩**: 已启用，压缩级别为 6
3. **Keepalive 连接**: 已配置上游服务器连接池 (`keepalive 32`)
4. **静态资源缓存**: 已配置差异化缓存策略

## 安全加固建议

1. **定期更新 SSL 证书**: 建议在证书到期前 30 天更新
2. **启用 WAF**: 考虑集成 ModSecurity 或云 WAF
3. **限流配置**: 根据实际负载配置 `limit_req` 模块
4. **IP 白名单**: 对管理后台路径配置 IP 访问限制

## 监控与日志

### 访问日志
```bash
# 实时查看访问日志
docker-compose exec nginx tail -f /var/log/nginx/access.log
```

### 错误日志
```bash
# 实时查看错误日志
docker-compose exec nginx tail -f /var/log/nginx/error.log
```

### 日志分析
建议集成 ELK Stack 或 Grafana Loki 进行日志聚合分析。

## 相关文档

- [Docker Compose 配置](../../docker-compose.yml)
- [后端 API 文档](../../backend/README.md)
- [前端部署文档](../../frontend/README.md)
- [系统架构设计](.kiro/specs/qms-foundation-and-auth/design.md)
